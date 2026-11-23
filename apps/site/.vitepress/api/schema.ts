import { deref, refName, spec, type OpenApiDocument, type Schema } from './openapi.ts';

/** A schema with `allOf` merged in and `$ref` followed; the name is kept when there was one. */
export interface Resolved {
  schema: Schema;
  name?: string;
  nullable: boolean;
}

function mergeAll(parts: Schema[], doc: OpenApiDocument): Schema {
  const merged: Schema = {};
  for (const part of parts) {
    const flat = flatten(part, doc).schema;
    const properties = { ...merged.properties, ...flat.properties };
    const required = [...new Set([...(merged.required ?? []), ...(flat.required ?? [])])];
    Object.assign(merged, flat, { properties, required });
  }
  return merged;
}

/** Follows references, merges `allOf` and reads `oneOf: [X, null]` as a nullable X. */
export function flatten(input: Schema, doc: OpenApiDocument = spec): Resolved {
  const name = refName(input.$ref);
  let schema = input.$ref ? { ...deref(input, doc), ...omit(input, '$ref') } : input;
  let nullable = false;

  const variants = schema.oneOf ?? schema.anyOf;
  if (variants && !schema.type && !schema.properties) {
    const real = variants.filter((v) => !isNull(v));
    if (real.length === 1 && real.length < variants.length) {
      const inner = flatten(real[0]!, doc);
      return {
        schema: { ...inner.schema, ...omit(schema, 'oneOf', 'anyOf') },
        name: name ?? inner.name,
        nullable: true,
      };
    }
  }
  if (Array.isArray(schema.type) && schema.type.includes('null')) {
    nullable = true;
    const rest = schema.type.filter((t) => t !== 'null');
    schema = { ...schema, type: rest.length === 1 ? rest[0] : rest };
  }
  if (schema.allOf) {
    const { allOf, ...own } = schema;
    schema = mergeAll([...allOf, own], doc);
  }
  return { schema, ...(name ? { name } : {}), nullable };
}

function omit(schema: Schema, ...keys: (keyof Schema)[]): Schema {
  const copy = { ...schema };
  for (const key of keys) delete copy[key];
  return copy;
}

function isNull(schema: Schema): boolean {
  return schema.type === 'null';
}

function primaryType(schema: Schema): string | undefined {
  if (Array.isArray(schema.type)) return schema.type[0];
  if (schema.type) return schema.type;
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  if (schema.enum?.length) return typeof schema.enum[0];
  if (schema.const !== undefined) return typeof schema.const;
  return undefined;
}

/** A short type label such as `string`, `integer`, `array of objects` or `Envelope`. */
export function typeLabel(input: Schema, doc: OpenApiDocument = spec): string {
  const { schema, nullable } = flatten(input, doc);
  let label: string;
  const type = primaryType(schema);
  if (type === 'array' && schema.items) {
    const item = flatten(schema.items, doc).schema;
    const itemType = primaryType(item) ?? 'value';
    label = `array of ${itemType === 'object' ? 'objects' : `${itemType}s`}`;
  } else if (type === 'object' && !schema.properties && schema.additionalProperties) {
    label = 'map';
  } else if (schema.contentEncoding === 'base64') {
    label = 'string (base64)';
  } else if (schema.format && type === 'string') {
    label = `string (${schema.format})`;
  } else {
    label = type ?? 'any';
  }
  return nullable ? `${label} or null` : label;
}

export interface FieldDoc {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enumValues: string[];
  defaultValue?: string;
  constraints: string[];
  children: FieldDoc[];
}

const literal = (value: unknown) => (typeof value === 'string' ? value : JSON.stringify(value));

function constraintsOf(schema: Schema): string[] {
  const out: string[] = [];
  const range = (min: number | undefined, max: number | undefined, one: string, many: string) => {
    const unit = (n: number) => (n === 1 ? one : many);
    if (min !== undefined && max !== undefined) out.push(`${min} to ${max}${unit(max)}`);
    else if (min === 1 && one) out.push('not empty');
    else if (min !== undefined) out.push(`at least ${min}${unit(min)}`);
    else if (max !== undefined) out.push(`at most ${max}${unit(max)}`);
  };
  range(schema.minLength, schema.maxLength, ' character', ' characters');
  range(schema.minimum, schema.maximum, '', '');
  range(schema.minItems, schema.maxItems, ' item', ' items');
  if (schema.pattern) out.push(`matches \`${schema.pattern}\``);
  if (schema.const !== undefined) out.push(`always \`${literal(schema.const)}\``);
  return out;
}

function childrenOf(schema: Schema, doc: OpenApiDocument, depth: number): FieldDoc[] {
  if (depth > 4) return [];
  if (schema.properties) return describeObject(schema, doc, depth + 1);
  if (schema.items) {
    const item = flatten(schema.items, doc).schema;
    if (item.properties) return describeObject(item, doc, depth + 1);
  }
  return [];
}

/** The rows of an object schema: one per property, with nested objects as children. */
export function describeObject(input: Schema, doc: OpenApiDocument = spec, depth = 0): FieldDoc[] {
  const schema = flatten(input, doc).schema;
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, property]) => {
    const resolved = flatten(property, doc).schema;
    const enumSource = resolved.enum ?? flatten(resolved.items ?? {}, doc).schema.enum;
    return {
      name,
      type: typeLabel(property, doc),
      required: required.has(name),
      ...(firstText(property.description, resolved.description)
        ? { description: firstText(property.description, resolved.description)! }
        : {}),
      enumValues: (enumSource ?? []).map(literal),
      ...(resolved.default !== undefined ? { defaultValue: literal(resolved.default) } : {}),
      constraints: constraintsOf(resolved),
      children: childrenOf(resolved, doc, depth),
    };
  });
}

function firstText(...texts: (string | undefined)[]): string | undefined {
  return texts.find((text) => text && text.trim())?.trim();
}

/** `anyOf` alternatives that only list required properties, as a readable rule. */
export function requirementRule(input: Schema, doc: OpenApiDocument = spec): string | undefined {
  const schema = flatten(input, doc).schema;
  const sets = (schema.anyOf ?? schema.oneOf)?.map((variant) => variant.required);
  if (!sets || sets.some((set) => !set?.length)) return undefined;
  const named = sets.map((set) => set!.map((name) => `\`${name}\``).join(', '));
  return `Give either ${named.join(' or ')}.`;
}

const SAMPLE_STRINGS: Record<string, string> = {
  'date-time': '2026-03-02T09:14:31.000Z',
  date: '2026-03-02',
  uuid: '7f3c9a2e-5b1d-4e8a-9c6f-2d4b8e1a0c37',
  email: 'asha@example.com',
  uri: 'https://sign.example.com/sign/q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw',
};

/** Values for the patterns the document uses; a test checks every generated example. */
const PATTERN_SAMPLES: Record<string, string> = {
  '^[0-9a-f]{64}$': '9f2c'.repeat(16),
  '^\\+[1-9]\\d{6,14}$': '+919876543210',
};

/**
 * A value that fits the schema, built from its examples, defaults and formats. Used where the
 * document gives no example of its own.
 */
export function exampleOf(input: Schema, doc: OpenApiDocument = spec, depth = 0): unknown {
  const { schema, nullable } = flatten(input, doc);
  if (depth > 8) return nullable ? null : undefined;
  if (schema.example !== undefined) return schema.example;
  if (schema.examples?.length) return schema.examples[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants && !schema.properties && !schema.type)
    return exampleOf(variants[0]!, doc, depth + 1);

  switch (primaryType(schema)) {
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const [name, property] of Object.entries(schema.properties ?? {})) {
        const value = exampleOf(property, doc, depth + 1);
        if (value !== undefined) out[name] = value;
      }
      return out;
    }
    case 'array': {
      const item = schema.items ? exampleOf(schema.items, doc, depth + 1) : undefined;
      return item === undefined ? [] : [item];
    }
    case 'integer':
    case 'number':
      return schema.minimum ?? 1;
    case 'boolean':
      return true;
    case 'string':
      if (schema.pattern && PATTERN_SAMPLES[schema.pattern]) return PATTERN_SAMPLES[schema.pattern];
      if (schema.format && SAMPLE_STRINGS[schema.format]) return SAMPLE_STRINGS[schema.format];
      return 'string';
    case 'null':
      return null;
    default:
      return nullable ? null : undefined;
  }
}
