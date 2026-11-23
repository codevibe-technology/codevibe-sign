import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditTrailPdf } from './audit-trail';
import { appendCertificate, certificatePdf, type CertificateData } from './certificate';
import { renderFields } from './render';
import { seal } from './seal';
import { extractText, SAMPLE_NAMES } from './testing/extract';
import {
  A4,
  document,
  envelope,
  event,
  field,
  makePdf,
  pngBase64,
  recipient,
} from './testing/fixtures';
import { createTestP12, type TestP12 } from './testing/p12';
import { verifySeal } from './verify';

const recipients = SAMPLE_NAMES.map((name, index) =>
  recipient({
    id: `r${index}`,
    name,
    email: `p${index}@example.com`,
    order: index,
    status: 'signed',
    actedAt: '2026-11-19T10:15:00.000Z',
  }),
);
const events = recipients.map((entry, index) =>
  event(index + 1, 'recipient.signed', { recipientId: entry.id }),
);
const data = (names = recipients): CertificateData => ({
  envelope: envelope({
    title: 'नियुक्ति पत्र – Offer letter',
    recipients: names,
    status: 'completed',
    completedAt: '2026-11-19T10:15:00.000Z',
  }),
  document: document({ name: 'ऑफ़र-लेटर.pdf' }),
  events,
  timeZone: 'Asia/Kolkata',
  sender: { name: 'गीता शर्मा', organization: 'அகரம் Pvt Ltd', email: 'geeta@example.com' },
  note: 'पंजीकृत कार्यालय, Pune',
});

/** Items in reading order; readers split a line where the font changes. */
const joined = (text: string[]) => text.join(' ').replace(/\s+/g, ' ');
const expectAllNames = (text: string[]) => {
  for (const name of SAMPLE_NAMES) {
    expect(joined(text)).toContain(name);
  }
  expect(joined(text)).not.toContain('?');
};

let base: Uint8Array;
let identity: TestP12;

beforeAll(async () => {
  base = await makePdf([{ size: A4 }]);
  identity = createTestP12({ commonName: 'Codevibe Sign Seal' });
});

describe('names and titles in Indian scripts, Arabic and extended Latin', () => {
  it('appear on the appended certificate as typed', async () => {
    const text = await extractText(await appendCertificate(base, data()));
    expectAllNames(text);
    expect(joined(text)).toContain('नियुक्ति पत्र');
    expect(joined(text)).toContain('गीता शर्मा, அகரம் Pvt Ltd');
    expect(joined(text)).toContain('पंजीकृत कार्यालय, Pune');
  });

  it('appear on the standalone certificate and the audit trail', async () => {
    expectAllNames(await extractText(await certificatePdf(data())));
    const trail = await extractText(
      await auditTrailPdf({ envelope: data().envelope, events, timeZone: 'Asia/Kolkata' }),
    );
    expect(joined(trail)).toContain('नियुक्ति पत्र');
    expectAllNames(trail);
  });

  it('are drawn in name fields and under signatures', async () => {
    const fields = recipients.flatMap((entry, index) => [
      field('signature', {
        id: `s${index}`,
        recipientId: entry.id,
        rect: { x: 40, y: 40 + index * 62, width: 220, height: 56 },
      }),
      field('name', {
        id: `n${index}`,
        recipientId: entry.id,
        rect: { x: 300, y: 50 + index * 62, width: 220, height: 24 },
      }),
    ]);
    const values = recipients.map((_, index) => ({
      fieldId: `s${index}`,
      value: pngBase64(60, 20),
    }));
    const text = await extractText(
      await renderFields(base, fields, values, recipients, { timeZone: 'Asia/Kolkata' }),
    );
    expectAllNames(text);
    expect(joined(text)).toContain('आशा राव, 19 Nov 2026 15:45 GMT+5:30');
  });

  it('keep the seal valid', async () => {
    const certified = await appendCertificate(base, data());
    const sealed = await seal(certified, { p12: identity.p12, passphrase: identity.passphrase });
    expect(await verifySeal(sealed)).toMatchObject({
      sealed: true,
      valid: true,
      coversWholeDocument: true,
    });
  });

  it('stay within the size budget', async () => {
    const latin = recipients.map((entry, index) => ({ ...entry, name: `Signer ${index}` }));
    const plain = (await certificatePdf(data(latin))).byteLength;
    const devanagari = (
      await certificatePdf(data(latin.map((entry) => ({ ...entry, name: 'आशा राव' }))))
    ).byteLength;
    const everyScript = (await certificatePdf(data())).byteLength;
    expect(devanagari - plain).toBeLessThan(25_000);
    expect(everyScript - plain).toBeLessThan(60_000);
  });

  it('leave Latin-only certificates without embedded fonts', async () => {
    const latin = recipients.map((entry, index) => ({ ...entry, name: `Signer ${index}` }));
    const bytes = await certificatePdf({
      ...data(latin),
      envelope: envelope({ recipients: latin }),
      document: document(),
      sender: { name: 'Geeta Sharma' },
      note: 'Pune',
    });
    expect(Buffer.from(bytes).toString('latin1')).not.toContain('FontFile2');
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
