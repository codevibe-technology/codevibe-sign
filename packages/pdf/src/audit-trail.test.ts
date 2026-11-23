import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import type { AuditEvent } from '@codevibe_technology/sign-core';
import { auditTrailPdf } from './audit-trail';
import { envelope, event, pageContent, shownText } from './testing/fixtures';

async function allText(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const text: string[] = [];
  for (let index = 0; index < doc.getPageCount(); index += 1) {
    text.push(...shownText(await pageContent(bytes, index)));
  }
  return text;
}

const events: AuditEvent[] = [
  event(1, 'envelope.created', { data: { recalledFrom: 'env_old', by: 'Meera Iyer' } }),
  event(2, 'envelope.sent'),
  event(3, 'recipient.corrected', {
    recipientId: 'r1',
    data: { by: 'dev@acme.example', oldEmail: 'old@example.com', newEmail: 'new@example.com' },
  }),
  event(4, 'recipient.link_shared', { recipientId: 'r1', data: { by: 'Dev Admin' } }),
  event(5, 'recipient.viewed', {
    recipientId: 'r1',
    context: { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 (Macintosh)' },
  }),
  event(6, 'recipient.signed', { recipientId: 'r1', context: { ip: '203.0.113.9' } }),
  event(7, 'envelope.completed'),
];

describe('auditTrailPdf', () => {
  it('lists every event with its time, what happened and who did it', async () => {
    const output = await auditTrailPdf({
      envelope: envelope(),
      events,
      timeZone: 'Asia/Kolkata',
      recordUrl: 'https://sign.example.com/r/abc',
      generatedAt: '2026-11-19T11:00:00.000Z',
    });
    const text = await allText(output);
    const joined = text.join('\n');
    expect(text).toContain('Audit trail');
    expect(joined).toContain('Offer letter for Shubh Kumar');
    expect(joined).toContain('env_01J9Z6Q4');
    expect(joined).toContain('f'.repeat(64));
    expect(joined).toContain('https://sign.example.com/r/abc');
    expect(text).toContain('Time (UTC and Asia/Kolkata)');
    expect(text).toContain('2026-11-18 09:00:06 UTC');
    expect(text).toContain('2026-11-18 14:30:06 GMT+5:30 (Asia/Kolkata)');
    expect(text).toContain('Corrected copy created');
    expect(text).toContain('Link shared manually');
    expect(text).toContain('Signed');
    expect(text).toContain('Shubh Kumar');
    expect(text).toContain('Meera Iyer');
    expect(text).toContain('Dev Admin');
    expect(text).toContain('Sender');
    expect(text).toContain('System');
    expect(joined).toContain('Page 1 of 1  ·  Generated 2026-11-19 11:00:00 UTC');
  });

  it('leaves out addresses, browsers and email addresses', async () => {
    const joined = (await allText(await auditTrailPdf({ envelope: envelope(), events }))).join(
      '\n',
    );
    for (const hidden of ['203.0.113', 'Mozilla', 'old@example.com', 'new@example.com']) {
      expect(joined).not.toContain(hidden);
    }
    expect(joined).not.toContain('dev@acme.example');
    expect(joined).toContain('d****@acme.example');
  });

  it('repeats the table header on every page of a long trail', async () => {
    const many = Array.from({ length: 200 }, (_, index) =>
      event(index + 1, 'recipient.reminded', { recipientId: 'r1' }),
    );
    const output = await auditTrailPdf({ envelope: envelope(), events: many });
    const pages = (await PDFDocument.load(output)).getPageCount();
    expect(pages).toBeGreaterThan(2);
    const text = await allText(output);
    expect(text).toContain('Audit trail (continued)');
    expect(text.filter((line) => line === 'Reminder sent')).toHaveLength(200);
    expect(text.filter((line) => line === 'Event')).toHaveLength(pages);
  });

  it('replaces characters the font cannot draw instead of failing', async () => {
    const output = await auditTrailPdf({
      envelope: envelope({ title: 'नियुक्ति पत्र' }),
      events,
    });
    expect((await PDFDocument.load(output)).getPageCount()).toBe(1);
  });
});
