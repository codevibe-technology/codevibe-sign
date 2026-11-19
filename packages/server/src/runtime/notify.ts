import {
  createSigningToken,
  hasActed,
  isFinal,
  type Effect,
  type Envelope,
  type Id,
  type Recipient,
} from '@codevibe_technology/sign-core';
import { DEFAULT_WORKSPACE } from '../tenancy';
import type { MailTemplates } from '../templates';
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

/** The templates and sender details for mail about an envelope in `workspaceId`. */
async function mailFor(rt: Runtime, workspaceId: string) {
  const custom = rt.workspaceMail ? await rt.workspaceMail(workspaceId) : null;
  const templates: MailTemplates = { ...rt.templates, ...custom?.templates };
  const sender = {
    ...(custom?.fromName ? { fromName: custom.fromName } : {}),
    ...(custom?.replyTo ? { replyTo: custom.replyTo } : {}),
  };
  return { templates, sender };
}

export async function runNotify(rt: Runtime, payload: NotifyPayload): Promise<void> {
  const stored = await rt.store.load(payload.envelopeId);
  const recipient = stored?.envelope.recipients.find((r) => r.id === payload.recipientId);
  if (!stored || !recipient) return;
  const { envelope } = stored;
  if (!recipient.email) {
    rt.logger.warn('recipient has no email address, skipping notification', {
      envelope: envelope.id,
      recipient: recipient.id,
      reason: payload.reason,
    });
    return;
  }

  const linkMail = payload.reason === 'invite' || payload.reason === 'reminder';
  if (linkMail && (isFinal(envelope) || hasActed(recipient))) return;
  const { templates, sender } = await mailFor(rt, stored.workspaceId ?? DEFAULT_WORKSPACE);

  if (payload.reason === 'completed_copy') {
    const attachments = await sealedAttachments(rt, envelope);
    const mail = templates.completed({ envelope, recipient, attached: attachments !== null });
    await rt.mailer.send({
      to: recipient.email,
      ...sender,
      ...mail,
      ...(attachments ? { attachments } : {}),
    });
    return;
  }

  if (payload.reason === 'cancelled') {
    await rt.mailer.send({
      to: recipient.email,
      ...sender,
      ...templates.cancelled({ envelope, recipient }),
    });
    return;
  }

  const link = await issueToken(rt, envelope, recipient);
  const template = payload.reason === 'invite' ? templates.invite : templates.reminder;
  await rt.mailer.send({
    to: recipient.email,
    ...sender,
    ...template({ envelope, recipient, link }),
  });
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
