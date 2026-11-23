import {
  createSigningToken,
  hasActed,
  isFinal,
  type Effect,
  type Envelope,
  type Id,
  type Recipient,
} from '@codevibe_technology/sign-core';
import { issueCopyClaim } from '../http/session';
import { DEFAULT_WORKSPACE } from '../tenancy';
import type { CopyDownload, MailTemplates } from '../templates';
import type { Runtime } from './context';
import { certificateFileKey, sealedFileKey, separateCertificates } from './seal';
import { timeZoneFor } from './time-zone';

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
  const workspaceId = stored.workspaceId ?? DEFAULT_WORKSPACE;
  const { templates, sender } = await mailFor(rt, workspaceId);
  const base = {
    to: recipient.email,
    ...sender,
    meta: {
      kind: payload.reason,
      workspaceId,
      envelopeId: envelope.id,
      recipientId: recipient.id,
    },
  };

  if (payload.reason === 'completed_copy') {
    const certificates = separateCertificates(await rt.store.listEvents(envelope.id));
    const attachments = await sealedAttachments(rt, envelope, certificates);
    if (attachments) {
      try {
        const mail = templates.completed({ envelope, recipient, attached: true, downloads: [] });
        await rt.mailer.send({ ...base, ...mail, attachments });
        return;
      } catch (err) {
        rt.logger.warn('completed copy with attachments was not sent, sending links instead', {
          envelope: envelope.id,
          recipient: recipient.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const downloads = copyDownloads(rt, envelope, recipient, certificates);
    await rt.mailer.send({
      ...base,
      ...templates.completed({ envelope, recipient, attached: false, downloads }),
    });
    return;
  }

  if (payload.reason === 'cancelled') {
    await rt.mailer.send({ ...base, ...templates.cancelled({ envelope, recipient }) });
    return;
  }

  const link = await issueToken(rt, envelope, recipient);
  const template = payload.reason === 'invite' ? templates.invite : templates.reminder;
  const timeZone = await timeZoneFor(rt, workspaceId);
  await rt.mailer.send({
    ...base,
    ...template({ envelope, recipient, link, ...(timeZone ? { timeZone } : {}) }),
  });
}

/** One personal download link per document, for a completed copy sent without attachments. */
function copyDownloads(
  rt: Runtime,
  envelope: Envelope,
  recipient: Recipient,
  certificates: ReadonlySet<string>,
): CopyDownload[] {
  const claim = issueCopyClaim(rt.sessionSecret, envelope.id, recipient.id, rt.clock.now());
  return envelope.documents.flatMap((document) => {
    const url = `${rt.publicUrl}${rt.basePath}/v1/sign/copy/${encodeURIComponent(document.id)}?c=${claim}`;
    return [
      { name: document.name, url },
      ...(certificates.has(document.id)
        ? [{ name: certificateName(document.name), url: `${url}&file=certificate` }]
        : []),
    ];
  });
}

const certificateName = (documentName: string) =>
  `${documentName.replace(/\.pdf$/i, '')} (signing certificate).pdf`;

/**
 * The sealed files to attach, or null to send links instead: when one is missing or cannot be
 * read, or together they are over `maxAttachmentBytes`.
 */
async function sealedAttachments(
  rt: Runtime,
  envelope: Envelope,
  certificates: ReadonlySet<string>,
) {
  const attachments = [];
  let total = 0;
  const read = (key: string, documentId: string) =>
    rt.files.get(key).catch((err: unknown) => {
      rt.logger.warn('sealed file could not be read for the completed copy', {
        envelope: envelope.id,
        document: documentId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
  for (const document of envelope.documents) {
    const files = [
      {
        key: sealedFileKey(envelope.id, document.id),
        filename: /\.pdf$/i.test(document.name) ? document.name : `${document.name}.pdf`,
      },
      ...(certificates.has(document.id)
        ? [
            {
              key: certificateFileKey(envelope.id, document.id),
              filename: certificateName(document.name),
            },
          ]
        : []),
    ];
    for (const file of files) {
      const content = await read(file.key, document.id);
      if (!content) return null;
      total += content.byteLength;
      if (total > rt.limits.maxAttachmentBytes) return null;
      attachments.push({ filename: file.filename, content, contentType: 'application/pdf' });
    }
  }
  return attachments;
}
