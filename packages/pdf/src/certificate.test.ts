import jsQR from 'jsqr';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { SignError, type AuditEvent, type Recipient } from '@codevibe_technology/sign-core';
import { extractText } from './testing/extract';
import { appendCertificate, certificatePdf, type CertificateData } from './certificate';
import { authLabel } from './certificate-text';
import { lockupWidth } from './lockup';
import { LOCKUP } from './lockup-paths';
import {
  A4,
  document,
  envelope,
  event,
  makePdf,
  pageContent,
  qrPixels,
  recipient,
  shownText,
} from './testing/fixtures';

const PAGE = { width: A4[0], height: A4[1] };
const RECORD_URL = 'https://sign.example.com/r/Zk3vQ9xLm2Tn8RbYc4Wd7HsA';

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

const signers = (count: number): Recipient[] =>
  Array.from({ length: count }, (_, index) =>
    recipient({
      id: `r${index}`,
      name: `Signer number ${index}`,
      email: `person${index}@example.com`,
      order: index,
    }),
  );

const signedBy = (recipients: Recipient[]): AuditEvent[] =>
  recipients.map((r, index) => event(index + 1, 'recipient.signed', { recipientId: r.id }));

async function certificateText(bytes: Uint8Array, firstPage: number): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  const text: string[] = [];
  for (let index = firstPage; index < doc.getPageCount(); index += 1) {
    text.push(...shownText(await pageContent(bytes, index)));
  }
  return text;
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  return (await PDFDocument.load(bytes)).getPageCount();
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
  it('certifies the file an Aadhaar eSign signer is about to sign', async () => {
    const ravi = recipient({
      id: 'r3',
      name: 'Ravi Kumar',
      email: 'ravi@example.com',
      order: 2,
      auth: 'aadhaar',
      status: 'viewed',
      actedAt: undefined,
    });
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope({
        status: 'in_progress',
        completedAt: undefined,
        recipients: [signer, ravi],
      }),
      document: document(),
      events: events.slice(0, 5),
      recordUrl: RECORD_URL,
      esign: { recipientId: 'r3', provider: 'leegality' },
    });
    expect(await pageCount(output)).toBe(2);
    const text = (await certificateText(output, 1)).join(' ');
    expect(text).toContain('Completed by the Aadhaar eSign of Ravi Kumar on this file');
    expect(text).toContain('Aadhaar eSign (via Leegality)');
    expect(text).toContain('With the Aadhaar eSign on this file');
    expect(text).toContain('The time is in the digital signature');
    expect(text).toContain('One-time code by email');
    expect(text).toContain('2026-11-18 09:00:05 UTC');
    expect(text).toContain('signed with Aadhaar eSign and then sealed');
    expect(text).not.toContain('chain head');
  });

  it('prints the facts of the signing on one page', async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const output = await appendCertificate(pdf, {
      envelope: envelope({ recipients: [signer, approver] }),
      document: document(),
      events,
      timeZone: 'Asia/Kolkata',
      sender: { name: 'Meera Iyer', organization: 'Acme Pvt Ltd', email: 'meera@acme.example' },
      recordUrl: RECORD_URL,
      generatedAt: '2026-11-19T11:00:00.000Z',
    });
    expect(await pageCount(output)).toBe(2);
    const size = (await PDFDocument.load(output)).getPage(1).getSize();
    expect(size.width).toBeCloseTo(595.28);
    expect(size.height).toBeCloseTo(841.89);

    const text = (await certificateText(output, 1)).join('\n');
    expect(text).toContain('Signing certificate');
    expect(text).toContain('Offer letter for Shubh Kumar');
    expect(text).toContain('Offer letter.pdf · 1 page');
    expect(text).toContain('env_01J9Z6Q4');
    expect(text).toContain('Completed');
    expect(text).toContain('19 Nov 2026 15:45 GMT+5:30 (Asia/Kolkata)');
    expect(text).toContain('2026-11-19 10:15:03 UTC');
    expect(text).toContain('Meera Iyer, Acme Pvt Ltd');
    expect(text).toContain('m****@acme.example');
    expect(text).not.toContain('meera@acme.example');

    expect(text).toContain('Shubh Kumar');
    expect(text).toContain('s****@example.com');
    expect(text).not.toContain('shubh@example.com');
    expect(text).toContain('One-time code by email');
    expect(text).toContain('18 Nov 2026 14:30 GMT+5:30');
    expect(text).toContain('2026-11-18 09:00:05 UTC');
    expect(text).toContain('Asha Rao');
    expect(text).toContain('Approver');
    expect(text).toContain('+91******3210');
    expect(text).toContain('One-time code by SMS');

    expect(text).toContain('aaaaaaaa ... aaaaaaaa');
    expect(text).toContain('a'.repeat(64));
    expect(text).toContain('Audit trail when sealed: 7 events, chain head');
    expect(text).toContain('f'.repeat(64));
    expect(text).not.toContain(RECORD_URL);
    expect(text).not.toContain('https://');
    expect(text).not.toContain('Public record');
    expect(text).toContain('Scan to check this document');
    expect(text).toContain('Signing certificate provided by:');
    expect(text).toContain('Page 1 of 1  ·  Generated 2026-11-19 11:00:00 UTC');
  });

  it('leaves out network details and the list of events', async () => {
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope({ recipients: [signer, approver] }),
      document: document(),
      events,
    });
    const text = (await certificateText(output, 1)).join('\n');
    for (const hidden of ['203.0.113', '198.51.100', 'Mozilla', 'Viewer/1.0', 'IP address']) {
      expect(text).not.toContain(hidden);
    }
    expect(text).not.toContain('User agent');
    expect(text).not.toContain('Envelope created');
    expect(text).not.toContain('Document viewed');
  });

  it('fits six signers, the fingerprint and the code on one page', async () => {
    const recipients = signers(6);
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope({ recipients }),
      document: document(),
      events: signedBy(recipients),
      timeZone: 'Asia/Kolkata',
      sender: { name: 'Meera Iyer', email: 'meera@acme.example' },
      recordUrl: RECORD_URL,
      note: 'Acme Pvt Ltd, CIN U72900KA2020PTC000000',
    });
    expect(await pageCount(output)).toBe(2);
    const content = await pageContent(output, 1);
    const baselines = [...content.matchAll(/[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ ([\d.-]+) Tm/g)]
      .map((m) => Number(m[1]))
      .filter((y) => y > 40);
    // Everything but the footer line sits above the bottom margin.
    expect(Math.min(...baselines)).toBeGreaterThan(44 + 30);
    const text = shownText(content);
    expect(text).toContain('Signer number 5');
    expect(text).toContain('Document fingerprint');
    expect(text).toContain('Acme Pvt Ltd, CIN U72900KA2020PTC000000');
  });

  it('continues on further pages when there are many signers', async () => {
    const recipients = signers(40);
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope({ recipients }),
      document: document(),
      events: signedBy(recipients),
      recordUrl: RECORD_URL,
    });
    const pages = (await pageCount(output)) - 1;
    expect(pages).toBeGreaterThan(1);
    expect(pages).toBeLessThan(5);

    const text = await certificateText(output, 1);
    expect(text).toContain('Signing certificate (continued)');
    expect(text.some((line) => line.startsWith(`Page ${pages} of ${pages}`))).toBe(true);
    for (let index = 0; index < 40; index += 1) {
      expect(text.filter((line) => line === `Signer number ${index}`)).toHaveLength(1);
    }
    // The table header repeats on every page; the fingerprint and the code appear once.
    expect(text.filter((line) => line === 'Method')).toHaveLength(pages);
    expect(text.filter((line) => line === 'Document fingerprint')).toHaveLength(1);
    expect(qrPixels(await pageContent(output, 1))).not.toBeNull();
    expect(qrPixels(await pageContent(output, 2))).toBeNull();
    for (let page = 1; page <= pages; page += 1) {
      const ys = [
        ...(await pageContent(output, page)).matchAll(
          /[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ ([\d.-]+) Tm/g,
        ),
      ].map((m) => Number(m[1]));
      expect(Math.min(...ys)).toBeGreaterThan(20);
    }
  });

  it('draws a QR code that reads as the record link, and makes the code the link', async () => {
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope(),
      document: document(),
      events,
      recordUrl: RECORD_URL,
    });
    const pixels = qrPixels(await pageContent(output, 1));
    expect(pixels).not.toBeNull();
    const decoded = jsQR(pixels!.data, pixels!.width, pixels!.height);
    expect(decoded?.data).toBe(RECORD_URL);

    const page = (await PDFDocument.load(output)).getPage(1);
    const annotations = page.node.lookup(PDFName.of('Annots'), PDFArray);
    const link = annotations.lookup(0, PDFDict);
    expect(link.lookup(PDFName.of('Subtype'))).toBe(PDFName.of('Link'));
    const action = link.lookup(PDFName.of('A'), PDFDict);
    expect(action.lookup(PDFName.of('URI'), PDFString).asString()).toBe(RECORD_URL);
    const rect = link.lookup(PDFName.of('Rect'), PDFArray).asRectangle();
    expect(rect.width).toBeCloseTo(104);
    expect(rect.height).toBeCloseTo(104);
    expect(rect.x + rect.width).toBeCloseTo(PAGE.width - 44);
  });

  it('ends the side column with a small Codevibe Sign lockup centred under the code', async () => {
    for (const recordUrl of [RECORD_URL, undefined]) {
      const output = await appendCertificate(await makePdf([{ size: A4 }]), {
        envelope: envelope(),
        document: document(),
        events,
        ...(recordUrl ? { recordUrl } : {}),
      });
      const content = await pageContent(output, 1);
      expect(shownText(content)).toContain('Signing certificate provided by:');
      // Navy "codevibe", blue "sign" and the blue and teal strokes of the mark.
      expect(content).toMatch(/0\.05098\d* 0\.10588\d* 0\.16470?\d* rg/);
      expect(content).toMatch(/0\.10588\d* 0\.41568\d* 0\.87843\d* rg/);
      expect(content).toMatch(/0\.10588\d* 0\.41568\d* 0\.87843\d* RG/);
      expect(content).toMatch(/0\.17647\d* 0\.83137\d* 0\.74901\d* RG/);
      // Each path is placed with a move, a turn and a flip of the y axis.
      const placed = [
        ...content.matchAll(
          /1 0 0 1 ([\d.-]+) ([\d.-]+) cm\s+1 0 0 1 0 0 cm\s+([\d.]+) 0 0 -[\d.]+ 0 0 cm/g,
        ),
      ].map((m) => ({ x: Number(m[1]), y: Number(m[2]), scale: Number(m[3]) }));
      expect(placed.length).toBeGreaterThanOrEqual(5);
      const right = PAGE.width - 44;
      const width = lockupWidth(12);
      // The lockup is about a line and a half of text tall and fits inside the code's width.
      expect(width).toBeLessThan(104);
      expect(Math.max(...placed.map((p) => p.scale)) * LOCKUP.height).toBeCloseTo(12);
      for (const { x, y } of placed) {
        expect(x).toBeCloseTo(right - 104 + (104 - width) / 2);
        // Under the code when there is one, at the top of the column when there is not.
        expect(y).toBeLessThan(PAGE.height - 44 - (recordUrl ? 104 : 0));
        expect(y).toBeGreaterThan(PAGE.height - 44 - 200);
      }
    }
  });

  it('has no code and no link without a record', async () => {
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope(),
      document: document(),
      events,
    });
    const content = await pageContent(output, 1);
    expect(qrPixels(content)).toBeNull();
    const text = shownText(content).join('\n');
    expect(text).not.toContain('Public record');
    expect(text).not.toContain('Scan');
    expect(text).toContain('Signing certificate provided by:');
    const page = (await PDFDocument.load(output)).getPage(1);
    expect(page.node.Annots()?.size() ?? 0).toBe(0);
  });

  it('refuses a record link that is not a URL', async () => {
    const data: CertificateData = {
      envelope: envelope(),
      document: document(),
      events,
      recordUrl: 'r/abc',
    };
    const error = await rejection(appendCertificate(await makePdf([{ size: A4 }]), data));
    expect(error.code).toBe('VALIDATION');
    expect(error.details).toMatchObject({ field: 'recordUrl' });
  });

  it("prints the sender's note at the end, on one line", async () => {
    const pdf = await makePdf([{ size: A4 }]);
    const output = await appendCertificate(pdf, {
      envelope: envelope({ recipients: [signer] }),
      document: document(),
      events,
      note: 'Acme Pvt Ltd\nCIN U72900KA2020PTC000000 ✓',
    });
    const text = (await certificateText(output, 1)).join('\n');
    expect(text).toContain('Acme Pvt Ltd CIN U72900KA2020PTC000000 ?');
  });

  it('says the file is sealed and nothing about PDF reader warnings', async () => {
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope(),
      document: document(),
      events,
    });
    const text = (await certificateText(output, 1)).join(' ');
    expect(text).toContain('sealed with a digital signature');
    expect(text).not.toMatch(/adobe|acrobat|unknown|trust/i);
  });

  it('shows the time in UTC alone without a time zone', async () => {
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope(),
      document: document(),
      events,
    });
    const text = await certificateText(output, 1);
    expect(text).toContain('2026-11-19 10:15:03 UTC');
    expect(text).toContain('Signed (UTC)');
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
    expect(text).toContain('Reason: Wrong joining date');
    expect(text).not.toContain('Not yet');
  });

  it('wraps long values instead of running off the page', async () => {
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope({ title: `Agreement ${'word '.repeat(80)}` }),
      document: document({ name: `${'X'.repeat(400)}.pdf` }),
      events,
      recordUrl: RECORD_URL,
    });
    const content = await pageContent(output, 1);
    const xs = [...content.matchAll(/[\d.-]+ [\d.-]+ [\d.-]+ [\d.-]+ ([\d.-]+) [\d.-]+ Tm/g)].map(
      (m) => Number(m[1]),
    );
    expect(Math.max(...xs)).toBeLessThan(595.28 - 44);
    const pieces = shownText(content).filter((line) => /^X+/.test(line));
    expect(pieces.length).toBeGreaterThan(2);
  });

  it('draws names outside Latin script with the bundled fonts', async () => {
    const output = await appendCertificate(await makePdf([{ size: A4 }]), {
      envelope: envelope({ recipients: [recipient({ name: 'शुभ कुमार' })] }),
      document: document(),
      events,
    });
    expect((await extractText(output)).join(' ')).toContain('शुभ कुमार');
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

describe('certificatePdf', () => {
  const data: CertificateData = {
    envelope: envelope({ recipients: [signer, approver] }),
    document: document(),
    events,
    recordUrl: RECORD_URL,
  };

  it('makes the certificate a one-page file of its own', async () => {
    const output = await certificatePdf(data);
    const doc = await PDFDocument.load(output);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Signing certificate: Offer letter for Shubh Kumar');
    const text = (await certificateText(output, 0)).join(' ');
    expect(text).toContain('Shubh Kumar');
    expect(text).toContain('This certificate summarises a completed signing.');
    expect(text).not.toContain('203.0.113');
    expect(text).not.toContain(RECORD_URL);
    expect(text).toContain('Signing certificate provided by:');
    const pixels = qrPixels(await pageContent(output, 0));
    expect(jsQR(pixels!.data, pixels!.width, pixels!.height)?.data).toBe(RECORD_URL);
  });

  it('names the provider an Aadhaar eSign went through', async () => {
    const aadhaar = recipient({
      status: 'signed',
      auth: 'aadhaar',
      esign: { provider: 'leegality', status: 'signed', signerName: 'SHUBH KUMAR' },
    });
    const output = await certificatePdf({
      ...data,
      envelope: envelope({ ...data.envelope, recipients: [aadhaar] }),
    });
    const text = (await certificateText(output, 0)).join(' ').replace(/\s+/g, ' ');
    expect(text).toContain('Aadhaar eSign (via Leegality)');
    expect(authLabel({ auth: 'aadhaar' })).toBe('Aadhaar eSign');
    expect(authLabel({ auth: 'aadhaar', esign: { ...aadhaar.esign!, sandbox: true } })).toBe(
      'Aadhaar eSign (via Leegality sandbox, test only)',
    );
    expect(authLabel({ auth: 'email_link', esign: aadhaar.esign })).toBe('Email link');
  });

  it('puts the certificates of several documents in one file', async () => {
    const output = await certificatePdf([
      data,
      { ...data, document: document({ id: 'd2', name: 'Annexure.pdf', sha256: 'b'.repeat(64) }) },
    ]);
    expect(await pageCount(output)).toBe(2);
    const second = shownText(await pageContent(output, 1)).join(' ');
    expect(second).toContain('Annexure.pdf');
    expect(second).toContain('b'.repeat(64));
  });
});
