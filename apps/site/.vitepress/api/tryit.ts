import { findOperation, successResponse, needsApiKey, type Operation } from './model.ts';
import { flatten } from './schema.ts';

/**
 * The "Try it" panel never talks to a real server from the public docs. It answers from the
 * OpenAPI document in the browser (mock), or, when the docs themselves run on this machine,
 * calls a sandbox server that is also on this machine. Both rules are enforced here.
 */

export interface TryItInput {
  path: Record<string, string>;
  query: Record<string, string>;
  body: string;
}

export interface TryItResult {
  status: number;
  statusText: string;
  body: string;
  contentType: string;
  ms: number;
  mock: boolean;
}

export interface TryItModel {
  id: string;
  method: string;
  path: string;
  needsKey: boolean;
  pathParams: { name: string; example: string }[];
  queryParams: { name: string; example: string; required: boolean }[];
  body?: string;
  /** The request is a file upload; the form has no file field, so only the mock runs it. */
  upload: boolean;
  bodyRequired: string[];
  success?: { status: number; example: unknown; mediaType?: string };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK.has(hostname.toLowerCase()) || hostname.toLowerCase().endsWith('.localhost');
}

/** A sandbox target must be plain http(s) on this machine, with no credentials in the URL. */
export function isSandboxTarget(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    !parsed.username &&
    !parsed.password &&
    isLoopbackHost(parsed.hostname)
  );
}

/** Calling a sandbox is only offered when the docs page itself is served from this machine. */
export function sandboxAvailable(pageHostname: string): boolean {
  return isLoopbackHost(pageHostname);
}

export function modelFor(operationId: string): TryItModel | undefined {
  const op = findOperation(operationId);
  return op ? toModel(op) : undefined;
}

function toModel(op: Operation): TryItModel {
  const success = successResponse(op);
  // The create example carries a small real PDF, so it also works against a sandbox as it is.
  const body = op.body ? JSON.stringify(op.body.example, null, 2) : undefined;
  return {
    id: op.id,
    method: op.method.toUpperCase(),
    path: op.path,
    needsKey: needsApiKey(op),
    pathParams: op.parameters
      .filter((p) => p.in === 'path')
      .map((p) => ({ name: p.name, example: String(p.example ?? '') })),
    queryParams: op.parameters
      .filter((p) => p.in === 'query')
      .map((p) => ({
        name: p.name,
        example: p.exampleGiven || p.required ? String(p.example ?? '') : '',
        required: p.required,
      })),
    ...(body !== undefined ? { body } : {}),
    upload: op.upload !== undefined,
    bodyRequired: op.body ? (flatten(op.body.schema).schema.required ?? []) : [],
    ...(success
      ? {
          success: {
            status: Number(success.status),
            example: success.example,
            ...(success.mediaType ? { mediaType: success.mediaType } : {}),
          },
        }
      : {}),
  };
}

export function requestPath(model: TryItModel, input: TryItInput): string {
  let path = model.path;
  for (const { name } of model.pathParams) {
    path = path.replace(`{${name}}`, encodeURIComponent(input.path[name] ?? ''));
  }
  const query = new URLSearchParams();
  for (const { name } of model.queryParams) {
    const value = input.query[name]?.trim();
    if (value) query.set(name, value);
  }
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  303: 'See Other',
  400: 'Bad Request',
};

function validationError(issues: { path: string; message: string }[]): TryItResult {
  return {
    status: 400,
    statusText: 'Bad Request',
    contentType: 'application/json',
    body: JSON.stringify(
      { error: { code: 'VALIDATION', message: issues[0]!.message, details: { issues } } },
      null,
      2,
    ),
    ms: 0,
    mock: true,
  };
}

/** The answer the documented server would give, worked out from the document alone. */
export function mockResponse(model: TryItModel, input: TryItInput): TryItResult {
  const missing = model.pathParams.filter(({ name }) => !input.path[name]?.trim());
  if (missing.length) {
    return validationError(
      missing.map(({ name }) => ({ path: name, message: `${name} is required` })),
    );
  }
  const required = model.queryParams.filter((p) => p.required && !input.query[p.name]?.trim());
  if (required.length) {
    return validationError(
      required.map(({ name }) => ({ path: name, message: `${name} is required` })),
    );
  }
  if (model.body !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.body);
    } catch {
      return validationError([{ path: '', message: 'The request body is not valid JSON' }]);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return validationError([{ path: '', message: 'The request body must be a JSON object' }]);
    }
    const absent = model.bodyRequired.filter((name) => !(name in parsed));
    if (absent.length) {
      return validationError(
        absent.map((name) => ({ path: name, message: `${name} is required` })),
      );
    }
  }
  const sha256 = model.pathParams.some((p) => p.name === 'sha256') ? input.path.sha256 : undefined;
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/i.test(sha256.trim())) {
    return validationError([
      { path: 'sha256', message: 'sha256 must be 64 hexadecimal characters' },
    ]);
  }
  const success = model.success;
  if (!success)
    return { status: 204, statusText: 'No Content', body: '', contentType: '', ms: 0, mock: true };
  if (success.mediaType === 'application/pdf') {
    return {
      status: success.status,
      statusText: STATUS_TEXT[success.status] ?? '',
      contentType: 'application/pdf',
      body: '%PDF-1.7 ... (a real server sends the PDF bytes here)',
      ms: 0,
      mock: true,
    };
  }
  if (success.status >= 300 && success.status < 400) {
    return {
      status: success.status,
      statusText: STATUS_TEXT[success.status] ?? '',
      contentType: '',
      body: 'Location: /sign',
      ms: 0,
      mock: true,
    };
  }
  return {
    status: success.status,
    statusText: STATUS_TEXT[success.status] ?? '',
    contentType: 'application/json',
    body: JSON.stringify(withPathIds(success.example, input.path), null, 2),
    ms: 0,
    mock: true,
  };
}

/** Echoes the id or hash typed into the form, so the answer reads as an answer to it. */
function withPathIds(example: unknown, path: Record<string, string>): unknown {
  if (!example || typeof example !== 'object' || Array.isArray(example)) return example;
  const record = example as Record<string, unknown>;
  const sha256 = path.sha256?.trim().toLowerCase();
  if (sha256 && typeof record.sha256 === 'string') return { ...record, sha256 };
  const id = (path.id ?? path.templateId)?.trim();
  if (!id) return example;
  if (typeof record.id === 'string') return { ...record, id };
  if (typeof record.envelopeId === 'string') return { ...record, envelopeId: id };
  return example;
}

export interface SandboxRequest {
  baseUrl: string;
  apiKey: string;
  pageHostname: string;
}

/** Sends the request to a sandbox on this machine; refuses anything else before any network. */
export async function sandboxResponse(
  model: TryItModel,
  input: TryItInput,
  sandbox: SandboxRequest,
  fetcher: typeof fetch = fetch,
): Promise<TryItResult> {
  if (!sandboxAvailable(sandbox.pageHostname)) {
    throw new Error('The sandbox can only be called when these docs run on your machine.');
  }
  if (model.upload) {
    throw new Error('This route takes a file. Send it with the curl sample above.');
  }
  const base = sandbox.baseUrl.trim().replace(/\/+$/, '');
  if (!isSandboxTarget(base)) {
    throw new Error('Enter a server on this machine, such as http://localhost:3000.');
  }
  const headers: Record<string, string> = { Accept: 'application/json, application/pdf' };
  if (model.needsKey && sandbox.apiKey.trim())
    headers.Authorization = `Bearer ${sandbox.apiKey.trim()}`;
  if (model.body !== undefined) headers['Content-Type'] = 'application/json';
  if (model.method === 'POST') headers['Idempotency-Key'] = crypto.randomUUID();

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetcher(`${base}${requestPath(model, input)}`, {
      method: model.method,
      headers,
      ...(model.body !== undefined ? { body: input.body } : {}),
      credentials: 'omit',
      redirect: 'manual',
      cache: 'no-store',
      signal: controller.signal,
    });
    const contentType = response.headers.get('content-type') ?? '';
    let body: string;
    if (contentType.includes('application/json')) {
      body = JSON.stringify(await response.json(), null, 2);
    } else if (contentType.includes('application/pdf')) {
      body = `PDF, ${(await response.arrayBuffer()).byteLength} bytes`;
    } else {
      body = await response.text();
    }
    return {
      status: response.status,
      statusText: response.statusText,
      contentType,
      body,
      ms: Math.round(performance.now() - started),
      mock: false,
    };
  } finally {
    clearTimeout(timer);
  }
}
