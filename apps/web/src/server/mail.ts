import 'server-only';
import type { Mailer } from '@codevibe_technology/sign-core';
import { renderEmail, standardLinks, type EmailDetail } from '@/lib/email-layout';
import { ROLE_LABELS, type Role } from '@/lib/roles';
import { mailOrg } from './mail-identity';

/**
 * An account email from Codevibe Sign itself, with the lockup served by the app the link
 * points at: mail clients drop SVG, and a self-hosted install serves its own copy.
 */
function layout(content: {
  title: string;
  lines: string[];
  action: { label: string; url: string };
  reason: string;
  details?: EmailDetail[];
  notes?: string[];
}) {
  const appUrl = new URL(content.action.url).origin;
  const org = mailOrg();
  return renderEmail({
    appUrl,
    preheader: content.lines[0]!,
    header: { kind: 'codevibe' },
    heading: content.title,
    paragraphs: content.lines,
    ...(content.details ? { details: content.details } : {}),
    button: { label: content.action.label, href: content.action.url },
    ...(content.notes ? { notes: content.notes } : {}),
    footer: {
      reason: content.reason,
      lines: org ? [org] : [],
      links: standardLinks(appUrl),
    },
  });
}

export async function sendMagicLink(mailer: Mailer, to: string, url: string) {
  const body = layout({
    title: 'Sign in to Codevibe Sign',
    lines: [
      'Use the button below to sign in. The link works once and expires in 10 minutes.',
      'If you did not ask to sign in, you can ignore this email.',
    ],
    action: { label: 'Sign in', url },
    reason:
      'You got this email because someone asked to sign in to Codevibe Sign with this address.',
  });
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
  const role = ROLE_LABELS[input.role];
  const body = layout({
    title: `Join ${input.workspaceName} on Codevibe Sign`,
    lines: [
      `${input.inviterName} invited you to the ${input.workspaceName} workspace as ${role.toLowerCase()}.`,
    ],
    details: [
      { label: 'Workspace', value: input.workspaceName },
      { label: 'Invited by', value: input.inviterName },
      { label: 'Role', value: role },
      { label: 'Expires', value: 'In 7 days' },
    ],
    action: { label: 'Accept invitation', url: input.url },
    reason: `You got this email because ${input.inviterName} invited this address to a workspace on Codevibe Sign. If you were not expecting it, you can ignore it.`,
  });
  await mailer.send({
    to: input.to,
    subject: `${input.inviterName} invited you to ${input.workspaceName}`,
    ...body,
    meta: { kind: 'team_invite', workspaceId: input.workspaceId },
  });
}

export async function sendPasswordReset(mailer: Mailer, to: string, url: string, minutes: number) {
  const body = layout({
    title: 'Choose a new password',
    lines: [
      `Use the button below to choose a new password for Codevibe Sign. The link works once and expires in ${minutes} minutes.`,
      'If you did not ask for this, you can ignore this email. Your password stays as it is.',
    ],
    action: { label: 'Choose a new password', url },
    reason:
      'You got this email because someone asked to reset the password of the Codevibe Sign account with this address.',
  });
  await mailer.send({
    to,
    subject: 'Choose a new password for Codevibe Sign',
    ...body,
    meta: { kind: 'password_reset' },
  });
}

export async function sendPasswordChanged(mailer: Mailer, to: string, signInUrl: string) {
  const body = layout({
    title: 'Your password was changed',
    lines: [
      'The password for your Codevibe Sign account was just set or changed.',
      'If that was you, there is nothing to do. If it was not, choose a new password now with "Forgot password" on the sign-in page, and tell the admin of your workspace.',
    ],
    action: { label: 'Open the sign-in page', url: signInUrl },
    reason:
      'You got this email because the password of your Codevibe Sign account changed. We send it for every change, to keep your account safe.',
  });
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
  const details: EmailDetail[] =
    kind === 'offered'
      ? [
          { label: 'Workspace', value: ws },
          { label: 'From', value: input.ownerName },
          ...(input.expiresOn ? [{ label: 'Open until', value: input.expiresOn }] : []),
        ]
      : [];
  await mailer.send({
    to: input.to,
    subject: mail.subject,
    ...layout({
      title: mail.title,
      lines: mail.lines,
      action: { label: mail.label, url: input.url },
      ...(details.length ? { details } : {}),
      reason: `You got this email because of a transfer of the ${ws} workspace on Codevibe Sign.`,
    }),
    meta: { kind: 'workspace_transfer', workspaceId: input.workspaceId },
  });
}
