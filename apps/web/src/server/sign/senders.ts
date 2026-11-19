import 'server-only';
import { getSessionUser } from '../auth/session';
import { db } from '../db';
import { recordSender } from '../envelopes';

/**
 * Remembers who created an envelope from the app (a session call that the sign server has
 * already authorised for `workspaceId`), so members can later void what they sent.
 */
export async function recordCreatedEnvelope(workspaceId: string, response: Response) {
  const user = await getSessionUser();
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { id?: unknown } | null;
  if (!user || typeof body?.id !== 'string') return;
  await recordSender(db(), { workspaceId, envelopeId: body.id, userId: user.id });
}
