import type { Id, Rect, Recipient } from '@codevibe_technology/sign-core';

export interface SignaturePosition {
  /** Zero-based page index. */
  page: number;
  /** PDF points with a top-left origin, as in `Field.rect`. */
  rect: Rect;
}

export interface EsignRequest {
  envelopeId: Id;
  /**
   * Your own reference for this request, when one envelope can lead to several (a signer who
   * starts again). Defaults to `envelopeId`.
   */
  reference?: string;
  recipient: Pick<Recipient, 'name' | 'email' | 'phone'>;
  /** The PDF to be signed. */
  documentBytes: Uint8Array;
  documentName: string;
  /**
   * Where the signer's Aadhaar eSign box sits. A provider whose API takes a position per
   * request places the signature there; one that takes it from its own configuration, such
   * as Leegality's v3.0 API, ignores it.
   */
  signaturePositions: SignaturePosition[];
  /** Where the provider should send status callbacks. */
  callbackUrl: string;
  /** Where the signer lands after signing or declining. */
  redirectUrl: string;
}

export interface EsignSession {
  /** The provider's id for this request; keep it to match webhooks and fetch the signed file. */
  providerRef: string;
  /** Send the signer here to complete Aadhaar eSign. */
  signUrl: string;
}

export type EsignStatus = 'signed' | 'failed' | 'expired' | 'declined';

export interface EsignEvent {
  providerRef: string;
  status: EsignStatus;
  signerName?: string;
  signedAt?: string;
}

export type WebhookHeaders = Record<string, string | string[] | undefined> | Headers;

export interface EsignProvider {
  readonly name: string;
  /** `sandbox` when requests go to the provider's test environment. */
  readonly environment?: 'sandbox' | 'production';
  createRequest(request: EsignRequest): Promise<EsignSession>;
  /**
   * Verifies a webhook and returns its event. Throws `SignError('WEBHOOK_INVALID')` for a body
   * that cannot be verified. Returns `null` for a verified callback that does not change the
   * signer's status (for example a reviewer approval).
   */
  parseWebhook(headers: WebhookHeaders, rawBody: string | Uint8Array): Promise<EsignEvent | null>;
  /** The signed PDF. Throws `SignError('INVALID_STATE')` until every signer has signed. */
  fetchSignedDocument(providerRef: string): Promise<Uint8Array>;
  /**
   * The provider reference a webhook body names, read without verifying anything, or null.
   * A server that holds several provider accounts uses it to find whose credentials must
   * verify the webhook. Never act on it before `parseWebhook` has accepted the same body.
   */
  webhookRef?(rawBody: string | Uint8Array): string | null;
  /**
   * Makes one read-only call with the configured credentials. Resolves when the provider
   * accepts them and throws `SignError('PROVIDER_ERROR')` otherwise.
   */
  checkCredentials?(): Promise<void>;
}
