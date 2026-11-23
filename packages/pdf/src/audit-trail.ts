import { PDFDocument } from 'pdf-lib';
import type { AuditEvent, Envelope, IsoDateTime, Recipient } from '@codevibe_technology/sign-core';
import { ROLE_LABELS, STATUS_LABELS, actionLabel, actorOf, authLabel } from './certificate-text';
import { embedFonts, type FontSet } from './fonts';
import { drawLockup, lockupWidth } from './lockup';
import { maskEmail, maskPhone } from './mask';
import { A4, CONTENT_WIDTH, MARGIN, PageFlow, type Part } from './page-flow';
import { assertTimeZone, formatSigningTime, formatUtc, parseDate } from './time';

export interface AuditTrailData {
  envelope: Envelope;
  /** The envelope's audit events, in order. */
  events: AuditEvent[];
  /** IANA time zone shown next to UTC, for example "Asia/Kolkata". */
  timeZone?: string;
  /** When the file was produced. Defaults to now. */
  generatedAt?: IsoDateTime;
  /** Link to the page that shows this signing's record. */
  recordUrl?: string;
}

export interface AuditTrailOptions {
  /** TrueType or OpenType font for names and titles outside Latin script. */
  font?: Uint8Array;
  /**
   * Print the network address each event came from, where one was recorded. Leave it off
   * for a file anyone with a link can open; the parties' own copy may carry it.
   */
  networkAddresses?: boolean;
}

const LOCKUP_HEIGHT = 11;

const contact = (recipient: Recipient) =>
  recipient.email ? maskEmail(recipient.email) : recipient.phone ? maskPhone(recipient.phone) : '';

const STATUS_WORDS: Record<Recipient['status'], string> = {
  pending: 'Waiting',
  notified: 'Invited',
  viewed: 'Viewed',
  signed: 'Signed',
  approved: 'Approved',
  declined: 'Declined',
};

/** How a signature was given, for the event that records it. */
function methodOf(event: AuditEvent, envelope: Envelope): string | undefined {
  if (event.action !== 'recipient.signed') return undefined;
  if (event.data?.method !== 'aadhaar_esign') return 'Electronic signature';
  const recipient = envelope.recipients.find((r) => r.id === event.recipientId);
  const provider = typeof event.data.provider === 'string' ? event.data.provider : undefined;
  const sandbox = event.data.sandbox === true || recipient?.esign?.sandbox === true;
  const label = authLabel({
    auth: 'aadhaar',
    ...(provider
      ? { esign: { provider, status: 'signed' as const, ...(sandbox ? { sandbox } : {}) } }
      : {}),
  });
  const name = typeof event.data.signerName === 'string' ? event.data.signerName : undefined;
  return name ? `${label}, name on the eSign certificate: ${name}` : label;
}

/**
 * The audit trail of an envelope as a PDF: the envelope, the hash of each document, how each
 * recipient took part, then every event with its number, time, what happened and who did it,
 * and the head of the hash chain. An email address named in an event is masked; network
 * addresses are printed only with `networkAddresses`, and browser details never.
 */
export async function auditTrailPdf(
  data: AuditTrailData,
  options: AuditTrailOptions = {},
): Promise<Uint8Array> {
  if (data.timeZone) {
    assertTimeZone(data.timeZone);
  }
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc, options.font);
  drawAuditTrail(doc, fonts, data, options);
  doc.setTitle(`Audit trail: ${data.envelope.title}`);
  await fonts.finish();
  return doc.save();
}

/** Draws the audit trail on new pages at the end of `doc`. */
export function drawAuditTrail(
  doc: PDFDocument,
  fonts: FontSet,
  data: AuditTrailData,
  options: Pick<AuditTrailOptions, 'networkAddresses'> = {},
): void {
  const { envelope, events, timeZone } = data;
  const names = new Map(envelope.recipients.map((recipient) => [recipient.id, recipient.name]));

  const flow = new PageFlow(doc, fonts, 'Audit trail');
  const body = flow.style('body');
  const small = flow.style('small');
  const mono = flow.style('mono');
  const hash = flow.style('monoSmall');
  const zoned = timeZone !== undefined && timeZone !== 'UTC';

  /** The time in the workspace's zone with UTC under it, or UTC alone. */
  const when = (value: string, nameZone = false): Part[] => {
    const date = parseDate(value);
    if (!date) {
      return [{ text: value, style: body }];
    }
    if (!zoned) {
      return [{ text: formatUtc(date), style: body }];
    }
    return [
      {
        text: formatSigningTime(value, timeZone) + (nameZone ? ` (${timeZone})` : ''),
        style: body,
      },
      { text: formatUtc(date), style: small },
    ];
  };

  flow.newPage();
  const first = flow.page;
  const caption = 'Provided by';
  const lockupX = A4.width - MARGIN - lockupWidth(LOCKUP_HEIGHT);
  const lockupTop = A4.height - MARGIN - 3;
  small.font.draw(first, caption, {
    x: lockupX - small.font.widthOfTextAtSize(caption, small.size) - 6,
    y: lockupTop - LOCKUP_HEIGHT + 2,
    size: small.size,
    color: small.color,
  });
  drawLockup(first, { x: lockupX, top: lockupTop, height: LOCKUP_HEIGHT });

  flow.field('Document', [{ text: envelope.title, style: flow.style('strong') }]);
  flow.field('Envelope ID', [{ text: envelope.id, style: mono }]);
  flow.field('Status', [{ text: STATUS_LABELS[envelope.status], style: body }]);
  if (envelope.sentAt) flow.field('Sent', when(envelope.sentAt, true));
  if (envelope.completedAt) flow.field('Completed', when(envelope.completedAt, true));
  flow.field('Events', [{ text: String(events.length), style: body }]);
  const head = envelope.auditHead ?? events[events.length - 1]?.hash;
  if (head) {
    flow.field('Chain head', [{ text: head, style: hash }]);
  }
  if (data.recordUrl) {
    flow.field('Public record', [{ text: data.recordUrl, style: mono }]);
  }

  const sealed = new Map(
    events
      .filter((e) => e.action === 'document.sealed')
      .map((e) => [String(e.data?.documentId ?? ''), e.data ?? {}] as const),
  );
  flow.section('Documents', 40);
  for (const document of envelope.documents) {
    const seal = sealed.get(document.id);
    const parts: Part[] = [
      { text: document.name, style: flow.style('strong') },
      { text: 'SHA-256 of the original', style: small },
      { text: document.sha256, style: hash },
    ];
    if (typeof seal?.sha256 === 'string') {
      parts.push(
        { text: 'SHA-256 of the signed file', style: small },
        { text: seal.sha256, style: hash },
      );
    }
    flow.field(`${document.pageCount} ${document.pageCount === 1 ? 'page' : 'pages'}`, parts);
  }

  flow.section('Recipients', 40);
  const recipients = [...envelope.recipients].sort((a, b) => a.order - b.order);
  const people = { name: 160, role: 85, method: 150 };
  flow.table(
    [
      { title: 'Name', width: people.name },
      { title: 'Role', width: people.role },
      { title: 'Method', width: people.method },
      { title: 'Status', width: CONTENT_WIDTH - people.name - people.role - people.method },
    ],
    recipients.map((recipient) => [
      [
        { text: recipient.name, style: body },
        ...(contact(recipient) ? [{ text: contact(recipient), style: small }] : []),
      ],
      [{ text: ROLE_LABELS[recipient.role], style: body }],
      [{ text: recipient.role === 'viewer' ? '-' : authLabel(recipient), style: body }],
      [{ text: STATUS_WORDS[recipient.status], style: body }],
    ]),
  );

  flow.section('Events', 40);
  flow.paragraph(
    'Each event carries a SHA-256 hash that covers the event before it, so none can be ' +
      'changed, removed or added afterwards without breaking the chain.',
    flow.style('label'),
  );
  flow.gap(6);
  const widths = { seq: 26, time: 165, action: 170 };
  flow.table(
    [
      { title: '#', width: widths.seq },
      { title: zoned ? `Time (${timeZone} and UTC)` : 'Time (UTC)', width: widths.time },
      { title: 'Event', width: widths.action },
      { title: 'By', width: CONTENT_WIDTH - widths.seq - widths.time - widths.action },
    ],
    events.map((event) => {
      const method = methodOf(event, envelope);
      // A server that cannot see the client's address records "unknown"; nothing to print.
      const recorded = event.context?.ip;
      const ip = options.networkAddresses && recorded !== 'unknown' ? recorded : undefined;
      return [
        [{ text: String(event.seq), style: body }],
        when(event.at),
        [
          { text: actionLabel(event), style: body },
          ...(method ? [{ text: method, style: small }] : []),
        ],
        [
          { text: actorOf(event, names), style: body },
          ...(ip ? [{ text: `IP ${ip}`, style: small }] : []),
        ],
      ];
    }),
  );

  flow.footers(`Envelope ${envelope.id}`, formatUtc(new Date(data.generatedAt ?? Date.now())));
}
