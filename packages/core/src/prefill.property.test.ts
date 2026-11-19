import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addField, prefillFields, validateForSend } from './builder';
import { clockAt, PNG, ready, T0 } from './test/fixtures';
import type { FieldValue } from './types';
import { SignError } from './types';
import { send, submit } from './workflow';

interface TextField {
  readOnly: boolean;
  required: boolean;
  prefill: string | null;
  sent: string | null;
}

const text = fc.string({ maxLength: 8 });
const textField: fc.Arbitrary<TextField> = fc.record({
  readOnly: fc.boolean(),
  required: fc.boolean(),
  prefill: fc.option(text),
  sent: fc.option(text),
});

const d = { clock: clockAt(T0) };

function build(fields: TextField[]) {
  const r = ready({ recipients: [{ name: 'Asha', email: 'asha@example.com' }] });
  let envelope = r.envelope;
  const ids: string[] = [];
  for (const field of fields) {
    const added = addField(
      envelope,
      {
        documentId: r.documentId,
        recipientId: r.ids[0]!,
        type: 'text',
        page: 0,
        rect: { x: 1, y: 1, width: 10, height: 10 },
        readOnly: field.readOnly,
        required: field.required,
      },
      { ids: r.gen },
    );
    envelope = added.envelope;
    ids.push(added.field.id);
  }
  const prefill = fields.flatMap((f, i) =>
    f.prefill === null ? [] : [{ fieldId: ids[i]!, value: f.prefill }],
  );
  envelope = prefillFields(envelope, prefill);
  const signature = envelope.fields.find((f) => f.type === 'signature')!.id;
  return { envelope, ids, recipientId: r.ids[0]!, signature };
}

describe('prefilled and read-only fields (properties)', () => {
  it('can be sent exactly when every required read-only field is prefilled', () => {
    fc.assert(
      fc.property(fc.array(textField, { maxLength: 5 }), (fields) => {
        const { envelope } = build(fields);
        const blocked = fields.some(
          (f) => f.readOnly && f.required && (f.prefill ?? '').trim() === '',
        );
        expect(validateForSend(envelope, new Date(T0)).length > 0).toBe(blocked);
      }),
    );
  });

  it('never lets a signer change a read-only value, and keeps everything else they send', () => {
    fc.assert(
      fc.property(fc.array(textField, { minLength: 1, maxLength: 5 }), (fields) => {
        fc.pre(!fields.some((f) => f.readOnly && f.required && (f.prefill ?? '').trim() === ''));
        const { envelope, ids, recipientId, signature } = build(fields);
        const live = send(envelope, d).envelope;
        const values: FieldValue[] = [
          { fieldId: signature, value: PNG },
          ...fields.flatMap((f, i) =>
            f.sent === null ? [] : [{ fieldId: ids[i]!, value: f.sent }],
          ),
        ];

        const final = fields.map((f) => {
          const prefilled = (f.prefill ?? '').trim();
          if (f.readOnly || f.sent === null) return prefilled;
          return f.sent.trim();
        });
        const tampered = fields.some(
          (f) => f.readOnly && f.sent !== null && f.sent.trim() !== (f.prefill ?? '').trim(),
        );
        const missing = fields.some((f, i) => f.required && final[i] === '');

        let code: string | undefined;
        let result: ReturnType<typeof submit> | undefined;
        try {
          result = submit(live, { recipientId, values }, d);
        } catch (error) {
          if (!(error instanceof SignError)) throw error;
          code = error.code;
        }

        if (tampered) {
          expect(code).toBe('FIELD_NOT_YOURS');
        } else if (missing) {
          expect(code).toBe('REQUIRED_FIELDS_MISSING');
        } else {
          expect(code).toBeUndefined();
          const stored = new Map(result!.envelope.values.map((v) => [v.fieldId, v.value]));
          expect(ids.map((id) => stored.get(id) ?? '')).toEqual(final);
        }
      }),
    );
  });
});
