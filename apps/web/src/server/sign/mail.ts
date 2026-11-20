import 'server-only';
import type { MailTemplates, WorkspaceMail } from '@codevibe_technology/sign-server';
import { renderMail, type MailBrand } from '@/lib/mail-templates';
import type { Brand } from '../brand';

export interface WorkspaceMailDeps {
  appUrl: string;
  brand: (workspaceId: string) => Promise<Brand>;
  workspaceName: (workspaceId: string) => Promise<string | null>;
}

/**
 * The sign server's `workspaceMail` hook: every invitation, reminder, completed copy and
 * cancellation in the workspace's brand, with its own subject and opening text where set.
 */
export function createWorkspaceMail(deps: WorkspaceMailDeps) {
  return async (workspaceId: string): Promise<WorkspaceMail | null> => {
    const name = await deps.workspaceName(workspaceId);
    if (!name) return null;
    const brand = await deps.brand(workspaceId);
    const company = brand.senderName ?? name;
    const look: MailBrand = {
      company,
      brandColor: brand.brandColor,
      logoUrl: brand.logoUrl ? `${deps.appUrl}${brand.logoUrl}` : null,
      showBadge: brand.showBadge,
    };
    const overrides = brand.emailOverrides;
    const templates: MailTemplates = {
      invite: ({ envelope, recipient, link }) =>
        renderMail(
          'invite',
          {
            recipientName: recipient.name,
            title: envelope.title,
            role: recipient.role,
            message: envelope.message ?? null,
            expiresAt: envelope.expiresAt ?? null,
            link,
          },
          look,
          overrides.invite,
        ),
      reminder: ({ envelope, recipient, link }) =>
        renderMail(
          'reminder',
          {
            recipientName: recipient.name,
            title: envelope.title,
            role: recipient.role,
            message: envelope.message ?? null,
            expiresAt: envelope.expiresAt ?? null,
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
