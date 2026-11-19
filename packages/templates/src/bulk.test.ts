import { describe, expect, it } from 'vitest';
import { webCryptoHasher } from '@codevibe/sign-core';
import { parseBulkCsv, planBulkSend, type BulkRow } from './bulk';
import { readOnlyFieldIds } from './instantiate';
import { templateVersion } from './version';
import { deps, offerTemplate, people } from './test/fixtures';

const HEADER =
  'Employee name,Employee email,Employee phone,Employee code,Joining date,meta.employeeId';
const hr = { roles: { HR: people.HR } };

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\r\n');
}

describe('parseBulkCsv', () => {
  it('maps columns to roles, prefill labels and metadata', () => {
    const result = parseBulkCsv(
      csv('Asha Rao,asha@example.com,,EMP-1,2026-04-01,E1'),
      offerTemplate(),
    );
    expect(result.errors).toEqual([]);
    expect(result.columns.map((c) => c.kind)).toEqual([
      'role',
      'role',
      'role',
      'prefill',
      'prefill',
      'metadata',
    ]);
    expect(result.rows).toEqual([
      {
        line: 2,
        roles: { Employee: { name: 'Asha Rao', email: 'asha@example.com' } },
        prefill: { 'Employee code': 'EMP-1', 'Joining date': '2026-04-01' },
        metadata: { employeeId: 'E1' },
      },
    ]);
  });

  it('reads headings in any case and with dots, dashes or underscores', () => {
    const result = parseBulkCsv(
      '﻿employee.NAME,EMPLOYEE_email,hr-name,Hr Email,employee code,metadata:batch\n' +
        'Asha,asha@example.com,Meera,hr@example.com,EMP-1,Nov',
      offerTemplate(),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({
      roles: {
        Employee: { name: 'Asha', email: 'asha@example.com' },
        HR: { name: 'Meera', email: 'hr@example.com' },
      },
      prefill: { 'Employee code': 'EMP-1' },
      metadata: { batch: 'Nov' },
    });
  });

  it('handles quoted commas and line breaks inside values', () => {
    const result = parseBulkCsv(
      csv(
        '"Rao, Asha",asha@example.com,,"EMP-1","1 April\n2026",E1',
        'Ravi,ravi@example.com,,EMP-2,,E2',
      ),
      offerTemplate(),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => r.line)).toEqual([2, 4]);
    expect(result.rows[0]!.roles.Employee!.name).toBe('Rao, Asha');
    expect(result.rows[0]!.prefill['Joining date']).toBe('1 April\n2026');
    expect(result.rows[1]!.prefill).toEqual({ 'Employee code': 'EMP-2' });
  });

  it('skips empty lines', () => {
    const result = parseBulkCsv(
      csv('', 'Asha,asha@example.com,,EMP-1,,', ',,,,,', '', 'Ravi,ravi@example.com,,EMP-2,,', ''),
      offerTemplate(),
    );
    expect(result.errors).toEqual([]);
    expect(result.rows.map((r) => r.line)).toEqual([3, 6]);
  });

  it('reports unknown, blank and repeated columns', () => {
    const result = parseBulkCsv(
      'Employee name,Employe email,,Employee Name,Salary\nAsha,a@example.com,,Asha,1',
      offerTemplate(),
    );
    expect(result.errors).toMatchObject([
      { line: 1, column: 'Employe email', message: expect.stringContaining('Unknown column') },
      { line: 1, column: '', message: 'A column has no heading' },
      { line: 1, column: 'Employee Name', message: 'Column Employee Name appears twice' },
      { line: 1, column: 'Salary' },
      { line: 2, column: 'Employee email', message: 'Missing Employee email' },
    ]);
  });

  it('collects every row problem without stopping at the first', () => {
    const result = parseBulkCsv(
      csv(
        'Asha,asha@example.com,,EMP-1,,',
        ',nobody@example.com,,EMP-2,,',
        'Ravi,,,EMP-3,,',
        'Kiran,kiran@,,EMP-4,,',
        'Dev,,98765,EMP-5,,',
        'Asha R,ASHA@example.com,,EMP-6,,',
        'Nina,nina@example.com,,EMP-7,,,surplus',
        'Om,om@example.com,+91 98765 43210,EMP-8,,',
      ),
      offerTemplate(),
    );
    expect(result.errors).toEqual([
      { line: 3, column: 'Employee name', message: 'Missing Employee name' },
      { line: 4, column: 'Employee email', message: 'Missing Employee email' },
      {
        line: 5,
        column: 'Employee email',
        message: 'Employee email kiran@ is not a valid address',
      },
      {
        line: 6,
        column: 'Employee phone',
        message: 'Employee phone must be in international format, for example +919876543210',
      },
      { line: 7, message: 'Duplicate of line 2: the same people again' },
      { line: 8, message: 'Row has 7 values but the header has 6 columns' },
    ]);
    expect(result.rows.map((r) => r.line)).toEqual([2, 9]);
    expect(result.rows[1]!.roles.Employee!.phone).toBe('+919876543210');
  });

  it('accepts a phone instead of an email unless the role signs by email', () => {
    const phoneOnly = parseBulkCsv(csv('Dev,,+919876543210,EMP-1,,'), offerTemplate());
    expect(phoneOnly.errors).toEqual([]);

    const template = offerTemplate();
    template.roles[0]!.auth = 'email_otp';
    expect(parseBulkCsv(csv('Dev,,+919876543210,EMP-1,,'), template).errors).toMatchObject([
      { line: 2, message: 'Missing Employee email' },
    ]);

    template.roles[0]!.auth = 'sms_otp';
    expect(parseBulkCsv(csv('Dev,dev@example.com,,EMP-1,,'), template).errors).toMatchObject([
      { line: 2, column: 'Employee phone' },
    ]);
  });

  it('reports an empty file and an unclosed quote', () => {
    expect(parseBulkCsv('', offerTemplate()).errors).toEqual([
      { line: 1, message: 'The file is empty; add a header row' },
    ]);
    const unclosed = parseBulkCsv(
      csv('Asha,asha@example.com,,EMP-1,,', '"Ravi,ravi@example.com'),
      offerTemplate(),
    );
    expect(unclosed.rows).toHaveLength(1);
    expect(unclosed.errors).toEqual([{ line: 3, message: 'A quoted value is never closed' }]);
  });

  it('reads 1,000 rows', () => {
    const lines: string[] = [];
    for (let i = 1; i <= 1000; i++)
      lines.push(`"Joiner, ${i}",joiner${i}@example.com,,EMP-${i},,E${i}`);
    const result = parseBulkCsv(csv(...lines), offerTemplate());
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1000);
    expect(result.rows[999]).toMatchObject({ line: 1001, metadata: { employeeId: 'E1000' } });
  });
});

describe('planBulkSend', () => {
  const rowsFrom = (...rows: string[]) => parseBulkCsv(csv(...rows), offerTemplate()).rows;

  it('plans one envelope per row with shared defaults', async () => {
    const rows = rowsFrom('Asha,asha@example.com,,EMP-1,,E1', 'Ravi,ravi@example.com,,EMP-2,,E2');
    const plan = await planBulkSend(offerTemplate(), rows, deps(), { defaults: hr });
    expect(plan.errors).toEqual([]);
    expect(plan.envelopes).toHaveLength(2);
    expect(plan.planned.map((p) => p.line)).toEqual([2, 3]);
    expect(plan.planned[0]!.result.envelope).toBe(plan.envelopes[0]);
    expect(plan.planned[0]!.result.events[0]!.action).toBe('envelope.created');

    const version = await templateVersion(offerTemplate(), webCryptoHasher);
    const [asha, ravi] = plan.envelopes;
    expect(asha!.recipients.map((r) => r.name)).toEqual(['Asha', 'Meera Iyer']);
    expect(ravi!.metadata).toMatchObject({ employeeId: 'E2', templateVersion: version });
    expect(readOnlyFieldIds(ravi!)).toHaveLength(1);
    expect(new Set(plan.envelopes.map((e) => e.id)).size).toBe(2);
  });

  it('lets row values win over defaults', async () => {
    const rows: BulkRow[] = [
      {
        line: 2,
        roles: { Employee: people.Employee, hr: { email: 'hr-north@example.com' } },
        prefill: { 'Employee code': 'EMP-1' },
        metadata: { region: 'North' },
      },
    ];
    const plan = await planBulkSend(offerTemplate(), rows, deps(), {
      defaults: { ...hr, metadata: { region: 'All', batch: 'Nov' } },
    });
    expect(plan.envelopes[0]!.recipients[1]).toMatchObject({
      name: 'Meera Iyer',
      email: 'hr-north@example.com',
    });
    expect(plan.envelopes[0]!.metadata).toMatchObject({ region: 'North', batch: 'Nov' });
  });

  it('reports failing rows and still plans the rest', async () => {
    const rows: BulkRow[] = [
      ...rowsFrom('Asha,asha@example.com,,EMP-1,,'),
      {
        line: 3,
        roles: { Employee: { name: 'Ravi', email: 'ravi@example.com' } },
        prefill: {},
        metadata: {},
      },
      {
        line: 4,
        roles: { Employee: { name: 'Kiran', email: 'kiran@example.com' } },
        prefill: { 'Employee code': 'EMP-3', 'Joining date': 'x'.repeat(1001) },
        metadata: {},
      },
      ...rowsFrom('Dev,dev@example.com,,EMP-4,,').map((r) => ({ ...r, line: 5 })),
    ];
    const plan = await planBulkSend(offerTemplate(), rows, deps(), { defaults: hr });
    expect(plan.planned.map((p) => p.line)).toEqual([2, 5]);
    expect(plan.errors).toEqual([
      {
        line: 3,
        path: 'prefill.Employee code',
        message: 'Give a value for Employee code; recipients cannot fill it in',
      },
      { line: 4, path: 'prefill.Joining date', message: 'Text is longer than 1000 characters' },
    ]);
  });

  it('reports a role nobody fills once, instead of on every row', async () => {
    const rows = rowsFrom('Asha,asha@example.com,,EMP-1,,', 'Ravi,ravi@example.com,,EMP-2,,');
    const plan = await planBulkSend(offerTemplate(), rows, deps());
    expect(plan.envelopes).toEqual([]);
    expect(plan.errors).toEqual([expect.objectContaining({ line: 1, path: 'roles.HR' })]);
  });

  it('applies overrides from defaults to every envelope', async () => {
    const rows = rowsFrom('Asha,asha@example.com,,EMP-1,,');
    const plan = await planBulkSend(offerTemplate(), rows, deps(), {
      defaults: { ...hr, overrides: { routing: 'parallel', expiresInDays: 30 } },
    });
    expect(plan.envelopes[0]).toMatchObject({
      routing: 'parallel',
      expiresAt: '2026-03-31T10:00:00.000Z',
    });
  });

  it('returns an empty plan for no rows', async () => {
    expect(await planBulkSend(offerTemplate(), [], deps())).toEqual({
      envelopes: [],
      planned: [],
      errors: [],
    });
  });

  it('throws when the template itself is invalid', async () => {
    const template = offerTemplate();
    template.documents = [];
    await expect(planBulkSend(template, [], deps())).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('plans 50 new joiners from a CSV', async () => {
    const lines: string[] = [];
    for (let i = 1; i <= 50; i++)
      lines.push(`Joiner ${i},joiner${i}@example.com,,EMP-${1000 + i},2026-12-01,E${i}`);
    const parsed = parseBulkCsv(csv(...lines), offerTemplate());
    const plan = await planBulkSend(offerTemplate(), parsed.rows, deps(), { defaults: hr });
    expect(parsed.errors).toEqual([]);
    expect(plan.errors).toEqual([]);
    expect(plan.envelopes).toHaveLength(50);
    expect(plan.envelopes[49]!.values.map((v) => v.value)).toEqual(['EMP-1050', '2026-12-01']);
  });
});
