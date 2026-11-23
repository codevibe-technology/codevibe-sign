import 'server-only';
import { auditTrailPdf, certificatePdf } from '@codevibe_technology/sign-pdf';
import type { PublicRecordView } from '@/lib/public-record';
import { actionLabel } from '@/lib/envelopes';
import { defaultTimeZone, env } from './env';
import { recordCertificates, recordUrl, type RecordSource } from './public-records';

const HEADERS = {
  'cache-control': 'private, no-store',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
};

const safeName = (id: string) => id.replace(/[^\w-]/g, '').slice(0, 80);

function download(body: BodyInit, type: string, name: string): Response {
  return new Response(body, {
    headers: {
      ...HEADERS,
      'content-type': type,
      'content-disposition': `attachment; filename="${name}"`,
    },
  });
}

export const recordRefusal = (status: 404 | 429) =>
  new Response(
    status === 404 ? 'Not found' : 'Too many requests. Wait a few minutes and try again.',
    {
      status,
      headers: { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' },
    },
  );

/** The completion certificate as a PDF of its own: one page per document, no document. */
export async function certificateDownload(source: RecordSource): Promise<Response> {
  const config = env();
  const bytes = await certificatePdf(
    recordCertificates(source, config.APP_URL, defaultTimeZone(config)),
  );
  return download(
    Buffer.from(bytes),
    'application/pdf',
    `certificate-${safeName(source.envelope.id)}.pdf`,
  );
}

export async function auditTrailPdfDownload(source: RecordSource): Promise<Response> {
  const config = env();
  const [first] = recordCertificates(source, config.APP_URL, defaultTimeZone(config));
  if (!first) return recordRefusal(404);
  const bytes = await auditTrailPdf({
    envelope: first.envelope,
    events: first.events,
    ...(first.timeZone ? { timeZone: first.timeZone } : {}),
    ...(first.recordUrl ? { recordUrl: first.recordUrl } : {}),
  });
  return download(
    Buffer.from(bytes),
    'application/pdf',
    `audit-trail-${safeName(source.envelope.id)}.pdf`,
  );
}

/** The audit trail as JSON, built from the public view so it can hold nothing the page hides. */
export function auditTrailJsonDownload(view: PublicRecordView): Response {
  const body = {
    record: recordUrl(env().APP_URL, view.id),
    envelopeId: view.envelopeId,
    title: view.title,
    status: view.status,
    completedAt: view.completedAt,
    chain: view.chain,
    events: view.trail.map((event) => ({
      seq: event.seq,
      action: event.action,
      label: actionLabel(event.action),
      at: event.at,
      by: event.actor,
      hash: event.hash,
    })),
  };
  return download(
    JSON.stringify(body, null, 2),
    'application/json; charset=utf-8',
    `audit-trail-${safeName(view.envelopeId)}.json`,
  );
}
