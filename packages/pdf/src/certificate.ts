import { PDFDocument, PDFString } from 'pdf-lib';
import {
  SignError,
  type AuditEvent,
  type Document,
  type Envelope,
  type IsoDateTime,
  type Recipient,
} from '@codevibe_technology/sign-core';
import { AUTH_LABELS, ROLE_LABELS, STATUS_LABELS, shortHash } from './certificate-text';
import { canEncode, embedFonts, encodable, type FontSet } from './fonts';
import { loadPdf } from './inspect';
import { maskEmail, maskPhone } from './mask';
import { A4, CONTENT_WIDTH, MARGIN, PageFlow, type Box, type Part } from './page-flow';
import { drawQr, qrModules } from './qr';
import { assertTimeZone, formatSigningTime, formatUtc, parseDate } from './time';

/** Who sent the envelope, as the certificate names them. */
export interface CertificateSender {
  name: string;
  /** The company or workspace the sender acts for. */
  organization?: string;
  /** Printed masked, for example `m****@example.com`. */
  email?: string;
}

export interface CertificateData {
  envelope: Envelope;
  /** The document this file was produced from; its `sha256` is the original file's hash. */
  document: Document;
  /** The envelope's audit events, in order. */
  events: AuditEvent[];
  /** IANA time zone shown next to UTC, for example "Asia/Kolkata". */
  timeZone?: string;
  /** When the certificate was produced. Defaults to now. */
  generatedAt?: IsoDateTime;
  sender?: CertificateSender;
  /**
   * Link to a page that shows this signing's record and audit trail. Printed as a QR code
   * and as text.
   */
  recordUrl?: string;
  /**
   * A short line from whoever sent the envelope, printed at the end, for example a company
   * registration number. Characters the font cannot draw become `?` rather than failing.
   */
  note?: string;
}

export interface CertificateOptions {
  /** TrueType or OpenType font for names and titles outside Latin script. */
  font?: Uint8Array;
  /** Largest accepted input PDF, in bytes. Defaults to 25 MB. */
  maxBytes?: number;
}

const QR_SIZE = 104;
const QR_GUTTER = 20;

const SEALED_FILE_LINE =
  'This file is sealed with a digital signature that covers every page, including this one. ' +
  'Any change made after sealing breaks the seal.';
const STANDALONE_LINE =
  'This certificate summarises a completed signing. The signed document is sealed with a ' +
  'digital signature, and any change made to it after sealing breaks the seal.';

interface Acted {
  actedAt?: string;
  declinedAt?: string;
}

/** When each recipient signed, approved or declined, from the audit events. */
function actionsByRecipient(events: AuditEvent[]): Map<string, Acted> {
  const result = new Map<string, Acted>();
  for (const event of events) {
    if (!event.recipientId) {
      continue;
    }
    const acted = result.get(event.recipientId) ?? {};
    result.set(event.recipientId, acted);
    if (event.action === 'recipient.signed' || event.action === 'recipient.approved') {
      acted.actedAt = event.at;
    }
    if (event.action === 'recipient.declined') {
      acted.declinedAt = event.at;
    }
  }
  return result;
}

function contact(recipient: Recipient): string {
  if (recipient.email) {
    return maskEmail(recipient.email);
  }
  return recipient.phone ? maskPhone(recipient.phone) : '';
}

function addLink(doc: PDFDocument, box: Box, width: number, url: string): void {
  const annotation = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [box.x, box.bottom, box.x + width, box.top],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    }),
  );
  box.page.node.addAnnot(annotation);
}

function drawCertificate(
  doc: PDFDocument,
  fonts: FontSet,
  data: CertificateData,
  closing: string,
): void {
  const { envelope, document, events, timeZone } = data;
  if (timeZone) {
    assertTimeZone(timeZone);
  }
  const human = (value: string, what: string): string => {
    if (!canEncode(fonts.regular, value)) {
      throw new SignError(
        'VALIDATION',
        `The ${what} uses characters the standard font cannot draw. Pass a font that covers them in options.font.`,
        { option: 'font', value },
      );
    }
    return value;
  };
  const machine = (value: string) => encodable(fonts.regular, value);
  const modules = data.recordUrl ? qrModules(data.recordUrl) : undefined;
  const recordUrl = data.recordUrl && modules ? new URL(data.recordUrl).href : undefined;

  const flow = new PageFlow(doc, fonts, 'Signing certificate');
  const body = flow.style('body');
  const small = flow.style('small');
  const zoned = timeZone !== undefined && timeZone !== 'UTC';

  /** The time in the workspace's zone with UTC under it, or UTC alone. */
  const moment = (value: string, nameZone = false): Part[] => {
    const date = parseDate(value);
    if (!date) {
      return [{ text: machine(value), style: body }];
    }
    if (!zoned) {
      return [{ text: formatUtc(date), style: body }];
    }
    return [
      {
        text: machine(formatSigningTime(value, timeZone) + (nameZone ? ` (${timeZone})` : '')),
        style: body,
      },
      { text: formatUtc(date), style: small },
    ];
  };

  flow.newPage();
  const top = flow.y;
  const first = flow.page;
  const summaryWidth = modules ? CONTENT_WIDTH - QR_SIZE - QR_GUTTER : CONTENT_WIDTH;

  flow.field(
    'Document',
    [
      { text: human(envelope.title, 'envelope title'), style: flow.style('strong') },
      {
        text: `${human(document.name, 'document name')} · ${document.pageCount} ${document.pageCount === 1 ? 'page' : 'pages'}`,
        style: small,
      },
    ],
    summaryWidth,
  );
  flow.field(
    'Envelope ID',
    [{ text: machine(envelope.id), style: flow.style('mono') }],
    summaryWidth,
  );
  flow.field('Status', [{ text: STATUS_LABELS[envelope.status], style: body }], summaryWidth);
  if (envelope.completedAt) {
    flow.field('Completed', moment(envelope.completedAt, true), summaryWidth);
  } else if (envelope.sentAt) {
    flow.field('Sent', moment(envelope.sentAt, true), summaryWidth);
  }
  if (data.sender) {
    const { name, organization, email } = data.sender;
    const who = organization && organization !== name ? `${name}, ${organization}` : name;
    flow.field(
      'Sender',
      [
        { text: machine(who), style: body },
        ...(email ? [{ text: machine(maskEmail(email)), style: small }] : []),
      ],
      summaryWidth,
    );
  }

  if (modules && recordUrl) {
    const x = A4.width - MARGIN - QR_SIZE;
    drawQr(first, modules, { x, top, size: QR_SIZE });
    const caption = 'Scan to check this document';
    first.drawText(caption, {
      x: x + (QR_SIZE - small.font.widthOfTextAtSize(caption, small.size)) / 2,
      y: top - QR_SIZE - small.size - 2,
      size: small.size,
      font: small.font,
      color: small.color,
    });
    if (flow.page === first) {
      flow.y = Math.min(flow.y, top - QR_SIZE - small.size - 10);
    }
    const link = flow.style('link');
    const box = flow.field('Public record', [{ text: recordUrl, style: link }]);
    const width = Math.min(box.width, link.font.widthOfTextAtSize(recordUrl, link.size));
    addLink(doc, box, width, recordUrl);
  }

  flow.section('Signers', 60);
  const acted = actionsByRecipient(events);
  const recipients = [...envelope.recipients].sort((a, b) => a.order - b.order);
  const widths = { name: 150, contact: 120, method: 105 };
  flow.table(
    [
      { title: 'Name', width: widths.name },
      { title: 'Email or phone', width: widths.contact },
      { title: 'Method', width: widths.method },
      {
        title: zoned ? `Signed (${timeZone} and UTC)` : 'Signed (UTC)',
        width: CONTENT_WIDTH - widths.name - widths.contact - widths.method,
      },
    ],
    recipients.map((recipient) => {
      const seen = acted.get(recipient.id) ?? {};
      const done =
        seen.actedAt ??
        (recipient.status === 'signed' || recipient.status === 'approved'
          ? recipient.actedAt
          : undefined);
      const declined =
        seen.declinedAt ?? (recipient.status === 'declined' ? recipient.actedAt : undefined);
      let when: Part[];
      if (declined) {
        when = [{ text: 'Declined', style: body }, ...moment(declined)];
        if (recipient.declineReason) {
          when.push({
            text: `Reason: ${human(recipient.declineReason, 'decline reason')}`,
            style: small,
          });
        }
      } else if (done) {
        when = moment(done);
      } else {
        when = [{ text: recipient.role === 'viewer' ? 'Copy only' : 'Not yet', style: body }];
      }
      return [
        [
          { text: human(recipient.name, 'recipient name'), style: body },
          { text: ROLE_LABELS[recipient.role], style: small },
        ],
        [{ text: machine(contact(recipient)), style: body }],
        [{ text: recipient.role === 'viewer' ? '' : AUTH_LABELS[recipient.auth], style: body }],
        when,
      ];
    }),
  );

  const auditHead = envelope.auditHead ?? events[events.length - 1]?.hash;
  flow.section('Document fingerprint', 60);
  flow.paragraph(shortHash(document.sha256), {
    ...flow.style('mono'),
    font: fonts.mono,
    size: 11,
  });
  flow.gap(1);
  flow.paragraph(document.sha256, flow.style('monoSmall'));
  flow.paragraph('SHA-256 of the document as it was sent for signing.', small);
  if (auditHead) {
    flow.gap(3);
    flow.paragraph(
      `Audit trail: ${events.length} ${events.length === 1 ? 'event' : 'events'}, chain head`,
      small,
    );
    flow.paragraph(machine(auditHead), flow.style('monoSmall'));
  }

  flow.gap(10);
  const label = flow.style('label');
  flow.paragraph(
    recordUrl
      ? `${closing} Scan the code or open the public record to see the live status and the audit trail.`
      : closing,
    label,
  );
  const note = data.note?.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (note) {
    flow.gap(3);
    flow.paragraph(machine(note), label);
  }

  flow.footers(
    `Envelope ${machine(envelope.id)}`,
    formatUtc(new Date(data.generatedAt ?? Date.now())),
  );
}

/**
 * Appends an A4 page titled "Signing certificate": the document, envelope id, status and
 * completion time, the sender, every signer with masked contact details, how they proved
 * who they are and when they signed, the document's SHA-256 and, when `recordUrl` is given,
 * a QR code and link to the public record. It fits one page for a usual envelope and
 * continues on further pages when there are many signers.
 */
export async function appendCertificate(
  pdfBytes: Uint8Array,
  data: CertificateData,
  options: CertificateOptions = {},
): Promise<Uint8Array> {
  const doc = await loadPdf(pdfBytes, { maxBytes: options.maxBytes });
  const fonts = await embedFonts(doc, options.font);
  drawCertificate(doc, fonts, data, SEALED_FILE_LINE);
  return doc.save();
}

/**
 * The same certificate as a PDF of its own, without the document: something to hand to a
 * person who should see who signed and when, but not what was signed. Pass several
 * certificates to put one after another in a single file.
 */
export async function certificatePdf(
  data: CertificateData | CertificateData[],
  options: Pick<CertificateOptions, 'font'> = {},
): Promise<Uint8Array> {
  const list = Array.isArray(data) ? data : [data];
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc, options.font);
  for (const item of list) {
    drawCertificate(doc, fonts, item, STANDALONE_LINE);
  }
  const title = list[0]?.envelope.title;
  doc.setTitle(title ? `Signing certificate: ${title}` : 'Signing certificate');
  return doc.save();
}
