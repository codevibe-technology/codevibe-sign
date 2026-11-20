import { describe, expect, it } from 'vitest';
import {
  MAX_BULK_ROWS,
  bulkProgress,
  bulkSendView,
  bulkStatusLabel,
  fixedPeopleProblems,
  previewBulkCsv,
  rowPeopleLine,
  sampleCsv,
  sampleCsvName,
} from './bulk-send';
import type { TemplateDefinition } from './templates';

const A4 = { width: 595, height: 842 };
const definition: TemplateDefinition = {
  title: '',
  message: '',
  routing: 'sequential',
  expiresInDays: 14,
  remindEveryDays: 2,
  roles: [
    { id: 'r_emp', name: 'Employee', type: 'signer', auth: 'email_link' },
    { id: 'r_hr', name: 'HR', type: 'signer', auth: 'email_otp' },
  ],
  documents: [{ id: 'd1', name: 'offer.pdf', size: 1, sha256: 'a'.repeat(64), pages: [A4] }],
  fields: [
    {
      id: 'f1',
      documentId: 'd1',
      recipientId: 'r_emp',
      type: 'signature',
      page: 0,
      rect: { x: 72, y: 600, width: 180, height: 48 },
      required: true,
    },
    {
      id: 'f2',
      documentId: 'd1',
      recipientId: 'r_hr',
      type: 'signature',
      page: 0,
      rect: { x: 300, y: 600, width: 180, height: 48 },
      required: true,
    },
    {
      id: 'f3',
      documentId: 'd1',
      recipientId: 'r_emp',
      type: 'text',
      page: 0,
      rect: { x: 72, y: 100, width: 180, height: 20 },
      required: false,
      label: 'Employee code',
    },
  ],
};
const template = { id: 'tpl_1', name: 'Offer letter' };
const hr = { r_hr: { name: 'Meera', email: 'hr@example.com', phone: '' } };

describe('sample file', () => {
  it('has a column for each role detail and an example row that passes', () => {
    const sms = {
      ...definition,
      roles: [definition.roles[0]!, { ...definition.roles[1]!, auth: 'sms_otp' as const }],
    };
    const csv = sampleCsv(sms);
    expect(csv.split('\n')[0]).toBe(
      'Employee name,Employee email,HR name,HR email,HR phone,meta.reference',
    );
    const preview = previewBulkCsv(csv, template, sms);
    expect(preview.problems).toEqual([]);
    expect(preview.ready).toHaveLength(1);
    expect(preview.fixedRoles).toEqual([]);
    expect(sampleCsvName('Offer letter / 2026')).toBe('offer-letter-2026-bulk-send.csv');
  });
});

describe('reading a bulk-send file', () => {
  it('maps each row to people per role and keeps meta columns', () => {
    const csv = [
      'Employee name,Employee email,HR name,HR email,meta.employeeId',
      '"Rao, Asha",asha@example.com,Meera,hr@example.com,E1',
      'Ravi Kumar,ravi@example.com,Meera,hr@example.com,E2',
    ].join('\n');
    const preview = previewBulkCsv(csv, template, definition);
    expect(preview.problems).toEqual([]);
    expect(preview.blocking).toBe(false);
    expect(preview.total).toBe(2);
    expect(preview.headers).toHaveLength(5);
    expect(preview.cells[0]).toEqual({
      line: 2,
      values: ['Rao, Asha', 'asha@example.com', 'Meera', 'hr@example.com', 'E1'],
    });
    expect(preview.ready[0]).toEqual({
      line: 2,
      people: {
        r_emp: { name: 'Rao, Asha', email: 'asha@example.com', phone: '' },
        r_hr: { name: 'Meera', email: 'hr@example.com', phone: '' },
      },
      metadata: { employeeId: 'E1' },
    });
  });

  it('asks for one fixed person for roles without columns', () => {
    const csv = 'Employee name,Employee email\nAsha,asha@example.com\n';
    const preview = previewBulkCsv(csv, template, definition, hr);
    expect(preview.fixedRoles.map((r) => r.name)).toEqual(['HR']);
    expect(preview.ready[0]!.people.r_hr).toEqual(hr.r_hr);
    expect(fixedPeopleProblems(preview.fixedRoles, {})).toEqual({
      'people.r_hr.name': "Enter the HR's name.",
      'people.r_hr.email': "Enter the HR's email; the link goes there.",
    });
    expect(fixedPeopleProblems(preview.fixedRoles, hr)).toEqual({});
  });

  it('points each row problem at its line and column', () => {
    const csv = [
      'Employee name,Employee email',
      'Asha,asha@example.com',
      'Ravi,not-an-email',
      ',mia@example.com',
      'Asha again,asha@example.com',
      'Zoe,,',
    ].join('\n');
    const preview = previewBulkCsv(csv, template, definition, hr);
    expect(preview.blocking).toBe(false);
    expect(preview.ready.map((r) => r.line)).toEqual([2]);
    expect(preview.problems).toEqual([
      { line: 3, column: 'Employee email', message: expect.stringMatching(/not a valid address/) },
      { line: 4, column: 'Employee name', message: 'Missing Employee name' },
      { line: 5, message: expect.stringMatching(/Duplicate of line 2/) },
      { line: 6, column: 'Employee email', message: 'Missing Employee email' },
    ]);
  });

  it('flags a row with no one in a role that has columns', () => {
    const csv = 'Employee name,Employee email,HR name,HR email\nAsha,asha@example.com,,\n';
    const preview = previewBulkCsv(csv, template, definition);
    expect(preview.problems).toEqual([
      { line: 2, column: 'HR name', message: 'Missing HR name and email' },
    ]);
  });

  it('refuses the same person in two signer roles of one row', () => {
    const csv =
      'Employee name,Employee email,HR name,HR email\nAsha,a@example.com,Asha,A@example.com\n';
    const preview = previewBulkCsv(csv, template, definition);
    expect(preview.problems).toEqual([
      { line: 2, column: 'HR email', message: expect.stringMatching(/already the Employee/) },
    ]);
  });

  it('blocks files it cannot use at all', () => {
    expect(previewBulkCsv('', template, definition).blocking).toBe(true);
    const headerOnly = previewBulkCsv('Employee name,Employee email\n', template, definition, hr);
    expect(headerOnly.blocking).toBe(true);
    expect(headerOnly.problems[0]!.message).toMatch(/no rows/);

    const unknown = previewBulkCsv(
      'Employee name,Employee email,Salary\nA,a@example.com,1\n',
      template,
      definition,
      hr,
    );
    expect(unknown.blocking).toBe(true);
    expect(unknown.problems[0]).toMatchObject({ line: 1, column: 'Salary' });

    const prefill = previewBulkCsv(
      'Employee name,Employee email,Employee code\nA,a@example.com,E1\n',
      template,
      definition,
      hr,
    );
    expect(prefill.blocking).toBe(true);
    expect(prefill.problems[0]).toMatchObject({
      line: 1,
      column: 'Employee code',
      message: expect.stringMatching(/not available yet/),
    });

    const rows = Array.from({ length: MAX_BULK_ROWS + 1 }, (_, i) => `P${i},p${i}@example.com`);
    const big = previewBulkCsv(
      ['Employee name,Employee email', ...rows].join('\n'),
      template,
      definition,
      hr,
    );
    expect(big.blocking).toBe(true);
    expect(big.total).toBe(MAX_BULK_ROWS + 1);
    expect(big.problems[0]!.message).toMatch(new RegExp(`up to ${MAX_BULK_ROWS}`));
  });

  it('asks for the phone of roles that sign with an SMS code', () => {
    const sms = {
      ...definition,
      roles: [{ ...definition.roles[0]!, auth: 'sms_otp' as const }, definition.roles[1]!],
    };
    const preview = previewBulkCsv(
      'Employee name,Employee email\nA,a@example.com\n',
      template,
      sms,
      hr,
    );
    expect(preview.problems).toEqual([
      {
        line: 2,
        column: 'Employee phone',
        message: expect.stringMatching(/Missing Employee phone/),
      },
    ]);
  });
});

describe('bulk send progress', () => {
  const view = bulkSendView({
    id: 'bulk_1',
    templateId: 'tpl_1',
    templateName: 'Offer',
    createdByName: null,
    status: 'sending',
    total: 4,
    sent: 1,
    failed: 1,
    createdAt: new Date('2026-11-20T10:00:00Z'),
    finishedAt: null,
  });

  it('counts handled rows and says where it is', () => {
    expect(view.createdAt).toBe('2026-11-20T10:00:00.000Z');
    expect(bulkProgress(view)).toBe(50);
    expect(bulkProgress({ total: 0, sent: 0, failed: 0 })).toBe(100);
    expect(bulkStatusLabel(view)).toBe('Sending: 2 of 4 done');
    expect(bulkStatusLabel({ ...view, status: 'done', sent: 4, failed: 0 })).toBe('All 4 sent');
    expect(bulkStatusLabel({ ...view, status: 'done', sent: 3, failed: 1 })).toBe(
      '3 sent, 1 failed',
    );
    expect(bulkStatusLabel({ ...view, status: 'cancelled' })).toBe('Stopped after 1 sent');
  });

  it('names who a row went to', () => {
    const roles = [{ id: 'r_emp' }, { id: 'r_hr' }];
    expect(
      rowPeopleLine({ r_emp: { name: 'Asha', email: 'a@example.com', phone: '' }, ...hr }, roles),
    ).toBe('Asha <a@example.com> + 1');
    expect(rowPeopleLine({}, roles)).toBe('');
  });
});
