import {
  createSigningToken,
  hasActed,
  isFinal,
  type Effect,
  type Envelope,
  type Id,
  type Recipient,
} from '@codevibe/sign-core';
import type { Runtime } from './context';
import { sealedFileKey } from './seal';

export interface NotifyPayload {
  envelopeId: Id;
  recipientId: Id;
  reason: Extract<Effect, { kind: 'notify' }>['reason'];
}

/** Creates a signing link for a recipient. Only the hash of the token is stored. */
export async function issueToken(rt: Runtime, envelope: Envelope, recipient: Recipient) {
  const { token, tokenHash } = createSigningToken(rt.random);
  const now = rt.clock.now().getTime();
  const envelopeEnd = envelope.expiresAt ? new Date(envelope.expiresAt).getTime() : Infinity;
  await rt.store.putToken({
    hash: tokenHash,
    envelopeId: envelope.id,
    recipientId: recipient.id,
    expiresAt: new Date(Math.min(now + rt.tokenTtlMs, envelopeEnd)),
  });
  return rt.signingUrl(token);
}

export async function runNotify(rt: Runtime, payload: NotifyPayload): Promise<void> {
  const envelope = await rt.store.get(payload.envelopeId);
  const recipient = envelope?.recipients.find((r) => r.id === payload.recipientId);
  if (!envelope || !recipient) return;
  if (!recipient.email) {
    rt.logger.warn('recipient has no email address, skipping notification', {
      envelope: envelope.id,
      recipient: recipient.id,
      reason: payload.reason,
    });
    return;
  }

  if (payload.reason === 'completed_copy') {
    const attachments = await sealedAttachments(rt, envelope);
    const mail = rt.templates.completed({ envelope, recipient, attached: attachments !== null });
    await rt.mailer.send({
      to: recipient.email,
      ...mail,
      ...(attachments ? { attachments } : {}),
    });
    return;
  }

  if (payload.reason === 'cancelled') {
    await rt.mailer.send({
      to: recipient.email,
      ...rt.templates.cancelled({ envelope, recipient }),
    });
    return;
  }

  if (isFinal(envelope) || hasActed(recipient)) return;
  const link = await issueToken(rt, envelope, recipient);
  const template = payload.reason === 'invite' ? rt.templates.invite : rt.templates.reminder;
  await rt.mailer.send({ to: recipient.email, ...template({ envelope, recipient, link }) });
}

async function sealedAttachments(rt: Runtime, envelope: Envelope) {
  const attachments = [];
  let total = 0;
  for (const document of envelope.documents) {
    const content = await rt.files.get(sealedFileKey(envelope.id, document.id));
    if (!content) return null;
    total += content.byteLength;
    if (total > rt.limits.maxAttachmentBytes) return null;
    const filename = /\.pdf$/i.test(document.name) ? document.name : `${document.name}.pdf`;
    attachments.push({ filename, content, contentType: 'application/pdf' });
  }
  return attachments;
}
