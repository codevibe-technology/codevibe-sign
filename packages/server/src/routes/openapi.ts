import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import document from '../../openapi.json';

const body = JSON.stringify(document);
const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;

/**
 * `GET /v1/openapi.json`: the description of this API. Public, cacheable and readable from any
 * origin, since it holds nothing that is not in the published package.
 */
export function openApiRoutes() {
  const app = new Hono();
  app.get('/', (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    c.header('ETag', etag);
    c.header('Access-Control-Allow-Origin', '*');
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    c.header('Content-Type', 'application/json; charset=utf-8');
    return c.body(body);
  });
  return app;
}
