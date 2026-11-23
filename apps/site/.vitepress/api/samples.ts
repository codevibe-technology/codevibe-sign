import { spec, type OpenApiDocument, type Schema } from './openapi.ts';
import { needsApiKey, successResponse, type Operation } from './model.ts';
import { flatten } from './schema.ts';

/** The cloud API. Self-hosted servers use their own address in its place. */
export const BASE_URL = 'https://sign.codevibe.in/api';

export const LANGUAGES = [
  { id: 'curl', label: 'curl', fence: 'sh' },
  { id: 'node', label: 'Node.js', fence: 'ts' },
  { id: 'python', label: 'Python', fence: 'python' },
  { id: 'go', label: 'Go', fence: 'go' },
] as const;
export type Language = (typeof LANGUAGES)[number]['id'];

/** A file read from disk and sent as base64, standing in for the inline example bytes. */
export class FileRef {
  readonly path: string;
  constructor(path: string) {
    this.path = path;
  }
}

export interface SampleRequest {
  method: string;
  url: string;
  headers: [string, string][];
  /** Header values read from an environment variable, by header name. */
  secrets: Record<string, string>;
  body?: unknown;
  binaryResponse: boolean;
  redirect: boolean;
  files: string[];
}

const SECRET_ENV: Record<string, string> = {
  Authorization: 'SIGN_API_KEY',
  'X-Sign-Session': 'SIGN_SESSION',
  'X-Sign-Receipt': 'SIGN_RECEIPT',
};

/** Replaces base64 file contents in an example with the file they would be read from. */
function withFiles(
  value: unknown,
  schema: Schema,
  doc: OpenApiDocument,
  sibling = 'document.pdf',
): unknown {
  const resolved = flatten(schema, doc).schema;
  if (resolved.contentEncoding === 'base64' && typeof value === 'string')
    return new FileRef(sibling);
  if (Array.isArray(value)) {
    return resolved.items ? value.map((item) => withFiles(item, resolved.items!, doc)) : value;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : sibling;
    return Object.fromEntries(
      Object.entries(record).map(([key, item]) => {
        const property = resolved.properties?.[key];
        return [key, property ? withFiles(item, property, doc, name) : item];
      }),
    );
  }
  return value;
}

function collectFiles(value: unknown, into: string[] = []): string[] {
  if (value instanceof FileRef) into.push(value.path);
  else if (Array.isArray(value)) value.forEach((item) => collectFiles(item, into));
  else if (value && typeof value === 'object')
    Object.values(value).forEach((item) => collectFiles(item, into));
  return into;
}

/** The example request of an operation, shared by every language. */
export function sampleRequest(op: Operation, doc: OpenApiDocument = spec): SampleRequest {
  let path = op.path;
  for (const p of op.parameters.filter((p) => p.in === 'path')) {
    path = path.replace(`{${p.name}}`, encodeURIComponent(String(p.example)));
  }
  const query = op.parameters
    .filter((p) => p.in === 'query' && (p.required || p.exampleGiven))
    .map((p) => `${encodeURIComponent(p.name)}=${String(p.example)}`);
  const url = `${BASE_URL}${path}${query.length ? `?${query.join('&')}` : ''}`;

  const headers: [string, string][] = [];
  const secrets: Record<string, string> = {};
  const first = op.security[0] ?? {};
  if (needsApiKey(op)) {
    headers.push(['Authorization', 'Bearer $SIGN_API_KEY']);
    secrets.Authorization = SECRET_ENV.Authorization!;
  } else {
    for (const name of Object.keys(first)) {
      const scheme = doc.components.securitySchemes?.[name];
      if (scheme?.in === 'header' && scheme.name) {
        const env = SECRET_ENV[scheme.name] ?? 'SIGN_TOKEN';
        headers.push([scheme.name, `$${env}`]);
        secrets[scheme.name] = env;
      }
    }
  }
  const idempotency = op.parameters.find((p) => p.name === 'Idempotency-Key');
  if (idempotency) headers.push(['Idempotency-Key', String(idempotency.example)]);

  const body = op.body ? withFiles(op.body.example, op.body.schema, doc) : undefined;
  if (body !== undefined) headers.push(['Content-Type', 'application/json']);
  const success = successResponse(op);
  return {
    method: op.method.toUpperCase(),
    url,
    headers,
    secrets,
    ...(body !== undefined ? { body } : {}),
    binaryResponse: success?.mediaType === 'application/pdf',
    redirect: success?.status.startsWith('3') ?? false,
    files: collectFiles(body),
  };
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A value as a JavaScript literal, with files read by `readFile`. */
export function jsLiteral(value: unknown, indent = ''): string {
  const next = `${indent}  `;
  if (value instanceof FileRef) return `await readFile('${value.path}')`;
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((item) => `${next}${jsLiteral(item, next)},`).join('\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const lines = entries.map(
      ([key, item]) =>
        `${next}${IDENTIFIER.test(key) ? key : `'${key}'`}: ${jsLiteral(item, next)},`,
    );
    return `{\n${lines.join('\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function pyLiteral(value: unknown, indent = ''): string {
  const next = `${indent}    `;
  if (value instanceof FileRef) return `b64("${value.path}")`;
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((item) => `${next}${pyLiteral(item, next)},`).join('\n')}\n${indent}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const lines = entries.map(
      ([key, item]) => `${next}${JSON.stringify(key)}: ${pyLiteral(item, next)},`,
    );
    return `{\n${lines.join('\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function goLiteral(value: unknown, indent = ''): string {
  const next = `${indent}\t`;
  if (value instanceof FileRef) return `b64(${JSON.stringify(value.path)})`;
  if (value === null) return 'nil';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]any{}';
    return `[]any{\n${value.map((item) => `${next}${goLiteral(item, next)},`).join('\n')}\n${indent}}`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return 'map[string]any{}';
    const lines = entries.map(
      ([key, item]) => `${next}${JSON.stringify(key)}: ${goLiteral(item, next)},`,
    );
    return `map[string]any{\n${lines.join('\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

export function curlSample(request: SampleRequest): string {
  const lines = [
    `curl${request.method === 'GET' ? '' : ` -X ${request.method}`} ${request.url.includes('?') ? `"${request.url}"` : request.url}`,
  ];
  for (const [name, value] of request.headers) lines.push(`-H "${name}: ${value}"`);
  if (request.body !== undefined) {
    const json = JSON.stringify(
      request.body,
      (_key, value: unknown) => (value instanceof FileRef ? `@@FILE:${value.path}@@` : value),
      2,
    );
    const quoted = shellQuote(json).replace(
      /"@@FILE:([^@]+)@@"/g,
      (_match, path: string) => `"'"$(base64 < ${path} | tr -d '\\n')"'"`,
    );
    lines.push(`-d ${quoted}`);
  }
  if (request.binaryResponse) lines.push('-o document.pdf');
  if (request.redirect) lines.push('-i');
  return lines.join(' \\\n  ');
}

const SENDER_SETUP = `const sign = createSignClient({
  baseUrl: '${BASE_URL}',
  apiKey: process.env.SIGN_API_KEY!,
});`;

type NodeCall = (args: { path: Record<string, string>; body: Record<string, unknown> }) => {
  code: string;
  imports?: string[];
};

/** Operations that `@codevibe_technology/sign-client` has a method for. */
const SENDER_CALLS: Record<string, NodeCall> = {
  createEnvelope: ({ body }) => ({
    code: `const envelope = await sign.envelopes.create(${jsLiteral(body)});\n\nconsole.log(envelope.id, envelope.status);`,
  }),
  getEnvelope: ({ path }) => ({
    code: `const envelope = await sign.envelopes.get(${jsLiteral(path.id)});\n\nconsole.log(envelope.status, envelope.recipients);`,
  }),
  updateEnvelope: ({ path, body }) => ({
    code: `const envelope = await sign.envelopes.update(${jsLiteral(path.id)}, ${jsLiteral(body)});`,
  }),
  sendEnvelope: ({ path }) => ({
    code: `const envelope = await sign.envelopes.send(${jsLiteral(path.id)});`,
  }),
  voidEnvelope: ({ path, body }) => ({
    code: `const envelope = await sign.envelopes.void(${jsLiteral(path.id)}, ${jsLiteral(body.reason)});`,
  }),
  shareSigningLink: ({ path }) => ({
    code: `const { url } = await sign.envelopes.shareLink(${jsLiteral(path.id)}, ${jsLiteral(path.recipientId)});\n\n// Treat the link like a password.`,
  }),
  correctRecipient: ({ path, body }) => ({
    code: `const envelope = await sign.envelopes.correctRecipient(\n  ${jsLiteral(path.id)},\n  ${jsLiteral(path.recipientId)},\n  ${jsLiteral(body, '  ')},\n);`,
  }),
  recallEnvelope: ({ path, body }) => ({
    code: `const { draft, recalled } = await sign.envelopes.recall(${jsLiteral(path.id)}, ${jsLiteral(body.note)});`,
  }),
  reviseEnvelope: ({ path }) => ({
    code: `const { draft, declined } = await sign.envelopes.revise(${jsLiteral(path.id)});`,
  }),
  listEnvelopeEvents: ({ path }) => ({
    code: `const { events, chainValid } = await sign.envelopes.events(${jsLiteral(path.id)});`,
  }),
  downloadDocument: ({ path }) => ({
    imports: [`import { writeFile } from 'node:fs/promises';`],
    code: `const pdf = await sign.envelopes.downloadDocument(${jsLiteral(path.id)}, ${jsLiteral(path.docId)}, {\n  version: 'sealed',\n});\nawait writeFile('sealed.pdf', pdf);`,
  }),
  getCertificate: ({ path }) => ({
    code: `const certificate = await sign.envelopes.certificate(${jsLiteral(path.id)});`,
  }),
};

const SIGNER_CALLS: Record<string, NodeCall> = {
  getSigningSession: () => ({ code: 'const session = await signer.session();' }),
  getSigningDocument: ({ path }) => ({
    code: `const pdf = await signer.document(${jsLiteral(path.docId)});`,
  }),
  sendOtp: () => ({ code: 'const { sentTo } = await signer.requestOtp();' }),
  verifyOtp: ({ body }) => ({ code: `await signer.verifyOtp(${jsLiteral(body.code)});` }),
  markViewed: () => ({ code: 'await signer.view();' }),
  submitSignature: ({ body }) => ({
    code: `// Call only after the signer has agreed: the client sends consent: true.\nconst result = await signer.submit(${jsLiteral(body.values)});`,
  }),
  declineSignature: ({ body }) => ({
    code: `const result = await signer.decline(${jsLiteral(body.reason)});`,
  }),
};

export const hasClientMethod = (op: Operation) => op.id in SENDER_CALLS || op.id in SIGNER_CALLS;

function nodeFetch(request: SampleRequest): string {
  const lines: string[] = [];
  const fsNames = [
    request.files.length ? 'readFile' : '',
    request.binaryResponse ? 'writeFile' : '',
  ].filter(Boolean);
  if (fsNames.length) lines.push(`import { ${fsNames.join(', ')} } from 'node:fs/promises';`, '');

  const headers = request.headers.map(([name, value]) => {
    const env = request.secrets[name];
    const literal = env
      ? name === 'Authorization'
        ? `\`Bearer \${process.env.${env}}\``
        : `process.env.${env}!`
      : jsLiteral(value);
    return `    ${IDENTIFIER.test(name) ? name : `'${name}'`}: ${literal},`;
  });
  const options = [
    ...(request.method === 'GET' ? [] : [`  method: '${request.method}',`]),
    ...(headers.length ? ['  headers: {', ...headers, '  },'] : []),
    ...(request.body !== undefined
      ? [`  body: JSON.stringify(${jsLiteral(request.body, '  ')}),`]
      : []),
    ...(request.redirect ? [`  redirect: 'manual',`] : []),
  ];
  lines.push(
    options.length
      ? `const response = await fetch('${request.url}', {\n${options.join('\n')}\n});`
      : `const response = await fetch('${request.url}');`,
  );
  if (request.binaryResponse) {
    lines.push(`await writeFile('document.pdf', new Uint8Array(await response.arrayBuffer()));`);
  } else if (request.redirect) {
    lines.push(`console.log(response.status, response.headers.get('location'));`);
  } else {
    lines.push(`console.log(response.status, await response.json());`);
  }
  return lines.join('\n');
}

function pathValues(op: Operation): Record<string, string> {
  return Object.fromEntries(
    op.parameters.filter((p) => p.in === 'path').map((p) => [p.name, String(p.example)]),
  );
}

export function nodeSample(op: Operation, request: SampleRequest): string {
  const args = {
    path: pathValues(op),
    body: (request.body ?? {}) as Record<string, unknown>,
  };
  const sender = SENDER_CALLS[op.id];
  const signer = SIGNER_CALLS[op.id];
  if (!sender && !signer) return nodeFetch(request);

  const call = (sender ?? signer)!(args);
  const imports = [...(call.imports ?? [])];
  if (request.files.length) imports.unshift(`import { readFile } from 'node:fs/promises';`);
  const client = sender ? 'createSignClient' : 'createSignerClient';
  imports.push(`import { ${client} } from '@codevibe_technology/sign-client';`);
  const setup = sender
    ? SENDER_SETUP
    : `// The token is the last part of the recipient's signing link.\nconst signer = createSignerClient({\n  baseUrl: '${BASE_URL}',\n  token: ${jsLiteral(args.path.token ?? '')},\n});`;
  return `${mergeImports(imports).join('\n')}\n\n${setup}\n\n${call.code}`;
}

function mergeImports(imports: string[]): string[] {
  const byModule = new Map<string, string[]>();
  for (const line of imports) {
    const match = /^import \{ (.+) \} from '(.+)';$/.exec(line);
    if (!match) continue;
    const names = byModule.get(match[2]!) ?? [];
    for (const name of match[1]!.split(', ')) if (!names.includes(name)) names.push(name);
    byModule.set(match[2]!, names);
  }
  return [...byModule].map(([module, names]) => `import { ${names.join(', ')} } from '${module}';`);
}

export function pythonSample(request: SampleRequest): string {
  const imports = [
    'import os',
    ...(request.files.length ? ['import base64'] : []),
    '',
    'import requests',
  ];
  if (!Object.keys(request.secrets).length) imports.splice(0, 1);
  const lines = [imports.join('\n').replace(/^\n/, '')];
  if (request.files.length) {
    lines.push(
      `def b64(path):\n    with open(path, "rb") as file:\n        return base64.b64encode(file.read()).decode()`,
    );
  }
  const headers = request.headers
    .filter(([name]) => name !== 'Content-Type')
    .map(([name, value]) => {
      const env = request.secrets[name];
      const literal = env
        ? name === 'Authorization'
          ? `f"Bearer {os.environ['${env}']}"`
          : `os.environ["${env}"]`
        : JSON.stringify(value);
      return `        ${JSON.stringify(name)}: ${literal},`;
    });
  const args = [
    `    "${request.url}",`,
    ...(headers.length ? ['    headers={', ...headers, '    },'] : []),
    ...(request.body !== undefined ? [`    json=${pyLiteral(request.body, '    ')},`] : []),
    ...(request.redirect ? ['    allow_redirects=False,'] : []),
    '    timeout=30,',
  ];
  lines.push(`response = requests.${request.method.toLowerCase()}(\n${args.join('\n')}\n)`);
  if (request.redirect) {
    lines.push(`print(response.status_code, response.headers["Location"])`);
  } else if (request.binaryResponse) {
    lines.push(
      `response.raise_for_status()\nwith open("document.pdf", "wb") as file:\n    file.write(response.content)`,
    );
  } else {
    lines.push(`response.raise_for_status()\nprint(response.json())`);
  }
  return lines.join('\n\n');
}

export function goSample(request: SampleRequest): string {
  const imports = new Set(['fmt', 'net/http']);
  const body: string[] = [];
  if (request.body !== undefined) {
    imports.add('bytes');
    imports.add('encoding/json');
    body.push(
      `\tpayload, err := json.Marshal(${goLiteral(request.body, '\t')})`,
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
    );
  }
  const reader = request.body !== undefined ? 'bytes.NewReader(payload)' : 'nil';
  body.push(
    `\treq, err := http.NewRequest(${JSON.stringify(request.method)}, ${JSON.stringify(request.url)}, ${reader})`,
    '\tif err != nil {',
    '\t\tpanic(err)',
    '\t}',
  );
  for (const [name, value] of request.headers) {
    const env = request.secrets[name];
    if (env) imports.add('os');
    const literal = env
      ? name === 'Authorization'
        ? `"Bearer "+os.Getenv(${JSON.stringify(env)})`
        : `os.Getenv(${JSON.stringify(env)})`
      : JSON.stringify(value);
    body.push(`\treq.Header.Set(${JSON.stringify(name)}, ${literal})`);
  }
  if (request.redirect) {
    body.push(
      '\tclient := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {',
      '\t\treturn http.ErrUseLastResponse',
      '\t}}',
      '\tres, err := client.Do(req)',
    );
  } else {
    body.push('\tres, err := http.DefaultClient.Do(req)');
  }
  body.push('\tif err != nil {', '\t\tpanic(err)', '\t}', '\tdefer res.Body.Close()');
  if (request.redirect) {
    body.push('\tfmt.Println(res.Status, res.Header.Get("Location"))');
  } else if (request.binaryResponse) {
    imports.add('io');
    imports.add('os');
    body.push(
      '\tfile, err := os.Create("document.pdf")',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tdefer file.Close()',
      '\tif _, err := io.Copy(file, res.Body); err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tfmt.Println(res.Status)',
    );
  } else {
    imports.add('io');
    body.push(
      '\tout, err := io.ReadAll(res.Body)',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\tfmt.Println(res.Status, string(out))',
    );
  }
  const helpers: string[] = [];
  if (request.files.length) {
    imports.add('encoding/base64');
    imports.add('os');
    helpers.push(
      'func b64(path string) string {',
      '\tdata, err := os.ReadFile(path)',
      '\tif err != nil {',
      '\t\tpanic(err)',
      '\t}',
      '\treturn base64.StdEncoding.EncodeToString(data)',
      '}',
      '',
    );
  }
  const sorted = [...imports].sort();
  return [
    'package main',
    '',
    'import (',
    ...sorted.map((name) => `\t${JSON.stringify(name)}`),
    ')',
    '',
    ...helpers,
    'func main() {',
    ...body,
    '}',
  ].join('\n');
}

/** Every sample of an operation, by language. */
export function samplesFor(op: Operation, doc: OpenApiDocument = spec): Record<Language, string> {
  const request = sampleRequest(op, doc);
  return {
    curl: curlSample(request),
    node: nodeSample(op, request),
    python: pythonSample(request),
    go: goSample(request),
  };
}
