import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import spec from '../../openapi.json';
import { harness } from '../testing/harness';
import {
  API_VERSION,
  deprecatedOperations,
  deprecationHeaders,
  versioning,
  type VersionedDocument,
} from './versioning';

const retiring = {
  deprecated: true,
  'x-deprecated-since': '2027-01-01',
  'x-sunset': '2027-07-02',
};

function appWith(document: VersionedDocument, basePath = '') {
  const app = basePath ? new Hono().basePath(basePath) : new Hono();
  app.use('*', versioning(basePath, document));
  app.all('*', (c) => c.json({ ok: true }));
  return app;
}

describe('the API version header', () => {
  it('is on every answer under /v1, errors included, and on nothing else', async () => {
    const h = harness();
    for (const [method, path] of [
      ['GET', '/v1/openapi.json'],
      ['GET', '/v1/envelopes'],
      ['GET', '/v1/envelopes/missing'],
      ['POST', '/v1/envelopes'],
      ['GET', '/v1/templates'],
      ['GET', `/v1/verify/${'a'.repeat(64)}`],
      ['GET', `/v1/sign/${'x'.repeat(43)}`],
      ['GET', '/v1/no-such-route'],
    ] as const) {
      const res = await h.call(method, path);
      expect(res.res.headers.get('codevibe-api-version'), `${method} ${path}`).toBe(API_VERSION);
      expect(res.res.headers.get('deprecation')).toBeNull();
      expect(res.res.headers.get('sunset')).toBeNull();
    }
    const unauthorized = await h.call('GET', '/v1/envelopes', { auth: false });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.res.headers.get('codevibe-api-version')).toBe(API_VERSION);
    expect((await h.call('GET', '/health')).res.headers.get('codevibe-api-version')).toBeNull();
  });

  it('follows the base path the server is mounted under', async () => {
    const h = harness({ basePath: '/api' });
    const res = await h.server.app.request('/api/v1/openapi.json');
    expect(res.headers.get('codevibe-api-version')).toBe(API_VERSION);
  });
});

describe('deprecated operations', () => {
  it('finds none in the API as it is published today', () => {
    expect(deprecatedOperations(spec)).toEqual([]);
  });

  it('announce since when and until when on their own answers only', async () => {
    const app = appWith(
      {
        paths: {
          '/v1/envelopes/{id}/remind': { post: retiring, get: {} },
          '/v1/sign/{token}': { get: retiring },
          '/v1/sign/receipt': { get: {} },
        },
      },
      '/api',
    );
    const old = await app.request('/api/v1/envelopes/env_1/remind', { method: 'POST' });
    expect(old.headers.get('deprecation')).toBe('@1798761600');
    expect(old.headers.get('sunset')).toBe('Fri, 02 Jul 2027 00:00:00 GMT');
    expect(old.headers.get('link')).toBe(
      '<https://sign.codevibe.in/docs/http-api/versioning>; rel="deprecation"; type="text/html"',
    );
    expect(old.headers.get('codevibe-api-version')).toBe(API_VERSION);

    for (const [method, path] of [
      ['GET', '/api/v1/envelopes/env_1/remind'],
      ['POST', '/api/v1/envelopes/env_1/remind/more'],
      ['POST', '/api/v1/envelopes/env_1'],
      ['GET', '/api/v1/sign/receipt'],
    ] as const) {
      const res = await app.request(path, { method });
      expect(res.headers.get('deprecation'), `${method} ${path}`).toBeNull();
      expect(res.headers.get('sunset')).toBeNull();
      expect(res.headers.get('link')).toBeNull();
    }
    const token = await app.request('/api/v1/sign/abc');
    expect(token.headers.get('sunset')).not.toBeNull();
  });

  it('formats the headers as RFC 9745 and RFC 8594 ask', () => {
    const headers = deprecationHeaders({
      method: 'GET',
      path: '/v1/x',
      since: new Date('2027-01-01T00:00:00Z'),
      sunset: new Date('2027-12-31T00:00:00Z'),
    });
    expect(headers.Deprecation).toMatch(/^@\d+$/);
    expect(new Date(headers.Sunset!).toISOString()).toBe('2027-12-31T00:00:00.000Z');
  });

  it('refuse to start without both dates or with under six months of notice', () => {
    const doc = (operation: object) => ({ paths: { '/v1/x': { get: operation } } });
    expect(() => deprecatedOperations(doc({ deprecated: true }))).toThrow(/x-deprecated-since/);
    expect(() =>
      deprecatedOperations(doc({ deprecated: true, 'x-deprecated-since': '2027-01-01' })),
    ).toThrow(/x-sunset/);
    expect(() => deprecatedOperations(doc({ ...retiring, 'x-sunset': '2027-06-01' }))).toThrow(
      /six months/,
    );
    expect(() => versioning('', doc({ ...retiring, 'x-sunset': 'soon' }))).toThrow(/x-sunset/);
    expect(deprecatedOperations(doc({ ...retiring, deprecated: false }))).toEqual([]);
  });
});
