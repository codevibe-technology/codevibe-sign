import { rgb, type PDFDocument, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import {
  SignError,
  type AuditAction,
  type AuditEvent,
  type AuthMethod,
  type Document,
  type Envelope,
  type IsoDateTime,
  type Recipient,
  type RecipientRole,
} from '@codevibe_technology/sign-core';
import { canEncode, embedFonts, encodable, type FontSet } from './fonts';
import { loadPdf, sha256Hex } from './inspect';
import { maskEmail, maskPhone } from './mask';
import { wrapText } from './text';
import { assertTimeZone, formatMoment, formatUtc } from './time';

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

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const FOOTER_SPACE = 36;
const CONTENT_WIDTH = A4.width - MARGIN * 2;
const LABEL_WIDTH = 132;

const COLORS = {
  text: rgb(0.1, 0.11, 0.15),
  muted: rgb(0.42, 0.45, 0.5),
  rule: rgb(0.85, 0.87, 0.9),
  band: rgb(0.96, 0.97, 0.98),
};

const SIZE = { title: 20, section: 11.5, name: 10.5, body: 9, label: 8.5, small: 7.5 };
const LEADING = 1.35;

const ROLE_LABELS: Record<RecipientRole, string> = {
  signer: 'Signer',
  approver: 'Approver',
  viewer: 'Viewer (receives a copy)',
};

const AUTH_LABELS: Record<AuthMethod, string> = {
  email_link: 'Email link',
  email_otp: 'One-time code by email',
  sms_otp: 'One-time code by SMS',
  aadhaar: 'Aadhaar eSign',
};

const ACTION_LABELS: Record<AuditAction, string> = {
  'envelope.created': 'Envelope created',
  'envelope.updated': 'Draft edited',
  'envelope.sent': 'Envelope sent',
  'envelope.completed': 'Envelope completed',
  'envelope.declined': 'Envelope declined',
  'envelope.expired': 'Envelope expired',
  'envelope.voided': 'Envelope voided',
  'envelope.recalled': 'Recalled to correct',
  'envelope.revised': 'Revised after decline',
  'recipient.notified': 'Invitation sent',
  'recipient.reminded': 'Reminder sent',
  'recipient.viewed': 'Document viewed',
  'recipient.authenticated': 'Identity verified',
  'recipient.signed': 'Signed',
  'recipient.approved': 'Approved',
  'recipient.declined': 'Declined',
  'recipient.link_shared': 'Link shared manually',
  'recipient.corrected': 'Recipient corrected',
  'document.sealed': 'Document sealed',
};

const SENDER_ACTIONS: ReadonlySet<AuditAction> = new Set([
  'envelope.created',
  'envelope.updated',
  'envelope.sent',
  'envelope.voided',
  'envelope.recalled',
  'envelope.revised',
  'recipient.link_shared',
  'recipient.corrected',
]);

/** The label for an event; a copy says what it replaced. */
function actionLabel(event: AuditEvent): string {
  if (event.action === 'envelope.created' && event.data?.recalledFrom) {
    return 'Corrected copy created';
  }
  if (event.action === 'envelope.created' && event.data?.revisedFrom) {
    return 'Revision created';
  }
  return ACTION_LABELS[event.action] ?? event.action;
}

interface RecipientActivity {
  viewedAt?: string;
  actedAt?: string;
  declinedAt?: string;
  ip?: string;
  userAgent?: string;
}

/** First view and final action per recipient, with the network details of the decisive event. */
function activityByRecipient(events: AuditEvent[]): Map<string, RecipientActivity> {
  const result = new Map<string, RecipientActivity>();
  const contextRank = new Map<string, { ip: number; userAgent: number }>();
  const rankOf: Partial<Record<AuditAction, number>> = {
    'recipient.viewed': 1,
    'recipient.authenticated': 2,
    'recipient.signed': 3,
    'recipient.approved': 3,
    'recipient.declined': 3,
  };

  for (const event of events) {
    if (!event.recipientId) {
      continue;
    }
    const activity = result.get(event.recipientId) ?? {};
    result.set(event.recipientId, activity);
    if (event.action === 'recipient.viewed' && !activity.viewedAt) {
      activity.viewedAt = event.at;
    }
    if (event.action === 'recipient.signed' || event.action === 'recipient.approved') {
      activity.actedAt = event.at;
    }
    if (event.action === 'recipient.declined') {
      activity.declinedAt = event.at;
    }
    const rank = rankOf[event.action];
    const context = event.context;
    if (rank === undefined || !context) {
      continue;
    }
    // Each detail comes from the most decisive event that recorded it.
    const ranks = contextRank.get(event.recipientId) ?? { ip: 0, userAgent: 0 };
    contextRank.set(event.recipientId, ranks);
    if (context.ip && rank >= ranks.ip) {
      ranks.ip = rank;
      activity.ip = context.ip;
    }
    if (context.userAgent && rank >= ranks.userAgent) {
      ranks.userAgent = rank;
      activity.userAgent = context.userAgent;
    }
  }
  return result;
}

interface TextStyle {
  font: PDFFont;
  size: number;
  color: RGB;
}

class CertificateLayout {
  readonly pages: PDFPage[] = [];
  private page!: PDFPage;
  private y = 0;

  constructor(
    private readonly doc: PDFDocument,
    private readonly fonts: FontSet,
  ) {}

  style(kind: 'body' | 'label' | 'mono' | 'bold' | 'small'): TextStyle {
    switch (kind) {
      case 'body':
        return { font: this.fonts.regular, size: SIZE.body, color: COLORS.text };
      case 'label':
        return { font: this.fonts.regular, size: SIZE.label, color: COLORS.muted };
      case 'mono':
        return { font: this.fonts.mono, size: SIZE.label, color: COLORS.text };
      case 'bold':
        return { font: this.fonts.bold, size: SIZE.name, color: COLORS.text };
      case 'small':
        return { font: this.fonts.regular, size: SIZE.small, color: COLORS.muted };
    }
  }

  newPage(): void {
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.pages.push(this.page);
    this.y = A4.height - MARGIN;
    const continued = this.pages.length > 1;
    this.write(continued ? 'Signing certificate (continued)' : 'Signing certificate', MARGIN, {
      font: this.fonts.bold,
      size: continued ? SIZE.section + 2 : SIZE.title,
      color: COLORS.text,
    });
    this.y -= (continued ? SIZE.section + 2 : SIZE.title) * 1.45;
    this.rule();
    this.y -= 14;
  }

  private write(text: string, x: number, style: TextStyle): void {
    this.page.drawText(text, {
      x,
      y: this.y - style.size,
      size: style.size,
      font: style.font,
      color: style.color,
    });
  }

  private rule(color: RGB = COLORS.rule): void {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4.width - MARGIN, y: this.y },
      thickness: 0.75,
      color,
    });
  }

  /** Starts a new page when fewer than `height` points are left. */
  ensure(height: number): void {
    if (this.y - height < MARGIN + FOOTER_SPACE) {
      this.newPage();
    }
  }

  lines(text: string, style: TextStyle, width: number): string[] {
    return wrapText(text, style.font, style.size, width);
  }

  paragraph(text: string, style: TextStyle): void {
    for (const line of this.lines(text, style, CONTENT_WIDTH)) {
      this.ensure(style.size * LEADING);
      this.write(line, MARGIN, style);
      this.y -= style.size * LEADING;
    }
  }

  section(title: string, after = 0): void {
    this.ensure(SIZE.section * 2 + 24 + after);
    this.y -= 10;
    this.write(title, MARGIN, { font: this.fonts.bold, size: SIZE.section, color: COLORS.text });
    this.y -= SIZE.section * LEADING + 4;
  }

  heading(text: string, after = 0): void {
    const style = this.style('bold');
    this.ensure(style.size * LEADING + 6 + after);
    this.y -= 4;
    for (const line of this.lines(text, style, CONTENT_WIDTH)) {
      this.write(line, MARGIN, style);
      this.y -= style.size * LEADING;
    }
    this.y -= 2;
  }

  /** A label in the left column and a wrapped value beside it; long values continue on the next page. */
  field(label: string, value: string, valueStyle: TextStyle = this.style('body')): void {
    const labelStyle = this.style('label');
    const valueX = MARGIN + LABEL_WIDTH;
    const labelLines = this.lines(label, labelStyle, LABEL_WIDTH - 8);
    const valueLines = this.lines(value, valueStyle, CONTENT_WIDTH - LABEL_WIDTH);
    const lineHeight = Math.max(labelStyle.size, valueStyle.size) * LEADING;
    const rows = Math.max(labelLines.length, valueLines.length);
    this.ensure(Math.min(rows, 3) * lineHeight);
    for (let row = 0; row < rows; row += 1) {
      this.ensure(lineHeight);
      const labelLine = labelLines[row];
      const valueLine = valueLines[row];
      if (labelLine) {
        this.write(labelLine, MARGIN, labelStyle);
      }
      if (valueLine) {
        this.write(valueLine, valueX, valueStyle);
      }
      this.y -= lineHeight;
    }
    this.y -= 2;
  }

  gap(points: number): void {
    this.y -= points;
  }

  separator(): void {
    this.ensure(10);
    this.y -= 4;
    this.rule();
    this.y -= 6;
  }

  /** A table whose header repeats on every page it spans. */
  table(columns: { title: string; width: number }[], rows: string[][]): void {
    const style = this.style('body');
    const headerStyle: TextStyle = { font: this.fonts.bold, size: SIZE.label, color: COLORS.muted };
    const lineHeight = style.size * LEADING;
    const padding = 4;

    const header = () => {
      this.ensure(headerStyle.size * LEADING + padding * 2 + lineHeight * 2);
      this.page.drawRectangle({
        x: MARGIN,
        y: this.y - headerStyle.size * LEADING - padding * 2,
        width: CONTENT_WIDTH,
        height: headerStyle.size * LEADING + padding * 2,
        color: COLORS.band,
      });
      this.y -= padding;
      let x = MARGIN + padding;
      for (const column of columns) {
        this.write(column.title, x, headerStyle);
        x += column.width;
      }
      this.y -= headerStyle.size * LEADING + padding;
    };

    header();
    for (const row of rows) {
      const cells = row.map((cell, index) =>
        this.lines(cell, style, (columns[index]?.width ?? 0) - padding * 2),
      );
      const height = Math.max(...cells.map((cell) => cell.length)) * lineHeight + padding * 2;
      if (this.y - height < MARGIN + FOOTER_SPACE) {
        this.newPage();
        header();
      }
      this.y -= padding;
      let x = MARGIN + padding;
      cells.forEach((cellLines, index) => {
        cellLines.forEach((line, lineIndex) => {
          this.page.drawText(line, {
            x,
            y: this.y - style.size - lineIndex * lineHeight,
            size: style.size,
            font: style.font,
            color: style.color,
          });
        });
        x += columns[index]?.width ?? 0;
      });
      this.y -= height - padding;
      this.rule();
    }
  }

  footers(envelopeId: string, generatedAt: string): void {
    const style = this.style('small');
    const total = this.pages.length;
    this.pages.forEach((page, index) => {
      const left = `Envelope ${envelopeId}`;
      const right = `Page ${index + 1} of ${total}  ·  Generated ${generatedAt}`;
      const rightWidth = style.font.widthOfTextAtSize(right, style.size);
      const y = MARGIN - 12;
      page.drawText(left, { x: MARGIN, y, size: style.size, font: style.font, color: style.color });
      page.drawText(right, {
        x: A4.width - MARGIN - rightWidth,
        y,
        size: style.size,
        font: style.font,
        color: style.color,
      });
    });
  }
}

function contact(recipient: Recipient): { label: string; value: string } | null {
  if (recipient.email) {
    return { label: 'Email', value: maskEmail(recipient.email) };
  }
  if (recipient.phone) {
    return { label: 'Phone', value: maskPhone(recipient.phone) };
  }
  return null;
}

function actor(event: AuditEvent, names: Map<string, string>): string {
  const by = event.data?.by;
  if (typeof by === 'string' && by && SENDER_ACTIONS.has(event.action)) {
    return by;
  }
  if (event.recipientId && !SENDER_ACTIONS.has(event.action)) {
    return names.get(event.recipientId) ?? event.recipientId;
  }
  return SENDER_ACTIONS.has(event.action) ? 'Sender' : 'System';
}

/**
 * Appends one or more A4 pages titled "Signing certificate": envelope and document
 * identity, SHA-256 of the original file and of the final content (the PDF passed in),
 * every recipient with masked contact details and the network and times of their
 * actions, the audit chain head and the full event list.
 */
export async function appendCertificate(
  pdfBytes: Uint8Array,
  data: CertificateData,
  options: CertificateOptions = {},
): Promise<Uint8Array> {
  const { envelope, document, events, timeZone } = data;
  if (timeZone) {
    assertTimeZone(timeZone);
  }
  const doc = await loadPdf(pdfBytes, { maxBytes: options.maxBytes });
  const fonts = await embedFonts(doc, options.font);

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
  const moment = (value: string) => machine(formatMoment(value, timeZone));

  const finalSha256 = sha256Hex(pdfBytes);
  const generatedAt = formatUtc(new Date(data.generatedAt ?? Date.now()));
  const auditHead = envelope.auditHead ?? events[events.length - 1]?.hash ?? 'none';
  const names = new Map(envelope.recipients.map((recipient) => [recipient.id, recipient.name]));
  const activity = activityByRecipient(events);

  const layout = new CertificateLayout(doc, fonts);
  const mono = layout.style('mono');
  layout.newPage();

  layout.paragraph(
    'This page records how the document was signed. The SHA-256 values identify the exact files; ' +
      'the audit chain head is the hash of the last event, and each event hash covers the one before it.',
    layout.style('label'),
  );
  layout.gap(6);

  layout.section('Envelope');
  layout.field('Envelope ID', machine(envelope.id), mono);
  layout.field('Title', human(envelope.title, 'envelope title'));
  layout.field('Status', envelope.status);
  layout.field('Created', moment(envelope.createdAt));
  if (envelope.sentAt) {
    layout.field('Sent', moment(envelope.sentAt));
  }
  if (envelope.completedAt) {
    layout.field('Completed', moment(envelope.completedAt));
  }

  layout.section('Document');
  layout.field('Name', human(document.name, 'document name'));
  layout.field('Pages', String(document.pageCount));
  layout.field('Original SHA-256', document.sha256, mono);
  layout.field('Final content SHA-256', finalSha256, mono);
  layout.paragraph(
    'Final content is the signed pages before this certificate was added and the file was sealed.',
    layout.style('small'),
  );

  layout.section('Recipients', 80);
  const recipients = [...envelope.recipients].sort((a, b) => a.order - b.order);
  recipients.forEach((recipient, index) => {
    if (index > 0) {
      layout.separator();
    }
    const seen = activity.get(recipient.id) ?? {};
    layout.heading(
      `${human(recipient.name, 'recipient name')} · ${ROLE_LABELS[recipient.role]}`,
      SIZE.body * LEADING * 3,
    );
    const reach = contact(recipient);
    if (reach) {
      layout.field(reach.label, machine(reach.value));
    }
    layout.field('Authentication', AUTH_LABELS[recipient.auth]);
    layout.field('Status', recipient.status);
    layout.field('IP address', machine(seen.ip ?? 'Not recorded'));
    layout.field('User agent', machine(seen.userAgent ?? 'Not recorded'));
    const viewed = seen.viewedAt ?? recipient.viewedAt;
    layout.field('Viewed', viewed ? moment(viewed) : 'Not viewed');
    const actedLabel = recipient.role === 'approver' ? 'Approved' : 'Signed';
    const acted =
      seen.actedAt ??
      (recipient.status === 'signed' || recipient.status === 'approved'
        ? recipient.actedAt
        : undefined);
    if (acted) {
      layout.field(actedLabel, moment(acted));
    } else if (recipient.role !== 'viewer' && recipient.status !== 'declined') {
      layout.field(actedLabel, 'Not yet');
    }
    const declined =
      seen.declinedAt ?? (recipient.status === 'declined' ? recipient.actedAt : undefined);
    if (declined) {
      layout.field('Declined', moment(declined));
    }
    if (recipient.declineReason) {
      layout.field('Reason given', human(recipient.declineReason, 'decline reason'));
    }
  });

  layout.section('Audit trail', 60);
  layout.field('Chain head SHA-256', machine(auditHead), mono);
  layout.field('Events', String(events.length));
  layout.gap(6);
  const timeTitle = timeZone && timeZone !== 'UTC' ? `Time (UTC / ${timeZone})` : 'Time (UTC)';
  layout.table(
    [
      { title: '#', width: 28 },
      { title: timeTitle, width: 196 },
      { title: 'Action', width: 120 },
      { title: 'By', width: CONTENT_WIDTH - 28 - 196 - 120 },
    ],
    events.map((event) => [
      String(event.seq),
      formatMoment(event.at, timeZone, '\n'),
      actionLabel(event),
      human(actor(event, names), 'recipient name'),
    ]),
  );

  const note = data.note?.replace(/\s+/g, ' ').trim().slice(0, 500);
  if (note) {
    layout.gap(10);
    layout.paragraph(machine(note), layout.style('label'));
  }

  layout.footers(machine(envelope.id), generatedAt);
  return doc.save();
}
