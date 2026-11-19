import {
  addDocument,
  addField,
  addRecipient,
  commitTransition,
  createEnvelope,
  decline,
  markViewed,
  randomIds,
  send,
  submit,
  systemClock,
  updateRecipient,
  validateForSend,
  verifyChain,
  webCryptoHasher,
  type AuditEvent,
  type Envelope,
  type Field,
  type FieldValue,
  type PageSize,
  type TransitionResult,
} from '@codevibe_technology/sign-core';

/** An envelope and its audit log, kept in memory the way a server would store them. */
export interface Store {
  envelope: Envelope;
  events: AuditEvent[];
}

const deps = { clock: systemClock, ids: randomIds };

async function commit(store: Store | null, result: TransitionResult): Promise<Store> {
  const committed = await commitTransition(
    result,
    (store?.events.length ?? 0) + 1,
    webCryptoHasher,
  );
  return { envelope: committed.envelope, events: [...(store?.events ?? []), ...committed.events] };
}

export async function createDraft(
  fileName: string,
  bytes: Uint8Array,
  pageSizes: PageSize[],
  people: Array<{ name: string; email: string }>,
): Promise<Store> {
  let store = await commit(null, createEnvelope({ title: fileName, routing: 'sequential' }, deps));
  const sha256 = await webCryptoHasher.sha256(bytes);
  let { envelope } = addDocument(
    store.envelope,
    {
      name: fileName,
      sha256,
      pageCount: pageSizes.length,
      fileKey: `local/${fileName}`,
      pageSizes,
    },
    deps,
  );
  for (const person of people) envelope = addRecipient(envelope, person, deps).envelope;
  store = { ...store, envelope };
  return store;
}

export function renameRecipient(store: Store, recipientId: string, name: string): Store {
  return { ...store, envelope: updateRecipient(store.envelope, recipientId, { name }) };
}

/** Adds the placed fields to the draft, checks it and sends it. Throws SignError on problems. */
export async function sendDraft(store: Store, fields: Field[]): Promise<Store> {
  let envelope = store.envelope;
  for (const f of fields) {
    envelope = addField(
      envelope,
      {
        documentId: f.documentId,
        recipientId: f.recipientId,
        type: f.type,
        page: f.page,
        rect: f.rect,
        required: f.required,
      },
      deps,
    ).envelope;
  }
  return commit(store, send(envelope, deps));
}

/** Problems that would stop the draft from being sent, in core's words. */
export function sendIssues(store: Store, fields: Field[]): string[] {
  return validateForSend({ ...store.envelope, fields }, new Date()).map((i) => i.message);
}

export async function viewAs(store: Store, recipientId: string): Promise<Store> {
  const recipient = store.envelope.recipients.find((r) => r.id === recipientId);
  if (recipient?.status !== 'notified') return store;
  return commit(store, markViewed(store.envelope, { recipientId }, deps));
}

export async function submitAs(
  store: Store,
  recipientId: string,
  values: FieldValue[],
): Promise<Store> {
  return commit(
    store,
    submit(
      store.envelope,
      { recipientId, values, context: { userAgent: navigator.userAgent } },
      deps,
    ),
  );
}

export async function declineAs(store: Store, recipientId: string, reason: string): Promise<Store> {
  return commit(store, decline(store.envelope, { recipientId, reason }, deps));
}

export async function verify(store: Store): Promise<boolean> {
  const result = await verifyChain(store.events, webCryptoHasher, {
    expectedHead: store.envelope.auditHead,
  });
  return result.valid;
}
