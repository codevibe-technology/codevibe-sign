import type { Envelope, Field } from '@codevibe_technology/sign-core';
import { describe, expect, it } from 'vitest';
import {
  MAX_PDF_BYTES,
  aadhaarProblems,
  adoptSavedRecipients,
  documentProblems,
  draftBody,
  emptySettings,
  fieldProblems,
  fileProblem,
  localPath,
  moveItem,
  newRecipient,
  recipientProblems,
  resumeStep,
  settingsProblems,
  stateFromEnvelope,
  stepProblems,
  titleFromFileName,
  type DraftRecipient,
  type SendFlowState,
} from './send-flow';

const person = (patch: Partial<DraftRecipient> = {}): DraftRecipient => ({
  ...newRecipient(),
  name: 'Asha Rao',
  email: 'asha@example.com',
  ...patch,
});

const signature = (recipientId: string, patch: Partial<Field> = {}): Field => ({
  id: `f_${recipientId}`,
  documentId: 'doc_1',
  recipientId,
  type: 'signature',
  page: 0,
  rect: { x: 10, y: 10, width: 100, height: 30 },
  required: true,
  ...patch,
});

function flow(patch: Partial<SendFlowState> = {}): SendFlowState {
  const asha = person({ id: 'r_asha', saved: true });
  return {
    envelopeId: 'env_1',
    documents: [
      { id: 'doc_1', name: 'offer.pdf', size: 1000, pages: [{ width: 595, height: 842 }] },
    ],
    recipients: [asha],
    routing: 'sequential',
    fields: [signature('r_asha')],
    settings: { ...emptySettings(), title: 'Offer letter' },
    ...patch,
  };
}

describe('files', () => {
  it('accepts a PDF under the limit', () => {
    expect(fileProblem({ name: 'offer.pdf', size: 1000, type: 'application/pdf' })).toBeNull();
    expect(fileProblem({ name: 'OFFER.PDF', size: 1000, type: '' })).toBeNull();
  });

  it('says how to fix files that cannot be sent', () => {
    expect(fileProblem({ name: 'cv.docx', size: 10, type: 'application/msword' })).toMatch(
      /not a PDF\. Save or export it as PDF/,
    );
    expect(fileProblem({ name: 'a.pdf', size: 0, type: 'application/pdf' })).toMatch(/empty/);
    expect(
      fileProblem({ name: 'big.pdf', size: MAX_PDF_BYTES + 1, type: 'application/pdf' }),
    ).toMatch(/20\.0 MB; the limit is 20 MB\. Compress it or split it/);
  });

  it('needs at least one and at most twenty documents', () => {
    expect(documentProblems([])).toEqual({ documents: 'Add at least one PDF to send.' });
    const many = Array.from({ length: 21 }, (_, i) => ({
      id: `${i}`,
      name: 'a.pdf',
      size: 1,
      pages: [],
    }));
    expect(documentProblems(many).documents).toMatch(/at most 20/);
  });

  it('turns a file name into a title', () => {
    expect(titleFromFileName('offer-letter_v2.pdf')).toBe('Offer letter v2');
    expect(titleFromFileName('nda.PDF')).toBe('Nda');
  });
});

describe('recipients', () => {
  it('asks a new signer for a one-time code by email by default', () => {
    expect(newRecipient().auth).toBe('email_otp');
  });

  it('needs someone who signs or approves', () => {
    expect(recipientProblems([]).recipients).toMatch(/Add the people/);
    expect(recipientProblems([person({ role: 'viewer' })]).recipients).toMatch(
      /signer or an approver/,
    );
    expect(recipientProblems([person({ role: 'approver' })])).toEqual({});
  });

  it('points at the field to fix for each person', () => {
    const r = person({ id: 'r1', name: ' ', email: 'not-an-email' });
    expect(recipientProblems([r])).toEqual({
      'recipients.r1.name': 'Enter their name.',
      'recipients.r1.email': 'This email address does not look right.',
    });
    expect(recipientProblems([person({ id: 'r2', email: '' })])['recipients.r2.email']).toMatch(
      /signing link goes there/,
    );
  });

  it('refuses SMS codes while no SMS provider is connected', () => {
    const r = person({ id: 'r1', auth: 'sms_otp', phone: '+919812345678' });
    expect(recipientProblems([r])['recipients.r1.auth']).toMatch(/SMS codes are not available/);
  });

  it('still checks the format of a mobile number that is given', () => {
    const r = person({ id: 'r1', phone: '98123' });
    expect(recipientProblems([r])['recipients.r1.phone']).toMatch(/\+919812345678/);
    expect(recipientProblems([{ ...r, phone: '+91 98123 45678' }])).toEqual({});
  });

  it('refuses the same person twice in the same role, allows a different role', () => {
    const a = person({ id: 'a' });
    expect(recipientProblems([a, person({ id: 'b', email: 'ASHA@example.com' })])).toEqual({
      'recipients.b.email': 'This person is already in the list with the same role.',
    });
    expect(recipientProblems([a, person({ id: 'b', role: 'viewer' })])).toEqual({});
  });
});

describe('fields and settings', () => {
  it('needs a required signature for every signer, not for approvers', () => {
    const asha = person({ id: 'a' });
    const ravi = person({ id: 'b', name: 'Ravi', email: 'ravi@example.com', role: 'approver' });
    expect(fieldProblems([asha, ravi], [])).toEqual({
      'fields.a':
        'Place a signature field for Asha Rao: pick them, then drag "Signature" onto the page.',
    });
    expect(fieldProblems([asha], [signature('a', { required: false })])).toHaveProperty('fields.a');
    expect(fieldProblems([asha], [signature('a', { type: 'initials' })])).toHaveProperty(
      'fields.a',
    );
    expect(fieldProblems([asha, ravi], [signature('a')])).toEqual({});
  });

  it('asks for one Aadhaar eSign box, and no drawn signature, from an Aadhaar signer', () => {
    const asha = person({ id: 'a' });
    const esigner = { ...asha, auth: 'aadhaar' as const };
    expect(fieldProblems([esigner], [])).toEqual({
      'fields.a':
        'Place the Aadhaar eSign box for Asha Rao: pick them, then drag "Aadhaar eSign" to where the signature goes.',
    });
    expect(fieldProblems([esigner], [signature('a')])['fields.a']).toMatch(/Aadhaar eSign box/);
    const box = signature('a', { id: 'box', type: 'aadhaar' });
    expect(fieldProblems([esigner], [box])).toEqual({});
    expect(fieldProblems([esigner], [box, signature('a', { id: 'x', type: 'initials' })])).toEqual({
      'fields.a':
        'Asha Rao signs with Aadhaar eSign and draws nothing. Delete their signature and initials fields.',
    });
    expect(fieldProblems([esigner], [box, { ...box, id: 'box2' }])['fields.a']).toMatch(
      /Keep one Aadhaar eSign box/,
    );
    expect(fieldProblems([asha], [signature('a'), box])['fields.a']).toMatch(
      /Only a signer who uses Aadhaar eSign/,
    );
  });

  it('checks the title, message and expiry', () => {
    expect(settingsProblems({ ...emptySettings(), title: '' }).title).toMatch(/email subject/);
    expect(settingsProblems({ ...emptySettings(), title: 'x'.repeat(201) }).title).toMatch(/200/);
    expect(
      settingsProblems({ ...emptySettings(), title: 'Ok', message: 'x'.repeat(5001) }).message,
    ).toMatch(/5000/);
    expect(
      settingsProblems({ ...emptySettings(), title: 'Ok', expiresInDays: 0 }).expiresInDays,
    ).toMatch(/1 and 365/);
  });

  it('collects every problem on the review step', () => {
    const state = flow({ fields: [], settings: emptySettings() });
    expect(Object.keys(stepProblems('review', state)).sort()).toEqual(['fields.r_asha', 'title']);
    expect(stepProblems('documents', state)).toEqual({});
  });
});

describe('the draft body', () => {
  it('numbers recipients in order, or all first for parallel signing', () => {
    const state = flow({
      recipients: [person({ id: 'a', saved: true }), person({ id: 'b', email: 'b@example.com' })],
    });
    expect(draftBody(state).recipients.map((r) => [r.key, 'id' in r, r.order])).toEqual([
      ['a', true, 1],
      ['b', false, 2],
    ]);
    expect(draftBody({ ...state, routing: 'parallel' }).recipients.map((r) => r.order)).toEqual([
      1, 1,
    ]);
  });

  it('cleans up values and leaves out fields of people who no longer sign', () => {
    const state = flow({
      recipients: [
        person({ id: 'a', saved: true, email: ' Asha@Example.com ', phone: '+91 98123 45678' }),
        person({ id: 'b', role: 'viewer', email: 'b@example.com' }),
      ],
      fields: [signature('a'), signature('b')],
      settings: { title: '  ', message: '  ', expiresInDays: 14, remindEveryDays: 0 },
    });
    const body = draftBody(state);
    expect(body.recipients[0]).toMatchObject({ email: 'asha@example.com', phone: '+919812345678' });
    expect(body.fields.map((f) => f.recipient)).toEqual(['a']);
    expect(body).toMatchObject({
      title: 'Offer',
      message: null,
      expiresInDays: 14,
      reminders: { firstAfterDays: 0, max: 0 },
    });
  });
});

describe('saving', () => {
  it('gives unsaved recipients and their fields the ids the server chose', () => {
    const local = person({ id: 'rcp_local_1' });
    const state = flow({ recipients: [local], fields: [signature('rcp_local_1')] });
    const next = adoptSavedRecipients(state, [local], [{ id: 'rcp_9' }]);
    expect(next.recipients[0]).toMatchObject({ id: 'rcp_9', saved: true });
    expect(next.fields[0]!.recipientId).toBe('rcp_9');
  });

  it('returns the same state when nothing changed, so saves do not loop', () => {
    const state = flow();
    expect(adoptSavedRecipients(state, state.recipients, [{ id: 'r_asha' }])).toBe(state);
  });

  it('keeps recipients added while a save was in flight', () => {
    const sent = [person({ id: 'l1' })];
    const later = person({ id: 'l2', email: 'b@example.com' });
    const next = adoptSavedRecipients(flow({ recipients: [...sent, later] }), sent, [{ id: 's1' }]);
    expect(next.recipients.map((r) => [r.id, r.saved])).toEqual([
      ['s1', true],
      ['l2', false],
    ]);
  });

  it('maps server field paths onto the form', () => {
    const sent = [person({ id: 'a' }), person({ id: 'b' })];
    expect(localPath('recipients[1].email', sent)).toBe('recipients.b.email');
    expect(localPath('recipients[7].email', sent)).toBe('recipients');
    expect(localPath('title', sent)).toBe('title');
    expect(localPath(undefined, sent)).toBeUndefined();
  });

  it('moves list items and ignores moves out of range', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    const list = ['a'];
    expect(moveItem(list, 0, 1)).toBe(list);
  });
});

describe('reopening a draft', () => {
  const envelope = {
    id: 'env_1',
    title: 'Offer',
    message: 'Hi',
    status: 'draft',
    routing: 'parallel',
    documents: [
      {
        id: 'doc_1',
        name: 'offer.pdf',
        sha256: 'a'.repeat(64),
        pageCount: 1,
        fileKey: 'k',
        pageSizes: [{ width: 595, height: 842 }],
      },
    ],
    recipients: [
      {
        id: 'r2',
        name: 'B',
        email: 'b@example.com',
        role: 'signer',
        order: 2,
        auth: 'email_otp',
        status: 'pending',
      },
      {
        id: 'r1',
        name: 'A',
        email: 'a@example.com',
        role: 'signer',
        order: 1,
        auth: 'email_link',
        status: 'pending',
      },
    ],
    fields: [],
    values: [],
    reminders: { firstAfterDays: 3, everyDays: 3, max: 5 },
    expiresAt: '2026-01-15T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  } satisfies Envelope;

  it('restores recipients in order, settings and the step to continue from', () => {
    const state = stateFromEnvelope(envelope, new Date('2026-01-01T00:00:00.000Z'));
    expect(state.recipients.map((r) => [r.id, r.saved])).toEqual([
      ['r1', true],
      ['r2', true],
    ]);
    expect(state.settings).toEqual({
      title: 'Offer',
      message: 'Hi',
      expiresInDays: 14,
      remindEveryDays: 3,
    });
    expect(state.routing).toBe('parallel');
    expect(resumeStep(state)).toBe('fields');
    expect(resumeStep({ ...state, fields: [signature('r1'), signature('r2')] })).toBe('review');
  });
});

describe('aadhaar esign', () => {
  const ravi = person({
    id: 'r_ravi',
    name: 'Ravi Kumar',
    email: 'ravi@example.com',
    auth: 'aadhaar',
  });
  const asha = person({ id: 'r_asha' });

  it('accepts one aadhaar signer who signs last on one document', () => {
    expect(aadhaarProblems(flow({ recipients: [asha, ravi] }))).toEqual({});
    expect(aadhaarProblems(flow({ recipients: [ravi] }))).toEqual({});
    const copy = person({ id: 'r_copy', role: 'viewer' });
    expect(aadhaarProblems(flow({ recipients: [asha, ravi, copy] }))).toEqual({});
  });

  it('points at the identity check when the rules are broken', () => {
    const at = 'recipients.r_ravi.auth';
    expect(aadhaarProblems(flow({ recipients: [ravi, asha] }))[at]).toMatch(/has to be last/);
    expect(aadhaarProblems(flow({ recipients: [asha, ravi], routing: 'parallel' }))[at]).toMatch(
      /One after another/,
    );
    const two = flow({
      recipients: [ravi],
      documents: [
        { id: 'doc_1', name: 'a.pdf', size: 1, pages: [] },
        { id: 'doc_2', name: 'b.pdf', size: 1, pages: [] },
      ],
    });
    expect(aadhaarProblems(two)[at]).toMatch(/covers one document/);
    const second = person({ id: 'r_two', auth: 'aadhaar', email: 'two@example.com' });
    expect(aadhaarProblems(flow({ recipients: [ravi, second] }))['recipients.r_two.auth']).toMatch(
      /Only one person/,
    );
    const approver = { ...ravi, role: 'approver' as const };
    expect(aadhaarProblems(flow({ recipients: [approver] }))[at]).toMatch(/for signers/);
  });

  it('wants an Indian mobile number when one is given', () => {
    const abroad = { ...ravi, phone: '+14155550100' };
    expect(aadhaarProblems(flow({ recipients: [abroad] }))['recipients.r_ravi.phone']).toMatch(
      /10-digit Indian mobile/,
    );
    const local = { ...ravi, phone: '+91 98123 45678' };
    expect(aadhaarProblems(flow({ recipients: [local] }))).toEqual({});
  });

  it('is part of the recipients and review steps, and survives reopening a draft', () => {
    const state = flow({
      recipients: [ravi, asha],
      fields: [signature('r_ravi'), signature('r_asha')],
    });
    expect(stepProblems('recipients', state)['recipients.r_ravi.auth']).toBeTruthy();
    expect(stepProblems('review', state)['recipients.r_ravi.auth']).toBeTruthy();
    expect(draftBody(flow({ recipients: [asha, ravi] })).recipients[1]).toMatchObject({
      auth: 'aadhaar',
    });
  });
});
