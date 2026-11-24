import { describe, expect, it } from 'vitest';
import {
  addDocument,
  addField,
  aadhaarIssues,
  aadhaarSealPosition,
  dropAadhaarSignatureFields,
  validateForSend,
} from './builder';
import type { Field } from './types';
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

describe('an Aadhaar eSign signer fills in nothing', () => {
  const rect = { x: 300, y: 600, width: 180, height: 60 };
  const withField = (type: Field['type'], recipients = [asha, ravi]) => {
    const start = ready({ recipients });
    const signer = start.ids.at(-1)!;
    const added = addField(
      start.envelope,
      { documentId: start.documentId, recipientId: signer, type, page: 0, rect },
      { ...deps(), ids: start.gen },
    ).envelope;
    return {
      envelope: added,
      field: added.fields.at(-1)!,
      ids: start.ids,
      documentId: start.documentId,
      gen: start.gen,
    };
  };

  it('sends with no field for the Aadhaar signer', () => {
    const { envelope, ids } = ready({ recipients: [asha, ravi] });
    expect(envelope.fields.filter((f) => f.recipientId === ids[1])).toEqual([]);
    expect(validateForSend(envelope, now)).toEqual([]);
    expect(send(envelope, deps()).envelope.status).toBe('sent');
  });

  it('takes one Aadhaar seal position, which is optional and takes no value', () => {
    const { envelope, field, ids } = withField('aadhaar');
    expect(validateForSend(envelope, now)).toEqual([]);
    expect(aadhaarSealPosition(envelope, ids[1]!)).toEqual(field);
    expect(aadhaarSealPosition(envelope, ids[0]!)).toBeNull();
    const sent = send(envelope, deps()).envelope;
    expect(sent.fields).toContainEqual(field);
  });

  it('refuses a second Aadhaar seal position', () => {
    const { envelope, ids, documentId, gen } = withField('aadhaar');
    const twice = addField(
      envelope,
      { documentId, recipientId: ids[1]!, type: 'aadhaar', page: 0, rect: { ...rect, y: 100 } },
      { ...deps(), ids: gen },
    ).envelope;
    expect(validateForSend(twice, now)).toEqual([
      {
        path: `fields.${twice.fields.at(-1)!.id}`,
        message: 'Ravi can have one Aadhaar seal position; remove this extra box',
      },
    ]);
  });

  it.each(['signature', 'initials'] as const)(
    'refuses a %s field, which the provider replaces',
    (type) => {
      const { envelope, field } = withField(type);
      expect(validateForSend(envelope, now)).toEqual([
        {
          path: `fields.${field.id}`,
          message: expect.stringMatching(
            /^Ravi signs with Aadhaar eSign; the provider draws the signature, .*Aadhaar seal position$/,
          ),
        },
      ]);
    },
  );

  it.each(['date_signed', 'name', 'text', 'checkbox'] as const)(
    'refuses a %s field and says to give it to an earlier signer',
    (type) => {
      const { envelope, field } = withField(type);
      expect(validateForSend(envelope, now)).toContainEqual({
        path: `fields.${field.id}`,
        message: expect.stringMatching(/fills in nothing here; .*give it to a signer before them/),
      });
    },
  );

  it('still refuses an Aadhaar seal position for anyone else', () => {
    const start = ready({ recipients: [asha] });
    const added = addField(
      start.envelope,
      { documentId: start.documentId, recipientId: start.ids[0]!, type: 'aadhaar', page: 0, rect },
      { ...deps(), ids: start.gen },
    ).envelope;
    expect(validateForSend(added, now)).toContainEqual({
      path: `fields.${added.fields.at(-1)!.id}`,
      message: 'Only a signer who uses Aadhaar eSign can have an Aadhaar seal position',
    });
  });

  it('still completes an envelope sent earlier with an Aadhaar eSign box', () => {
    const { envelope, ids, documentId } = ready({ recipients: [ravi] });
    const sent = send(envelope, deps()).envelope;
    const box: Field = {
      id: 'box',
      documentId,
      recipientId: ids[0]!,
      type: 'aadhaar',
      page: 0,
      rect,
      required: true,
    };
    const earlier = { ...sent, fields: [...sent.fields, box] };
    expect(() =>
      submit(earlier, { recipientId: ids[0]!, values: [{ fieldId: 'box', value: 'x' }] }, deps()),
    ).toThrowError(/takes no value/);
    const done = submit(earlier, { recipientId: ids[0]!, values: [] }, deps());
    expect(done.envelope.status).toBe('completed');
  });
});

describe('dropAadhaarSignatureFields', () => {
  const rect = { x: 50, y: 50, width: 100, height: 40 };
  const build = (types: Field['type'][]) => {
    const start = ready({ recipients: [asha, ravi] });
    let envelope = start.envelope;
    for (const type of types) {
      envelope = addField(
        envelope,
        { documentId: start.documentId, recipientId: start.ids[1]!, type, page: 0, rect },
        { ...deps(), ids: start.gen },
      ).envelope;
    }
    return { envelope, ids: start.ids };
  };

  it('drops the signature and initials fields of the Aadhaar signer', () => {
    const { envelope, ids } = build(['signature', 'initials']);
    const dropped = dropAadhaarSignatureFields(envelope);
    expect(dropped.fields.filter((f) => f.recipientId === ids[1])).toEqual([]);
    expect(validateForSend(dropped, now)).toEqual([]);
  });

  it('keeps the Aadhaar seal position', () => {
    const { envelope, ids } = build(['aadhaar', 'signature']);
    const dropped = dropAadhaarSignatureFields(envelope);
    expect(dropped.fields.filter((f) => f.recipientId === ids[1]).map((f) => f.type)).toEqual([
      'aadhaar',
    ]);
    expect(validateForSend(dropped, now)).toEqual([]);
  });

  it('keeps two positions, so sending says to remove one', () => {
    const { envelope } = build(['aadhaar', 'aadhaar']);
    expect(validateForSend(dropAadhaarSignatureFields(envelope), now)).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/one Aadhaar seal position/) }),
    ]);
  });

  it('keeps other fields of the Aadhaar signer, so sending still says what to fix', () => {
    const { envelope, ids } = build(['signature', 'text']);
    const dropped = dropAadhaarSignatureFields(envelope);
    expect(dropped.fields.filter((f) => f.recipientId === ids[1]).map((f) => f.type)).toEqual([
      'text',
    ]);
    expect(validateForSend(dropped, now)).toHaveLength(1);
  });

  it('leaves the other signers and envelopes without an Aadhaar signer as they are', () => {
    const { envelope, ids } = build(['signature']);
    const dropped = dropAadhaarSignatureFields(envelope);
    expect(dropped.fields.filter((f) => f.recipientId === ids[0])).toEqual(
      envelope.fields.filter((f) => f.recipientId === ids[0]),
    );
    const plain = ready().envelope;
    expect(dropAadhaarSignatureFields(plain)).toBe(plain);
  });
});
