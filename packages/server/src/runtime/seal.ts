import {
  SignError,
  recordSeal,
  type AuditEvent,
  type Effect,
  type Id,
  type TransitionResult,
} from '@codevibe_technology/sign-core';
import { sha256Hex } from '../crypto';
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
  const timeZone = await timeZoneFor(rt, workspaceId);
  const history = await rt.store.listEvents(envelope.id);
  const done = sealedIds(history);

  const sealed: { documentId: Id; sha256: string }[] = [];
  for (const document of envelope.documents) {
    if (done.has(document.id)) continue;
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
    const withCertificate = await rt.pdf.appendCertificate(rendered, {
      envelope,
      document,
      events: history,
      ...(note ? { note } : {}),
      ...(timeZone ? { timeZone } : {}),
    });
    const output = await rt.pdf.seal(withCertificate, {
      ...rt.sealer,
      signingTime: rt.clock.now(),
      onTimestampFailure: (error) =>
        rt.logger.warn('sealed without a timestamp', {
          envelopeId: envelope.id,
          documentId: document.id,
          error: error.message,
        }),
    });
    if (rt.sealTrust && rt.pdf.verify) {
      const check = await rt.pdf.verify(output, { trust: rt.sealTrust });
      if (!check.valid) {
        throw new SignError('SEAL_FAILED', `The sealed file for ${document.id} did not verify`, {
          reason: check.reason,
        });
      }
    }
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
