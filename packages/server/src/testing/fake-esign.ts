import type {
  EsignEvent,
  EsignProvider,
  EsignRequest,
  EsignStatus,
} from '@codevibe_technology/sign-aadhaar';
import { SignError } from '@codevibe_technology/sign-core';

export interface FakeEsignRequest {
  ref: string;
  request: EsignRequest;
  status: 'pending' | EsignStatus;
}

export interface FakeEsignProvider extends EsignProvider {
  requests: FakeEsignRequest[];
  /** Calls made to `fetchSignedDocument`, signed or not. */
  fetches: number;
  /** Makes the next `createRequest` fail the way a provider outage does. */
  failNextCreate(error?: Error): void;
  /** The signer finished (or declined, or let it lapse) at the provider. */
  finish(ref: string, status?: EsignStatus): void;
  /** A callback body the provider would send, carrying this account's mac. */
  webhook(ref: string, status: EsignStatus, signerName?: string): string;
}

/**
 * An eSign provider that lives in memory. Its callbacks carry `mac = <secret>:<documentId>`,
 * and it confirms each one against what it knows of the request, as the Leegality adapter
 * does with the provider's status API.
 */
export function fakeEsignProvider(
  options: {
    name?: string;
    secret?: string;
    /** Turns the file sent for signing into the file the provider gives back. */
    sign?: (pdf: Uint8Array) => Promise<Uint8Array> | Uint8Array;
    /** Hands over its own audit trail of a signed request. Defaults to true. */
    auditTrail?: boolean;
  } = {},
): FakeEsignProvider {
  const secret = options.secret ?? 'salt';
  const requests: FakeEsignRequest[] = [];
  let failure: Error | null = null;
  const find = (ref: string) => requests.find((r) => r.ref === ref);
  const invalid = (message: string) => new SignError('WEBHOOK_INVALID', message);

  const provider: FakeEsignProvider = {
    name: options.name ?? 'leegality',
    requests,
    fetches: 0,
    failNextCreate(error) {
      failure =
        error ??
        new SignError('PROVIDER_ERROR', 'Could not reach the provider', {
          reason: 'network',
          retryable: true,
        });
    },
    finish(ref, status = 'signed') {
      const request = find(ref);
      if (!request) throw new Error(`No request ${ref}`);
      request.status = status;
    },
    webhook(ref, status, signerName) {
      return JSON.stringify({
        documentId: ref,
        mac: `${secret}:${ref}`,
        status,
        ...(signerName ? { signerName } : {}),
      });
    },
    async createRequest(request) {
      if (failure) {
        const error = failure;
        failure = null;
        throw error;
      }
      const ref = `${secret}-doc-${requests.length + 1}`;
      requests.push({ ref, request, status: 'pending' });
      return { providerRef: ref, signUrl: `https://esign.example.com/sign/${ref}` };
    },
    async parseWebhook(_headers, rawBody) {
      let body: { documentId?: unknown; mac?: unknown; status?: unknown; signerName?: unknown };
      try {
        body = JSON.parse(
          typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody),
        ) as typeof body;
      } catch {
        throw invalid('Webhook body is not JSON');
      }
      if (typeof body.documentId !== 'string' || body.mac !== `${secret}:${body.documentId}`) {
        throw invalid('Webhook mac does not match');
      }
      const request = find(body.documentId);
      if (!request || request.status !== body.status) {
        throw invalid('Webhook does not match the document status');
      }
      const event: EsignEvent = { providerRef: request.ref, status: request.status as EsignStatus };
      if (typeof body.signerName === 'string') event.signerName = body.signerName;
      return event;
    },
    async fetchSignedDocument(providerRef) {
      provider.fetches += 1;
      const request = find(providerRef);
      if (!request || request.status !== 'signed') {
        throw new SignError('INVALID_STATE', 'The document is not signed by everyone yet');
      }
      const bytes = request.request.documentBytes;
      return options.sign ? options.sign(bytes) : bytes;
    },
    ...(options.auditTrail === false
      ? {}
      : {
          async fetchAuditTrail(providerRef: string) {
            const request = find(providerRef);
            if (!request || request.status !== 'signed') {
              throw new SignError('INVALID_STATE', 'The document is not signed by everyone yet');
            }
            return new TextEncoder().encode(`%PDF-1.7\nprovider-audit-trail=${providerRef}\n`);
          },
        }),
    webhookRef(rawBody) {
      try {
        const body = JSON.parse(
          typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody),
        ) as { documentId?: unknown };
        return typeof body.documentId === 'string' ? body.documentId : null;
      } catch {
        return null;
      }
    },
  };
  return provider;
}
