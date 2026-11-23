import {
  deref,
  mediaExample,
  spec,
  type OpenApiDocument,
  type RawOperation,
  type RawParameter,
  type Schema,
} from './openapi.ts';
import { exampleOf } from './schema.ts';

export const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type Method = (typeof METHODS)[number];

export interface Parameter {
  name: string;
  in: RawParameter['in'];
  required: boolean;
  description?: string;
  schema: Schema;
  example: unknown;
  /** Whether the document gives the example, rather than it being made up from the schema. */
  exampleGiven: boolean;
}

export interface ResponseDoc {
  status: string;
  description: string;
  mediaType?: string;
  schema?: Schema;
  example: unknown;
  headers: { name: string; description: string }[];
}

export interface Operation {
  id: string;
  anchor: string;
  method: Method;
  path: string;
  summary: string;
  description: string;
  resource: string;
  /** Security requirements; an empty list means the route is public. */
  security: Record<string, string[]>[];
  parameters: Parameter[];
  body?: { required: boolean; schema: Schema; example: unknown; mediaTypes: string[] };
  /** Set when the request is a file and nothing else: its media types, the raw one first. */
  upload?: { mediaTypes: string[]; field: string };
  responses: ResponseDoc[];
}

export interface Resource {
  name: string;
  slug: string;
  description: string;
  operations: Operation[];
}

/** `createEnvelope` becomes `create-envelope`: the anchor of an operation on its page. */
export const anchorOf = (operationId: string) =>
  operationId.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

export const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/** A real-looking signing token: 43 base64url characters, as the path pattern requires. */
export const SAMPLE_TOKEN = 'q3X9vL2pR8mT4kW7nB1cF6hJ0dS5gY2uE9aZ3xK7oPw';

function parameterOf(raw: RawParameter, doc: OpenApiDocument): Parameter {
  const parameter = deref(raw, doc);
  const schema = parameter.schema ?? {};
  const example =
    parameter.example ??
    (parameter.name === 'token' ? SAMPLE_TOKEN : undefined) ??
    exampleOf(schema, doc);
  return {
    name: parameter.name,
    in: parameter.in,
    required: parameter.required ?? parameter.in === 'path',
    ...(parameter.description ? { description: parameter.description.trim() } : {}),
    schema,
    example,
    exampleGiven: parameter.example !== undefined || schema.example !== undefined,
  };
}

function responsesOf(raw: RawOperation, doc: OpenApiDocument): ResponseDoc[] {
  return Object.entries(raw.responses ?? {}).map(([status, rawResponse]) => {
    const response = deref(rawResponse, doc);
    const [mediaType, media] = Object.entries(response.content ?? {})[0] ?? [];
    const example =
      mediaExample(media) ??
      (media?.schema && mediaType === 'application/json'
        ? exampleOf(media.schema, doc)
        : undefined);
    return {
      status,
      description: (response.description ?? '').trim(),
      ...(mediaType ? { mediaType } : {}),
      ...(media?.schema ? { schema: media.schema } : {}),
      example,
      headers: Object.entries(response.headers ?? {}).map(([name, header]) => ({
        name,
        description: (deref(header, doc).description ?? '').trim(),
      })),
    };
  });
}

function operationOf(
  path: string,
  method: Method,
  raw: RawOperation,
  shared: RawParameter[],
  doc: OpenApiDocument,
): Operation {
  const body = raw.requestBody ? deref(raw.requestBody, doc) : undefined;
  const json = body?.content?.['application/json'];
  return {
    id: raw.operationId,
    anchor: anchorOf(raw.operationId),
    method,
    path,
    summary: raw.summary ?? raw.operationId,
    description: (raw.description ?? '').trim(),
    resource: raw.tags?.[0] ?? 'Other',
    security: raw.security ?? doc.security ?? [],
    parameters: [...shared, ...(raw.parameters ?? [])].map((p) => parameterOf(p, doc)),
    ...(body && json?.schema
      ? {
          body: {
            required: body.required ?? false,
            schema: json.schema,
            example: mediaExample(json) ?? exampleOf(json.schema, doc),
            mediaTypes: Object.keys(body.content ?? {}),
          },
        }
      : {}),
    ...(body && !json && body.content?.['application/pdf']
      ? {
          upload: {
            mediaTypes: [
              'application/pdf',
              ...Object.keys(body.content).filter((t) => t !== 'application/pdf'),
            ],
            field: 'file',
          },
        }
      : {}),
    responses: responsesOf(raw, doc),
  };
}

/** Every operation of the document, in document order. */
export function operations(doc: OpenApiDocument = spec): Operation[] {
  return Object.entries(doc.paths).flatMap(([path, item]) => {
    const shared = (item.parameters as RawParameter[] | undefined) ?? [];
    return METHODS.filter((method) => item[method]).map((method) =>
      operationOf(path, method, item[method] as RawOperation, shared, doc),
    );
  });
}

/** The webhook deliveries the server sends, described like operations. */
export function webhookEvents(doc: OpenApiDocument = spec): Operation[] {
  return Object.values(doc.webhooks ?? {}).flatMap((item) =>
    METHODS.filter((method) => item[method]).map((method) =>
      operationOf('', method, item[method]!, [], doc),
    ),
  );
}

/** Operations grouped by their first tag, in the order the tags are declared. */
export function resources(doc: OpenApiDocument = spec): Resource[] {
  const all = operations(doc);
  const declared = (doc.tags ?? []).map((tag) => tag.name);
  const names = [...declared, ...all.map((op) => op.resource).filter((n) => !declared.includes(n))];
  return [...new Set(names)]
    .map((name) => ({
      name,
      slug: slugOf(name),
      description: (doc.tags?.find((tag) => tag.name === name)?.description ?? '').trim(),
      operations: all.filter((op) => op.resource === name),
    }))
    .filter((resource) => resource.operations.length > 0);
}

export function findOperation(id: string, doc: OpenApiDocument = spec): Operation | undefined {
  return operations(doc).find((op) => op.id === id);
}

export function successResponse(op: Operation): ResponseDoc | undefined {
  return op.responses.find((r) => /^[23]/.test(r.status));
}

/** True when every way to call the route needs a sender API key. */
export const needsApiKey = (op: Operation) =>
  op.security.length > 0 && op.security.every((requirement) => 'apiKey' in requirement);
