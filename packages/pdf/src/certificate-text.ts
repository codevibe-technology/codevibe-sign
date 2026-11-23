import type {
  AuditAction,
  AuditEvent,
  AuthMethod,
  EnvelopeStatus,
  Recipient,
  RecipientRole,
} from '@codevibe_technology/sign-core';
import { maskEmail } from './mask';

export const ROLE_LABELS: Record<RecipientRole, string> = {
  signer: 'Signer',
  approver: 'Approver',
  viewer: 'Receives a copy',
};

export const AUTH_LABELS: Record<AuthMethod, string> = {
  email_link: 'Email link',
  email_otp: 'One-time code by email',
  sms_otp: 'One-time code by SMS',
  aadhaar: 'Aadhaar eSign',
};

/**
 * How a recipient signed, as the certificate prints it. An Aadhaar eSign names the provider
 * it went through once the recipient has been there: `Aadhaar eSign (via Leegality)`. One
 * made in the provider's test environment says so, because it has no legal effect.
 */
export function authLabel(recipient: Pick<Recipient, 'auth' | 'esign'>): string {
  const label = AUTH_LABELS[recipient.auth];
  const provider = recipient.esign?.provider.trim();
  if (recipient.auth !== 'aadhaar' || !provider) return label;
  const name = `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`;
  return recipient.esign?.sandbox
    ? `${label} (via ${name} sandbox, test only)`
    : `${label} (via ${name})`;
}

export const STATUS_LABELS: Record<EnvelopeStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
  expired: 'Expired',
  voided: 'Voided',
};

const ACTION_LABELS: Record<AuditAction, string> = {
  'envelope.created': 'Envelope created',
  'envelope.updated': 'Draft edited',
  'envelope.sent': 'Envelope sent',
  'envelope.completed': 'Envelope completed',
  'envelope.declined': 'Envelope declined',
  'envelope.expired': 'Envelope expired',
  'envelope.voided': 'Envelope voided',
  'envelope.recalled': 'Recalled to correct',
  'envelope.revised': 'Revised after decline',
  'recipient.notified': 'Invitation sent',
  'recipient.reminded': 'Reminder sent',
  'recipient.viewed': 'Document viewed',
  'recipient.authenticated': 'Identity verified',
  'recipient.signed': 'Signed',
  'recipient.approved': 'Approved',
  'recipient.declined': 'Declined',
  'recipient.link_shared': 'Link shared manually',
  'recipient.corrected': 'Recipient corrected',
  'recipient.esign_started': 'Aadhaar eSign started',
  'recipient.esign_failed': 'Aadhaar eSign not completed',
  'document.sealed': 'Document sealed',
};

const SENDER_ACTIONS: ReadonlySet<AuditAction> = new Set([
  'envelope.created',
  'envelope.updated',
  'envelope.sent',
  'envelope.voided',
  'envelope.recalled',
  'envelope.revised',
  'recipient.link_shared',
  'recipient.corrected',
]);

/** The label for an event; a copy says what it replaced. */
export function actionLabel(event: AuditEvent): string {
  if (event.action === 'envelope.created' && event.data?.recalledFrom) {
    return 'Corrected copy created';
  }
  if (event.action === 'envelope.created' && event.data?.revisedFrom) {
    return 'Revision created';
  }
  return ACTION_LABELS[event.action] ?? event.action;
}

/** Who an event is by: the recipient's name, the named sender (an email is masked), or a role. */
export function actorOf(event: AuditEvent, names: Map<string, string>): string {
  const by = event.data?.by;
  if (typeof by === 'string' && by && SENDER_ACTIONS.has(event.action)) {
    return by.includes('@') ? maskEmail(by) : by;
  }
  if (event.recipientId && !SENDER_ACTIONS.has(event.action)) {
    return names.get(event.recipientId) ?? event.recipientId;
  }
  return SENDER_ACTIONS.has(event.action) ? 'Sender' : 'System';
}

/** "3f2a9c1b ... 77e0a1b2": enough of a SHA-256 to compare by eye. */
export function shortHash(hex: string): string {
  return hex.length > 20 ? `${hex.slice(0, 8)} ... ${hex.slice(-8)}` : hex;
}
