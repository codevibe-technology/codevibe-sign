import type { EsignEvent, EsignProvider } from '@codevibe_technology/sign-aadhaar';
import {
  SignError,
  decline,
  hasActed,
  isActive,
  isExpiredAt,
  isFinal,
  submit,
  type AuditAction,
  type AuditContext,
  type Envelope,
  type FieldValue,
  type Id,
  type PendingAuditEvent,
  type Recipient,
  type RecipientEsign,
  type TransitionResult,
} from '@codevibe_technology/sign-core';
import { HttpError, validation } from '../errors';
import { enforce } from '../http/rate-limit';
import type { Runtime } from '../runtime/context';
import { mutate } from '../runtime/mutate';
import { timeZoneFor } from '../runtime/time-zone';
import { OPEN_STATUSES, endSession, settle } from './settle';
import type { EsignSession, EsignSignature, EsignUnavailable } from './types';

export const esignedFileKey = (envelopeId: Id, documentId: Id) =>
  `envelopes/${envelopeId}/documents/${documentId}/esigned.pdf`;

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** A session whose provider call never came back is given up after this long. */
const STARTING_TTL_MS = 5 * 60 * 1000;
const STARTS_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 10_000;
export const PROVIDER_DECLINE_REASON = 'Declined at the eSign provider';

const NOT_CONFIGURED: EsignUnavailable = {
  reason: 'not_configured',
  message: 'Aadhaar eSign is not set up on this server',
};
const SIGNER_UNAVAILABLE =
  'Aadhaar eSign is not available for this document right now. The sender has been told.';
const START_FAILED = 'Aadhaar eSign could not be started. Try again in a few minutes.';

export const hasAadhaarSigner = (envelope: Envelope) =>
  envelope.recipients.some((r) => r.auth === 'aadhaar');

/** Why an envelope's workspace cannot use Aadhaar eSign now, or null when it can. */
export async function esignUnavailable(
  rt: Runtime,
  workspaceId: string,
): Promise<EsignUnavailable | null> {
  if (!rt.esign || !rt.store.esign) return NOT_CONFIGURED;
  return (await rt.esign.available?.(workspaceId)) ?? null;
}

/** Refuses to send an envelope with an Aadhaar signer from a workspace that cannot eSign. */
export async function assertEsignReady(
  rt: Runtime,
  workspaceId: string,
  envelope: Envelope,
): Promise<void> {
  if (!hasAadhaarSigner(envelope)) return;
  const blocked = await esignUnavailable(rt, workspaceId);
  if (blocked) {
    throw new SignError('ESIGN_UNAVAILABLE', blocked.message, { reason: blocked.reason });
  }
}

function withEsign(envelope: Envelope, recipientId: Id, esign: RecipientEsign): Envelope {
  return {
    ...envelope,
    recipients: envelope.recipients.map((r) => (r.id === recipientId ? { ...r, esign } : r)),
  };
}

const NOTHING = (envelope: Envelope): TransitionResult => ({ envelope, events: [], effects: [] });

function noted(
  envelope: Envelope,
  action: AuditAction,
  event: Omit<PendingAuditEvent, 'envelopeId' | 'action'>,
): TransitionResult {
  return {
    envelope,
    events: [{ envelopeId: envelope.id, action, ...event }],
    effects: [{ kind: 'webhook', event: action, envelopeId: envelope.id }],
  };
}

/** Writes to the audit trail without letting a closed or busy envelope fail the caller. */
async function record(
  rt: Runtime,
  envelopeId: Id,
  apply: (envelope: Envelope) => TransitionResult,
): Promise<void> {
  try {
    await mutate(rt, envelopeId, apply);
  } catch (err) {
    rt.logger.warn('esign audit event was not recorded', {
      envelope: envelopeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Records that an eSign did not finish, so the sender can see why on the envelope. */
async function recordFailure(
  rt: Runtime,
  input: { envelopeId: Id; recipientId: Id; provider?: string; context?: AuditContext },
  reason: string,
  status: 'failed' | 'expired' = 'failed',
): Promise<void> {
  const at = rt.clock.now().toISOString();
  await record(rt, input.envelopeId, (envelope) => {
    const recipient = envelope.recipients.find((r) => r.id === input.recipientId);
    if (isFinal(envelope) || !recipient || hasActed(recipient)) return NOTHING(envelope);
    const next = input.provider
      ? withEsign(envelope, recipient.id, { provider: input.provider, status })
      : envelope;
    return noted(next, 'recipient.esign_failed', {
      at,
      recipientId: recipient.id,
      ...(input.context ? { context: input.context } : {}),
      data: { reason, ...(input.provider ? { provider: input.provider } : {}) },
    });
  });
}

/** Compares by field and value only: a store may hand objects back with their keys reordered. */
const sameValues = (a: FieldValue[], b: FieldValue[]) => {
  const key = (values: FieldValue[]) =>
    JSON.stringify(
      values.map((v) => [v.fieldId, v.value] as const).sort(([x], [y]) => x.localeCompare(y)),
    );
  return key(a) === key(b);
};

/** The signer's values without the signing date, which moves from one attempt to the next. */
function comparable(envelope: Envelope, values: FieldValue[]): FieldValue[] {
  const dates = new Set(envelope.fields.filter((f) => f.type === 'date_signed').map((f) => f.id));
  return values.filter((v) => !dates.has(v.fieldId));
}

export interface StartEsignInput {
  envelope: Envelope;
  recipient: Recipient;
  workspaceId: string;
  values: FieldValue[];
  context: AuditContext;
}

/**
 * Sends the signer to the eSign provider: draws their values on the document, asks the
 * provider to sign that file and answers the provider's signing page. Asking again while the
 * first request is open answers the same page; nothing is reserved or requested twice.
 */
export async function startEsign(
  rt: Runtime,
  input: StartEsignInput,
): Promise<{ signUrl: string; expiresAt: string }> {
  const { envelope, recipient, workspaceId, context } = input;
  if (recipient.auth !== 'aadhaar') {
    throw validation('This recipient does not sign with Aadhaar eSign');
  }
  const now = rt.clock.now();
  // Checks the turn, the envelope's state and every value exactly as signing would.
  const signed = submit(
    structuredClone(envelope),
    { recipientId: recipient.id, values: input.values },
    { clock: rt.clock },
  ).envelope;
  const ownFields = envelope.fields.filter((f) => f.recipientId === recipient.id);
  const ownIds = new Set(ownFields.map((f) => f.id));
  const values = signed.values.filter((v) => ownIds.has(v.fieldId));

  const store = rt.store.esign;
  const esign = rt.esign;
  const who = { envelopeId: envelope.id, recipientId: recipient.id, context };
  const refuse = async (blocked: EsignUnavailable): Promise<never> => {
    await recordFailure(rt, who, blocked.reason);
    throw new SignError('ESIGN_UNAVAILABLE', blocked.signerMessage ?? SIGNER_UNAVAILABLE, {
      reason: blocked.reason,
    });
  };
  if (!store || !esign) return refuse(NOT_CONFIGURED);

  const current = await store.latest(envelope.id, recipient.id);
  if (current && OPEN_STATUSES.includes(current.status)) {
    const live = current.expiresAt.getTime() > now.getTime();
    if (current.status === 'starting' && live) {
      throw new HttpError('CONFLICT', 'Aadhaar eSign is already starting. Try again in a moment.');
    }
    const unchanged = sameValues(
      comparable(envelope, current.values),
      comparable(envelope, values),
    );
    if (current.status === 'pending' && live && unchanged && current.signUrl) {
      return { signUrl: current.signUrl, expiresAt: current.expiresAt.toISOString() };
    }
    await endSession(rt, current, OPEN_STATUSES, 'failed');
  }

  await enforce(
    rt.limiter,
    `esign-start:${envelope.id}:${recipient.id}`,
    STARTS_PER_HOUR,
    HOUR_MS,
    now,
  );
  const blocked = await esign.available?.(workspaceId);
  if (blocked) return refuse(blocked);
  const provider = await esign.provider(workspaceId);
  if (!provider) return refuse(NOT_CONFIGURED);

  const document = envelope.documents[0];
  const original = document ? await rt.files.get(document.fileKey) : null;
  if (!document || !original) {
    throw new SignError('ENVELOPE_NOT_FOUND', 'Document file not found');
  }

  const session: EsignSession = {
    id: rt.ids.id(),
    workspaceId,
    envelopeId: envelope.id,
    recipientId: recipient.id,
    documentId: document.id,
    provider: provider.name,
    providerRef: null,
    signUrl: null,
    status: 'starting',
    values,
    context,
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + STARTING_TTL_MS),
  };
  if (!(await store.insert(session))) {
    throw new HttpError('CONFLICT', 'Aadhaar eSign is already starting. Try again in a moment.');
  }
  const hook = {
    workspaceId,
    envelopeId: envelope.id,
    recipientId: recipient.id,
    ref: session.id,
  };

  try {
    await esign.onStart?.(hook);
  } catch (err) {
    // Nothing was reserved, so there is nothing for `onEnd` to give back.
    await store.transition(session.id, ['starting'], 'failed', rt.clock.now());
    const refused = err instanceof SignError && err.code === 'ESIGN_UNAVAILABLE';
    const reason =
      refused && typeof err.details?.reason === 'string' ? err.details.reason : 'refused';
    if (!refused) {
      rt.logger.error('esign onStart failed', {
        envelope: envelope.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return refuse({
      reason,
      message: reason,
      ...(refused ? { signerMessage: err.message } : {}),
    });
  }

  let created: { providerRef: string; signUrl: string };
  try {
    const timeZone = await timeZoneFor(rt, workspaceId);
    const fields = envelope.fields.filter((f) => f.documentId === document.id);
    const fieldIds = new Set(fields.map((f) => f.id));
    const rendered = await rt.pdf.renderFields(
      original,
      fields,
      signed.values.filter((v) => fieldIds.has(v.fieldId)),
      signed.recipients,
      { documentId: document.id, ...(timeZone ? { timeZone } : {}) },
    );
    created = await provider.createRequest({
      envelopeId: envelope.id,
      reference: session.id,
      recipient: {
        name: recipient.name,
        ...(recipient.email ? { email: recipient.email } : {}),
        ...(recipient.phone ? { phone: recipient.phone } : {}),
      },
      documentBytes: rendered,
      documentName: document.name,
      signaturePositions: ownFields
        .filter((f) => f.type === 'signature')
        .map((f) => ({ page: f.page, rect: f.rect })),
      callbackUrl: `${rt.publicUrl}${rt.basePath}/v1/esign/webhooks/${provider.name}`,
      redirectUrl: `${rt.signingPageUrl}?esign=return`,
    });
  } catch (err) {
    await endSession(rt, session, ['starting'], 'failed');
    const reason =
      err instanceof SignError && typeof err.details?.reason === 'string'
        ? err.details.reason
        : 'provider_error';
    await recordFailure(rt, { ...who, provider: provider.name }, reason);
    rt.logger.error('esign request was not created', {
      envelope: envelope.id,
      provider: provider.name,
      reason,
      error: err instanceof SignError ? err.code : 'Error',
    });
    if (err instanceof SignError && err.code === 'RATE_LIMITED') throw err;
    if (err instanceof SignError && err.code === 'DOCUMENT_TOO_LARGE') {
      throw new SignError(
        'DOCUMENT_TOO_LARGE',
        'This document is too large for Aadhaar eSign. Ask the sender for a smaller file.',
      );
    }
    throw new SignError('PROVIDER_ERROR', START_FAILED, { reason: 'provider_error' });
  }

  const ttl = esign.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const envelopeEnd = envelope.expiresAt ? Date.parse(envelope.expiresAt) : Infinity;
  const at = rt.clock.now();
  const expiresAt = new Date(Math.min(at.getTime() + ttl, envelopeEnd));
  if (!(await store.activate(session.id, { ...created, expiresAt, at }))) {
    await endSession(rt, session, ['starting'], 'failed');
    throw new SignError('PROVIDER_ERROR', START_FAILED, { reason: 'provider_error' });
  }
  await record(rt, envelope.id, (current) =>
    noted(
      withEsign(current, recipient.id, { provider: provider.name, status: 'pending' }),
      'recipient.esign_started',
      {
        at: at.toISOString(),
        recipientId: recipient.id,
        context,
        data: { provider: provider.name, providerRef: created.providerRef },
      },
    ),
  );
  return { signUrl: created.signUrl, expiresAt: expiresAt.toISOString() };
}

/** What the server can tell about the file the provider signed. */
async function inspect(rt: Runtime, bytes: Uint8Array): Promise<EsignSignature | undefined> {
  if (!Buffer.from(bytes.subarray(0, 1024)).toString('latin1').includes('%PDF-')) {
    throw new SignError('PROVIDER_ERROR', 'The eSign provider returned a file that is not a PDF', {
      reason: 'unsigned_file',
    });
  }
  if (!rt.pdf.verifySignatures) return undefined;
  const signatures = await rt.pdf.verifySignatures(bytes);
  const last = signatures.at(-1);
  if (!last) {
    throw new SignError('PROVIDER_ERROR', 'The file from the eSign provider is not signed', {
      reason: 'unsigned_file',
    });
  }
  return {
    intact: signatures.every((s) => s.valid),
    ...(last.signer?.commonName ? { signerCommonName: last.signer.commonName } : {}),
    ...(last.issuer?.commonName ? { issuerCommonName: last.issuer.commonName } : {}),
    ...(last.certificateSha256 ? { certificateSha256: last.certificateSha256 } : {}),
    ...(last.signedAt ? { signedAt: last.signedAt } : {}),
  };
}

const CLOSED = new Set([
  'INVALID_STATE',
  'NOT_YOUR_TURN',
  'ENVELOPE_EXPIRED',
  'ENVELOPE_NOT_FOUND',
]);

async function providerOf(rt: Runtime, session: EsignSession): Promise<EsignProvider> {
  const provider = await rt.esign?.provider(session.workspaceId);
  if (!provider || provider.name !== session.provider) {
    throw new SignError('PROVIDER_ERROR', 'The eSign provider of this workspace is not set up', {
      reason: 'not_configured',
    });
  }
  return provider;
}

/**
 * The provider signed: keeps its file, marks the recipient signed with the values they gave
 * and ends the session. Safe to run twice at once; the envelope takes one signature and
 * `onEnd` hears `signed` once. A session that had expired or failed is still honoured,
 * because the provider did the work.
 */
export async function completeSigned(
  rt: Runtime,
  session: EsignSession,
  result: { bytes?: Uint8Array; signerName?: string } = {},
): Promise<void> {
  if (session.status === 'signed' || !session.providerRef) return;
  const bytes =
    result.bytes ??
    (await (await providerOf(rt, session)).fetchSignedDocument(session.providerRef));
  const signature = await inspect(rt, bytes);
  const signedAt = rt.clock.now().toISOString();
  const signerName = result.signerName ?? signature?.signerCommonName;

  const stored = await rt.store.load(session.envelopeId);
  const recipient = stored?.envelope.recipients.find((r) => r.id === session.recipientId);
  const open =
    stored &&
    recipient &&
    !hasActed(recipient) &&
    isActive(stored.envelope) &&
    !isExpiredAt(stored.envelope, rt.clock.now());
  if (open) {
    await rt.files.put(
      esignedFileKey(session.envelopeId, session.documentId),
      bytes,
      'application/pdf',
    );
    const ownIds = new Set(session.values.map((v) => v.fieldId));
    try {
      await mutate(rt, session.envelopeId, (current) => {
        const next = submit(
          current,
          {
            recipientId: session.recipientId,
            values: session.values,
            ...(session.context ? { context: session.context } : {}),
            data: {
              method: 'aadhaar_esign',
              provider: session.provider,
              providerRef: session.providerRef ?? '',
              ...(signerName ? { signerName } : {}),
              ...(signature?.certificateSha256
                ? { certificateSha256: signature.certificateSha256 }
                : {}),
            },
          },
          { clock: rt.clock },
        );
        // The page the provider signed shows the values of the moment the signer started.
        const kept = next.envelope.values.filter((v) => !ownIds.has(v.fieldId));
        return {
          ...next,
          envelope: withEsign(
            { ...next.envelope, values: [...kept, ...session.values] },
            session.recipientId,
            {
              provider: session.provider,
              status: 'signed',
              signedAt,
              ...(signerName ? { signerName } : {}),
            },
          ),
        };
      });
    } catch (err) {
      if (!(err instanceof SignError && CLOSED.has(err.code))) throw err;
    }
  } else {
    rt.logger.warn('esign finished for an envelope that is no longer open', {
      envelope: session.envelopeId,
      session: session.id,
    });
  }
  await endSession(rt, session, ['pending', 'expired', 'failed'], 'signed', {
    ...(signerName ? { signerName } : {}),
    ...(signature ? { signature } : {}),
  });
}

/** Applies a verified provider event to its session. Repeats change nothing. */
export async function applyEsignEvent(
  rt: Runtime,
  session: EsignSession,
  event: EsignEvent,
): Promise<void> {
  if (event.status === 'signed') {
    await completeSigned(rt, session, {
      ...(event.signerName ? { signerName: event.signerName } : {}),
    });
    return;
  }
  if (!(await endSession(rt, session, OPEN_STATUSES, event.status))) return;
  if (event.status === 'declined') {
    try {
      await mutate(rt, session.envelopeId, (current) =>
        decline(
          withEsign(current, session.recipientId, {
            provider: session.provider,
            status: 'declined',
          }),
          {
            recipientId: session.recipientId,
            reason: PROVIDER_DECLINE_REASON,
            ...(session.context ? { context: session.context } : {}),
          },
          { clock: rt.clock },
        ),
      );
    } catch (err) {
      if (!(err instanceof SignError && CLOSED.has(err.code))) throw err;
    }
    return;
  }
  await recordFailure(
    rt,
    { ...session, provider: session.provider },
    event.status === 'expired' ? 'provider_expired' : 'provider_failed',
    event.status,
  );
}

/**
 * Asks the provider whether a pending session has been signed, at most once every few
 * seconds per session, and completes it if so. Lets the signing page move on when the
 * provider's webhook is late or never arrives.
 */
export async function checkPending(
  rt: Runtime,
  session: EsignSession,
  options: { force?: boolean } = {},
): Promise<'signed' | 'pending'> {
  if (session.status !== 'pending' || !session.providerRef) return 'pending';
  if (!options.force) {
    const hit = await rt.limiter.hit(
      `esign-check:${session.id}`,
      1,
      CHECK_INTERVAL_MS,
      rt.clock.now(),
    );
    if (!hit.allowed) return 'pending';
  }
  let bytes: Uint8Array;
  try {
    bytes = await (await providerOf(rt, session)).fetchSignedDocument(session.providerRef);
  } catch (err) {
    if (!(err instanceof SignError && err.code === 'INVALID_STATE')) {
      rt.logger.warn('esign status check failed', {
        envelope: session.envelopeId,
        session: session.id,
        error: err instanceof SignError ? err.code : 'Error',
      });
    }
    return 'pending';
  }
  await completeSigned(rt, session, { bytes });
  return 'signed';
}

/** Expires sessions past their time, after one last look, and retries unheard outcomes. */
export async function tickEsign(rt: Runtime, limit = 50): Promise<void> {
  const store = rt.store.esign;
  if (!store || !rt.esign) return;
  for (const session of await store.due(rt.clock.now(), limit)) {
    try {
      if (session.unsettled && !OPEN_STATUSES.includes(session.status)) {
        await settle(rt, session, session.unsettled);
        continue;
      }
      if (session.status === 'starting') {
        if (await endSession(rt, session, ['starting'], 'failed')) {
          await recordFailure(rt, { ...session, provider: session.provider }, 'start_interrupted');
        }
        continue;
      }
      if ((await checkPending(rt, session, { force: true })) === 'signed') continue;
      if (await endSession(rt, session, ['pending'], 'expired')) {
        await recordFailure(rt, { ...session, provider: session.provider }, 'expired', 'expired');
      }
    } catch (err) {
      rt.logger.error('esign session check failed', {
        envelope: session.envelopeId,
        session: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
