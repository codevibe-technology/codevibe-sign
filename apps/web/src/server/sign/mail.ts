import 'server-only';
import type { Mailer, OtpSender } from '@codevibe_technology/sign-core';
import type { MailTemplates, WorkspaceMail } from '@codevibe_technology/sign-server';
import { codeMail, renderMail, type MailBrand } from '@/lib/mail-templates';
import type { Brand } from '../brand';

export interface WorkspaceMailDeps {
  appUrl: string;
  /** Who runs the install, for the footer. */
  org?: string | null;
  brand: (workspaceId: string) => Promise<Brand>;
  workspaceName: (workspaceId: string) => Promise<string | null>;
}

/** A workspace's look for its emails, or null when the workspace is gone. */
async function lookOf(deps: WorkspaceMailDeps, workspaceId: string) {
  const name = await deps.workspaceName(workspaceId);
  if (!name) return null;
  const brand = await deps.brand(workspaceId);
  const look: MailBrand = {
    company: brand.senderName ?? name,
    brandColor: brand.brandColor,
    logoUrl: brand.logoUrl ? `${deps.appUrl}${brand.logoUrl}` : null,
    showBadge: brand.showBadge,
    appUrl: deps.appUrl,
    org: deps.org ?? null,
  };
  return { brand, look };
}

/**
 * The sign server's `workspaceMail` hook: every invitation, reminder, completed copy and
 * cancellation in the workspace's brand, with its own subject and opening text where set.
 */
export function createWorkspaceMail(deps: WorkspaceMailDeps) {
  return async (workspaceId: string): Promise<WorkspaceMail | null> => {
    const found = await lookOf(deps, workspaceId);
    if (!found) return null;
    const { brand, look } = found;
    const company = look.company;
    const overrides = brand.emailOverrides;
    const templates: MailTemplates = {
      invite: ({ envelope, recipient, link, timeZone }) =>
        renderMail(
          'invite',
          {
            recipientName: recipient.name,
            title: envelope.title,
            role: recipient.role,
            aadhaar: recipient.auth === 'aadhaar',
            message: envelope.message ?? null,
            changeNote: envelope.changeNote ?? null,
            expiresAt: envelope.expiresAt ?? null,
            ...(timeZone ? { timeZone } : {}),
            link,
          },
          look,
          overrides.invite,
        ),
      reminder: ({ envelope, recipient, link, timeZone }) =>
        renderMail(
          'reminder',
          {
            recipientName: recipient.name,
            title: envelope.title,
            role: recipient.role,
            aadhaar: recipient.auth === 'aadhaar',
            message: envelope.message ?? null,
            changeNote: envelope.changeNote ?? null,
            expiresAt: envelope.expiresAt ?? null,
            ...(timeZone ? { timeZone } : {}),
            link,
          },
          look,
          overrides.reminder,
        ),
      completed: ({ envelope, recipient, attached, downloads }) =>
        renderMail(
          'completed',
          {
            recipientName: recipient.name,
            title: envelope.title,
            role: recipient.role,
            attached,
            downloads,
          },
          look,
          overrides.completed,
        ),
      cancelled: ({ envelope, recipient }) =>
        renderMail(
          'cancelled',
          {
            recipientName: recipient.name,
            title: envelope.title,
            role: recipient.role,
            envelopeStatus: envelope.status,
          },
          look,
          overrides.cancelled,
        ),
    };
    return {
      templates,
      fromName: company,
      ...(brand.replyTo ? { replyTo: brand.replyTo } : {}),
    };
  };
}

/**
 * Sends one-time codes by email in the brand of the workspace the document belongs to, from
 * its sender name. Recipients set to `sms_otp` need an SMS sender instead.
 */
export function createOtpSender(mailer: Mailer, deps: WorkspaceMailDeps): OtpSender {
  return {
    async send(recipient, code, context) {
      if (!recipient.email) throw new Error(`Recipient ${recipient.id} has no email address`);
      const found = context?.workspaceId ? await lookOf(deps, context.workspaceId) : null;
      const look: MailBrand = found?.look ?? {
        company: 'Codevibe Sign',
        brandColor: '#1B6AE0',
        logoUrl: null,
        showBadge: true,
        appUrl: deps.appUrl,
        org: deps.org ?? null,
      };
      await mailer.send({
        to: recipient.email,
        ...(found ? { fromName: look.company } : {}),
        ...(found?.brand.replyTo ? { replyTo: found.brand.replyTo } : {}),
        ...codeMail({ recipientName: recipient.name, code }, look),
        meta: {
          kind: 'otp',
          recipientId: recipient.id,
          ...(context?.envelopeId ? { envelopeId: context.envelopeId } : {}),
          ...(context?.workspaceId ? { workspaceId: context.workspaceId } : {}),
        },
      });
    },
  };
}
