import type { Field } from '@codevibe_technology/sign-core';
import { validateTemplate } from '@codevibe_technology/sign-templates';
import { describe, expect, it } from 'vitest';
import {
  definitionInput,
  detailProblems,
  editorStateFrom,
  emptyTemplate,
  firstOpenStep,
  keptFields,
  roleProblems,
  sendProblems,
  templateFieldProblems,
  templateStepProblems,
  templateSummary,
  toSignTemplate,
  type TemplateDefinition,
  type TemplateRoleDef,
} from './templates';

const A4 = { width: 595, height: 842 };
const roles: TemplateRoleDef[] = [
  { id: 'r_emp', name: 'Employee', type: 'signer', auth: 'email_link' },
  { id: 'r_mgr', name: 'Manager', type: 'approver', auth: 'email_otp' },
  { id: 'r_hr', name: 'HR', type: 'viewer', auth: 'email_link' },
];
const signature = (recipientId: string, extra: Partial<Field> = {}): Field => ({
  id: `f_${recipientId}`,
  documentId: 'd1',
  recipientId,
  type: 'signature',
  page: 0,
  rect: { x: 72, y: 600, width: 180, height: 48 },
  required: true,
  ...extra,
});
const definition: TemplateDefinition = {
  title: '',
  message: 'Welcome aboard',
  routing: 'sequential',
  expiresInDays: 14,
  remindEveryDays: 2,
  roles,
  documents: [{ id: 'd1', name: 'offer.pdf', size: 100, sha256: 'a'.repeat(64), pages: [A4, A4] }],
  fields: [signature('r_emp')],
};
const template = { id: 'tpl_1', name: 'Offer letter' };

describe('template roles', () => {
  it('starts each role with a one-time code by email', () => {
    expect(emptyTemplate().roles.map((r) => r.auth)).toEqual(['email_otp']);
  });

  it('needs at least one role that acts, each named once', () => {
    expect(roleProblems([])).toEqual({ roles: expect.stringMatching(/at least one role/) });
    expect(roleProblems([{ ...roles[2]! }]).roles).toMatch(/signer or an approver/);
    expect(
      roleProblems([
        { ...roles[0]!, name: ' ' },
        { ...roles[1]!, name: 'employee' },
        { ...roles[2]!, name: 'EMPLOYEE ' },
      ]),
    ).toEqual({
      'roles.r_emp.name': expect.stringMatching(/Name the role/),
      'roles.r_hr.name': 'Another role already has this name.',
    });
    expect(roleProblems([{ ...roles[0]!, name: 'x'.repeat(61) }])['roles.r_emp.name']).toMatch(
      /under 60/,
    );
    expect(roleProblems(roles)).toEqual({});
  });

  it('asks for a signature for every signer role, as the send flow does', () => {
    expect(templateFieldProblems(roles, [])).toEqual({
      'fields.r_emp': expect.stringMatching(/signature field for Employee/),
    });
    expect(templateFieldProblems(roles, [signature('r_emp')])).toEqual({});
  });
});

describe('template details', () => {
  const settings = { title: '', message: '', expiresInDays: 30, remindEveryDays: 2 };

  it('needs a name and keeps the title optional', () => {
    expect(detailProblems({ name: '', description: '', settings })).toEqual({
      name: expect.stringMatching(/Name the template/),
    });
    expect(detailProblems({ name: 'Offer', description: 'x'.repeat(501), settings })).toEqual({
      description: expect.stringMatching(/under 500/),
    });
    expect(
      detailProblems({
        name: 'Offer',
        description: '',
        settings: { ...settings, expiresInDays: 0 },
      }),
    ).toEqual({ expiresInDays: expect.any(String) });
    expect(detailProblems({ name: 'Offer', description: '', settings })).toEqual({});
  });

  it('walks the steps in order and points at the first that needs work', () => {
    const state = emptyTemplate();
    expect(firstOpenStep(state)).toBe('documents');
    const withDoc = {
      ...state,
      documents: [{ id: 'd1', name: 'a.pdf', size: 1, pages: [A4] }],
    };
    expect(firstOpenStep(withDoc)).toBe('fields');
    const placed = { ...withDoc, fields: [signature(state.roles[0]!.id)] };
    expect(firstOpenStep(placed)).toBe('details');
    expect(templateStepProblems('details', placed)).toEqual({ name: expect.any(String) });
    expect(templateStepProblems('details', { ...placed, name: 'Offer' })).toEqual({});
  });
});

describe('saving a template', () => {
  it('drops fields of viewers, removed roles and removed documents', () => {
    const fields = [
      signature('r_emp'),
      signature('r_hr', { id: 'f_view' }),
      signature('r_gone', { id: 'f_gone' }),
      signature('r_emp', { id: 'f_doc', documentId: 'd_gone' }),
    ];
    const state = { roles, fields, documents: [{ id: 'd1', name: 'a', size: 1, pages: [A4] }] };
    expect(keptFields(state).map((f) => f.id)).toEqual(['f_r_emp']);
  });

  it('sends trimmed values and round-trips through the editor state', () => {
    const state = {
      ...editorStateFrom({ id: 'tpl_1', name: 'Offer', description: null }, definition),
      name: ' Offer letter ',
      description: '  ',
      roles: roles.map((r) => ({ ...r, name: ` ${r.name} ` })),
    };
    const input = definitionInput(state);
    expect(input.name).toBe('Offer letter');
    expect(input.description).toBe('');
    expect(input.roles.map((r) => r.name)).toEqual(['Employee', 'Manager', 'HR']);
    expect(input.fields).toEqual([
      {
        id: 'f_r_emp',
        documentId: 'd1',
        recipientId: 'r_emp',
        type: 'signature',
        page: 0,
        rect: { x: 72, y: 600, width: 180, height: 48 },
        required: true,
      },
    ]);
    expect(state.templateId).toBe('tpl_1');
    expect(state.documents).toEqual([{ id: 'd1', name: 'offer.pdf', size: 100, pages: [A4, A4] }]);
  });

  it('summarises a template for the list', () => {
    expect(
      templateSummary({
        id: 'tpl_1',
        name: 'Offer',
        description: null,
        definition,
        updatedAt: new Date('2026-11-01T00:00:00Z'),
        archivedAt: null,
        createdByName: 'Asha',
      }),
    ).toEqual({
      id: 'tpl_1',
      name: 'Offer',
      description: null,
      roles: [
        { name: 'Employee', type: 'signer' },
        { name: 'Manager', type: 'approver' },
        { name: 'HR', type: 'viewer' },
      ],
      documentCount: 1,
      pageCount: 2,
      updatedAt: '2026-11-01T00:00:00.000Z',
      archivedAt: null,
      createdByName: 'Asha',
    });
  });
});

describe('sending from a template', () => {
  it('names the role and the detail that is missing or wrong', () => {
    expect(sendProblems(definition, {})).toEqual({
      'people.r_emp.name': "Enter the Employee's name.",
      'people.r_emp.email': "Enter the Employee's email; the link goes there.",
      'people.r_mgr.name': "Enter the Manager's name.",
      'people.r_mgr.email': "Enter the Manager's email; the link goes there.",
      'people.r_hr.name': "Enter the HR's name.",
      'people.r_hr.email': "Enter the HR's email; the link goes there.",
    });
    const sms = { roles: [{ ...roles[0]!, auth: 'sms_otp' as const }] };
    expect(sendProblems(sms, { r_emp: { name: 'A', email: 'a@example.com', phone: '' } })).toEqual({
      'people.r_emp.phone': expect.stringMatching(/SMS codes are not available/),
    });
    expect(
      sendProblems(definition, {
        r_emp: { name: 'A', email: 'nope', phone: '98123' },
        r_mgr: { name: 'B', email: 'b@example.com', phone: '' },
        r_hr: { name: 'C', email: 'c@example.com', phone: '' },
      }),
    ).toEqual({
      'people.r_emp.email': 'This email address does not look right.',
      'people.r_emp.phone': expect.stringMatching(/international format/),
    });
  });

  it('refuses the same person twice in the same kind of role', () => {
    const two = { roles: [roles[0]!, { ...roles[0]!, id: 'r_2', name: 'Witness' }] };
    expect(
      sendProblems(two, {
        r_emp: { name: 'A', email: 'a@example.com', phone: '' },
        r_2: { name: 'A', email: 'A@example.com', phone: '' },
      }),
    ).toEqual({ 'people.r_2.email': expect.stringMatching(/already the Employee/) });
  });

  it('checks the title and message overrides', () => {
    expect(sendProblems({ roles: [] }, {}, { title: ' ', message: '' })).toEqual({
      title: 'Give the envelope a title.',
    });
    expect(
      sendProblems({ roles: [] }, {}, { title: 'x', message: 'y'.repeat(5001) }).message,
    ).toMatch(/under 5000/);
  });

  it("matches the templates package's own rules", () => {
    expect(validateTemplate(toSignTemplate(template, definition))).toEqual([]);
    const broken = toSignTemplate(template, { ...definition, fields: [] });
    expect(validateTemplate(broken).length).toBeGreaterThan(0);
  });
});
