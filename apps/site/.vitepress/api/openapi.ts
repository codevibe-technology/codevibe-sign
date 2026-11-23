import document from '../../../../packages/server/openapi.json' with { type: 'json' };

export interface Schema {
  $ref?: string;
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  allOf?: Schema[];
  oneOf?: Schema[];
  anyOf?: Schema[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  format?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  additionalProperties?: boolean | Schema;
  propertyNames?: Schema;
  contentEncoding?: string;
  contentMediaType?: string;
  readOnly?: boolean;
  example?: unknown;
  examples?: unknown[];
}

export interface MediaType {
  schema?: Schema;
  example?: unknown;
  examples?: Record<string, { $ref?: string; summary?: string; value?: unknown }>;
}

export interface RawParameter {
  $ref?: string;
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: Schema;
  example?: unknown;
}

export interface RawResponse {
  $ref?: string;
  description?: string;
  headers?: Record<string, { $ref?: string; description?: string; schema?: Schema }>;
  content?: Record<string, MediaType>;
}

export interface RawOperation {
  operationId: string;
  tags?: string[];
  summary?: string;
  description?: string;
  security?: Record<string, string[]>[];
  parameters?: RawParameter[];
  requestBody?: { $ref?: string; required?: boolean; content?: Record<string, MediaType> };
  responses?: Record<string, RawResponse>;
}

export interface SecurityScheme {
  type: string;
  scheme?: string;
  in?: string;
  name?: string;
  description?: string;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: { url: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  security?: Record<string, string[]>[];
  paths: Record<string, Record<string, RawOperation | RawParameter[] | undefined>>;
  webhooks?: Record<string, Record<string, RawOperation>>;
  components: {
    schemas: Record<string, Schema>;
    parameters?: Record<string, RawParameter>;
    responses?: Record<string, RawResponse>;
    securitySchemes?: Record<string, SecurityScheme>;
    examples?: Record<string, { value?: unknown }>;
    headers?: Record<string, { description?: string; schema?: Schema }>;
  };
}

export const spec = document as unknown as OpenApiDocument;

/** Follows `$ref` pointers inside the document until it reaches a node without one. */
export function deref<T extends { $ref?: string }>(node: T, from: OpenApiDocument = spec): T {
  let current: unknown = node;
  const seen = new Set<string>();
  while (current && typeof (current as { $ref?: unknown }).$ref === 'string') {
    const ref = (current as { $ref: string }).$ref;
    if (seen.has(ref)) throw new Error(`Circular reference ${ref}`);
    seen.add(ref);
    if (!ref.startsWith('#/')) throw new Error(`Only local references are supported: ${ref}`);
    current = ref
      .slice(2)
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce<unknown>((at, key) => (at as Record<string, unknown> | undefined)?.[key], from);
    if (current === undefined) throw new Error(`Unresolved reference ${ref}`);
  }
  return current as T;
}

/** The component name a `$ref` points at, such as `Envelope`. */
export function refName(ref: string | undefined): string | undefined {
  return ref?.startsWith('#/components/schemas/') ? ref.slice(21) : undefined;
}

/** The first example of a media type, following example references. */
export function mediaExample(media: MediaType | undefined): unknown {
  if (!media) return undefined;
  if (media.example !== undefined) return media.example;
  const first = Object.values(media.examples ?? {})[0];
  return first ? deref(first).value : undefined;
}
