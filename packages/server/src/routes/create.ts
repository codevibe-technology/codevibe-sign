import {
  addDocument,
  dropAadhaarSignatureFields,
  createEnvelope,
  send,
  type Envelope,
  type Id,
  type TransitionResult,
} from '@codevibe_technology/sign-core';
import { sha256Hex } from '../crypto';
import { applyParties } from '../draft';
import type { PdfInfo } from '../engine';
import type { EnvelopeSettings, FieldSpec, RecipientSpec, UploadedDocument } from '../input';
import { assertEsignReady } from '../esign/flow';
import type { Runtime } from '../runtime/context';
import { create } from '../runtime/mutate';
import { originalFileKey } from './shared';

export interface EnvelopeParts {
  settings: EnvelopeSettings;
  recipients: RecipientSpec[];
  fields: FieldSpec[];
  /** Each PDF with what `checkPdf` found in it. */
  documents: { upload: UploadedDocument; info: PdfInfo }[];
  send: boolean;
  /** A last change to the draft before it is saved or sent, for example prefilled values. */
  prepare?: (draft: Envelope) => Envelope;
}

/**
 * Builds an envelope from parsed and checked parts, stores its files and saves it, sent at
 * once when asked. Shared by `POST /v1/envelopes` and envelopes made from a template, so both
 * pass through the same core rules.
 */
export async function createEnvelopeFromParts(
  rt: Runtime,
  workspaceId: string,
  parts: EnvelopeParts,
): Promise<Envelope> {
  const deps = { clock: rt.clock, ids: rt.ids };
  const { settings } = parts;
  const created = createEnvelope(
    {
      title: settings.title ?? '',
      ...(settings.routing ? { routing: settings.routing } : {}),
      ...(settings.reminders ? { reminders: settings.reminders } : {}),
      ...(settings.message ? { message: settings.message } : {}),
      ...(settings.changeNote ? { changeNote: settings.changeNote } : {}),
      ...(settings.expiresAt ? { expiresAt: settings.expiresAt } : {}),
      ...(settings.metadata ? { metadata: settings.metadata } : {}),
    },
    deps,
  );
  let envelope = created.envelope;
  const documentKeys = new Map<string, Id>();
  parts.documents.forEach(({ upload, info }, i) => {
    const added = addDocument(
      envelope,
      {
        name: upload.name,
        sha256: sha256Hex(upload.bytes),
        pageCount: info.pageCount,
        pageSizes: info.pages,
        fileKey: originalFileKey(envelope.id, i),
      },
      deps,
    );
    envelope = added.envelope;
    documentKeys.set(upload.key, added.document.id);
    documentKeys.set(added.document.id, added.document.id);
  });
  envelope = applyParties(envelope, documentKeys, parts.recipients, parts.fields, rt.ids);
  if (parts.prepare) envelope = parts.prepare(envelope);

  let result: TransitionResult = { ...created, envelope };
  if (parts.send) {
    const sent = send(dropAadhaarSignatureFields(envelope), deps);
    await assertEsignReady(rt, workspaceId, envelope);
    result = {
      envelope: sent.envelope,
      events: [...created.events, ...sent.events],
      effects: [...created.effects, ...sent.effects],
    };
  }

  const keys = envelope.documents.map((d) => d.fileKey);
  await Promise.all(
    parts.documents.map(({ upload }, i) => rt.files.put(keys[i]!, upload.bytes, 'application/pdf')),
  );
  try {
    return await create(rt, result, workspaceId);
  } catch (err) {
    await Promise.allSettled(keys.map((key) => rt.files.delete(key)));
    throw err;
  }
}
