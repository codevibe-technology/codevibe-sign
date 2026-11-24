import { getSessionUser } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

const noStore = { 'cache-control': 'no-store' };

/**
 * Called by open app pages while the person is using them, so work that stays in the browser
 * (placing fields, reading a document) keeps the session alive on the server too. Reading the
 * session records the activity; it answers 401 once the session has ended.
 */
export async function POST(): Promise<Response> {
  const user = await getSessionUser();
  if (!user) {
    return Response.json(
      { code: 'SESSION_ENDED', message: 'Your session has ended. Sign in again.' },
      { status: 401, headers: noStore },
    );
  }
  return new Response(null, { status: 204, headers: noStore });
}
