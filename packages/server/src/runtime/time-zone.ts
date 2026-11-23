import { isTimeZone } from '../time-zone';
import type { Runtime } from './context';

/**
 * The zone for dates on a workspace's signed documents and in its emails: the workspace's own
 * when `workspaceTimeZone` names one, otherwise the server's `timeZone`, otherwise none (UTC).
 * A zone the runtime does not know is logged and skipped, so a bad setting never stops a seal.
 */
export async function timeZoneFor(rt: Runtime, workspaceId: string): Promise<string | undefined> {
  const own = rt.workspaceTimeZone ? await rt.workspaceTimeZone(workspaceId) : null;
  if (own && isTimeZone(own)) return own;
  if (own) rt.logger.warn('unknown workspace time zone, using the default', { workspaceId });
  return rt.timeZone;
}
