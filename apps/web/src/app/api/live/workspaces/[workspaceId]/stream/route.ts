import { getSessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { liveHub } from '@/server/live/live';
import { liveStream } from '@/server/live/stream';
import { findMembership } from '@/server/workspaces';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const refuse = (status: number) =>
  new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * Server-Sent Events for the workspace's envelope changes, for signed-in members only. Anyone
 * else gets a 404, as for the workspace's pages.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params;
  const user = await getSessionUser();
  if (!user) return refuse(401);
  const sql = db();
  const member = async () => (await findMembership(sql, user.id, { id: workspaceId })) !== null;
  if (!(await member())) return refuse(404);
  try {
    return await liveStream({
      hub: liveHub(),
      workspaceId,
      signal: request.signal,
      stillAllowed: member,
    });
  } catch (err) {
    console.error('[live] stream could not start', err instanceof Error ? err.message : err);
    return refuse(503);
  }
}
