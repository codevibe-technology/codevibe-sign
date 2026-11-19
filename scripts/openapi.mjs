#!/usr/bin/env node
// Builds the files that come from the OpenAPI document, packages/server/openapi.yaml:
// packages/server/openapi.json (served at GET /v1/openapi.json) and the Postman collection in
// docs/postman. With --check it writes nothing and fails when either is out of date.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { parse } from 'yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const SOURCE = join(root, 'packages/server/openapi.yaml');
const JSON_OUT = join(root, 'packages/server/openapi.json');
const POSTMAN_OUT = join(root, 'docs/postman/codevibe-sign.postman_collection.json');

const METHODS = ['get', 'put', 'post', 'patch', 'delete'];

/** Variables a request sets from its response, so the next request in the folder just works. */
const CAPTURE = {
  createEnvelope: [
    'const body = pm.response.json();',
    "if (body.id) pm.collectionVariables.set('envelopeId', body.id);",
    "if (body.documents?.[0]) pm.collectionVariables.set('docId', body.documents[0].id);",
  ],
  verifyOtp: [
    'const body = pm.response.json();',
    "if (body.sessionToken) pm.collectionVariables.set('signerSession', body.sessionToken);",
  ],
};

/** Collection variables that stand in for path parameters. */
const PATH_VARIABLES = { id: 'envelopeId', docId: 'docId', token: 'token' };

function resolve(spec, node) {
  let current = node;
  while (current && typeof current.$ref === 'string') {
    current = current.$ref
      .slice(2)
      .split('/')
      .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
      .reduce((at, key) => at?.[key], spec);
  }
  return current;
}

function exampleOf(spec, media) {
  if (!media) return undefined;
  if (media.example !== undefined) return media.example;
  const first = Object.values(media.examples ?? {})[0];
  return first ? resolve(spec, first).value : undefined;
}

function requestFor(spec, path, method, operation, pathItem) {
  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map((p) =>
    resolve(spec, p),
  );
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/^\{(.+)\}$/, ':$1'));
  const query = parameters
    .filter((p) => p.in === 'query')
    .map((p) => ({ key: p.name, value: '', description: p.description ?? '', disabled: true }));
  const url = {
    raw: `{{baseUrl}}/${segments.join('/')}`,
    host: ['{{baseUrl}}'],
    path: segments,
    ...(query.length ? { query } : {}),
    variable: parameters
      .filter((p) => p.in === 'path')
      .map((p) => ({
        key: p.name,
        value: `{{${PATH_VARIABLES[p.name] ?? p.name}}}`,
        description: (p.description ?? '').trim(),
      })),
  };
  if (url.variable.length === 0) delete url.variable;

  const header = parameters
    .filter((p) => p.in === 'header' && p.name !== 'If-None-Match')
    .map((p) => ({
      key: p.name,
      value: p.name === 'Idempotency-Key' ? '{{$guid}}' : '',
      description: (p.description ?? '').trim(),
      disabled: true,
    }));
  const security = operation.security ?? spec.security ?? [];
  if (security.some((s) => 'signerSession' in s)) {
    header.push({
      key: 'X-Sign-Session',
      value: '{{signerSession}}',
      description: 'For recipients who sign with a one-time code, after otp/verify.',
      disabled: true,
    });
  }

  const request = {
    method: method.toUpperCase(),
    header,
    url,
    description: [operation.summary, operation.description?.trim()].filter(Boolean).join('\n\n'),
  };
  if (!security.some((s) => 'apiKey' in s)) request.auth = { type: 'noauth' };

  const content = resolve(spec, operation.requestBody)?.content ?? {};
  const json = exampleOf(spec, content['application/json']);
  if (json !== undefined) {
    header.push({ key: 'Content-Type', value: 'application/json' });
    request.body = {
      mode: 'raw',
      raw: JSON.stringify(json, null, 2),
      options: { raw: { language: 'json' } },
    };
  } else if (content['multipart/form-data']) {
    request.body = { mode: 'formdata', formdata: [] };
  }
  return request;
}

function uploadVariant(spec, path, operation, pathItem) {
  const media = resolve(spec, operation.requestBody)?.content?.['multipart/form-data'];
  if (!media) return undefined;
  const schema = resolve(spec, media.schema);
  const request = requestFor(spec, path, 'post', operation, pathItem);
  request.header = request.header.filter((h) => h.key !== 'Content-Type');
  request.body = {
    mode: 'formdata',
    formdata: [
      {
        key: 'envelope',
        value: schema.properties.envelope.examples[0],
        type: 'text',
        contentType: 'application/json',
      },
      { key: 'documents', type: 'file', src: [] },
    ],
  };
  return { name: `${operation.summary} (multipart upload)`, request };
}

function toPostman(spec) {
  const folders = new Map((spec.tags ?? []).map((tag) => [tag.name, { tag, item: [] }]));
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;
      const folder = folders.get(operation.tags?.[0]);
      const item = {
        name: operation.summary,
        request: requestFor(spec, path, method, operation, pathItem),
      };
      const capture = CAPTURE[operation.operationId];
      if (capture)
        item.event = [{ listen: 'test', script: { type: 'text/javascript', exec: capture } }];
      folder.item.push(item);
      const upload = uploadVariant(spec, path, operation, pathItem);
      if (upload) folder.item.push(upload);
    }
  }
  return {
    info: {
      name: spec.info.title,
      description: `${spec.info.summary}\n\nGenerated from the OpenAPI document. Set \`baseUrl\` and \`apiKey\` first.`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{apiKey}}', type: 'string' }] },
    variable: [
      { key: 'baseUrl', value: spec.servers[0].variables.baseUrl.default },
      { key: 'apiKey', value: '' },
      { key: 'envelopeId', value: '' },
      { key: 'docId', value: '' },
      { key: 'token', value: '' },
      { key: 'signerSession', value: '' },
    ],
    item: [...folders.values()]
      .filter((folder) => folder.item.length > 0)
      .map(({ tag, item }) => ({ name: tag.name, description: tag.description.trim(), item })),
  };
}

async function format(file, value) {
  const options = (await prettier.resolveConfig(file)) ?? {};
  return prettier.format(JSON.stringify(value), { ...options, filepath: file });
}

const spec = parse(readFileSync(SOURCE, 'utf8'));
const outputs = [
  [JSON_OUT, await format(JSON_OUT, spec)],
  [POSTMAN_OUT, await format(POSTMAN_OUT, toPostman(spec))],
];

const check = process.argv.includes('--check');
let stale = false;
for (const [file, text] of outputs) {
  let current = '';
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    current = '';
  }
  if (current === text) continue;
  if (check) {
    console.error(`${relative(root, file)} is out of date; run pnpm openapi`);
    stale = true;
  } else {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    console.log(`wrote ${relative(root, file)}`);
  }
}
if (stale) process.exit(1);
