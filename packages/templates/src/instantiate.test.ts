import { describe, expect, it } from 'vitest';
import {
  commitTransition,
  currentRecipients,
  send,
  SignError,
  submit,
  webCryptoHasher,
} from '@codevibe_technology/sign-core';
import { assertWritable, instantiate, METADATA_KEYS, readOnlyFieldIds } from './instantiate';
import { templateVersion } from './version';
import { clockAt, deps, issuePaths, offerTemplate, people, rejection, T0 } from './test/fixtures';
import type { Template } from './types';

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const prefill = { 'Employee code': 'EMP-0042', 'Joining date': '2026-04-01' };

describe('instantiate', () => {
  it('builds a draft envelope from the template', async () => {
    const result = await instantiate(offerTemplate(), { roles: people, prefill }, deps());
    const { envelope } = result;
    expect(envelope).toMatchObject({
      status: 'draft',
      title: 'Offer letter',
      message: 'Please review and sign your offer.',
      routing: 'sequential',
      expiresAt: '2026-03-15T10:00:00.000Z',
      documents: [{ name: 'offer.pdf', fileKey: 'templates/offer.pdf', pageCount: 2 }],
    });
    expect(envelope.recipients).toMatchObject([
      { name: 'Asha Rao', email: 'asha@example.com', role: 'signer', order: 1, auth: 'email_link' },
      { name: 'Meera Iyer', email: 'hr@example.com', role: 'signer', order: 2, auth: 'email_otp' },
    ]);
    expect(envelope.fields).toHaveLength(4);
    expect(result.events.map((e) => e.action)).toEqual(['envelope.created']);
  });

  it('stamps template id and version into metadata', async () => {
    const template = offerTemplate();
    template.metadata = { department: 'Sales' };
    const { envelope } = await instantiate(
      template,
      { roles: people, prefill, metadata: { employeeId: 'E42', templateVersion: 'mine' } },
      deps(),
    );
    expect(envelope.metadata).toMatchObject({
      department: 'Sales',
      employeeId: 'E42',
      templateId: 'offer-letter',
      templateVersion: await templateVersion(template, webCryptoHasher),
    });
  });

  it('runs sequential routing: Employee first, then HR', async () => {
    const { envelope } = await instantiate(offerTemplate(), { roles: people, prefill }, deps());
    const sent = send(envelope, deps()).envelope;
    expect(currentRecipients(sent).map((r) => r.name)).toEqual(['Asha Rao']);
    const employee = sent.recipients[0]!;
    const own = sent.fields.filter((f) => f.recipientId === employee.id);
    const values = [
      { fieldId: own.find((f) => f.type === 'signature')!.id, value: PNG },
      { fieldId: own.find((f) => f.label === 'Joining date')!.id, value: '2026-04-01' },
    ];
    const signed = submit(
      sent,
      { recipientId: employee.id, values },
      { clock: clockAt('2026-03-02T10:00:00.000Z') },
    ).envelope;
    expect(currentRecipients(signed).map((r) => r.name)).toEqual(['Meera Iyer']);
  });

  it('runs parallel routing from the template or an override', async () => {
    const template: Template = { ...offerTemplate(), routing: 'parallel' };
    const parallel = (await instantiate(template, { roles: people, prefill }, deps())).envelope;
    expect(parallel.routing).toBe('parallel');
    expect(currentRecipients(send(parallel, deps()).envelope)).toHaveLength(2);

    const overridden = (
      await instantiate(
        offerTemplate(),
        { roles: people, prefill, overrides: { routing: 'parallel' } },
        deps(),
      )
    ).envelope;
    expect(currentRecipients(send(overridden, deps()).envelope)).toHaveLength(2);
  });

  it('lets equal orders act together in sequential routing', async () => {
    const template = offerTemplate();
    template.roles[0]!.order = 1;
    template.roles[1]!.order = 1;
    template.roles.push({ name: 'Manager', type: 'approver' });
    const { envelope } = await instantiate(
      template,
      { roles: { ...people, Manager: { name: 'Kiran', email: 'kiran@example.com' } }, prefill },
      deps(),
    );
    expect(envelope.recipients.map((r) => r.order)).toEqual([1, 1, 2]);
    expect(currentRecipients(send(envelope, deps()).envelope)).toHaveLength(2);
  });

  it('adds viewers who receive a copy', async () => {
    const template = offerTemplate();
    template.roles.push({ name: 'Payroll', type: 'viewer' });
    const { envelope } = await instantiate(
      template,
      {
        roles: { ...people, Payroll: { name: 'Payroll team', email: 'payroll@example.com' } },
        prefill,
      },
      deps(),
    );
    expect(envelope.recipients[2]).toMatchObject({ role: 'viewer', order: 1 });
  });

  it('matches role names and prefill labels without regard to case', async () => {
    const { envelope } = await instantiate(
      offerTemplate(),
      {
        roles: { employee: people.Employee, hr: people.HR },
        prefill: { 'employee CODE': 'EMP-7' },
      },
      deps(),
    );
    expect(envelope.values.map((v) => v.value)).toEqual(['EMP-7']);
  });

  it('applies overrides for title, message, reminders and expiry', async () => {
    const reminders = { firstAfterDays: 1, everyDays: 1, max: 2 };
    const one = await instantiate(
      offerTemplate(),
      {
        roles: people,
        prefill,
        overrides: { title: 'Offer for Asha', message: 'Welcome', reminders, expiresInDays: 3 },
      },
      deps(),
    );
    expect(one.envelope).toMatchObject({
      title: 'Offer for Asha',
      message: 'Welcome',
      reminders,
      expiresAt: '2026-03-04T10:00:00.000Z',
    });
    const exact = await instantiate(
      offerTemplate(),
      {
        roles: people,
        prefill,
        overrides: { expiresAt: '2026-05-01T00:00:00.000Z', expiresInDays: 3 },
      },
      deps(),
    );
    expect(exact.envelope.expiresAt).toBe('2026-05-01T00:00:00.000Z');
  });

  it('has no expiry when the template sets none', async () => {
    const template = offerTemplate();
    delete template.expiresInDays;
    const { envelope } = await instantiate(template, { roles: people, prefill }, deps());
    expect(envelope.expiresAt).toBeUndefined();
  });

  it('lets a person change the auth method and sign by phone', async () => {
    const { envelope } = await instantiate(
      offerTemplate(),
      {
        roles: { Employee: { name: 'Asha', phone: '+91 98765-43210' }, HR: people.HR },
        prefill,
      },
      deps(),
    );
    expect(envelope.recipients[0]).toMatchObject({ phone: '+919876543210', auth: 'sms_otp' });
  });
});

describe('instantiate: prefill', () => {
  it('stores prefilled values and locks read-only fields', async () => {
    const { envelope } = await instantiate(offerTemplate(), { roles: people, prefill }, deps());
    const code = envelope.fields.find((f) => f.label === 'Employee code')!;
    const joining = envelope.fields.find((f) => f.label === 'Joining date')!;
    expect(envelope.values).toEqual([
      { fieldId: code.id, value: 'EMP-0042' },
      { fieldId: joining.id, value: '2026-04-01' },
    ]);
    expect(code).toMatchObject({ required: true, readOnly: true });
    expect(joining.required).toBe(true);
    expect(joining).not.toHaveProperty('readOnly');
    expect(readOnlyFieldIds(envelope)).toEqual([code.id]);
    expect(envelope.metadata?.[METADATA_KEYS.readOnlyFields]).toBeUndefined();
  });

  it('lets core refuse a change to a read-only field at submit', async () => {
    const { envelope } = await instantiate(offerTemplate(), { roles: people, prefill }, deps());
    const sent = send(envelope, deps()).envelope;
    const employee = sent.recipients[0]!;
    const own = sent.fields.filter((f) => f.recipientId === employee.id);
    const values = [
      { fieldId: own.find((f) => f.type === 'signature')!.id, value: PNG },
      { fieldId: own.find((f) => f.label === 'Joining date')!.id, value: '2026-04-01' },
      { fieldId: own.find((f) => f.label === 'Employee code')!.id, value: 'EMP-9999' },
    ];
    try {
      submit(sent, { recipientId: employee.id, values }, deps());
      expect.unreachable();
    } catch (error) {
      expect((error as SignError).code).toBe('FIELD_NOT_YOURS');
    }
  });

  it('still reads the metadata key earlier versions wrote', async () => {
    const { envelope } = await instantiate(offerTemplate(), { roles: people, prefill }, deps());
    const code = envelope.fields.find((f) => f.label === 'Employee code')!;
    const joining = envelope.fields.find((f) => f.label === 'Joining date')!;
    const legacy = {
      ...envelope,
      fields: envelope.fields.map((f) => (f.id === code.id ? { ...f, readOnly: undefined } : f)),
      metadata: {
        ...envelope.metadata,
        [METADATA_KEYS.readOnlyFields]: `${code.id},${joining.id}`,
      },
    };
    expect(readOnlyFieldIds(legacy)).toEqual([code.id, joining.id]);
    expect(() => assertWritable(legacy, [{ fieldId: joining.id, value: 'x' }])).toThrow(SignError);
  });

  it('keeps the prefilled value through signing', async () => {
    const { envelope } = await instantiate(offerTemplate(), { roles: people, prefill }, deps());
    const sent = send(envelope, deps()).envelope;
    const employee = sent.recipients[0]!;
    const own = sent.fields.filter((f) => f.recipientId === employee.id);
    const values = [
      { fieldId: own.find((f) => f.type === 'signature')!.id, value: PNG },
      { fieldId: own.find((f) => f.label === 'Joining date')!.id, value: '2026-04-01' },
    ];
    expect(() => assertWritable(sent, values)).not.toThrow();
    const signed = submit(sent, { recipientId: employee.id, values }, deps()).envelope;
    expect(signed.values.find((v) => v.value === 'EMP-0042')).toBeDefined();
  });

  it('rejects changes to read-only fields', async () => {
    const { envelope } = await instantiate(offerTemplate(), { roles: people, prefill }, deps());
    const [locked] = readOnlyFieldIds(envelope);
    try {
      assertWritable(envelope, [{ fieldId: locked!, value: 'EMP-9999' }]);
      expect.unreachable();
    } catch (error) {
      expect((error as SignError).code).toBe('INVALID_FIELD_VALUE');
    }
  });

  it('needs a value for a required read-only field', async () => {
    const error = await rejection(
      instantiate(offerTemplate(), { roles: people, prefill: { 'Joining date': 'x' } }, deps()),
    );
    expect(issuePaths(error)).toEqual(['prefill.Employee code']);
  });

  it('leaves an optional read-only field empty and unlocked when no value is given', async () => {
    const template = offerTemplate();
    template.roles[0]!.fields![0]!.required = false;
    const { envelope } = await instantiate(template, { roles: people }, deps());
    expect(envelope.values).toEqual([]);
    expect(readOnlyFieldIds(envelope)).toEqual([]);
    expect(envelope.metadata?.[METADATA_KEYS.readOnlyFields]).toBeUndefined();
  });

  it('rejects unknown labels and over-long values', async () => {
    const error = await rejection(
      instantiate(
        offerTemplate(),
        {
          roles: people,
          prefill: { ...prefill, 'Employee cde': 'x', 'Joining date': 'x'.repeat(1001) },
        },
        deps(),
      ),
    );
    expect(issuePaths(error)).toEqual(['prefill.Joining date', 'prefill.Employee cde']);
  });
});

describe('instantiate: failures', () => {
  it('rejects an invalid template', async () => {
    const template = offerTemplate();
    template.title = '';
    expect(
      issuePaths(await rejection(instantiate(template, { roles: people, prefill }, deps()))),
    ).toEqual(['title']);
  });

  it('needs a person for every role and no unknown roles', async () => {
    const error = await rejection(
      instantiate(
        offerTemplate(),
        { roles: { Employee: people.Employee, Manager: people.HR }, prefill },
        deps(),
      ),
    );
    expect(issuePaths(error)).toEqual(['roles.HR', 'roles.Manager']);
  });

  it('reports contact problems under the role name, for every role at once', async () => {
    const error = await rejection(
      instantiate(
        offerTemplate(),
        {
          roles: {
            Employee: { name: 'Asha', email: 'not-an-email' },
            HR: { name: 'Meera', phone: '+919876543210' },
          },
          prefill,
        },
        deps(),
      ),
    );
    expect(issuePaths(error)).toEqual(['roles.Employee.email', 'roles.HR.email']);
  });

  it('rejects a bad phone number and a blank name', async () => {
    const error = await rejection(
      instantiate(
        offerTemplate(),
        { roles: { Employee: { name: ' ', phone: '98765' }, HR: people.HR }, prefill },
        deps(),
      ),
    );
    expect(issuePaths(error)).toEqual(['roles.Employee.name', 'roles.Employee.phone']);
  });

  it('rejects bad overrides', async () => {
    const reminders = { firstAfterDays: -1, everyDays: 1, max: 1 };
    const bad = await rejection(
      instantiate(
        offerTemplate(),
        { roles: people, prefill, overrides: { reminders, expiresInDays: 0 } },
        deps(),
      ),
    );
    expect(issuePaths(bad)).toEqual([
      'overrides.reminders.firstAfterDays',
      'overrides.expiresInDays',
    ]);
    const past = await rejection(
      instantiate(
        offerTemplate(),
        { roles: people, prefill, overrides: { expiresAt: T0 } },
        deps(),
      ),
    );
    expect(issuePaths(past)).toEqual(['expiresAt']);
  });

  it('produces envelopes whose created event commits on the audit chain', async () => {
    const result = await instantiate(offerTemplate(), { roles: people, prefill }, deps());
    const committed = await commitTransition(result, 1, webCryptoHasher);
    expect(committed.events[0]).toMatchObject({ seq: 1, action: 'envelope.created' });
  });
});
