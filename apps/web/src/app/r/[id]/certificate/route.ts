import { recordSource, recordViewAllowed } from '@/server/public-record-page';
import { certificateDownload, recordRefusal } from '@/server/public-record-files';

export const dynamic = 'force-dynamic';

/** The completion certificate of a public record, without the signed document. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await recordViewAllowed(request.headers))) return recordRefusal(429);
  const source = await recordSource((await params).id);
  return source ? certificateDownload(source) : recordRefusal(404);
}
