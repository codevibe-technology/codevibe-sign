import 'server-only';
import type { Mailer } from '@codevibe_technology/sign-core';
import { escapeHtml } from '@codevibe_technology/sign-server';
import { BRAND_NAME, LOCKUP } from '@/lib/brand-assets';
import { ROLE_LABELS, type Role } from '@/lib/roles';

/** The lockup as a PNG from the app the link points at, at 28 px tall: mail clients drop SVG. */
function logo(url: string): string {
  const src = new URL(LOCKUP.email, url).href;
  const width = Math.round((LOCKUP.width * 28) / LOCKUP.height);
  return `<img src="${escapeHtml(src)}" alt="${BRAND_NAME}" width="${width}" height="28" style="display:block;border:0;height:28px;width:${width}px">`;
}

function layout(title: string, lines: string[], action: { label: string; url: string }) {
  const text = [...lines, '', `${action.label}: ${action.url}`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#F4F6FA;font-family:Inter,Arial,sans-serif;color:#0D1B2A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:520px;background:#FFFFFF;border:1px solid #D9E0EA;border-radius:12px">
<tr><td style="padding:24px 28px 0">${logo(action.url)}</td></tr>
<tr><td style="padding:16px 28px 20px;border-bottom:4px solid #2DD4BF;font-weight:700;font-size:18px">${escapeHtml(title)}</td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.6">
${lines.map((line) => `<p style="margin:0 0 12px">${escapeHtml(line)}</p>`).join('')}
<p style="margin:24px 0 8px"><a href="${escapeHtml(action.url)}" style="display:inline-block;background:#1B6AE0;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${escapeHtml(action.label)}</a></p>
<p style="margin:16px 0 0;font-size:13px;color:#5B6B80">Or paste this link into your browser:<br>${escapeHtml(action.url)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

export async function sendMagicLink(mailer: Mailer, to: string, url: string) {
  const body = layout(
    'Sign in to Codevibe Sign',
    [
      'Use the button below to sign in. The link works once and expires in 10 minutes.',
      'If you did not ask to sign in, you can ignore this email.',
    ],
    { label: 'Sign in', url },
  );
  await mailer.send({
    to,
    subject: 'Your sign-in link for Codevibe Sign',
    ...body,
    meta: { kind: 'sign_in' },
  });
}

export async function sendInvitation(
  mailer: Mailer,
  input: {
    to: string;
    url: string;
    workspaceId: string;
    workspaceName: string;
    inviterName: string;
    role: Role;
  },
) {
  const body = layout(
    `Join ${input.workspaceName} on Codevibe Sign`,
    [
      `${input.inviterName} invited you to the ${input.workspaceName} workspace as ${ROLE_LABELS[input.role].toLowerCase()}.`,
      'The invitation expires in 7 days.',
    ],
    { label: 'Accept invitation', url: input.url },
  );
  await mailer.send({
    to: input.to,
    subject: `${input.inviterName} invited you to ${input.workspaceName}`,
    ...body,
    meta: { kind: 'team_invite', workspaceId: input.workspaceId },
  });
}

export async function sendPasswordReset(mailer: Mailer, to: string, url: string, minutes: number) {
  const body = layout(
    'Choose a new password',
    [
      `Use the button below to choose a new password for Codevibe Sign. The link works once and expires in ${minutes} minutes.`,
      'If you did not ask for this, you can ignore this email. Your password stays as it is.',
    ],
    { label: 'Choose a new password', url },
  );
  await mailer.send({
    to,
    subject: 'Choose a new password for Codevibe Sign',
    ...body,
    meta: { kind: 'password_reset' },
  });
}

export async function sendPasswordChanged(mailer: Mailer, to: string, signInUrl: string) {
  const body = layout(
    'Your password was changed',
    [
      'The password for your Codevibe Sign account was just set or changed.',
      'If that was you, there is nothing to do. If it was not, choose a new password now with "Forgot password" on the sign-in page, and tell the admin of your workspace.',
    ],
    { label: 'Open the sign-in page', url: signInUrl },
  );
  await mailer.send({
    to,
    subject: 'Your Codevibe Sign password was changed',
    ...body,
    meta: { kind: 'password_changed' },
  });
}

export type TransferMailKind =
  | 'offered'
  | 'started'
  | 'accepted_owner'
  | 'accepted_recipient'
  | 'declined'
  | 'cancelled';

/**
 * The emails of a workspace transfer, to whichever side `kind` is for. `url` is where that
 * person acts or reads more: the offer for the recipient, the workspace settings for the owner.
 */
export async function sendTransferMail(
  mailer: Mailer,
  kind: TransferMailKind,
  input: {
    to: string;
    url: string;
    workspaceId: string;
    workspaceName: string;
    ownerName: string;
    recipient: string;
    expiresOn?: string;
    previousOwnerStays?: boolean;
  },
) {
  const ws = input.workspaceName;
  const content: Record<
    TransferMailKind,
    { subject: string; title: string; lines: string[]; label: string }
  > = {
    offered: {
      subject: `${input.ownerName} wants to transfer ${ws} to you`,
      title: `Take over ${ws}?`,
      lines: [
        `${input.ownerName} offered to move the ${ws} workspace to your account. Its documents, templates, members, API keys and webhooks come with it, and its address stays the same.`,
        'It will count against your plan, which pays for it from then on. Invoices already issued stay with the account that paid them.',
        `You confirm it is you before it moves. The offer is open until ${input.expiresOn ?? 'it expires'}.`,
      ],
      label: 'Review the transfer',
    },
    started: {
      subject: `You offered ${ws} to ${input.recipient}`,
      title: `Transfer of ${ws} started`,
      lines: [
        `You offered the ${ws} workspace to ${input.recipient}. Nothing moves until they accept, and you can cancel the offer until then from the workspace settings.`,
        input.previousOwnerStays
          ? 'When it moves, you stay in the workspace as an admin.'
          : 'When it moves, you leave the workspace.',
        `The offer expires on ${input.expiresOn ?? 'its last day'} if it is not accepted.`,
      ],
      label: 'Open workspace settings',
    },
    accepted_owner: {
      subject: `${ws} now belongs to ${input.recipient}`,
      title: 'Transfer complete',
      lines: [
        `${input.recipient} accepted, and the ${ws} workspace is now on their account and plan.`,
        input.previousOwnerStays
          ? 'You are an admin of it now. Invoices and eSign credits you paid for stay with your account.'
          : 'You have left it. Invoices and eSign credits you paid for stay with your account.',
      ],
      label: 'Open Codevibe Sign',
    },
    accepted_recipient: {
      subject: `${ws} is now yours`,
      title: 'Transfer complete',
      lines: [
        `The ${ws} workspace is now on your account, and you are its owner. Its address, documents, templates, members, API keys and webhooks are unchanged.`,
        'Check the plan and billing admins on the Plan and usage and Team pages.',
      ],
      label: 'Open the workspace',
    },
    declined: {
      subject: `${input.recipient} declined ${ws}`,
      title: 'Transfer declined',
      lines: [
        `${input.recipient} declined the transfer of the ${ws} workspace. Nothing has changed: it is still on your account.`,
      ],
      label: 'Open workspace settings',
    },
    cancelled: {
      subject: `The transfer of ${ws} was cancelled`,
      title: 'Transfer cancelled',
      lines: [
        `${input.ownerName} cancelled the offer to move the ${ws} workspace to you. Nothing has changed, and there is nothing for you to do.`,
      ],
      label: 'Open Codevibe Sign',
    },
  };
  const mail = content[kind];
  await mailer.send({
    to: input.to,
    subject: mail.subject,
    ...layout(mail.title, mail.lines, { label: mail.label, url: input.url }),
    meta: { kind: 'workspace_transfer', workspaceId: input.workspaceId },
  });
}
