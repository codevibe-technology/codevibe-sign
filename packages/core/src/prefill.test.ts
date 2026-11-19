import { describe, expect, it } from 'vitest';
import {
  addField,
  prefillFields,
  removeDocument,
  removeField,
  removeRecipient,
  validateForSend,
} from './builder';
import { clockAt, errorCode, issuePaths, PNG, ready, T0, valuesFor } from './test/fixtures';
import type { Envelope, FieldType } from './types';
import { SignError } from './types';
import { send, submit } from './workflow';

const rect = { x: 10, y: 10, width: 100, height: 40 };
const now = new Date(T0);
const d = () => ({ clock: clockAt(T0) });

function withField(type: FieldType, options: { readOnly?: boolean; required?: boolean } = {}) {
  const r = ready({ recipients: [{ name: 'Asha', email: 'asha@example.com' }] });
  const added = addField(
    r.envelope,
    { documentId: r.documentId, recipientId: r.ids[0]!, type, page: 0, rect, ...options },
    { ids: r.gen },
  );
  return { envelope: added.envelope, fieldId: added.field.id, recipientId: r.ids[0]! };
}

function thrown(fn: () => unknown): SignError {
  try {
    fn();
  } catch (error) {
    if (error instanceof SignError) return error;
    throw error;
  }
  throw new Error('expected a SignError');
}

const signature = (envelope: Envelope, recipientId: string) =>
  envelope.fields.find((f) => f.recipientId === recipientId && f.type === 'signature')!.id;

describe('readOnly fields', () => {
  it('keeps the flag on text, name and checkbox fields', () => {
    for (const type of ['text', 'name', 'checkbox'] as const) {
      const { envelope, fieldId } = withField(type, { readOnly: true });
      expect(envelope.fields.find((f) => f.id === fieldId)).toMatchObject({ readOnly: true });
    }
  });

  it('leaves the flag off unless asked', () => {
    const { envelope, fieldId } = withField('text');
    expect(envelope.fields.find((f) => f.id === fieldId)).not.toHaveProperty('readOnly');
  });

  it('refuses read-only signatures, initials and dates', () => {
    const r = ready();
    for (const type of ['signature', 'initials', 'date_signed'] as const) {
      expect(
        issuePaths(() =>
          addField(
            r.envelope,
            {
              documentId: r.documentId,
              recipientId: r.ids[0]!,
              type,
              page: 0,
              rect,
              readOnly: true,
            },
            { ids: r.gen },
          ),
        ),
      ).toEqual(['field.readOnly']);
    }
  });
});

describe('prefillFields', () => {
  it('stores checked values', () => {
    const { envelope, fieldId } = withField('text');
    const next = prefillFields(envelope, [{ fieldId, value: '  EMP-042 ' }]);
    expect(next.values).toEqual([{ fieldId, value: 'EMP-042' }]);
  });

  it('replaces an earlier value and clears with an empty one', () => {
    const { envelope, fieldId } = withField('text');
    const first = prefillFields(envelope, [{ fieldId, value: 'a' }]);
    expect(prefillFields(first, [{ fieldId, value: 'b' }]).values).toEqual([
      { fieldId, value: 'b' },
    ]);
    expect(prefillFields(first, [{ fieldId, value: '  ' }]).values).toEqual([]);
  });

  it('lists every bad value', () => {
    const { envelope, fieldId, recipientId } = withField('checkbox');
    const sig = signature(envelope, recipientId);
    expect(
      issuePaths(() =>
        prefillFields(envelope, [
          { fieldId, value: 'yes' },
          { fieldId: sig, value: PNG },
          { fieldId: 'nope', value: 'x' },
        ]),
      ),
    ).toEqual([`values.${fieldId}`, `values.${sig}`, 'values.nope']);
  });

  it('refuses a field given twice and a value that is not a string', () => {
    const { envelope, fieldId } = withField('text');
    expect(
      issuePaths(() =>
        prefillFields(envelope, [
          { fieldId, value: 'a' },
          { fieldId, value: 'b' },
        ]),
      ),
    ).toEqual([`values.${fieldId}`]);
    expect(
      issuePaths(() => prefillFields(envelope, [{ fieldId, value: 5 as unknown as string }])),
    ).toEqual([`values.${fieldId}`]);
  });

  it('works only on drafts', () => {
    const { envelope, fieldId } = withField('text');
    expect(
      errorCode(() => prefillFields({ ...envelope, status: 'sent' }, [{ fieldId, value: 'a' }])),
    ).toBe('INVALID_STATE');
  });

  it('never mutates its input', () => {
    const { envelope, fieldId } = withField('text');
    const snapshot = JSON.stringify(envelope);
    prefillFields(envelope, [{ fieldId, value: 'a' }]);
    expect(JSON.stringify(envelope)).toBe(snapshot);
  });

  it('drops values whose field is removed', () => {
    const { envelope, fieldId, recipientId } = withField('text');
    const filled = prefillFields(envelope, [{ fieldId, value: 'a' }]);
    expect(removeField(filled, fieldId).values).toEqual([]);
    expect(removeRecipient(filled, recipientId).values).toEqual([]);
    expect(removeDocument(filled, filled.documents[0]!.id).values).toEqual([]);
  });
});

describe('validateForSend with prefilled values', () => {
  it('needs a value for a required read-only field', () => {
    const { envelope, fieldId } = withField('text', { readOnly: true });
    expect(validateForSend(envelope, now).map((i) => i.path)).toEqual([`fields.${fieldId}`]);
    const filled = prefillFields(envelope, [{ fieldId, value: 'EMP-042' }]);
    expect(validateForSend(filled, now)).toEqual([]);
  });

  it('needs a ticked box for a required read-only checkbox', () => {
    const { envelope, fieldId } = withField('checkbox', { readOnly: true });
    const unticked = prefillFields(envelope, [{ fieldId, value: 'false' }]);
    expect(validateForSend(unticked, now).map((i) => i.path)).toEqual([`fields.${fieldId}`]);
  });

  it('lets optional read-only fields and read-only names stay empty', () => {
    expect(
      validateForSend(withField('text', { readOnly: true, required: false }).envelope, now),
    ).toEqual([]);
    expect(validateForSend(withField('name', { readOnly: true }).envelope, now)).toEqual([]);
  });

  it('flags values set without prefillFields', () => {
    const { envelope, fieldId, recipientId } = withField('checkbox');
    const sig = signature(envelope, recipientId);
    const tampered: Envelope = {
      ...envelope,
      values: [
        { fieldId, value: 'maybe' },
        { fieldId: sig, value: PNG },
        { fieldId: 'gone', value: 'x' },
      ],
    };
    expect(validateForSend(tampered, now).map((i) => i.path)).toEqual([
      `values.${fieldId}`,
      `values.${sig}`,
      'values.gone',
    ]);
  });
});

describe('submit with prefilled values', () => {
  function sentWith(type: FieldType, value: string, options: { readOnly?: boolean } = {}) {
    const { envelope, fieldId, recipientId } = withField(type, options);
    const filled = prefillFields(envelope, [{ fieldId, value }]);
    return { envelope: send(filled, d()).envelope, fieldId, recipientId };
  }

  const signOnly = (envelope: Envelope, recipientId: string) => [
    { fieldId: signature(envelope, recipientId), value: PNG },
  ];

  it('counts a prefilled value towards a required field', () => {
    const { envelope, fieldId, recipientId } = sentWith('text', 'EMP-042', { readOnly: true });
    const result = submit(envelope, { recipientId, values: signOnly(envelope, recipientId) }, d());
    expect(result.envelope.status).toBe('completed');
    expect(result.envelope.values).toContainEqual({ fieldId, value: 'EMP-042' });
  });

  it('refuses a change to a read-only field', () => {
    const { envelope, fieldId, recipientId } = sentWith('text', 'EMP-042', { readOnly: true });
    const error = thrown(() =>
      submit(
        envelope,
        {
          recipientId,
          values: [...signOnly(envelope, recipientId), { fieldId, value: 'EMP-001' }],
        },
        d(),
      ),
    );
    expect(error.code).toBe('FIELD_NOT_YOURS');
    expect(error.details).toEqual({ fieldId, readOnly: true });
  });

  it('refuses to fill an empty read-only field', () => {
    const { envelope, fieldId, recipientId } = withField('text', {
      readOnly: true,
      required: false,
    });
    const live = send(envelope, d()).envelope;
    expect(
      errorCode(() =>
        submit(
          live,
          { recipientId, values: [...signOnly(live, recipientId), { fieldId, value: 'x' }] },
          d(),
        ),
      ),
    ).toBe('FIELD_NOT_YOURS');
  });

  it('accepts the prefilled value sent back unchanged', () => {
    const { envelope, fieldId, recipientId } = sentWith('text', 'EMP-042', { readOnly: true });
    const result = submit(
      envelope,
      {
        recipientId,
        values: [...signOnly(envelope, recipientId), { fieldId, value: ' EMP-042 ' }],
      },
      d(),
    );
    expect(result.envelope.values).toContainEqual({ fieldId, value: 'EMP-042' });
  });

  it('lets the signer change or clear an editable prefilled value', () => {
    const { envelope, fieldId, recipientId } = withField('text', { required: false });
    const live = send(prefillFields(envelope, [{ fieldId, value: 'draft' }]), d()).envelope;
    const changed = submit(
      live,
      { recipientId, values: [...signOnly(live, recipientId), { fieldId, value: 'mine' }] },
      d(),
    );
    expect(changed.envelope.values.filter((v) => v.fieldId === fieldId)).toEqual([
      { fieldId, value: 'mine' },
    ]);
    const cleared = submit(
      live,
      { recipientId, values: [...signOnly(live, recipientId), { fieldId, value: '' }] },
      d(),
    );
    expect(cleared.envelope.values.some((v) => v.fieldId === fieldId)).toBe(false);
  });

  it('keeps a prefilled name instead of the recipient name', () => {
    const { envelope, fieldId, recipientId } = sentWith('name', 'Asha R. Rao', { readOnly: true });
    const result = submit(envelope, { recipientId, values: signOnly(envelope, recipientId) }, d());
    expect(result.envelope.values).toContainEqual({ fieldId, value: 'Asha R. Rao' });
  });

  it('still asks for required fields nobody prefilled', () => {
    const { envelope, fieldId, recipientId } = withField('text');
    const live = send(envelope, d()).envelope;
    const error = thrown(() =>
      submit(live, { recipientId, values: signOnly(live, recipientId) }, d()),
    );
    expect(error.code).toBe('REQUIRED_FIELDS_MISSING');
    expect(error.details).toEqual({ fieldIds: [fieldId] });
    expect(
      submit(live, { recipientId, values: valuesFor(live, recipientId) }, d()).envelope.status,
    ).toBe('completed');
  });
});
