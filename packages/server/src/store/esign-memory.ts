import type { EsignSession, EsignSessionStore } from '../esign/types';

const OPEN = new Set(['starting', 'pending']);

export function memoryEsignSessions(): EsignSessionStore {
  const rows = new Map<string, EsignSession>();
  const copy = (session: EsignSession) => structuredClone(session);
  const newestFirst = (a: EsignSession, b: EsignSession) =>
    b.createdAt.getTime() - a.createdAt.getTime();

  return {
    async insert(session) {
      const taken = [...rows.values()].some(
        (row) =>
          row.id === session.id ||
          (row.envelopeId === session.envelopeId &&
            row.recipientId === session.recipientId &&
            OPEN.has(row.status)),
      );
      if (taken) return false;
      rows.set(session.id, copy(session));
      return true;
    },
    async activate(id, input) {
      const row = rows.get(id);
      if (!row || row.status !== 'starting') return false;
      const clash = [...rows.values()].some(
        (other) => other.provider === row.provider && other.providerRef === input.providerRef,
      );
      if (clash) return false;
      Object.assign(row, {
        status: 'pending',
        providerRef: input.providerRef,
        signUrl: input.signUrl,
        expiresAt: new Date(input.expiresAt),
        updatedAt: new Date(input.at),
      });
      return true;
    },
    async get(id) {
      const row = rows.get(id);
      return row ? copy(row) : null;
    },
    async findByRef(provider, providerRef) {
      const row = [...rows.values()].find(
        (r) => r.provider === provider && r.providerRef === providerRef,
      );
      return row ? copy(row) : null;
    },
    async latest(envelopeId, recipientId) {
      const row = [...rows.values()]
        .filter((r) => r.envelopeId === envelopeId && r.recipientId === recipientId)
        .sort(newestFirst)[0];
      return row ? copy(row) : null;
    },
    async open(envelopeId) {
      return [...rows.values()]
        .filter((r) => r.envelopeId === envelopeId && OPEN.has(r.status))
        .map(copy);
    },
    async transition(id, from, to, at, patch = {}) {
      const row = rows.get(id);
      if (!row || !from.includes(row.status)) return false;
      row.status = to;
      row.updatedAt = new Date(at);
      if (patch.signerName !== undefined) row.signerName = patch.signerName;
      if (patch.signature !== undefined) row.signature = structuredClone(patch.signature);
      if (patch.unsettled === null) delete row.unsettled;
      else if (patch.unsettled !== undefined) row.unsettled = patch.unsettled;
      return true;
    },
    async settle(id) {
      const row = rows.get(id);
      if (row) delete row.unsettled;
    },
    async due(now, limit) {
      return [...rows.values()]
        .filter(
          (r) =>
            (OPEN.has(r.status) && r.expiresAt.getTime() <= now.getTime()) ||
            r.unsettled !== undefined,
        )
        .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
        .slice(0, limit)
        .map(copy);
    },
  };
}
