import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionPolicy, type SessionPolicy } from '@/lib/session-policy';
import type { Auth } from '@/server/auth/auth';
import { authOptions } from '@/server/auth/config';
import { passwordLockout } from '@/server/auth/password-lockout';
import {
  choosePassword,
  createInvitedAccount,
  needsPassword,
  setOwnPassword,
} from '@/server/auth/passwords';
import {
  keepSessionActive,
  touchSession,
  type StoredSession,
} from '@/server/auth/session-activity';
import { AppError } from '@/server/errors';
import { acceptInvitation, createInvitation } from '@/server/invitations';
import { migrateAll } from '@/server/migrate';
import { createWorkspace } from '@/server/workspaces';

const url = process.env.DATABASE_URL;
const APP_URL = 'http://localhost:3000';
const SECRET = 'test-secret-0123456789abcdef0123456789';
const GOOD = 'mango-river-lantern';
const MINUTE = 60_000;

describe.skipIf(!url)('app sessions, against PostgreSQL', () => {
  const schema = `web_sess_${process.pid}_${Date.now()}`;
  const policy = sessionPolicy({ idleMinutes: 30, maxHours: 12 });
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  const mail: { email: string; url: string }[] = [];
  const instances = new Map<SessionPolicy, Auth>();

  function authWith(rules: SessionPolicy): Auth {
    const existing = instances.get(rules);
    if (existing) return existing;
    const created = betterAuth(
      authOptions({
        sql,
        appUrl: APP_URL,
        secret: SECRET,
        sessionPolicy: rules,
        sendMagicLink: async (email, link) => void mail.push({ email, url: link }),
        sendPasswordReset: async () => undefined,
        passwordChanged: async () => undefined,
      }),
    ) as unknown as Auth;
    instances.set(rules, created);
    return created;
  }

  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0]!)
      .filter((c) => c.startsWith('cvs.'))
      .join('; ');

  /** Signs someone in by emailed link, the way most people first arrive. */
  async function signInByLink(rules: SessionPolicy = policy, email?: string) {
    const auth = authWith(rules);
    const address = email ?? `p-${randomUUID().slice(0, 8)}@example.com`;
    const sent = await auth.handler(
      new Request(`${APP_URL}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: APP_URL },
        body: JSON.stringify({ email: address, name: 'Pat Lee', callbackURL: '/' }),
      }),
    );
    expect(sent.status).toBe(200);
    const link = mail.filter((m) => m.email === address).at(-1)!.url;
    const response = await auth.handler(new Request(link));
    const cookie = cookieOf(response);
    const found = (await auth.api.getSession({ headers: new Headers({ cookie }) }))!;
    return { auth, cookie, response, user: found.user, token: found.session.token };
  }

  async function stored(token: string): Promise<StoredSession | null> {
    const [row] = await sql<
      { token: string; created_at: Date; updated_at: Date; expires_at: Date }[]
    >`select token, created_at, updated_at, expires_at from auth_sessions where token = ${token}`;
    return row
      ? {
          token: row.token,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          expiresAt: row.expires_at,
        }
      : null;
  }

  /** Moves a session back in time, as if it was signed in and last used that long ago. */
  async function age(token: string, signedInAgo: number, lastActiveAgo: number) {
    await sql`
      update auth_sessions
      set created_at = now() - make_interval(secs => ${signedInAgo / 1000}),
          updated_at = now() - make_interval(secs => ${lastActiveAgo / 1000})
      where token = ${token}`;
    return (await stored(token))!;
  }

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 4, onnotice: () => {}, connection: { search_path: schema } });
    await migrateAll(sql);
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  describe('a new session', () => {
    it('ends at the idle limit, while its cookie may live as long as the cap', async () => {
      const { token, response } = await signInByLink();
      const row = (await stored(token))!;
      const idle = row.expiresAt.getTime() - row.createdAt.getTime();
      expect(Math.abs(idle - 30 * MINUTE)).toBeLessThan(5000);
      expect(response.headers.getSetCookie().join()).toMatch(
        /cvs\.session_token=[^;]+;[^,]*Max-Age=43200/i,
      );
    });

    it('lasts the whole cap when idle sign-out is off', async () => {
      const off = sessionPolicy({ idleMinutes: 0, maxHours: 8 });
      const { token } = await signInByLink(off);
      const row = (await stored(token))!;
      const life = row.expiresAt.getTime() - row.createdAt.getTime();
      expect(Math.abs(life - 8 * 60 * MINUTE)).toBeLessThan(5000);
      expect(await touchSession(sql, off, token)).toBeNull();
    });

    it('is not slid forward by the auth library when it is read', async () => {
      const { auth, cookie, token } = await signInByLink();
      const before = (await stored(token))!;
      await age(token, 2 * 60 * MINUTE, 2 * 60 * MINUTE);
      await sql`update auth_sessions set expires_at = ${before.expiresAt} where token = ${token}`;
      expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).not.toBeNull();
      expect((await stored(token))!.expiresAt).toEqual(before.expiresAt);
    });
  });

  describe('activity', () => {
    it('moves the expiry to the idle limit from now, at most once a minute', async () => {
      const { token } = await signInByLink();
      const signedIn = await age(token, 20 * MINUTE, 20 * MINUTE);
      const now = new Date();

      const moved = await touchSession(sql, policy, token, now);
      expect(moved).toEqual(new Date(now.getTime() + 30 * MINUTE));
      expect((await stored(token))!.updatedAt).toEqual(now);

      const soon = new Date(now.getTime() + 59_000);
      expect(await touchSession(sql, policy, token, soon)).toBeNull();
      expect((await stored(token))!.expiresAt).toEqual(moved);

      const later = new Date(now.getTime() + MINUTE);
      expect(await touchSession(sql, policy, token, later)).toEqual(
        new Date(later.getTime() + 30 * MINUTE),
      );
      expect(signedIn.createdAt).toEqual((await stored(token))!.createdAt);
    });

    it('is written by a request only when the minute has passed', async () => {
      const { token } = await signInByLink();
      const fresh = (await stored(token))!;
      expect(await keepSessionActive(sql, policy, fresh)).toBe(true);
      expect((await stored(token))!.updatedAt).toEqual(fresh.updatedAt);

      const aged = await age(token, 10 * MINUTE, 5 * MINUTE);
      const now = new Date();
      expect(await keepSessionActive(sql, policy, aged, now)).toBe(true);
      expect((await stored(token))!).toMatchObject({
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 30 * MINUTE),
      });
    });

    it('never moves the expiry past the lifetime cap', async () => {
      const { token } = await signInByLink();
      const row = await age(token, 11 * 60 * MINUTE + 50 * MINUTE, 2 * MINUTE);
      const moved = (await touchSession(sql, policy, token))!;
      expect(moved).toEqual(new Date(row.createdAt.getTime() + 12 * 60 * MINUTE));
    });

    it('cannot bring back a session that has already run out', async () => {
      const { token } = await signInByLink();
      await sql`update auth_sessions set expires_at = now() - interval '1 second' where token = ${token}`;
      await age(token, 40 * MINUTE, 31 * MINUTE);
      expect(await touchSession(sql, policy, token)).toBeNull();
    });
  });

  describe('the server refuses', () => {
    it('a session idle for longer than the limit, and deletes it', async () => {
      const { auth, cookie, token } = await signInByLink();
      const idle = await age(token, 31 * MINUTE, 31 * MINUTE);
      expect(await keepSessionActive(sql, policy, idle)).toBe(false);
      expect(await stored(token)).toBeNull();
      expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    });

    it('a session older than the cap however busy it is', async () => {
      const { token } = await signInByLink();
      const old = await age(token, 12 * 60 * MINUTE + MINUTE, 0);
      expect(await keepSessionActive(sql, policy, old)).toBe(false);
      expect(await stored(token)).toBeNull();
    });

    it('a session from before the limits, even with a stored expiry weeks away', async () => {
      const { token } = await signInByLink();
      await sql`update auth_sessions set expires_at = now() + interval '20 days' where token = ${token}`;
      const legacy = await age(token, 3 * 60 * MINUTE, 3 * 60 * MINUTE);
      expect(await keepSessionActive(sql, policy, legacy)).toBe(false);
    });

    it('a stolen cookie once its stored expiry has passed, in the library too', async () => {
      const { auth, cookie, token } = await signInByLink();
      await sql`update auth_sessions set expires_at = now() - interval '1 second' where token = ${token}`;
      expect(await auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    });
  });

  it('signs out of every device at once', async () => {
    const first = await signInByLink();
    const second = await signInByLink(policy, first.user.email);
    expect(second.user.id).toBe(first.user.id);
    await first.auth.api.revokeSessions({ headers: new Headers({ cookie: first.cookie }) });
    expect(await sql`select 1 from auth_sessions where user_id = ${first.user.id}`).toHaveLength(0);
    for (const { cookie } of [first, second]) {
      expect(await first.auth.api.getSession({ headers: new Headers({ cookie }) })).toBeNull();
    }
  });

  describe('a password at the first workspace', () => {
    const deps = (auth: Auth) => ({
      sql,
      auth,
      lockout: passwordLockout(),
      notify: async () => undefined,
    });
    const field = async (promise: Promise<unknown>) => {
      const err = await promise.then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(AppError);
      return (err as AppError).field;
    };

    it('is required of someone who signs in only by emailed link, then never again', async () => {
      const { auth, cookie, user } = await signInByLink();
      const person = { id: user.id, email: user.email, name: user.name };
      expect(await needsPassword(sql, user.id)).toBe(true);
      expect(await field(choosePassword(sql, person, undefined))).toBe('password');
      expect(await field(choosePassword(sql, person, 'Password@123'))).toBe('password');

      const chosen = (await choosePassword(sql, person, GOOD))!;
      await setOwnPassword(deps(auth), person, new Headers({ cookie }), { newPassword: chosen });
      expect(await needsPassword(sql, user.id)).toBe(false);
      expect(await choosePassword(sql, person, undefined)).toBeNull();
    });

    it('is not asked of someone who signs in with Google', async () => {
      const { user } = await signInByLink();
      await sql`
        insert into auth_accounts (id, user_id, account_id, provider_id)
        values (${randomUUID()}, ${user.id}, ${'google-' + user.id}, 'google')`;
      expect(await needsPassword(sql, user.id)).toBe(false);
    });

    it('is already done for someone who joined by invitation with a new account', async () => {
      const owner = await signInByLink();
      const workspace = await createWorkspace(sql, { name: 'Acme', userId: owner.user.id });
      const email = `new-${randomUUID().slice(0, 6)}@example.com`;
      const { token } = await createInvitation(sql, {
        workspaceId: workspace.id,
        email,
        role: 'member',
        invitedBy: { userId: owner.user.id, role: 'owner' },
      });
      await createInvitedAccount(
        { sql, auth: owner.auth },
        { token, name: 'Ravi', password: GOOD },
      );
      const [joined] = await sql<
        { id: string }[]
      >`select id from auth_users where email = ${email}`;
      expect(await needsPassword(sql, joined!.id)).toBe(false);
    });

    it('is asked of an invited member who has only ever used emailed links', async () => {
      const owner = await signInByLink();
      const workspace = await createWorkspace(sql, { name: 'Beta', userId: owner.user.id });
      const member = await signInByLink();
      const { token } = await createInvitation(sql, {
        workspaceId: workspace.id,
        email: member.user.email,
        role: 'member',
        invitedBy: { userId: owner.user.id, role: 'owner' },
      });
      const person = { id: member.user.id, email: member.user.email, name: member.user.name };
      expect(await field(choosePassword(sql, person, 'short'))).toBe('password');
      const chosen = (await choosePassword(sql, person, GOOD))!;
      expect(await acceptInvitation(sql, token, person)).toEqual({ workspaceSlug: workspace.slug });
      await setOwnPassword(deps(member.auth), person, new Headers({ cookie: member.cookie }), {
        newPassword: chosen,
      });
      expect(await needsPassword(sql, member.user.id)).toBe(false);
    });
  });
});
