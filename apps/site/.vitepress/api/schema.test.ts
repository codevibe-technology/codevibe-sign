import { describe, expect, it } from 'vitest';
import { describeObject, exampleOf, flatten, requirementRule, typeLabel } from './schema.ts';
import type { OpenApiDocument } from './openapi.ts';

const doc = {
  openapi: '3.1.0',
  info: { title: 't', version: '1' },
  paths: {},
  components: {
    schemas: {
      Id: { type: 'string', minLength: 1, description: 'An id.' },
      Stamp: { type: 'string', format: 'date-time' },
      Box: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { $ref: '#/components/schemas/Id' },
          at: { oneOf: [{ $ref: '#/components/schemas/Stamp' }, { type: 'null' }] },
          kind: { type: 'string', enum: ['a', 'b'], default: 'a' },
          items: {
            type: 'array',
            items: { type: 'object', properties: { n: { type: 'integer', minimum: 2 } } },
          },
        },
        anyOf: [{ required: ['id'] }, { required: ['kind', 'items'] }],
      },
      Child: {
        allOf: [{ $ref: '#/components/schemas/Box' }],
        properties: { extra: { type: 'boolean' } },
      },
    },
  },
} as unknown as OpenApiDocument;

describe('schema helpers', () => {
  it('reads oneOf with null as a nullable type', () => {
    const resolved = flatten(
      { oneOf: [{ $ref: '#/components/schemas/Stamp' }, { type: 'null' }] },
      doc,
    );
    expect(resolved.nullable).toBe(true);
    expect(resolved.schema.format).toBe('date-time');
    expect(typeLabel({ type: ['string', 'null'] }, doc)).toBe('string or null');
  });

  it('merges allOf parts and their required lists', () => {
    const fields = describeObject({ $ref: '#/components/schemas/Child' }, doc);
    expect(fields.map((f) => f.name)).toEqual(['id', 'at', 'kind', 'items', 'extra']);
    expect(fields.find((f) => f.name === 'id')).toMatchObject({
      required: true,
      description: 'An id.',
    });
  });

  it('describes enums, defaults, constraints and nested objects', () => {
    const fields = describeObject({ $ref: '#/components/schemas/Box' }, doc);
    expect(fields.find((f) => f.name === 'kind')).toMatchObject({
      enumValues: ['a', 'b'],
      defaultValue: 'a',
    });
    expect(fields.find((f) => f.name === 'id')!.constraints).toEqual(['not empty']);
    const items = fields.find((f) => f.name === 'items')!;
    expect(items.type).toBe('array of objects');
    expect(items.children[0]).toMatchObject({ name: 'n', constraints: ['at least 2'] });
  });

  it('states anyOf requirements in words', () => {
    expect(requirementRule({ $ref: '#/components/schemas/Box' }, doc)).toBe(
      'Give either `id` or `kind`, `items`.',
    );
  });

  it('builds examples that respect formats, defaults and minimums', () => {
    expect(exampleOf({ $ref: '#/components/schemas/Box' }, doc)).toEqual({
      id: 'string',
      at: '2026-03-02T09:14:31.000Z',
      kind: 'a',
      items: [{ n: 2 }],
    });
  });

  it('refuses references it cannot resolve', () => {
    expect(() => flatten({ $ref: '#/components/schemas/Missing' }, doc)).toThrow(/Unresolved/);
  });
});
