import { describe, expect, it } from 'vitest';
import { declineLine, eventDetail, maskEmail } from './envelopes';
import { declineNotice, renderMail, sampleInput } from './mail-templates';

describe('eventDetail', () => {
  it('names who shared a link by hand', () => {
    expect(eventDetail({ action: 'recipient.link_shared', data: { by: 'Meera' } })).toEqual({
      label: 'Link shared manually by Meera',
    });
  });

  it('shows a correction with emails partly masked', () => {
    const detail = eventDetail({
      action: 'recipient.corrected',
      data: {
        by: 'Meera',
        oldName: 'Asha',
        newName: 'Asha Rao',
        oldEmail: 'asha@example.com',
        newEmail: 'asha.rao@example.org',
        invited: true,
      },
    });
    expect(detail.label).toBe('Details corrected by Meera');
    expect(detail.note).toBe(
      'name Asha → Asha Rao; email a***@example.com → a***@example.org; new invitation sent',
    );
    expect(detail.note).not.toContain('asha.rao');
  });

  it('links a recalled or revised envelope to its copy, and the copy back', () => {
    expect(
      eventDetail({
        action: 'envelope.recalled',
        data: { by: 'Meera', replacementId: 'env_2', replacementTitle: 'Offer' },
      }),
    ).toEqual({
      label: 'Recalled to correct by Meera',
      link: { envelopeId: 'env_2', title: 'Offer', prefix: 'Replaced by' },
    });
    expect(
      eventDetail({ action: 'envelope.revised', data: { replacementId: 'env_3' } }).link,
    ).toMatchObject({ envelopeId: 'env_3' });
    expect(
      eventDetail({
        action: 'envelope.created',
        data: { recalledFrom: 'env_1', recalledFromTitle: 'Offer', by: 'Meera' },
      }),
    ).toEqual({
      label: 'Corrected copy made by Meera',
      link: { envelopeId: 'env_1', title: 'Offer', prefix: 'Copy of the recalled' },
    });
    expect(eventDetail({ action: 'envelope.created', data: { revisedFrom: 'env_1' } }).label).toBe(
      'Revision made',
    );
    expect(eventDetail({ action: 'envelope.created', data: {} })).toEqual({
      label: 'Draft created',
    });
  });

  it('masks emails', () => {
    expect(maskEmail('asha@example.com')).toBe('a***@example.com');
    expect(maskEmail('nope')).toBe('***');
  });
});

describe('declineLine', () => {
  const recipients = [
    {
      id: 'r1',
      name: 'Ravi',
      email: null,
      role: 'approver' as const,
      status: 'declined' as const,
      actedAt: null,
      declineReason: 'Salary is wrong',
    },
  ];
  it('says who declined and why, for declined envelopes only', () => {
    expect(declineLine({ status: 'declined', recipients })).toBe(
      'Declined by Ravi: Salary is wrong',
    );
    expect(
      declineLine({ status: 'declined', recipients: [{ ...recipients[0]!, declineReason: null }] }),
    ).toBe('Declined by Ravi');
    expect(declineLine({ status: 'sent', recipients })).toBeNull();
  });
});

describe('mail for revisions', () => {
  const brand = { company: 'Acme', brandColor: '#0F766E', logoUrl: null, showBadge: false };

  it('puts what changed in the invitation and reminder', () => {
    for (const kind of ['invite', 'reminder'] as const) {
      const mail = renderMail(
        kind,
        { ...sampleInput(kind), changeNote: 'Notice is 30 days' },
        brand,
      );
      expect(mail.text).toContain('What changed: Notice is 30 days');
      expect(mail.html).toContain('What changed: Notice is 30 days');
    }
  });

  it('tells the sender who declined, their role and reason in full', () => {
    const mail = declineNotice({
      senderName: 'Meera',
      title: 'Offer letter',
      declinedBy: 'Satyam Patel',
      role: 'approver',
      reason: 'The <notice> period is wrong',
      url: 'https://sign.example.com/dashboard/acme/envelopes/env_1',
    });
    expect(mail.subject).toBe('Declined: Offer letter');
    expect(mail.text).toContain('Satyam Patel (approver) declined “Offer letter”.');
    expect(mail.text).toContain('Their reason: The <notice> period is wrong');
    expect(mail.html).toContain('The &lt;notice&gt; period is wrong');
    expect(mail.text).toContain('https://sign.example.com/dashboard/acme/envelopes/env_1');
  });
});
