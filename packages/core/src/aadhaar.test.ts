import { describe, expect, it } from 'vitest';
import { addDocument, aadhaarIssues, validateForSend } from './builder';
import { deps, ready, SHA, T0, valuesFor } from './test/fixtures';
import { recordSeal, send, submit } from './workflow';

const now = new Date(T0);
const paths = (envelope: Parameters<typeof aadhaarIssues>[0]) =>
  aadhaarIssues(envelope).map((issue) => issue.path);

const asha = { name: 'Asha', email: 'asha@example.com' };
const ravi = { name: 'Ravi', email: 'ravi@example.com', auth: 'aadhaar' as const };

describe('aadhaarIssues', () => {
  it('has nothing to say without an Aadhaar signer', () => {
    expect(aadhaarIssues(ready().envelope)).toEqual([]);
  });

  it('accepts one Aadhaar signer who signs last', () => {
    const { envelope } = ready({ recipients: [asha, ravi] });
    expect(validateForSend(envelope, now)).toEqual([]);
  });

  it('accepts an Aadhaar signer alone, in either routing', () => {
    expect(aadhaarIssues(ready({ recipients: [ravi] }).envelope)).toEqual([]);
    expect(aadhaarIssues(ready({ recipients: [ravi], routing: 'parallel' }).envelope)).toEqual([]);
  });

  it('ignores viewers when deciding who is last', () => {
    const { envelope } = ready({
      recipients: [ravi, { name: 'HR', email: 'hr@example.com', role: 'viewer' }],
    });
    expect(aadhaarIssues(envelope)).toEqual([]);
  });

  it('refuses a second Aadhaar signer', () => {
    const { envelope, ids } = ready({
      recipients: [ravi, { ...ravi, name: 'Meera', email: 'meera@example.com' }],
    });
    expect(paths(envelope)).toContain(`recipients.${ids[1]}.auth`);
  });

  it('refuses Aadhaar for an approver', () => {
    const { envelope, ids } = ready({ recipients: [asha, { ...ravi, role: 'approver' }] });
    expect(paths(envelope)).toContain(`recipients.${ids[1]}.auth`);
  });

  it('refuses a second document', () => {
    const start = ready({ recipients: [asha, ravi] });
    const { envelope } = addDocument(
      start.envelope,
      { name: 'annexure.pdf', sha256: SHA, pageCount: 1, fileKey: 'files/annexure.pdf' },
      { ...deps(), ids: start.gen },
    );
    expect(paths(envelope)).toEqual(['documents']);
  });

  it('refuses an Aadhaar signer who is not last', () => {
    const { envelope, ids } = ready({ recipients: [ravi, asha] });
    expect(paths(envelope)).toEqual([`recipients.${ids[0]}.order`]);
    const tied = ready({
      recipients: [
        { ...asha, order: 1 },
        { ...ravi, order: 1 },
      ],
    });
    expect(paths(tied.envelope)).toEqual([`recipients.${tied.ids[1]}.order`]);
  });

  it('refuses parallel routing when someone else also acts', () => {
    const { envelope } = ready({ recipients: [asha, ravi], routing: 'parallel' });
    expect(paths(envelope)).toEqual(['routing']);
  });

  it('stops the envelope from being sent', () => {
    const { envelope } = ready({ recipients: [ravi, asha] });
    expect(() => send(envelope, deps())).toThrowError(/must be the last to act/);
  });
});

describe('submit with extra event data', () => {
  it('records it on the signed event next to the field count', () => {
    const { envelope, ids } = ready({ recipients: [ravi] });
    const sent = send(envelope, deps()).envelope;
    const result = submit(
      sent,
      {
        recipientId: ids[0]!,
        values: valuesFor(sent, ids[0]!),
        data: { method: 'aadhaar_esign', provider: 'leegality', fields: 99 },
      },
      deps(),
    );
    expect(result.events[0]).toMatchObject({
      action: 'recipient.signed',
      data: { method: 'aadhaar_esign', provider: 'leegality', fields: 1 },
    });
  });
});

describe('recordSeal with extra event data', () => {
  it('keeps the document and its hash ahead of anything passed in', () => {
    const { envelope, ids } = ready({ recipients: [ravi] });
    const sent = send(envelope, deps()).envelope;
    const done = submit(sent, { recipientId: ids[0]!, values: valuesFor(sent, ids[0]!) }, deps());
    const documentId = done.envelope.documents[0]!.id;
    const sealed = recordSeal(
      done.envelope,
      { documentId, sha256: SHA, data: { seal: 'countersigned', sha256: 'other' } },
      deps(),
    );
    expect(sealed.events[0]).toMatchObject({
      action: 'document.sealed',
      data: { seal: 'countersigned', documentId, sha256: SHA },
    });
  });
});
