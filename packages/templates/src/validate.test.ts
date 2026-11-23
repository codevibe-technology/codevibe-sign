import { describe, expect, it } from 'vitest';
import { SignError } from '@codevibe_technology/sign-core';
import { assertValidTemplate, validateTemplate } from './validate';
import { offerTemplate } from './test/fixtures';
import type { Template } from './types';

const paths = (template: Template) => validateTemplate(template).map((i) => i.path);

function edit(change: (t: Template) => void): Template {
  const template = offerTemplate();
  change(template);
  return template;
}

describe('validateTemplate', () => {
  it('accepts the offer letter template', () => {
    expect(validateTemplate(offerTemplate())).toEqual([]);
    expect(() => assertValidTemplate(offerTemplate())).not.toThrow();
  });

  it('requires a title, documents and an acting role', () => {
    expect(paths({ title: ' ', documents: [], roles: [] })).toEqual([
      'title',
      'documents',
      'roles',
    ]);
    expect(paths(edit((t) => (t.roles = [{ name: 'Legal', type: 'viewer' }])))).toEqual(['roles']);
  });

  it('takes the Aadhaar eSign box as the signature of an Aadhaar eSign role only', () => {
    const boxed = (auth: 'aadhaar' | 'email_otp') =>
      edit((t) => {
        const role = t.roles[0]!;
        role.auth = auth;
        role.fields = (role.fields ?? []).map((f) =>
          f.type === 'signature' ? { ...f, type: 'aadhaar' } : f,
        );
      });
    expect(validateTemplate(boxed('aadhaar'))).toEqual([]);
    expect(validateTemplate(boxed('email_otp')).map((i) => i.path)).toEqual(['roles.0.fields']);
  });

  it('checks routing, reminders and expiry', () => {
    expect(
      paths(
        edit((t) => {
          t.routing = 'random' as never;
          t.reminders = { firstAfterDays: 2, everyDays: 0, max: 3 };
          t.expiresInDays = 0;
        }),
      ),
    ).toEqual(['routing', 'reminders.everyDays', 'expiresInDays']);
    expect(paths(edit((t) => (t.expiresInDays = 1.5)))).toEqual(['expiresInDays']);
  });

  it('checks documents', () => {
    const template = edit((t) => {
      t.documents = [
        { name: '', fileKey: 'a', sha256: 'XYZ', pageSizes: [] },
        {
          name: 'b.pdf',
          fileKey: 'a',
          sha256: 'b'.repeat(64),
          pageSizes: [{ width: 0, height: 10 }],
        },
      ];
      t.roles = [{ name: 'HR', type: 'approver' }];
    });
    expect(paths(template)).toEqual([
      'documents.0.name',
      'documents.0.sha256',
      'documents.0.pageSizes',
      'documents.1.fileKey',
      'documents.1.pageSizes.0',
    ]);
  });

  it('keeps every field inside its page', () => {
    const template = edit((t) => {
      const fields = t.roles[0]!.fields!;
      fields[0]!.rect = { x: 500, y: 120, width: 160, height: 20 };
      fields[1]!.page = 2;
      fields[2]!.document = 'missing.pdf';
    });
    const issues = validateTemplate(template);
    expect(issues.map((i) => i.path)).toEqual([
      'roles.0.fields.0.rect',
      'roles.0.fields.1.page',
      'roles.0.fields.2.document',
    ]);
    expect(issues[0]!.message).toContain('595 x 842');
  });

  it('rejects negative, empty and non-finite boxes', () => {
    const template = edit((t) => {
      const fields = t.roles[0]!.fields!;
      fields[0]!.rect = { x: -1, y: 0, width: 0, height: 10 };
      fields[1]!.rect = { x: Number.NaN, y: 0, width: 10, height: 10 };
    });
    const issues = validateTemplate(template).filter((i) => i.path.endsWith('rect'));
    expect(issues.map((i) => i.message)).toEqual([
      'Width and height must be greater than 0',
      'The box starts outside the page',
      'Position and size must be finite numbers',
    ]);
  });

  it('needs a required signature field for every signer role', () => {
    const optional = edit((t) => (t.roles[1]!.fields![0]!.required = false));
    expect(paths(optional)).toEqual(['roles.1.fields']);
    const initials = edit((t) => (t.roles[1]!.fields![0]!.type = 'initials'));
    expect(validateTemplate(initials)[0]!.message).toBe(
      'Place at least one required signature field for HR',
    );
    const approver = edit((t) => (t.roles[1] = { name: 'HR', type: 'approver' }));
    expect(validateTemplate(approver)).toEqual([]);
  });

  it('checks roles: names, type, order, auth and viewer fields', () => {
    const template = edit((t) => {
      t.roles[1]!.name = ' employee ';
      t.roles.push(
        { name: '', type: 'boss' as never },
        {
          name: 'Auditor',
          type: 'viewer',
          order: 0,
          auth: 'fax' as never,
          fields: [t.roles[0]!.fields![2]!],
        },
      );
    });
    expect(paths(template)).toEqual([
      'roles.1.name',
      'roles.2.name',
      'roles.2.type',
      'roles.3.order',
      'roles.3.auth',
      'roles.3.fields',
    ]);
  });

  it('allows read-only only on labelled text fields', () => {
    const template = edit((t) => {
      const fields = t.roles[0]!.fields!;
      delete fields[0]!.label;
      fields[2]!.readOnly = true;
      fields[2]!.label = 'Sign here';
    });
    expect(paths(template)).toEqual(['roles.0.fields.0.label', 'roles.0.fields.2.readOnly']);
  });

  it('rejects unknown field types', () => {
    expect(paths(edit((t) => (t.roles[0]!.fields![1]!.type = 'stamp' as never)))).toEqual([
      'roles.0.fields.1.type',
    ]);
  });

  it('throws a VALIDATION SignError listing every issue', () => {
    try {
      assertValidTemplate({ title: '', documents: [], roles: [] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SignError);
      const signError = error as SignError;
      expect(signError.code).toBe('VALIDATION');
      expect(signError.message).toBe('Title is required (title)');
      expect((signError.details?.issues as unknown[]).length).toBe(3);
    }
  });
});
