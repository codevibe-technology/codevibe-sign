import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { SignError, type AuditEvent, type Recipient } from '@codevibe/sign-core';
import { appendCertificate } from './certificate';
import { sha256Hex } from './inspect';
import {
  A4,
  document,
  envelope,
  event,
  makePdf,
  pageContent,
  recipient,
  shownText,
} from './testing/fixtures';

const signer = recipient({ status: 'signed' });
const approver = recipient({
  id: 'r2',
  name: 'Asha Rao',
  email: undefined,
  phone: '+919876543210',
  role: 'approver',
  order: 2,
  auth: 'sms_otp',
  status: 'approved',
});

const events: AuditEvent[] = [
  event(1, 'envelope.created'),
  event(2, 'envelope.sent'),
  event(3, 'recipient.notified', { recipientId: 'r1' }),
  event(4, 'recipient.viewed', {
    recipientId: 'r1',
    context: { ip: '203.0.113.7', userAgent: 'Viewer/1.0' },
  }),
  event(5, 'recipient.signed', {
    recipientId: 'r1',
    context: { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (Macintosh) Safari/605.1.15' },
  }),
  event(6, 'recipient.approved', { recipientId: 'r2', context: { ip: '198.51.100.4' } }),
  event(7, 'envelope.completed'),
];

async function certificateText(bytes: Uint8Array, firstPage: number): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const text: string[] = [];
  for (let index = firstPage; index < doc.getPageCount(); index += 1) {
    text.push(...shownText(await pageContent(bytes, index)));
  }
  return text;
}

async function rejection(promise: Promise<unknown>): Promise<SignError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SignError);
  return error as SignError;
}

describe('appendCertificate', () => {
  it('appends A4 pages after the document', async () => {
    const pdf = await makePdf([{ size: A4 }, { size: [612, 792] }]);
    const output = await appendCertificate(pdf, {
      envelope: envelope({ recipients: [signer, approver] }),
      document: document({ pageCount: 2 }),
      events,
    });
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    const size = doc.getPage(2).getSize();
    expect(size.width).toBeCloseTo(595.28);
    expect(size.height).toBeCloseTo(841.89);
  });

  it('records the envelope, both hashes, recipients and the audit chain', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const output = await appendCertificate(pdf, {
      envelope: envelope({ recipients: [signer, approver] }),
      document: document(),
      events,
      generatedAt: '2026-11-19T11:00:00.000Z',
    });
    const text = (await certificateText(output, 1)).join('\n');

    expect(text).toContain('Signing certificate');
    expect(text).toContain('env_01J9Z6Q4');
    expect(text).toContain('Offer letter for Shubh Kumar');
    expect(text).toContain('Offer letter.pdf');
    expect(text).toContain('a'.repeat(64));
    expect(text).toContain(sha256Hex(pdf));
    expect(text).toContain('f'.repeat(64));

    expect(text).toContain('Shubh Kumar · Signer');
    expect(text).toContain('s****@example.com');
    expect(text).not.toContain('shubh@example.com');
    expect(text).toContain('Asha Rao · Approver');
    expect(text).toContain('+91******3210');
    expect(text).toContain('One-time code by SMS');

    // The signing event's network details win over the earlier view.
    expect(text).toContain('203.0.113.9');
    expect(text).not.toContain('203.0.113.7');
    expect(text).toContain('Mozilla/5.0 (Macintosh) Safari/605.1.15');
    expect(text).toContain('2026-11-18 09:00:04 UTC');
    expect(text).toContain('2026-11-18 09:00:05 UTC');

    expect(text).toContain('Envelope created');
    expect(text).toContain('Sender');
    expect(text).toContain('System');
    expect(text).toContain('Page 2 of 2  ·  Generated 2026-11-19 11:00:00 UTC');
  });

  it("adds the integrator's time zone next to UTC", async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const output = await appendCertificate(pdf, {
      envelope: envelope(),
      document: document(),
      events,
      timeZone: 'Asia/Kolkata',
    });
    const text = (await certificateText(output, 1)).join('\n');
    expect(text).toContain('2026-11-18 09:00:05 UTC / 2026-11-18 14:30:05 GMT+5:30 (Asia/Kolkata)');
    expect(text).toContain('Time (UTC / Asia/Kolkata)');
  });

  it('shows declines with their reason', async () => {
    const declined = recipient({ status: 'declined', declineReason: 'Wrong joining date' });
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope({ status: 'declined', recipients: [declined], completedAt: undefined }),
      document: document(),
      events: [event(1, 'recipient.declined', { recipientId: 'r1' })],
    });
    const text = (await certificateText(output, 1)).join('\n');
    expect(text).toContain('Declined');
    expect(text).toContain('Wrong joining date');
    expect(text).not.toContain('Not yet');
  });

  it('flows many recipients and events over several pages', async () => {
    const recipients: Recipient[] = Array.from({ length: 25 }, (_, index) =>
      recipient({
        id: `r${index}`,
        name: `Signer number ${index}`,
        email: `person${index}@example.com`,
        order: index,
      }),
    );
    const many: AuditEvent[] = Array.from({ length: 300 }, (_, index) =>
      event(index + 1, 'recipient.reminded', { recipientId: `r${index % 25}` }),
    );
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope({ recipients }),
      document: document(),
      events: many,
    });
    const doc = await PDFDocument.load(output);
    const pages = doc.getPageCount() - 1;
    expect(pages).toBeGreaterThan(5);

    const text = await certificateText(output, 1);
    expect(text).toContain('Signing certificate (continued)');
    expect(text.some((line) => line.startsWith(`Page ${pages} of ${pages}`))).toBe(true);
    expect(text.filter((line) => line === 'Reminder sent')).toHaveLength(300);
    expect(text).toContain('Signer number 24 · Signer');
    // The table header repeats on every page it spans.
    expect(text.filter((line) => line === 'Action').length).toBeGreaterThan(2);
  });

  it('wraps long values instead of running off the page', async () => {
    const userAgent = `Mozilla/5.0 ${'X'.repeat(400)}`;
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope(),
      document: document({ name: `Very long document name ${'word '.repeat(60)}.pdf` }),
      events: [event(1, 'recipient.signed', { recipientId: 'r1', context: { userAgent } })],
    });
    const content = await pageContent(output, 1);
    const xs = [...content.matchAll(/[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ ([\d.-]+) [\d.-]+ Tm/g)].map(
      (m) => Number(m[1]),
    );
    expect(Math.max(...xs)).toBeLessThan(595.28 - 48);
    const pieces = shownText(content).filter(
      (line) => /^X+$/.test(line) || line.startsWith('Mozilla'),
    );
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces.join('').replace('Mozilla/5.0', '')).toBe('X'.repeat(400));
  });

  it('asks for a custom font for names outside Latin script', async () => {
    const error = await rejection(
      appendCertificate(await makePdf([{ size: A4 }]), {
        envelope: envelope({ recipients: [recipient({ name: 'शुभ कुमार' })] }),
        document: document(),
        events,
      }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.details).toMatchObject({ option: 'font' });
  });

  it('rejects an unknown time zone and unreadable input', async () => {
    const data = { envelope: envelope(), document: document(), events };
    const pdf = await makePdf([{ size: A4 }]);
    expect(
      (await rejection(appendCertificate(pdf, { ...data, timeZone: 'Nowhere/City' }))).code,
    ).toBe('VALIDATION');
    expect((await rejection(appendCertificate(new Uint8Array([1, 2, 3]), data))).code).toBe(
      'DOCUMENT_INVALID',
    );
  });
});
