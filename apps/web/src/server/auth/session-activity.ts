import type postgres from 'postgres';
import { needsTouch, sessionIsLive, type SessionPolicy } from '@/lib/session-policy';

type Sql = postgres.Sql | postgres.TransactionSql;

export interface StoredSession {
  token: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

/**
 * Records activity on a session: its expiry moves to the idle limit from now, never past the
 * lifetime cap. A session written to within `touchSeconds` is left alone, so a busy page costs
 * one write a minute at most. Returns the new expiry, or null when nothing was written
 * (recently touched, already over, or gone).
 */
export async function touchSession(
  sql: Sql,
  policy: SessionPolicy,
  token: string,
  now: Date = new Date(),
): Promise<Date | null> {
  if (policy.idleSeconds === null) return null;
  const since = new Date(now.getTime() - policy.touchSeconds * 1000);
  const [row] = await sql<{ expires_at: Date }[]>`
    update auth_sessions
    set expires_at = least(
          ${now}::timestamptz + make_interval(secs => ${policy.idleSeconds}),
          created_at + make_interval(secs => ${policy.maxSeconds})
        ),
        updated_at = ${now}
    where token = ${token} and expires_at > ${now} and updated_at <= ${since}
    returning expires_at`;
  return row ? new Date(row.expires_at) : null;
}

/** Ends one session for good, so its cookie stops working everywhere at once. */
export async function endSession(sql: Sql, token: string): Promise<void> {
  await sql`delete from auth_sessions where token = ${token}`;
}

/**
 * Checks a session the auth library has found against the idle and lifetime rules, then
 * records the request as activity. A session over either limit is deleted and reads as
 * signed out.
 */
export async function keepSessionActive(
  sql: Sql,
  policy: SessionPolicy,
  session: StoredSession,
  now: Date = new Date(),
): Promise<boolean> {
  if (!sessionIsLive(policy, session, now)) {
    await endSession(sql, session.token);
    return false;
  }
  if (needsTouch(policy, session.updatedAt, now))
    await touchSession(sql, policy, session.token, now);
  return true;
}
