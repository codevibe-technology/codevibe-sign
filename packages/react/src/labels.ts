import type { FieldType, Recipient } from '@codevibe_technology/sign-core';

export const defaultFieldTypeLabels: Record<FieldType, string> = {
  signature: 'Signature',
  initials: 'Initials',
  date_signed: 'Date signed',
  name: 'Name',
  text: 'Text',
  checkbox: 'Checkbox',
  aadhaar: 'Aadhaar eSign',
};

export const RECIPIENT_COLOR_COUNT = 6;

/** Index of the recipient's colour (`--cvs-recipient-<n>`), stable for the list order. */
export function recipientColorIndex(recipients: Recipient[], recipientId: string): number {
  const index = recipients.findIndex((r) => r.id === recipientId);
  return (index < 0 ? 0 : index) % RECIPIENT_COLOR_COUNT;
}

export function mergeLabels<T extends object>(defaults: T, overrides?: Partial<T>): T {
  return overrides ? { ...defaults, ...overrides } : defaults;
}
