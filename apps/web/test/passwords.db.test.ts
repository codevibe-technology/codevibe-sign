import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Auth } from '@/server/auth/auth';
import { authOptions } from '@/server/auth/config';
import { limitResetLinks } from '@/server/auth/magic-link-limit';
import { guardPasswords } from '@/server/auth/password-guard';
import {
  LOCKOUT_WINDOW_MS,
  MAX_FAILED_SIGN_INS,
  passwordLockout,
  type PasswordLockout,
} from '@/server/auth/password-lockout';
import { createInvitedAccount, hasPassword, setOwnPassword } from '@/server/auth/passwords';
import { AppError } from '@/server/errors';
import { acceptInvitation, createInvitation, revokeInvitation } from '@/server/invitations';
import { migrateAll } from '@/server/migrate';
import { createWorkspace } from '@/server/workspaces';

const url = process.env.DATABASE_URL;
const APP_URL = 'http://localhost:3000';
const SECRET = 'test-secret-0123456789abcdef0123456789';
const GOOD = 'mango-river-lantern';
const BETTER = 'seven quiet copper kettles';

async function rejectsWith(promise: Promise<unknown>, code: string, field?: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
  if (field) expect((err as AppError).field).toBe(field);
  return err as AppError;
}

describe.skipIf(!url)('passwords, against PostgreSQL', () => {
  const schema = `web_pw_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let auth: Auth;
  let lockout: PasswordLockout;
  let handle: (request: Request) => Promise<Response>;
  let clock = Date.now();
  const mail: { kind: 'magic' | 'reset' | 'changed'; email: string; url?: string }[] = [];

  const post = (path: string, body: unknown, cookie?: string) =>
    handle(
      new Request(`${APP_URL}/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: APP_URL,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const signIn = (email: string, password: string) => post('/sign-in/email', { email, password });
  const sessionCookie = (response: Response) =>
    response.headers
      .getSetCookie()
      .map((c) => c.split(';')[0]!)
      .filter((c) => c.startsWith('cvs.'))
      .join('; ');
  const sessionOf = async (cookie: string) =>
    (await auth.api.getSession({ headers: new Headers({ cookie }) }))?.user ?? null;
  const deps = () => ({
    sql,
    auth,
    lockout,
    notify: async (email: string) => void mail.push({ kind: 'changed', email }),
  });

  const lastLink = (email: string) =>
    mail.filter((m) => m.kind === 'magic' && m.email === email).at(-1)!.url!;

  /** Someone who has only ever used the emailed link: an account without a password. */
  async function linkUser(name: string) {
    const email = `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@example.com`;
    const sent = await post('/sign-in/magic-link', { email, name, callbackURL: '/' });
    expect(sent.status).toBe(200);
    const link = lastLink(email);
    const cookie = sessionCookie(await handle(new Request(link)));
    const user = (await sessionOf(cookie))!;
    expect(user.email).toBe(email);
    return { id: user.id, email, name: user.name, cookie };
  }

  /** Someone invited to a workspace, with the token from their invitation email. */
  async function invited(owner: { id: string }, email: string) {
    const workspace = await createWorkspace(sql, {
      name: `Team ${randomUUID().slice(0, 6)}`,
      userId: owner.id,
    });
    const { invitation, token } = await createInvitation(sql, {
      workspaceId: workspace.id,
      email,
      role: 'member',
      invitedBy: { userId: owner.id, role: 'owner' },
    });
    return { workspace, token, id: invitation.id };
  }

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 4, onnotice: () => {}, connection: { search_path: schema } });
    await migrateAll(sql);
    const sendReset = limitResetLinks(
      async (email, link) => void mail.push({ kind: 'reset', email, url: link }),
      () => new Date(clock),
    );
    auth = betterAuth(
      authOptions({
        sql,
        appUrl: APP_URL,
        secret: SECRET,
        sendMagicLink: async (email, link) => void mail.push({ kind: 'magic', email, url: link }),
        sendPasswordReset: sendReset,
        passwordChanged: async (email) => void mail.push({ kind: 'changed', email }),
      }),
    ) as unknown as Auth;
  });

  beforeEach(() => {
    clock = Date.now();
    lockout = passwordLockout(() => new Date(clock));
    handle = guardPasswords((request) => auth.handler(request), lockout);
    mail.length = 0;
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  describe('an invitation', () => {
    it('lets a new person create their account with a password and join', async () => {
      const owner = await linkUser('Owner');
      const email = `new-${randomUUID().slice(0, 6)}@example.com`;
      const { token, workspace } = await invited(owner, email);

      expect(
        await createInvitedAccount({ sql, auth }, { token, name: ' Ravi  Kumar ', password: GOOD }),
      ).toEqual({ email });
      const [row] = await sql`
        select u.id, u.name, u.email_verified, a.password
        from auth_users u join auth_accounts a on a.user_id = u.id where u.email = ${email}`;
      expect(row).toMatchObject({ name: 'Ravi Kumar', email_verified: true });
      expect(row!.password).not.toContain(GOOD);
      expect(row!.password.length).toBeGreaterThan(60);

      const signedIn = await signIn(email, GOOD);
      expect(signedIn.status).toBe(200);
      const cookie = sessionCookie(signedIn);
      expect(signedIn.headers.getSetCookie().join()).toMatch(
        /cvs\.session_token=[^;]+;.*HttpOnly/i,
      );
      const user = (await sessionOf(cookie))!;
      expect(await acceptInvitation(sql, token, user)).toEqual({ workspaceSlug: workspace.slug });
      expect(await hasPassword(sql, user.id)).toBe(true);
    });

    it('is not a way to replace the password of an account that already exists', async () => {
      const owner = await linkUser('Owner');
      const existing = await linkUser('Existing');
      const { token } = await invited(owner, existing.email);
      await rejectsWith(
        createInvitedAccount({ sql, auth }, { token, name: 'Mallory', password: GOOD }),
        'CONFLICT',
      );
      expect(await hasPassword(sql, existing.id)).toBe(false);
      expect((await signIn(existing.email, GOOD)).status).toBe(401);
    });

    it('refuses a dead invitation, a missing name and a weak password', async () => {
      const owner = await linkUser('Owner');
      const email = `weak-${randomUUID().slice(0, 6)}@example.com`;
      const { token, workspace, id } = await invited(owner, email);
      const join = (input: Partial<{ token: string; name: string; password: string }>) =>
        createInvitedAccount({ sql, auth }, { token, name: 'Ravi', password: GOOD, ...input });

      await rejectsWith(join({ token: 'not-a-token' }), 'NOT_FOUND');
      await rejectsWith(join({ name: '   ' }), 'VALIDATION', 'name');
      await rejectsWith(join({ password: 'short' }), 'VALIDATION', 'newPassword');
      await rejectsWith(join({ password: 'Password@123' }), 'VALIDATION', 'newPassword');
      await rejectsWith(
        join({ password: `${email.split('@')[0]}!!` }),
        'VALIDATION',
        'newPassword',
      );
      await revokeInvitation(sql, workspace.id, id);
      await rejectsWith(join({}), 'NOT_FOUND');
      expect(await sql`select 1 from auth_users where email = ${email}`).toHaveLength(0);
    });
  });

  describe('sign-in', () => {
    it('has no open registration: an account starts from an emailed link', async () => {
      const email = `open-${randomUUID().slice(0, 6)}@example.com`;
      const res = await post('/sign-up/email', { email, password: GOOD, name: 'Open' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await sql`select 1 from auth_users where email = ${email}`).toHaveLength(0);
    });

    it('answers the same for a wrong password, an account without one and no account', async () => {
      const withLink = await linkUser('Linked');
      const withPassword = await linkUser('Pat');
      await setOwnPassword(deps(), withPassword, new Headers({ cookie: withPassword.cookie }), {
        newPassword: GOOD,
      });
      const answers = [];
      for (const email of [withPassword.email, withLink.email, 'nobody@example.com']) {
        const res = await signIn(email, 'not-the-password');
        answers.push([res.status, await res.json()]);
      }
      expect(answers[0]![0]).toBe(401);
      expect(answers[1]).toEqual(answers[0]);
      expect(answers[2]).toEqual(answers[0]);
      expect(sessionCookie(await signIn(withPassword.email, 'not-the-password'))).not.toMatch(
        /session_token=\S/,
      );
    });

    it('pauses for an address after five wrong passwords, even for the right one', async () => {
      const user = await linkUser('Lock');
      await setOwnPassword(deps(), user, new Headers({ cookie: user.cookie }), {
        newPassword: GOOD,
      });
      for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) {
        expect((await signIn(user.email, `wrong-password-${i}`)).status).toBe(401);
      }
      const locked = await signIn(user.email.toUpperCase(), GOOD);
      expect(locked.status).toBe(429);
      expect(Number(locked.headers.get('retry-after'))).toBeGreaterThan(0);
      expect((await locked.json()).message).toMatch(/Email me a link instead/);
      expect(sessionCookie(locked)).toBe('');

      const other = await linkUser('Other');
      await setOwnPassword(deps(), other, new Headers({ cookie: other.cookie }), {
        newPassword: GOOD,
      });
      expect((await signIn(other.email, GOOD)).status).toBe(200);

      clock += LOCKOUT_WINDOW_MS + 1000;
      expect((await signIn(user.email, GOOD)).status).toBe(200);
    });

    it('forgets earlier slips after a correct password', async () => {
      const user = await linkUser('Slip');
      await setOwnPassword(deps(), user, new Headers({ cookie: user.cookie }), {
        newPassword: GOOD,
      });
      for (let round = 0; round < 3; round++) {
        for (let i = 0; i < MAX_FAILED_SIGN_INS - 1; i++)
          await signIn(user.email, 'wrong-password');
        expect((await signIn(user.email, GOOD)).status).toBe(200);
      }
    });

    it('still signs in with an emailed link while the password is paused', async () => {
      const user = await linkUser('Paused');
      await setOwnPassword(deps(), user, new Headers({ cookie: user.cookie }), {
        newPassword: GOOD,
      });
      for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) await signIn(user.email, 'wrong-password');
      expect((await signIn(user.email, GOOD)).status).toBe(429);
      await post('/sign-in/magic-link', { email: user.email, callbackURL: '/' });
      const link = lastLink(user.email);
      expect((await sessionOf(sessionCookie(await handle(new Request(link)))))?.id).toBe(user.id);
    });
  });

  describe('a forgotten password', () => {
    const request = (email: string) =>
      post('/request-password-reset', { email, redirectTo: '/reset-password' });
    const tokenOf = (link: string) => new URL(link).pathname.split('/').pop()!;

    it('answers the same whether or not the address has an account', async () => {
      const user = await linkUser('Known');
      const known = await request(user.email);
      const unknown = await request('nobody@example.com');
      expect(known.status).toBe(200);
      expect(await unknown.json()).toEqual(await known.json());
      expect(mail.filter((m) => m.kind === 'reset').map((m) => m.email)).toEqual([user.email]);
    });

    it('sets a new password once, signs every session out and tells the owner', async () => {
      const user = await linkUser('Reset');
      await setOwnPassword(deps(), user, new Headers({ cookie: user.cookie }), {
        newPassword: GOOD,
      });
      const elsewhere = sessionCookie(await signIn(user.email, GOOD));
      mail.length = 0;

      await request(user.email);
      const link = mail.find((m) => m.kind === 'reset')!.url!;
      expect(link).toContain(`${APP_URL}/api/auth/reset-password/`);
      const landed = await handle(new Request(link));
      expect(landed.status).toBe(302);
      expect(landed.headers.get('location')).toMatch(/\/reset-password\?token=/);
      const token = tokenOf(link);

      const weak = await post('/reset-password', { token, newPassword: 'Password@123' });
      expect([weak.status, (await weak.json()).code]).toEqual([400, 'WEAK_PASSWORD']);
      const short = await post('/reset-password', { token, newPassword: 'short' });
      expect(short.status).toBe(400);

      expect((await post('/reset-password', { token, newPassword: BETTER })).status).toBe(200);
      expect(mail.filter((m) => m.kind === 'changed').map((m) => m.email)).toEqual([user.email]);
      expect(await sessionOf(user.cookie)).toBeNull();
      expect(await sessionOf(elsewhere)).toBeNull();
      expect((await signIn(user.email, GOOD)).status).toBe(401);
      expect((await signIn(user.email, BETTER)).status).toBe(200);

      const again = await post('/reset-password', { token, newPassword: 'another fine password' });
      expect(again.status).toBe(400);
      expect((await signIn(user.email, BETTER)).status).toBe(200);
    });

    it('gives someone who only used links their first password', async () => {
      const user = await linkUser('First');
      await request(user.email);
      const token = tokenOf(mail.find((m) => m.kind === 'reset')!.url!);
      expect((await post('/reset-password', { token, newPassword: GOOD })).status).toBe(200);
      expect(await hasPassword(sql, user.id)).toBe(true);
      expect((await signIn(user.email, GOOD)).status).toBe(200);
    });

    it('refuses an expired or invented link', async () => {
      const user = await linkUser('Late');
      await request(user.email);
      const token = tokenOf(mail.find((m) => m.kind === 'reset')!.url!);
      await sql`update auth_verifications set expires_at = now() - interval '1 minute'
        where identifier = ${`reset-password:${token}`}`;
      expect((await post('/reset-password', { token, newPassword: GOOD })).status).toBe(400);
      expect((await post('/reset-password', { token: 'invented', newPassword: GOOD })).status).toBe(
        400,
      );
      expect(await hasPassword(sql, user.id)).toBe(false);
    });

    it('sends one address five links in fifteen minutes, then none, with the same answer', async () => {
      const user = await linkUser('Flood');
      const answers = [];
      for (let i = 0; i < 8; i++) answers.push((await request(user.email)).status);
      expect(new Set(answers)).toEqual(new Set([200]));
      expect(mail.filter((m) => m.kind === 'reset')).toHaveLength(5);
      clock += 16 * 60_000;
      await request(user.email);
      expect(mail.filter((m) => m.kind === 'reset')).toHaveLength(6);
    });
  });

  describe('the password in settings', () => {
    it('sets the first password from a signed-in session and tells the owner', async () => {
      const user = await linkUser('Setter');
      expect(await hasPassword(sql, user.id)).toBe(false);
      const headers = new Headers({ cookie: user.cookie });
      await rejectsWith(
        setOwnPassword(deps(), user, headers, { newPassword: 'qwertyuiop' }),
        'VALIDATION',
        'newPassword',
      );
      await rejectsWith(
        setOwnPassword(deps(), user, headers, { newPassword: `${user.email}` }),
        'VALIDATION',
        'newPassword',
      );
      expect(await setOwnPassword(deps(), user, headers, { newPassword: GOOD })).toEqual({
        hadPassword: false,
      });
      expect(mail.filter((m) => m.kind === 'changed').map((m) => m.email)).toEqual([user.email]);
      expect((await signIn(user.email, GOOD)).status).toBe(200);
      expect((await sessionOf(user.cookie))?.id).toBe(user.id);
    });

    it('changes it only with the current one, and counts wrong tries', async () => {
      const user = await linkUser('Changer');
      const headers = new Headers({ cookie: user.cookie });
      await setOwnPassword(deps(), user, headers, { newPassword: GOOD });
      await rejectsWith(
        setOwnPassword(deps(), user, headers, { newPassword: BETTER }),
        'VALIDATION',
        'currentPassword',
      );
      await rejectsWith(
        setOwnPassword(deps(), user, headers, { currentPassword: GOOD, newPassword: GOOD }),
        'VALIDATION',
        'newPassword',
      );
      for (let i = 0; i < MAX_FAILED_SIGN_INS; i++) {
        await rejectsWith(
          setOwnPassword(deps(), user, headers, {
            currentPassword: `wrong-${i}-wrong`,
            newPassword: BETTER,
          }),
          'VALIDATION',
          'currentPassword',
        );
      }
      await rejectsWith(
        setOwnPassword(deps(), user, headers, { currentPassword: GOOD, newPassword: BETTER }),
        'CONFLICT',
        'currentPassword',
      );
      expect((await signIn(user.email, GOOD)).status).toBe(429);
      clock += LOCKOUT_WINDOW_MS + 1000;
      expect(
        await setOwnPassword(deps(), user, headers, { currentPassword: GOOD, newPassword: BETTER }),
      ).toEqual({ hadPassword: true });
      expect((await signIn(user.email, GOOD)).status).toBe(401);
      expect((await signIn(user.email, BETTER)).status).toBe(200);
    });

    it('can sign every other session out while changing it', async () => {
      const user = await linkUser('Sessions');
      const headers = new Headers({ cookie: user.cookie });
      await setOwnPassword(deps(), user, headers, { newPassword: GOOD });
      const laptop = sessionCookie(await signIn(user.email, GOOD));
      const phone = sessionCookie(await signIn(user.email, GOOD));
      expect((await sessionOf(phone))?.id).toBe(user.id);

      await setOwnPassword(deps(), user, new Headers({ cookie: laptop }), {
        currentPassword: GOOD,
        newPassword: BETTER,
        signOutOthers: true,
      });
      expect(await sessionOf(phone)).toBeNull();
      expect(await sessionOf(user.cookie)).toBeNull();
    });

    it('signs other sessions out on request and keeps this one', async () => {
      const user = await linkUser('Others');
      await setOwnPassword(deps(), user, new Headers({ cookie: user.cookie }), {
        newPassword: GOOD,
      });
      const other = sessionCookie(await signIn(user.email, GOOD));
      await auth.api.revokeOtherSessions({ headers: new Headers({ cookie: user.cookie }) });
      expect(await sessionOf(other)).toBeNull();
      expect((await sessionOf(user.cookie))?.id).toBe(user.id);
    });

    it('refuses a weak password sent straight to the library’s own endpoint', async () => {
      const user = await linkUser('Direct');
      await setOwnPassword(deps(), user, new Headers({ cookie: user.cookie }), {
        newPassword: GOOD,
      });
      const res = await post(
        '/change-password',
        { currentPassword: GOOD, newPassword: 'Welcome@2026' },
        user.cookie,
      );
      expect([res.status, (await res.json()).code]).toEqual([400, 'WEAK_PASSWORD']);
      expect((await signIn(user.email, GOOD)).status).toBe(200);
    });
  });
});
