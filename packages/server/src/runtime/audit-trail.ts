import type { Envelope } from '@codevibe_technology/sign-core';
import { DEFAULT_WORKSPACE } from '../tenancy';
import { providerAuditTrailKey } from '../esign/flow';
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

const titleOf = (envelope: Envelope) =>
  envelope.title.replace(/[\p{Cc}"*/:<>?\\|]+/gu, ' ').trim() || 'Envelope';

/** "Offer letter (audit trail).pdf", from the envelope's title. */
export function auditTrailName(envelope: Envelope): string {
  return `${titleOf(envelope)} (audit trail).pdf`;
}

/** "Offer letter (certificate and audit trail).pdf": what goes with an Aadhaar eSign. */
export function certificateWithAuditTrailName(envelope: Envelope): string {
  return `${titleOf(envelope)} (certificate and audit trail).pdf`;
}

/** "Offer letter (Leegality audit trail).pdf": the eSign provider's own audit trail. */
export function providerAuditTrailName(envelope: Envelope, provider: string): string {
  const label = `${provider.charAt(0).toUpperCase()}${provider.slice(1)}`;
  return `${titleOf(envelope)} (${label} audit trail).pdf`;
}

/** "Offer letter (signing certificate).pdf", for a certificate sealed on its own. */
export function certificateName(documentName: string): string {
  return `${documentName.replace(/\.pdf$/i, '')} (signing certificate).pdf`;
}

/**
 * The eSign provider's own audit trail of the envelope's Aadhaar eSign, when it was kept,
 * with the name to save it under.
 */
export async function providerAuditTrailFile(
  rt: Runtime,
  envelope: Envelope,
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const signer = envelope.recipients.find((r) => r.esign?.status === 'signed' && r.esign.ref);
  const document = envelope.documents[0];
  if (!signer?.esign?.ref || !document) return null;
  const bytes = await rt.files.get(
    providerAuditTrailKey(envelope.id, document.id, signer.esign.ref),
  );
  return bytes
    ? { bytes, filename: providerAuditTrailName(envelope, signer.esign.provider) }
    : null;
}
