import { DOCS_BASE } from '../site.ts';
import { deref, spec, type OpenApiDocument, type Schema } from './openapi.ts';
import {
  needsApiKey,
  resources,
  successResponse,
  webhookEvents,
  type Operation,
  type Parameter,
  type Resource,
} from './model.ts';
import { LANGUAGES, BASE_URL, samplesFor, type Language } from './samples.ts';
import { describeObject, exampleOf, requirementRule, typeLabel, type FieldDoc } from './schema.ts';

export const GENERATED_NOTE =
  '<!-- Generated from packages/server/openapi.yaml by `pnpm docs:api`. Edit the document, not this file. -->';

/** Where the generated pages live, relative to the docs root. */
export const REFERENCE_DIR = 'http-api/reference';

const STATUS_TEXT: Record<string, string> = {
  '200': 'OK',
  '201': 'Created',
  '204': 'No Content',
  '303': 'See Other',
  '304': 'Not Modified',
  '400': 'Bad Request',
  '401': 'Unauthorized',
  '403': 'Forbidden',
  '404': 'Not Found',
  '409': 'Conflict',
  '410': 'Gone',
  '413': 'Content Too Large',
  '422': 'Unprocessable Content',
  '423': 'Locked',
  '429': 'Too Many Requests',
  '500': 'Internal Server Error',
  '502': 'Bad Gateway',
};

/** The main object each resource page documents first, with where its example comes from. */
const OBJECTS: Record<
  string,
  { schema: string; title: string; example?: (doc: OpenApiDocument) => unknown }
> = {
  Envelopes: {
    schema: 'Envelope',
    title: 'The envelope object',
    example: (doc) => sentEnvelope(doc),
  },
  Recipients: {
    schema: 'Recipient',
    title: 'The recipient object',
    example: (doc) => (sentEnvelope(doc) as { recipients?: unknown[] })?.recipients?.[0],
  },
  Documents: {
    schema: 'Document',
    title: 'The document object',
    example: (doc) => (sentEnvelope(doc) as { documents?: unknown[] })?.documents?.[0],
  },
  'Audit trail': { schema: 'AuditEvent', title: 'The audit event object' },
  Templates: {
    schema: 'Template',
    title: 'The template object',
    example: (doc) => doc.components.examples?.OfferTemplate?.value,
  },
  Verification: {
    schema: 'PublicVerification',
    title: 'The verification object',
    example: (doc) => doc.components.examples?.ValidVerification?.value,
  },
  Signing: { schema: 'SignerView', title: 'The signing session object' },
};

function sentEnvelope(doc: OpenApiDocument): unknown {
  return doc.components.examples?.SentEnvelope?.value;
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline markdown for text that sits inside raw HTML: backticks become code, the rest is escaped. */
export function inlineHtml(text: string): string {
  return text
    .split(/(`[^`]+`)/g)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1
        ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
        : escapeHtml(part),
    )
    .join('');
}

/** Text for a table cell: one line, pipes escaped. */
const cell = (text: string) => text.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');

const methodBadge = (method: string) =>
  `<span class="api-method" data-method="${method.toLowerCase()}">${method.toUpperCase()}</span>`;

export const pagePath = (resource: Pick<Resource, 'slug'>) => `/${REFERENCE_DIR}/${resource.slug}`;

/** A link for raw HTML, which VitePress does not rewrite: with the base, as a clean URL. */
const htmlHref = (path: string, anchor: string) => `${DOCS_BASE}${path.slice(1)}#${anchor}`;

const fence = (lang: string, title: string, code: string) => {
  const ticks = code.includes('```') ? '````' : '```';
  return `${ticks}${lang} [${title}]\n${code}\n${ticks}`;
};

function codeGroup(blocks: string[]): string {
  return ['::: code-group', '', ...blocks.flatMap((block) => [block, '']), ':::'].join('\n');
}

/** The samples as one tab group; the Node sample is type-checked by `pnpm check:snippets`. */
function sampleGroup(samples: Record<Language, string>): string {
  return codeGroup(
    LANGUAGES.map(({ id, label, fence: lang }) =>
      fence(id === 'node' ? `${lang} check` : lang, label, samples[id]),
    ),
  );
}

function fieldHtml(field: FieldDoc, depth: number, output: boolean): string {
  const head = [
    `<code class="api-field__name">${escapeHtml(field.name)}</code>`,
    `<span class="api-field__type">${escapeHtml(field.type)}</span>`,
    field.required && !output ? '<span class="api-field__required">Required</span>' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const meta: string[] = [];
  if (field.enumValues.length) {
    meta.push(`One of ${field.enumValues.map((v) => `<code>${escapeHtml(v)}</code>`).join(' ')}`);
  }
  if (field.defaultValue !== undefined) {
    meta.push(`Default <code>${escapeHtml(field.defaultValue)}</code>`);
  }
  meta.push(...field.constraints.map((c) => inlineHtml(c[0]!.toUpperCase() + c.slice(1))));

  const parts = [`<div class="api-field">`, `<p class="api-field__head">${head}</p>`, ''];
  if (field.description) parts.push(field.description, '');
  if (meta.length)
    parts.push(
      `<p class="api-field__meta">${meta.join('<span aria-hidden="true"> · </span>')}</p>`,
      '',
    );
  if (field.children.length) {
    parts.push(
      `<details class="api-field__children">`,
      `<summary>Attributes of <code>${escapeHtml(field.name)}</code></summary>`,
      '',
      fieldsHtml(field.children, depth + 1, output),
      '',
      '</details>',
      '',
    );
  }
  parts.push('</div>');
  return parts.join('\n');
}

/** `output` marks fields of an answer, where "required" only means "always there" and is left out. */
function fieldsHtml(fields: FieldDoc[], depth = 0, output = false): string {
  return [
    '<div class="api-fields">',
    '',
    ...fields.map((f) => fieldHtml(f, depth, output)),
    '',
    '</div>',
  ].join('\n');
}

function parameterFields(parameters: Parameter[], doc: OpenApiDocument): FieldDoc[] {
  return parameters.map((p) => {
    const field = describeObject(
      { type: 'object', properties: { [p.name]: p.schema }, required: p.required ? [p.name] : [] },
      doc,
    )[0]!;
    return p.description ? { ...field, description: p.description } : field;
  });
}

function securityText(op: Operation, doc: OpenApiDocument): string {
  if (op.security.length === 0) return 'None. This route is public.';
  if (needsApiKey(op)) return 'Sender API key, as `Authorization: Bearer <key>`';
  const ways = op.security.map((requirement) => {
    const names = Object.keys(requirement);
    if (names.length === 0) {
      return op.path.includes('{token}') ? 'the signing token in the path' : 'the link itself';
    }
    return names
      .map((name) => {
        const scheme = doc.components.securitySchemes?.[name];
        if (scheme?.in === 'header') return `the \`${scheme.name}\` header`;
        if (scheme?.in === 'cookie') return `the \`${scheme.name}\` cookie`;
        return name;
      })
      .join(' and ');
  });
  const unique = [...new Set(ways)];
  const text =
    unique.length === 1 ? unique[0]! : `${unique.slice(0, -1).join(', ')} or ${unique.at(-1)}`;
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}

const parameterSections: { in: Parameter['in']; title: string; suffix: string }[] = [
  { in: 'path', title: 'Path parameters', suffix: 'path' },
  { in: 'query', title: 'Query parameters', suffix: 'query' },
  { in: 'header', title: 'Headers', suffix: 'headers' },
];

function bodySection(op: Operation, doc: OpenApiDocument): string[] {
  if (op.upload) {
    const [raw, ...others] = op.upload.mediaTypes;
    const form = others.includes('multipart/form-data')
      ? `, or as \`multipart/form-data\` in a form field named \`${op.upload.field}\``
      : '';
    return [
      `### Request body {#${op.anchor}-body}`,
      '',
      `The file itself as the body, with \`Content-Type: ${raw}\`${form}.`,
      '',
    ];
  }
  if (!op.body) return [];
  const out = [`### Request body {#${op.anchor}-body}`, ''];
  const media = op.body.mediaTypes.map((type) => `\`${type}\``).join(' or ');
  if (op.body.mediaTypes.length > 1) out.push(`Send it as ${media}.`, '');
  const fields = describeObject(op.body.schema, doc);
  if (fields.length) out.push(fieldsHtml(fields), '');
  else out.push(`A ${typeLabel(op.body.schema, doc)}.`, '');
  const rule = requirementRule(op.body.schema, doc);
  if (rule) out.push(rule, '');
  return out;
}

function returnsSection(op: Operation, doc: OpenApiDocument): string[] {
  const success = op.responses.filter((r) => /^[23]/.test(r.status));
  if (!success.length) return [];
  const out = [`### Returns {#${op.anchor}-returns}`, ''];
  for (const response of success) {
    const link = response.schema ? schemaLink(response.schema, doc) : '';
    const type = link ? ` A${/^[[`]?[aeiou]/i.test(link) ? 'n' : ''} ${link}.` : '';
    out.push(
      `**${response.status} ${STATUS_TEXT[response.status] ?? ''}**. ${response.description}${type}`.trim(),
      '',
    );
    const headers = response.headers.filter((h) => h.description);
    if (headers.length) {
      out.push(...headers.map((h) => `- \`${h.name}\`: ${cell(h.description)}`), '');
    }
  }
  return out;
}

/** The object name as a link to where the object is described, when it has its own section. */
function schemaLink(schema: Schema, doc: OpenApiDocument): string {
  const label = typeLabel(schema, doc);
  const name = schema.$ref?.split('/').at(-1);
  const owner = Object.entries(OBJECTS).find(([, object]) => object.schema === name);
  if (owner) {
    const resource = resources(doc).find((r) => r.name === owner[0]);
    if (resource)
      return `[${owner[1].title.replace(/^The /, '')}](${pagePath(resource)}#${anchorOfTitle(owner[1].title)})`;
  }
  return name ? `\`${name}\` object` : label;
}

const anchorOfTitle = (title: string) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-');

function errorsSection(op: Operation): string[] {
  const errors = op.responses.filter((r) => /^[45]/.test(r.status));
  if (!errors.length) return [];
  return [
    `### Errors {#${op.anchor}-errors}`,
    '',
    '| Status | When |',
    '| ------ | ---- |',
    ...errors.map((r) => `| ${r.status} | ${cell(r.description)} |`),
    '',
  ];
}

function notes(op: Operation): string[] {
  const out: string[] = [];
  if (op.parameters.some((p) => p.name === 'Idempotency-Key')) {
    out.push(
      'Send an `Idempotency-Key` to retry safely: the same key and body within 24 hours return the first response. See [retries](/http-api/conventions#retries).',
    );
  }
  if (op.parameters.some((p) => p.name === 'cursor')) {
    out.push(
      'Results come one page at a time. See [pagination](/http-api/conventions#pagination).',
    );
  }
  return out;
}

function responseExample(op: Operation): string {
  const success = successResponse(op);
  if (!success) return '';
  const title = `${success.status} ${STATUS_TEXT[success.status] ?? ''}`.trim();
  if (success.mediaType === 'application/pdf') {
    return codeGroup([
      fence('text', title, 'Content-Type: application/pdf\n\n%PDF-1.7 ... (the PDF bytes)'),
    ]);
  }
  if (success.status.startsWith('3')) {
    return codeGroup([fence('http', title, `HTTP/1.1 ${title}\nLocation: /sign`)]);
  }
  if (success.example === undefined) return '';
  return codeGroup([fence('json', title, JSON.stringify(success.example, null, 2))]);
}

function operationSection(op: Operation, doc: OpenApiDocument): string {
  const main: string[] = [
    `## ${op.summary} {#${op.anchor}}`,
    '',
    `<p class="api-route">${methodBadge(op.method)}<code>${escapeHtml(op.path)}</code></p>`,
    '',
    op.description,
    '',
    `<p class="api-auth"><span class="api-auth__label">Auth</span> ${inlineHtml(securityText(op, doc))}</p>`,
    '',
    ...notes(op).flatMap((note) => [note, '']),
  ];
  for (const section of parameterSections) {
    const parameters = op.parameters.filter((p) => p.in === section.in);
    if (!parameters.length) continue;
    main.push(
      `### ${section.title} {#${op.anchor}-${section.suffix}}`,
      '',
      fieldsHtml(parameterFields(parameters, doc)),
      '',
    );
  }
  main.push(...bodySection(op, doc), ...returnsSection(op, doc), ...errorsSection(op));

  const aside = [
    `<div class="api-panel" data-label="Request">`,
    '',
    sampleGroup(samplesFor(op, doc)),
    '',
    `<ApiTryIt operation="${op.id}" />`,
    '',
    '</div>',
    '',
  ];
  const example = responseExample(op);
  if (example)
    aside.push(`<div class="api-panel" data-label="Response">`, '', example, '', '</div>');

  return [
    `<section class="api-op" aria-labelledby="${op.anchor}">`,
    '<div class="api-op__main">',
    '',
    ...main,
    '</div>',
    '<div class="api-op__aside">',
    '',
    ...aside,
    '',
    '</div>',
    '</section>',
  ].join('\n');
}

function frontmatter(title: string, description: string): string {
  return [
    '---',
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    'pageClass: api-page',
    'aside: false',
    'outline: false',
    '---',
  ].join('\n');
}

function endpointList(ops: Operation[], href: (op: Operation) => string): string {
  return [
    '<nav class="api-endpoints" aria-label="Endpoints">',
    '<p class="api-endpoints__title">Endpoints</p>',
    '<ul>',
    ...ops.map(
      (op) =>
        `<li><a href="${href(op)}">${methodBadge(op.method)}<code>${escapeHtml(op.path)}</code></a></li>`,
    ),
    '</ul>',
    '</nav>',
  ].join('\n');
}

function objectSection(resource: Resource, doc: OpenApiDocument): string {
  const object = OBJECTS[resource.name];
  const schema = object && doc.components.schemas[object.schema];
  if (!object || !schema) return '';
  const example =
    object.example?.(doc) ?? exampleOf({ $ref: `#/components/schemas/${object.schema}` }, doc);
  return [
    `<section class="api-op" aria-labelledby="${anchorOfTitle(object.title)}">`,
    '<div class="api-op__main">',
    '',
    `## ${object.title} {#${anchorOfTitle(object.title)}}`,
    '',
    ...(schema.description ? [schema.description.trim(), ''] : []),
    `### Attributes {#${anchorOfTitle(object.title)}-attributes}`,
    '',
    fieldsHtml(describeObject({ $ref: `#/components/schemas/${object.schema}` }, doc), 0, true),
    '',
    '</div>',
    '<div class="api-op__aside">',
    '',
    `<div class="api-panel" data-label="Example">`,
    '',
    codeGroup([fence('json', object.schema, JSON.stringify(example, null, 2))]),
    '',
    '</div>',
    '',
    '</div>',
    '</section>',
  ].join('\n');
}

export function resourcePage(resource: Resource, doc: OpenApiDocument = spec): string {
  const intro = [
    '<section class="api-op api-op--intro">',
    '<div class="api-op__main">',
    '',
    `# ${resource.name}`,
    '',
    resource.description,
    '',
    '</div>',
    '<div class="api-op__aside">',
    '',
    endpointList(resource.operations, (op) => `#${op.anchor}`),
    '',
    '</div>',
    '</section>',
  ];
  return [
    frontmatter(resource.name, firstSentence(resource.description)),
    '',
    GENERATED_NOTE,
    '',
    ...intro,
    '',
    objectSection(resource, doc),
    '',
    ...resource.operations
      .map((op) => operationSection(op, doc))
      .flatMap((section) => [section, '']),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ').replace(/`/g, '');
  const end = flat.indexOf('. ');
  return end === -1 ? flat : flat.slice(0, end + 1);
}

const NODE_WEBHOOK = `import { createServer } from 'node:http';
import { readWebhook, SignApiError } from '@codevibe_technology/sign-client';

const secret = process.env.SIGN_WEBHOOK_SECRET!;

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const rawBody = Buffer.concat(chunks).toString('utf8');

  try {
    const delivery = await readWebhook(secret, req.headers['x-codevibe-signature'], rawBody);
    res.writeHead(204).end();
    if (delivery.type === 'envelope.completed') {
      console.log('completed', delivery.data.envelope.id);
    }
  } catch (error) {
    res.writeHead(error instanceof SignApiError ? 401 : 500).end();
  }
}).listen(4000);`;

const PYTHON_WEBHOOK = `import hashlib
import hmac
import time


def verify_webhook(secret: str, header: str, raw_body: bytes, tolerance: int = 300) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(",") if "=" in part)
    timestamp, signature = parts.get("t", ""), parts.get("v1", "")
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > tolerance:
        return False
    signed = timestamp.encode() + b"." + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)`;

const GO_WEBHOOK = `package webhooks

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"strconv"
	"strings"
	"time"
)

func VerifyWebhook(secret, header string, rawBody []byte, tolerance time.Duration) bool {
	var timestamp, signature string
	for _, part := range strings.Split(header, ",") {
		key, value, _ := strings.Cut(part, "=")
		switch key {
		case "t":
			timestamp = value
		case "v1":
			signature = value
		}
	}
	seconds, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil || math.Abs(time.Since(time.Unix(seconds, 0)).Seconds()) > tolerance.Seconds() {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp + "."))
	mac.Write(rawBody)
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(signature))
}`;

export const WEBHOOK_SAMPLES = { node: NODE_WEBHOOK, python: PYTHON_WEBHOOK, go: GO_WEBHOOK };

function webhookSection(event: Operation, doc: OpenApiDocument): string {
  const headers = event.parameters.filter((p) => p.in === 'header');
  const main = [
    `## ${event.summary} {#${event.anchor}}`,
    '',
    `<p class="api-route">${methodBadge('post')}<code>your webhook URL</code></p>`,
    '',
    event.description,
    '',
    `### Headers {#${event.anchor}-headers}`,
    '',
    fieldsHtml(parameterFields(headers, doc)),
    '',
    ...(event.body
      ? [
          `### Body {#${event.anchor}-body}`,
          '',
          fieldsHtml(describeObject(event.body.schema, doc), 0, true),
          '',
        ]
      : []),
  ];
  const aside = event.body
    ? [
        `<div class="api-panel" data-label="Payload">`,
        '',
        codeGroup([fence('json', 'POST', JSON.stringify(event.body.example, null, 2))]),
        '',
        '</div>',
      ]
    : [];
  return [
    `<section class="api-op" aria-labelledby="${event.anchor}">`,
    '<div class="api-op__main">',
    '',
    ...main,
    '</div>',
    '<div class="api-op__aside">',
    '',
    ...aside,
    '',
    '</div>',
    '</section>',
  ].join('\n');
}

export function webhooksPage(doc: OpenApiDocument = spec): string {
  const actions = (doc.components.schemas.AuditAction?.enum ?? []).map(String);
  const events = webhookEvents(doc);
  const verify = [
    '<section class="api-op" aria-labelledby="verify-a-delivery">',
    '<div class="api-op__main">',
    '',
    '## Verify a delivery {#verify-a-delivery}',
    '',
    'Every delivery is signed with the secret of its target. Check the signature before you trust the body:',
    '',
    '1. Read the raw body exactly as received. Do not parse and re-serialise it first.',
    '2. Split `x-codevibe-signature` into `t` (unix seconds) and `v1` (hex).',
    '3. Compute HMAC-SHA256 of `<t>.<raw body>` with the secret, and compare it with `v1` in constant time.',
    '4. Reject the delivery when `t` is more than five minutes from your clock, so a captured request cannot be replayed.',
    '',
    'Answer with a 2xx within 10 seconds and do the work afterwards. A delivery that fails is retried with the same `id`, so drop ids you have already handled.',
    '',
    '</div>',
    '<div class="api-op__aside">',
    '',
    `<div class="api-panel" data-label="Verify">`,
    '',
    codeGroup([
      fence('ts check', 'Node.js', NODE_WEBHOOK),
      fence('python', 'Python', PYTHON_WEBHOOK),
      fence('go', 'Go', GO_WEBHOOK),
    ]),
    '',
    '</div>',
    '',
    '</div>',
    '</section>',
  ];
  return [
    frontmatter(
      'Webhooks',
      'The events the server posts to your webhook URLs, their payloads, and how to verify a delivery.',
    ),
    '',
    GENERATED_NOTE,
    '',
    '<section class="api-op api-op--intro">',
    '<div class="api-op__main">',
    '',
    '# Webhooks',
    '',
    'The server posts an event to your webhook URLs when something happens to an envelope, so your backend never has to poll. Each event is one audit action; a target subscribes to the actions it wants, or `*` for all.',
    '',
    'Webhook targets are set in the server options, or in workspace settings on the cloud. The [webhooks guide](/guides/webhooks) covers setting them up and testing them.',
    '',
    '</div>',
    '<div class="api-op__aside">',
    '',
    '<div class="api-endpoints">',
    '<p class="api-endpoints__title">Event types</p>',
    '<ul class="api-endpoints__plain">',
    ...actions.map((action) => `<li><code>${escapeHtml(action)}</code></li>`),
    '</ul>',
    '</div>',
    '',
    '</div>',
    '</section>',
    '',
    ...verify,
    '',
    ...events.map((event) => webhookSection(event, doc)).flatMap((s) => [s, '']),
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

export function referenceIndexPage(doc: OpenApiDocument = spec): string {
  const groups = resources(doc);
  const lines = [
    frontmatter(
      'API reference',
      'Every route of the Codevibe Sign HTTP API, grouped by resource, with examples in curl, Node.js, Python and Go.',
    ),
    '',
    GENERATED_NOTE,
    '',
    '# API reference',
    '',
    `The Codevibe Sign API is organised around envelopes. It takes and returns JSON, uses standard HTTP status codes, and authenticates your backend with an API key. Version ${doc.info.version} lives under \`/v1\` as one unit; see [versioning and deprecation](/http-api/versioning).`,
    '',
    '<div class="api-base">',
    '<p><span class="api-base__label">Cloud</span><code>' + BASE_URL + '</code></p>',
    '<p><span class="api-base__label">Self-hosted</span><code>https://&lt;your server&gt;</code></p>',
    '</div>',
    '',
    'New here? Start with the [quickstart](/http-api/quickstart), then read [authentication](/http-api/authentication) and [errors](/http-api/errors).',
    '',
  ];
  for (const resource of [...groups]) {
    lines.push(
      `## ${resource.name} {#${resource.slug}}`,
      '',
      firstSentence(resource.description),
      '',
    );
    lines.push(
      '<ul class="api-index">',
      ...resource.operations.map(
        (op) =>
          `<li><a href="${htmlHref(pagePath(resource), op.anchor)}">${methodBadge(op.method)}<code>${escapeHtml(op.path)}</code><span>${escapeHtml(op.summary)}</span></a></li>`,
      ),
      '</ul>',
      '',
    );
  }
  lines.push(
    '## Webhooks {#webhooks}',
    '',
    'Events the server posts to your backend.',
    '',
    '<ul class="api-index">',
    ...webhookEvents(doc).map(
      (event) =>
        `<li><a href="${htmlHref(`/${REFERENCE_DIR}/webhooks`, event.anchor)}">${methodBadge('post')}<code>your webhook URL</code><span>${escapeHtml(event.summary)}</span></a></li>`,
    ),
    '</ul>',
    '',
  );
  return lines.join('\n');
}

/** `429 Too Many Requests`, or `403 Forbidden or 429 Too Many Requests` for a code with several. */
function statusCell(status: number | number[] | undefined): string {
  if (status === undefined) return '';
  return (Array.isArray(status) ? status : [status])
    .map((s) => `${s} ${STATUS_TEXT[String(s)] ?? ''}`.trim())
    .join(' or ');
}

/** Every error code with its status, its meaning and the routes that can return it. */
export function errorsPage(doc: OpenApiDocument = spec): string {
  const schema = doc.components.schemas.ErrorCode as Schema & {
    'x-status'?: Record<string, number | number[]>;
    'x-descriptions'?: Record<string, string>;
  };
  const codes = (schema.enum ?? []).map(String);
  const status = schema['x-status'] ?? {};
  const descriptions = schema['x-descriptions'] ?? {};
  const errorExample = deref(
    { $ref: '#/components/responses/BadRequest' } as {
      $ref: string;
      content?: Record<string, { example?: unknown }>;
    },
    doc,
  ).content?.['application/json']?.example;
  const lines = [
    frontmatter(
      'Errors',
      'Every error code of the Codevibe Sign HTTP API, the HTTP status it comes with, and what to do about it.',
    ),
    '',
    GENERATED_NOTE,
    '',
    '# Errors',
    '',
    'Every error has the same JSON body. `code` is stable and comes with the HTTP status listed below; `message` is for people and may change, so branch on `code`. `details` carries extra facts for some codes.',
    '',
    codeGroup([
      fence(
        'json',
        `${status.VALIDATION ?? 400} ${STATUS_TEXT[String(status.VALIDATION ?? 400)]}`,
        JSON.stringify(errorExample, null, 2),
      ),
    ]),
    '',
    'With the Node.js client every failure is a `SignApiError` carrying `code`, `status`, `details` and `requestId`. When no response arrived at all, `status` is `0` and `code` is `NETWORK`, `TIMEOUT` or `ABORTED`.',
    '',
    '## Codes {#codes}',
    '',
    '| Code | Status | Meaning |',
    '| ---- | ------ | ------- |',
    ...codes.map(
      (code) =>
        `| <span id="${code.toLowerCase().replace(/_/g, '-')}">\`${code}\`</span> | ${statusCell(status[code])} | ${cell(descriptions[code] ?? '')} |`,
    ),
    '',
    '## Retrying {#retrying}',
    '',
    '- `429 RATE_LIMITED`: wait the number of seconds in the `Retry-After` header, then retry.',
    "- `429 PLAN_LIMIT`: the plan's API request count is used up. It starts again at the time in `Retry-After`; retrying sooner is refused. `403 PLAN_LIMIT` does not change by waiting: remove something or move to a bigger plan.",
    '- `500` and `502`: retry with backoff, sending the same `Idempotency-Key` so nothing is created twice.',
    '- `409 CONFLICT`: another request got there first. Fetch the envelope again and retry if it still makes sense.',
    '- Every other `4xx`: fix the request first. Sending it again unchanged gets the same answer.',
    '',
  ];
  return lines.join('\n');
}

/** Every generated page, by its path under the docs root. */
export function generatedPages(doc: OpenApiDocument = spec): Record<string, string> {
  const pages: Record<string, string> = {
    'http-api/reference/index.md': referenceIndexPage(doc),
    'http-api/errors.md': errorsPage(doc),
    [`${REFERENCE_DIR}/webhooks.md`]: webhooksPage(doc),
  };
  for (const resource of resources(doc))
    pages[`${REFERENCE_DIR}/${resource.slug}.md`] = resourcePage(resource, doc);
  return pages;
}
