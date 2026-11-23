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
import {
  auditTrailFile,
  auditTrailName,
  certificateName,
  certificateWithAuditTrailName,
  providerAuditTrailFile,
} from './audit-trail';
import type { Runtime } from './context';
import {
  certificateFileKey,
  certificatesWithAuditTrail,
  sealedFileKey,
  separateCertificates,
} from './seal';
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
    const events = await rt.store.listEvents(envelope.id);
    const certificates = separateCertificates(events);
    const withTrail = certificatesWithAuditTrail(events);
    // A document signed with Aadhaar eSign has the audit trail in its certificate file.
    const ownTrail = !envelope.documents.some((d) => withTrail.has(d.id));
    const trail = ownTrail
      ? await auditTrailFile(rt, envelope, workspaceId).catch((err: unknown) => {
          rt.logger.warn('audit trail was not drawn for the completed copy', {
            envelope: envelope.id,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        })
      : null;
    const auditTrail = trail !== null || !ownTrail;
    const files = { certificates, withTrail };
    const attachments = await sealedAttachments(rt, envelope, files, trail);
    if (attachments) {
      try {
        const mail = templates.completed({
          envelope,
          recipient,
          attached: true,
          auditTrail,
          ...(ownTrail ? {} : { esign: true }),
          downloads: [],
        });
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
    const downloads = copyDownloads(rt, envelope, recipient, files, trail !== null);
    await rt.mailer.send({
      ...base,
      ...templates.completed({
        envelope,
        recipient,
        attached: false,
        auditTrail,
        ...(ownTrail ? {} : { esign: true }),
        downloads,
      }),
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

interface CopyFiles {
  /** Documents whose certificate is a file of its own. */
  certificates: ReadonlySet<string>;
  /** Of those, the ones whose certificate file holds the audit trail too. */
  withTrail: ReadonlySet<string>;
}

const certificateFile = (envelope: Envelope, documentName: string, files: CopyFiles, id: string) =>
  files.withTrail.has(id) ? certificateWithAuditTrailName(envelope) : certificateName(documentName);

/**
 * One personal download link per file, for a completed copy sent without attachments: each
 * document, its separate certificate, and the audit trail once for the envelope.
 */
function copyDownloads(
  rt: Runtime,
  envelope: Envelope,
  recipient: Recipient,
  files: CopyFiles,
  auditTrail: boolean,
): CopyDownload[] {
  const claim = issueCopyClaim(rt.sessionSecret, envelope.id, recipient.id, rt.clock.now());
  const urlOf = (documentId: string) =>
    `${rt.publicUrl}${rt.basePath}/v1/sign/copy/${encodeURIComponent(documentId)}?c=${claim}`;
  const links = envelope.documents.flatMap((document) => {
    const url = urlOf(document.id);
    return [
      { name: document.name, url },
      ...(files.certificates.has(document.id)
        ? [
            {
              name: certificateFile(envelope, document.name, files, document.id),
              url: `${url}&file=certificate`,
            },
          ]
        : []),
    ];
  });
  const first = envelope.documents[0];
  return auditTrail && first
    ? [...links, { name: auditTrailName(envelope), url: `${urlOf(first.id)}&file=audit-trail` }]
    : links;
}

/** The provider's audit trail goes with the attachments only when it is this small. */
const PROVIDER_TRAIL_ATTACH_BYTES = 2 * 1024 * 1024;

/**
 * The sealed files to attach, with the audit trail after them, or null to send links instead:
 * when one is missing or cannot be read, or together they are over `maxAttachmentBytes`. The
 * eSign provider's own audit trail is added when it is small and still fits; it is not one of
 * the links otherwise, and stays on the envelope page.
 */
async function sealedAttachments(
  rt: Runtime,
  envelope: Envelope,
  files: CopyFiles,
  trail: Uint8Array | null,
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
    const parts = [
      {
        key: sealedFileKey(envelope.id, document.id),
        filename: /\.pdf$/i.test(document.name) ? document.name : `${document.name}.pdf`,
      },
      ...(files.certificates.has(document.id)
        ? [
            {
              key: certificateFileKey(envelope.id, document.id),
              filename: certificateFile(envelope, document.name, files, document.id),
            },
          ]
        : []),
    ];
    for (const file of parts) {
      const content = await read(file.key, document.id);
      if (!content) return null;
      total += content.byteLength;
      if (total > rt.limits.maxAttachmentBytes) return null;
      attachments.push({ filename: file.filename, content, contentType: 'application/pdf' });
    }
  }
  if (trail) {
    total += trail.byteLength;
    if (total > rt.limits.maxAttachmentBytes) return null;
    attachments.push({
      filename: auditTrailName(envelope),
      content: trail,
      contentType: 'application/pdf',
    });
  }
  const provider = await providerAuditTrailFile(rt, envelope).catch(() => null);
  if (
    provider &&
    provider.bytes.byteLength <= PROVIDER_TRAIL_ATTACH_BYTES &&
    total + provider.bytes.byteLength <= rt.limits.maxAttachmentBytes
  ) {
    attachments.push({
      filename: provider.filename,
      content: provider.bytes,
      contentType: 'application/pdf',
    });
  }
  return attachments;
}
