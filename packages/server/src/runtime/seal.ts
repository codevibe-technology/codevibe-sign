import {
  SignError,
  recordSeal,
  type AuditEvent,
  type Effect,
  type Id,
  type TransitionResult,
} from '@codevibe_technology/sign-core';
import { sha256Hex } from '../crypto';
import type { CertificateInput, SealOptions } from '../engine';
import { esignedFileKey } from '../esign/flow';
import type { Job } from '../store/types';
import { DEFAULT_WORKSPACE } from '../tenancy';
import type { Runtime } from './context';
import { makeJob } from './jobs';
import { mutate } from './mutate';
import type { NotifyPayload } from './notify';
import { timeZoneFor } from './time-zone';

export interface SealPayload {
  envelopeId: Id;
  /** Completion emails to send once the sealed files exist. */
  afterSeal: NotifyPayload[];
}

export const sealedFileKey = (envelopeId: Id, documentId: Id) =>
  `envelopes/${envelopeId}/documents/${documentId}/sealed.pdf`;

/** The signing certificate of a document whose file could not take a certificate page. */
export const certificateFileKey = (envelopeId: Id, documentId: Id) =>
  `envelopes/${envelopeId}/documents/${documentId}/certificate.pdf`;

/** Documents whose signing certificate is a file of its own, from the sealed events. */
export const separateCertificates = (events: AuditEvent[]) =>
  new Set(
    events
      .filter((e) => e.action === 'document.sealed' && e.data?.certificate === 'separate')
      .map((e) => String(e.data?.documentId ?? '')),
  );

const sealedIds = (events: AuditEvent[]) =>
  new Set(
    events
      .filter((e) => e.action === 'document.sealed')
      .map((e) => String(e.data?.documentId ?? '')),
  );

/**
 * Draws the field values, adds the certificate page and applies the seal to every document
 * not sealed yet, then records one `document.sealed` event per document. Safe to rerun.
 */
export async function runSeal(
  rt: Runtime,
  payload: SealPayload,
  enqueue: (jobs: Job[]) => Promise<void>,
): Promise<void> {
  const stored = await rt.store.load(payload.envelopeId);
  const envelope = stored?.envelope;
  if (!envelope || envelope.status !== 'completed') return;
  const workspaceId = stored?.workspaceId ?? DEFAULT_WORKSPACE;
  const note = rt.certificateNote ? await rt.certificateNote(workspaceId) : null;
  const details = (await rt.certificateDetails?.({ workspaceId, envelope })) ?? null;
  const timeZone = await timeZoneFor(rt, workspaceId);
  const history = await rt.store.listEvents(envelope.id);
  const done = sealedIds(history);

  const sealOptions = (documentId: Id): SealOptions => ({
    ...rt.sealer,
    signingTime: rt.clock.now(),
    onTimestampFailure: (error) =>
      rt.logger.warn('sealed without a timestamp', {
        envelopeId: envelope.id,
        documentId,
        error: error.message,
      }),
  });
  /** Answers true when the seal holds but an earlier signature could not be read. */
  const assertVerified = async (output: Uint8Array, documentId: Id, earlier = false) => {
    if (!rt.sealTrust || !rt.pdf.verify) return false;
    const check = await rt.pdf.verify(output, {
      trust: rt.sealTrust,
      ...(earlier ? { allowEarlierSignatures: true } : {}),
    });
    // A provider's signature in a form this server cannot read is not a reason to withhold
    // the file: it came from the provider as it is, and the seal over it is checked.
    if (check.valid) return false;
    if (earlier && check.reason === 'earlier_signature_invalid') return true;
    throw new SignError('SEAL_FAILED', `The sealed file for ${documentId} did not verify`, {
      reason: check.reason,
    });
  };

  const sealed: SealedDocument[] = [];
  for (const document of envelope.documents) {
    if (done.has(document.id)) continue;
    const certificate: CertificateInput = {
      envelope,
      document,
      events: history,
      ...(details?.sender ? { sender: details.sender } : {}),
      ...(details?.recordUrl ? { recordUrl: details.recordUrl } : {}),
      ...(note ? { note } : {}),
      ...(timeZone ? { timeZone } : {}),
    };
    const esigned = await rt.files.get(esignedFileKey(envelope.id, document.id));
    if (esigned) {
      sealed.push(
        await sealEsigned(rt, envelope.id, document.id, esigned, certificate, {
          sealOptions,
          assertVerified,
        }),
      );
      continue;
    }
    const original = await rt.files.get(document.fileKey);
    if (!original)
      throw new SignError('SEAL_FAILED', `Original file for ${document.id} is missing`);
    const fields = envelope.fields.filter((f) => f.documentId === document.id);
    const fieldIds = new Set(fields.map((f) => f.id));
    const values = envelope.values.filter((v) => fieldIds.has(v.fieldId));
    const rendered = await rt.pdf.renderFields(original, fields, values, envelope.recipients, {
      documentId: document.id,
      ...(timeZone ? { timeZone } : {}),
    });
    const withCertificate = await rt.pdf.appendCertificate(rendered, certificate);
    const output = await rt.pdf.seal(withCertificate, sealOptions(document.id));
    await assertVerified(output, document.id);
    await rt.files.put(sealedFileKey(envelope.id, document.id), output, 'application/pdf');
    sealed.push({ documentId: document.id, sha256: sha256Hex(output) });
  }

  if (sealed.length > 0) {
    await mutate(rt, envelope.id, async (current) => {
      const already = sealedIds(await rt.store.listEvents(current.id));
      let result: TransitionResult = { envelope: current, events: [], effects: [] };
      for (const s of sealed) {
        if (already.has(s.documentId)) continue;
        const next = recordSeal(result.envelope, s, { clock: rt.clock });
        result = {
          envelope: next.envelope,
          events: [...result.events, ...next.events],
          effects: [...result.effects, ...next.effects],
        };
      }
      return { ...result, effects: dedupeWebhooks(result.effects) };
    });
  }
  await enqueue(payload.afterSeal.map((p) => makeJob(rt, 'notify', p)));
}

interface SealedDocument {
  documentId: Id;
  sha256: string;
  data?: Record<string, string>;
}

/**
 * Finishes a file an eSign provider signed. Nothing but another signature can be added to
 * it, so the seal goes on as an incremental update that leaves the provider's bytes as they
 * are, and the signing certificate becomes a sealed file of its own. A file the provider
 * locked against any further signature is kept exactly as it came.
 */
async function sealEsigned(
  rt: Runtime,
  envelopeId: Id,
  documentId: Id,
  esigned: Uint8Array,
  certificate: CertificateInput,
  tools: {
    sealOptions: (documentId: Id) => SealOptions;
    assertVerified: (output: Uint8Array, documentId: Id, earlier?: boolean) => Promise<boolean>;
  },
): Promise<SealedDocument> {
  let output = esigned;
  let mode = 'provider_only';
  if (rt.pdf.countersign) {
    try {
      output = await rt.pdf.countersign(esigned, tools.sealOptions(documentId));
      mode = 'countersigned';
    } catch (err) {
      const locked =
        err instanceof SignError &&
        err.code === 'PDF_ALREADY_SIGNED' &&
        err.details?.reason === 'locked';
      if (!locked) throw err;
      rt.logger.warn('the eSign provider locked the file, keeping it without a seal', {
        envelopeId,
        documentId,
      });
    }
  }
  const data: Record<string, string> = { seal: mode };
  if (mode === 'countersigned' && (await tools.assertVerified(output, documentId, true))) {
    rt.logger.warn('sealed over a provider signature this server could not check', {
      envelopeId,
      documentId,
    });
    data.earlierSignatures = 'unverified';
  }
  if (rt.pdf.certificatePdf) {
    const page = await rt.pdf.certificatePdf(certificate);
    const sealedPage = await rt.pdf.seal(page, tools.sealOptions(documentId));
    await tools.assertVerified(sealedPage, documentId);
    await rt.files.put(certificateFileKey(envelopeId, documentId), sealedPage, 'application/pdf');
    data.certificate = 'separate';
    data.certificateSha256 = sha256Hex(sealedPage);
  }
  await rt.files.put(sealedFileKey(envelopeId, documentId), output, 'application/pdf');
  return { documentId, sha256: sha256Hex(output), data };
}

/** Core emits one webhook per seal; receivers get one `document.sealed` per envelope. */
function dedupeWebhooks(effects: Effect[]): Effect[] {
  const seen = new Set<string>();
  return effects.filter((e) => {
    if (e.kind !== 'webhook') return true;
    if (seen.has(e.event)) return false;
    seen.add(e.event);
    return true;
  });
}
