import 'server-only';
import type postgres from 'postgres';
import { db } from '../db';
import { LIVE_CHANNEL, encodeChange, type LiveChange } from './events';
import { createLiveHub, type LiveHub } from './hub';

const holder = globalThis as unknown as { __cvsLiveHub?: LiveHub };

/** The process's live hub, listening on one dedicated PostgreSQL connection. */
export function liveHub(): LiveHub {
  holder.__cvsLiveHub ??= createLiveHub((channel, onMessage, onListen) =>
    db().listen(channel, onMessage, onListen),
  );
  return holder.__cvsLiveHub;
}

/**
 * Tells every web process about a saved change through NOTIFY, so pages open on any of them
 * refresh. Only ids and action names travel; see `encodeChange`.
 */
export async function publishChange(sql: postgres.Sql, change: LiveChange): Promise<void> {
  const payload = encodeChange(change);
  if (payload) await sql.notify(LIVE_CHANNEL, payload);
}
