import type { MiddlewareHandler } from 'hono';
import bundled from '../../openapi.json';

/** The version of the whole HTTP API, as in the `/v1` of every route. */
export const API_VERSION = '1';
export const VERSION_HEADER = 'Codevibe-Api-Version';
/** Where deprecations are announced and the policy is written down. */
export const DEPRECATION_POLICY_URL = 'https://sign.codevibe.in/docs/http-api/versioning';

const METHODS = ['get', 'put', 'post', 'patch', 'delete'] as const;

/** Notice between marking an operation deprecated and switching it off: six months. */
export const MIN_NOTICE_DAYS = 182;

export interface DeprecatedOperation {
  method: string;
  /** The path as the document writes it, for example `/v1/envelopes/{id}`. */
  path: string;
  /** When the operation was marked deprecated. */
  since: Date;
  /** When it stops working. */
  sunset: Date;
}

interface DocumentedOperation {
  deprecated?: boolean;
  'x-deprecated-since'?: string;
  'x-sunset'?: string;
}

export interface VersionedDocument {
  paths: Record<string, unknown>;
}

function dateOf(value: unknown, what: string): Date {
  const date = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) throw new Error(`${what} must be a date such as 2027-06-30`);
  return date;
}

/**
 * The operations a document marks `deprecated: true`. Each must say since when
 * (`x-deprecated-since`) and until when it keeps working (`x-sunset`), at least six months
 * apart; a document that breaks the promise stops the server from starting.
 */
export function deprecatedOperations(document: VersionedDocument): DeprecatedOperation[] {
  const found: DeprecatedOperation[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation = (item as Record<string, DocumentedOperation | undefined>)[method];
      if (!operation?.deprecated) continue;
      const name = `${method.toUpperCase()} ${path}`;
      const since = dateOf(operation['x-deprecated-since'], `${name}: x-deprecated-since`);
      const sunset = dateOf(operation['x-sunset'], `${name}: x-sunset`);
      if (sunset.getTime() - since.getTime() < MIN_NOTICE_DAYS * 86_400_000) {
        throw new Error(`${name}: x-sunset must be at least six months after x-deprecated-since`);
      }
      found.push({ method: method.toUpperCase(), path, since, sunset });
    }
  }
  return found;
}

/** `Deprecation` (RFC 9745), `Sunset` (RFC 8594) and a link to the announcement. */
export function deprecationHeaders(operation: DeprecatedOperation): Record<string, string> {
  return {
    Deprecation: `@${Math.floor(operation.since.getTime() / 1000)}`,
    Sunset: operation.sunset.toUTCString(),
    Link: `<${DEPRECATION_POLICY_URL}>; rel="deprecation"; type="text/html"`,
  };
}

const parameters = (path: string) => path.split('{').length - 1;

const pattern = (path: string) =>
  new RegExp(
    `^${path
      .split(/\{[^}]+\}/)
      .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[^/]+')}/?$`,
  );

/**
 * Marks every API answer with the API version, and the answers of deprecated operations with
 * when they stop working, so a client learns of it from the responses it already gets.
 */
export function versioning(
  basePath: string,
  document: VersionedDocument = bundled,
): MiddlewareHandler {
  const prefix = `${basePath}/v1/`;
  const deprecated = deprecatedOperations(document);
  // Every documented path takes part in the match, fewest parameters first as in the router,
  // so `/v1/sign/receipt` is never taken for a deprecated `/v1/sign/{token}`.
  const routes = Object.keys(deprecated.length > 0 ? document.paths : {})
    .sort((a, b) => parameters(a) - parameters(b))
    .map((path) => ({ path, matches: pattern(path) }));
  return async (c, next) => {
    await next();
    if (!c.req.path.startsWith(prefix)) return;
    c.header(VERSION_HEADER, API_VERSION);
    if (routes.length === 0) return;
    const requested = c.req.path.slice(basePath.length);
    const route = routes.find((r) => r.matches.test(requested));
    const hit = deprecated.find((d) => d.path === route?.path && d.method === c.req.method);
    if (!hit) return;
    for (const [name, value] of Object.entries(deprecationHeaders(hit))) c.header(name, value);
  };
}
