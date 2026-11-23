import { PDFDocument } from 'pdf-lib';
import type { AuditEvent, Envelope, IsoDateTime } from '@codevibe_technology/sign-core';
import { actionLabel, actorOf } from './certificate-text';
import { embedFonts, encodable } from './fonts';
import { CONTENT_WIDTH, PageFlow, type Part } from './page-flow';
import { assertTimeZone, formatInZone, formatUtc, parseDate } from './time';

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
}

/**
 * The audit trail of an envelope as a PDF: every event with its number, time, what happened
 * and who did it, and the head of the hash chain. Network addresses and browser details of
 * the events are left out; an email address named in an event is masked.
 */
export async function auditTrailPdf(
  data: AuditTrailData,
  options: AuditTrailOptions = {},
): Promise<Uint8Array> {
  const { envelope, events, timeZone } = data;
  if (timeZone) {
    assertTimeZone(timeZone);
  }
  const doc = await PDFDocument.create();
  const fonts = await embedFonts(doc, options.font);
  const text = (value: string) => encodable(fonts.regular, value);
  const names = new Map(envelope.recipients.map((recipient) => [recipient.id, recipient.name]));

  const flow = new PageFlow(doc, fonts, 'Audit trail');
  const body = flow.style('body');
  flow.newPage();
  flow.field('Document', [{ text: text(envelope.title), style: flow.style('strong') }]);
  flow.field('Envelope ID', [{ text: text(envelope.id), style: flow.style('mono') }]);
  flow.field('Events', [{ text: String(events.length), style: body }]);
  const head = envelope.auditHead ?? events[events.length - 1]?.hash;
  if (head) {
    flow.field('Chain head', [{ text: text(head), style: flow.style('monoSmall') }]);
  }
  if (data.recordUrl) {
    flow.field('Public record', [{ text: text(data.recordUrl), style: flow.style('mono') }]);
  }
  flow.gap(4);
  flow.paragraph(
    'Each event carries a SHA-256 hash that covers the event before it, so none can be ' +
      'changed, removed or added afterwards without breaking the chain.',
    flow.style('label'),
  );
  flow.gap(8);

  const zoned = timeZone !== undefined && timeZone !== 'UTC';
  const small = flow.style('small');
  const when = (value: string): Part[] => {
    const date = parseDate(value);
    if (!date) {
      return [{ text: text(value), style: body }];
    }
    return [
      { text: formatUtc(date), style: body },
      ...(zoned ? [{ text: text(formatInZone(date, timeZone)), style: small }] : []),
    ];
  };
  const widths = { seq: 30, time: 200, action: 125 };
  flow.table(
    [
      { title: '#', width: widths.seq },
      { title: zoned ? `Time (UTC and ${timeZone})` : 'Time (UTC)', width: widths.time },
      { title: 'Event', width: widths.action },
      { title: 'By', width: CONTENT_WIDTH - widths.seq - widths.time - widths.action },
    ],
    events.map((event) => [
      [{ text: String(event.seq), style: body }],
      when(event.at),
      [{ text: actionLabel(event), style: body }],
      [{ text: text(actorOf(event, names)), style: body }],
    ]),
  );

  flow.footers(
    `Envelope ${text(envelope.id)}`,
    formatUtc(new Date(data.generatedAt ?? Date.now())),
  );
  doc.setTitle(`Audit trail: ${envelope.title}`);
  return doc.save();
}
