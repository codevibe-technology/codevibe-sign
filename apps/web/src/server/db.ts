import 'server-only';
import postgres from 'postgres';
import { env } from './env';

export type Sql = postgres.Sql;

const holder = globalThis as unknown as { __cvsSql?: Sql };

/**
 * The process's one connection pool, shared by the app, Better Auth and the sign server. Kept
 * on `globalThis` so development reloads reuse it instead of opening a new pool each time.
 */
export function db(): Sql {
  holder.__cvsSql ??= postgres(env().DATABASE_URL, { max: 10, onnotice: () => {} });
  return holder.__cvsSql;
}
