import { describe, expect, it } from 'vitest';
import {
  addDocument,
  addField,
  aadhaarIssues,
  adoptAadhaarBox,
  removeField,
  validateForSend,
} from './builder';
import type { Envelope } from './types';
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
      data: { method: 'aadhaar_esign', provider: 'leegality', fields: 0 },
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

describe('the Aadhaar eSign box', () => {
  const boxOf = (envelope: Envelope, recipientId: string) =>
    envelope.fields.find((f) => f.recipientId === recipientId && f.type === 'aadhaar')!;
  const rect = { x: 300, y: 600, width: 180, height: 60 };

  it('stands in for the signature field of an Aadhaar signer', () => {
    const { envelope, ids } = ready({ recipients: [asha, ravi] });
    expect(boxOf(envelope, ids[1]!).required).toBe(true);
    expect(envelope.fields.some((f) => f.recipientId === ids[1] && f.type === 'signature')).toBe(
      false,
    );
    expect(validateForSend(envelope, now)).toEqual([]);
  });

  it('blocks sending until it is placed', () => {
    const { envelope, ids } = ready({ recipients: [asha, ravi] });
    const without = removeField(envelope, boxOf(envelope, ids[1]!).id);
    expect(validateForSend(without, now)).toContainEqual({
      path: `recipients.${ids[1]}.fields`,
      message: 'Place the Aadhaar eSign box for Ravi; their signature goes there',
    });
    expect(() => send(without, deps())).toThrowError(/Place the Aadhaar eSign box/);
  });

  it('refuses a drawn signature or initials next to it', () => {
    const start = ready({ recipients: [ravi] });
    const added = addField(
      start.envelope,
      {
        documentId: start.documentId,
        recipientId: start.ids[0]!,
        type: 'initials',
        page: 0,
        rect,
      },
      { ...deps(), ids: start.gen },
    );
    const initials = added.envelope.fields.at(-1)!;
    expect(validateForSend(added.envelope, now).map((i) => i.path)).toEqual([
      `fields.${initials.id}`,
    ]);
  });

  it('allows one box only, and it must be required', () => {
    const start = ready({ recipients: [ravi] });
    const second = addField(
      start.envelope,
      {
        documentId: start.documentId,
        recipientId: start.ids[0]!,
        type: 'aadhaar',
        page: 0,
        rect,
        required: false,
      },
      { ...deps(), ids: start.gen },
    ).envelope;
    const extra = second.fields.at(-1)!;
    expect(validateForSend(second, now).map((i) => i.path)).toEqual([
      `fields.${extra.id}`,
      `fields.${extra.id}.required`,
    ]);
  });

  it('belongs only to a signer who uses Aadhaar eSign', () => {
    const start = ready({ recipients: [asha] });
    const added = addField(
      start.envelope,
      {
        documentId: start.documentId,
        recipientId: start.ids[0]!,
        type: 'aadhaar',
        page: 0,
        rect,
      },
      { ...deps(), ids: start.gen },
    ).envelope;
    expect(validateForSend(added, now)).toContainEqual({
      path: `fields.${added.fields.at(-1)!.id}`,
      message: 'Only a signer who uses Aadhaar eSign can have an Aadhaar eSign box',
    });
  });

  it('takes no value and is not asked for when the signer submits', () => {
    const { envelope, ids } = ready({ recipients: [ravi] });
    const sent = send(envelope, deps()).envelope;
    const box = boxOf(sent, ids[0]!);
    expect(() =>
      submit(sent, { recipientId: ids[0]!, values: [{ fieldId: box.id, value: 'x' }] }, deps()),
    ).toThrowError(/takes no value/);
    const done = submit(sent, { recipientId: ids[0]!, values: [] }, deps());
    expect(done.envelope.status).toBe('completed');
    expect(done.envelope.values.some((v) => v.fieldId === box.id)).toBe(false);
  });
});

describe('adoptAadhaarBox', () => {
  const legacy = () => {
    const start = ready({ recipients: [asha, ravi] });
    const box = start.envelope.fields.find((f) => f.type === 'aadhaar')!;
    const envelope: Envelope = {
      ...start.envelope,
      fields: start.envelope.fields.map((f) =>
        f.id === box.id ? { ...f, type: 'signature' as const } : f,
      ),
    };
    return { envelope, box, ids: start.ids };
  };

  it('turns the lone signature field of an Aadhaar signer into the box', () => {
    const { envelope, box } = legacy();
    expect(validateForSend(envelope, now)).not.toEqual([]);
    const adopted = adoptAadhaarBox(envelope);
    expect(adopted.fields.find((f) => f.id === box.id)).toMatchObject({
      type: 'aadhaar',
      required: true,
    });
    expect(validateForSend(adopted, now)).toEqual([]);
  });

  it('leaves the other signers and envelopes without an Aadhaar signer alone', () => {
    const { envelope, ids } = legacy();
    const adopted = adoptAadhaarBox(envelope);
    expect(adopted.fields.filter((f) => f.recipientId === ids[0])).toEqual(
      envelope.fields.filter((f) => f.recipientId === ids[0]),
    );
    const plain = ready().envelope;
    expect(adoptAadhaarBox(plain)).toBe(plain);
  });

  it('changes nothing when the signer has a box already or several signature fields', () => {
    const current = ready({ recipients: [ravi] }).envelope;
    expect(adoptAadhaarBox(current)).toBe(current);
    const { envelope, box } = legacy();
    const twice: Envelope = {
      ...envelope,
      fields: [...envelope.fields, { ...envelope.fields.find((f) => f.id === box.id)!, id: 'f2' }],
    };
    expect(adoptAadhaarBox(twice)).toBe(twice);
  });
});
