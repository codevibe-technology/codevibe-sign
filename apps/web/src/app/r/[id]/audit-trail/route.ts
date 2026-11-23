import { recordSource, recordView, recordViewAllowed } from '@/server/public-record-page';
import {
  auditTrailJsonDownload,
  auditTrailPdfDownload,
  recordRefusal,
} from '@/server/public-record-files';

export const dynamic = 'force-dynamic';

/** The audit trail of a public record as a PDF, or as JSON with `?format=json`. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await recordViewAllowed(request.headers))) return recordRefusal(429);
  const { id } = await params;
  if (new URL(request.url).searchParams.get('format') === 'json') {
    const view = await recordView(id);
    return view ? auditTrailJsonDownload(view) : recordRefusal(404);
  }
  const source = await recordSource(id);
  return source ? auditTrailPdfDownload(source) : recordRefusal(404);
}
