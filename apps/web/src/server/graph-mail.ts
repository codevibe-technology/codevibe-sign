import { randomUUID } from 'node:crypto';
import type { MailMessage, Mailer } from '@codevibe_technology/sign-core';

export interface GraphMailerOptions {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** The sending mailbox, for example `Codevibe <no-reply@codevibe.in>`. */
  from: string;
  fetch?: typeof fetch;
  /** Milliseconds since the epoch; injectable for token-expiry tests. */
  now?: () => number;
  /** Where failures are reported. Messages never carry the client secret. */
  log?: (line: string) => void;
}

/**
 * Largest JSON request sent to `sendMail`. Graph refuses inline messages over roughly 4 MB, and
 * base64 makes attachments a third larger, so anything bigger goes out as download links.
 */
export const GRAPH_MAX_REQUEST_BYTES = 3 * 1024 * 1024;

/**
 * Largest total of attachments the completion email carries when sending through Graph: about
 * 2.7 MB once encoded, which leaves room for the body under `GRAPH_MAX_REQUEST_BYTES`.
 */
export const GRAPH_MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;

/** Tokens are renewed this long before Microsoft says they expire. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const GRAPH = 'https://graph.microsoft.com/v1.0';
const ENTRA_SECRETS = 'Entra admin center > App registrations > your app > Certificates & secrets';

export type GraphMailErrorCode =
  | 'bad_secret'
  | 'bad_ids'
  | 'token_failed'
  | 'access_denied'
  | 'unknown_mailbox'
  | 'unavailable'
  | 'too_large'
  | 'send_failed';

/** A send that Microsoft refused, with what to change. `transient` means a retry may work. */
export class GraphMailError extends Error {
  constructor(
    readonly code: GraphMailErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'GraphMailError';
  }

  get transient(): boolean {
    return this.code === 'unavailable';
  }
}

interface Mailbox {
  address: string;
  name?: string;
}

/** `Name <address>` or a bare address, with quotes and line breaks dropped from the name. */
export function parseMailbox(value: string): Mailbox {
  const match = /^([\s\S]*)<([^<>]+)>\s*$/.exec(value);
  if (!match) return { address: value.trim() };
  const name = match[1]!.replace(/[\r\n"\\]/g, '').trim();
  return { address: match[2]!.trim(), ...(name ? { name } : {}) };
}

const recipient = ({ address, name }: Mailbox) => ({
  emailAddress: { address, ...(name ? { name } : {}) },
});

/**
 * The `sendMail` request body for a message. Graph keeps one body per message, so the HTML is
 * sent when there is one and the plain text otherwise. `meta` is never sent.
 */
export function graphMessage(message: MailMessage, from: string) {
  const sender = parseMailbox(from);
  const name = message.fromName?.replace(/[\r\n"<>\\]/g, '').trim() || sender.name;
  return {
    message: {
      subject: message.subject,
      body: message.html
        ? { contentType: 'HTML', content: message.html }
        : { contentType: 'Text', content: message.text },
      from: recipient({ address: sender.address, ...(name ? { name } : {}) }),
      toRecipients: [recipient(parseMailbox(message.to))],
      ...(message.replyTo ? { replyTo: [recipient(parseMailbox(message.replyTo))] } : {}),
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((a) => ({
              '@odata.type': '#microsoft.graph.fileAttachment',
              name: a.filename,
              contentType: a.contentType,
              contentBytes: Buffer.from(a.content).toString('base64'),
            })),
          }
        : {}),
    },
    saveToSentItems: false,
  };
}

interface TokenFailure {
  error?: string;
  error_codes?: number[];
  error_description?: string;
}

const aadCodes = (body: TokenFailure): number[] => {
  if (Array.isArray(body.error_codes)) return body.error_codes;
  const found = /AADSTS(\d+)/.exec(body.error_description ?? '');
  return found ? [Number(found[1])] : [];
};

/** The token endpoint's refusal as an error naming the setting to fix. */
export function tokenError(status: number, body: TokenFailure): GraphMailError {
  const codes = aadCodes(body);
  const tag = codes.length ? ` (AADSTS${codes[0]})` : '';
  if (codes.includes(7000215) || codes.includes(7000222)) {
    return new GraphMailError(
      'bad_secret',
      `Microsoft 365 rejected MS_CLIENT_SECRET: it is wrong or has expired${tag}. ` +
        `Create a new client secret in ${ENTRA_SECRETS} and set MS_CLIENT_SECRET to its value.`,
      status,
    );
  }
  if (codes.some((code) => [700016, 90002, 900023, 90013].includes(code))) {
    return new GraphMailError(
      'bad_ids',
      `Microsoft 365 does not know this app or tenant${tag}. Check MS_CLIENT_ID (the ` +
        'Application (client) ID) and MS_TENANT_ID (the Directory (tenant) ID) on the app ' +
        "registration's Overview page.",
      status,
    );
  }
  if (status === 429 || status >= 500) {
    return new GraphMailError(
      'unavailable',
      `Microsoft sign-in is busy (HTTP ${status})${tag}; the email will be tried again.`,
      status,
    );
  }
  return new GraphMailError(
    'token_failed',
    `Microsoft 365 did not issue a token (HTTP ${status}${body.error ? `, ${body.error}` : ''})` +
      `${tag}. Check MS_TENANT_ID, MS_CLIENT_ID and MS_CLIENT_SECRET.`,
    status,
  );
}

interface GraphFailure {
  error?: { code?: string; message?: string };
}

/** A `sendMail` refusal as an error saying what to change in Microsoft 365. */
export function sendError(
  status: number,
  body: GraphFailure,
  mailbox: string,
  retryAfter?: string | null,
): GraphMailError {
  const code = body.error?.code ?? '';
  const tag = code ? ` (${code})` : '';
  if (status === 403 || code === 'ErrorAccessDenied') {
    return new GraphMailError(
      'access_denied',
      `Microsoft 365 refused to send as ${mailbox} (HTTP ${status})${tag}. Give the app the ` +
        'Mail.Send application permission and grant admin consent, and if access is limited to ' +
        `certain mailboxes, include ${mailbox}.`,
      status,
    );
  }
  if (
    status === 404 ||
    ['ErrorInvalidUser', 'ResourceNotFound', 'MailboxNotEnabledForRESTAPI'].includes(code)
  ) {
    return new GraphMailError(
      'unknown_mailbox',
      `Microsoft 365 has no mailbox ${mailbox} (HTTP ${status})${tag}. Set MAIL_FROM to a ` +
        'licensed mailbox or shared mailbox in this tenant.',
      status,
    );
  }
  if (status === 413 || code === 'ErrorMessageSizeExceeded') {
    return new GraphMailError(
      'too_large',
      `Microsoft 365 refused the email as too large (HTTP ${status})${tag}.`,
      status,
    );
  }
  if (status === 429 || status === 503 || status === 502 || status === 504) {
    const wait = retryAfter && /^\d+$/.test(retryAfter) ? `, asked to wait ${retryAfter}s` : '';
    return new GraphMailError(
      'unavailable',
      `Microsoft 365 is busy (HTTP ${status}${wait})${tag}; the email will be tried again.`,
      status,
    );
  }
  return new GraphMailError(
    'send_failed',
    `Microsoft 365 did not send the email (HTTP ${status})${tag}.`,
    status,
  );
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Sends through Microsoft Graph as one Microsoft 365 mailbox, signed in with the app's client
 * credentials. The token is kept in memory and renewed shortly before it expires, or once when
 * Graph answers 401.
 */
export function graphMailer(options: GraphMailerOptions): Mailer {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.error(line));
  const mailbox = parseMailbox(options.from).address;
  const secret = options.clientSecret;
  let token: { value: string; renewAt: number } | null = null;
  let pending: Promise<string> | null = null;

  // Defence in depth: whatever Microsoft echoes back, the secret never leaves this module.
  const scrub = (text: string) => (secret ? text.split(secret).join('[secret]') : text);
  const reported = (err: GraphMailError) => {
    const clean = new GraphMailError(err.code, scrub(err.message), err.status);
    log(`[mail] Microsoft Graph: ${clean.message}`);
    return clean;
  };

  async function requestToken(): Promise<string> {
    const url = `https://login.microsoftonline.com/${encodeURIComponent(options.tenantId)}/oauth2/v2.0/token`;
    let response: Response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: options.clientId,
          client_secret: secret,
          scope: 'https://graph.microsoft.com/.default',
        }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw reported(
        new GraphMailError(
          'unavailable',
          `Microsoft sign-in could not be reached (${err instanceof Error ? err.name : 'network error'}); the email will be tried again.`,
        ),
      );
    }
    if (!response.ok) throw reported(tokenError(response.status, await readJson(response)));
    const body = await readJson<{ access_token?: string; expires_in?: number }>(response);
    if (!body.access_token) {
      throw reported(
        new GraphMailError('token_failed', 'Microsoft 365 returned no access token.', 200),
      );
    }
    const lifetime = (Number(body.expires_in) || 3599) * 1000;
    token = { value: body.access_token, renewAt: now() + lifetime - TOKEN_MARGIN_MS };
    return body.access_token;
  }

  function accessToken(): Promise<string> {
    if (token && now() < token.renewAt) return Promise.resolve(token.value);
    pending ??= requestToken().finally(() => {
      pending = null;
    });
    return pending;
  }

  async function post(body: string, bearer: string, requestId: string) {
    try {
      return await fetcher(`${GRAPH}/users/${encodeURIComponent(mailbox)}/sendMail`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearer}`,
          'content-type': 'application/json',
          'client-request-id': requestId,
          'return-client-request-id': 'true',
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw reported(
        new GraphMailError(
          'unavailable',
          `Microsoft Graph could not be reached (${err instanceof Error ? err.name : 'network error'}); the email will be tried again.`,
        ),
      );
    }
  }

  return {
    async send(message) {
      const body = JSON.stringify(graphMessage(message, options.from));
      const size = Buffer.byteLength(body);
      if (size > GRAPH_MAX_REQUEST_BYTES) {
        throw reported(
          new GraphMailError(
            'too_large',
            `The email is ${(size / 1024 / 1024).toFixed(1)} MB once encoded, over the ` +
              `${GRAPH_MAX_REQUEST_BYTES / 1024 / 1024} MB Microsoft Graph allows; send links instead.`,
          ),
        );
      }
      const requestId = randomUUID();
      let response = await post(body, await accessToken(), requestId);
      if (response.status === 401) {
        token = null;
        response = await post(body, await accessToken(), requestId);
        if (response.status === 401) {
          throw reported(
            new GraphMailError(
              'access_denied',
              'Microsoft Graph refused a fresh access token (HTTP 401). Check that the app ' +
                'registration has the Mail.Send application permission with admin consent.',
              401,
            ),
          );
        }
      }
      if (!response.ok) {
        throw reported(
          sendError(
            response.status,
            await readJson(response),
            mailbox,
            response.headers.get('retry-after'),
          ),
        );
      }
      return { messageId: response.headers.get('request-id') ?? requestId };
    },
  };
}
