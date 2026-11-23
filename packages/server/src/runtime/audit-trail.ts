import type { Envelope } from '@codevibe_technology/sign-core';
import { DEFAULT_WORKSPACE } from '../tenancy';
import type { Runtime } from './context';
import { timeZoneFor } from './time-zone';

/**
 * The audit trail of an envelope as a PDF for its parties: every event, in the workspace's
 * time zone and UTC, with the network address it came from. Null when the PDF engine cannot
 * draw one.
 */
export async function auditTrailFile(
  rt: Runtime,
  envelope: Envelope,
  workspaceId: string | undefined,
): Promise<Uint8Array | null> {
  if (!rt.pdf.auditTrailPdf) return null;
  const events = await rt.store.listEvents(envelope.id);
  const timeZone = await timeZoneFor(rt, workspaceId ?? DEFAULT_WORKSPACE);
  return rt.pdf.auditTrailPdf({
    envelope,
    events,
    networkAddresses: true,
    ...(timeZone ? { timeZone } : {}),
  });
}

/** "Offer letter (audit trail).pdf", from the envelope's title. */
export function auditTrailName(envelope: Envelope): string {
  const title = envelope.title.replace(/[\p{Cc}"*/:<>?\\|]+/gu, ' ').trim() || 'Envelope';
  return `${title} (audit trail).pdf`;
}
