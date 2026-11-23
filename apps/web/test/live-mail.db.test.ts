import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LIVE_CHANNEL } from '@/server/live/events';
import { createLiveHub, type LiveSignal } from '@/server/live/hub';
import { publishChange } from '@/server/live/live';
import {
  completedCopyMail,
  listMailLog,
  loggingMailer,
  pruneMailLog,
  recordMail,
  type MailLogEntry,
} from '@/server/mail-log';
import { mailSenderOnDecline } from '@/server/decline-mail';
import { migrateAll } from '@/server/migrate';

const url = process.env.DATABASE_URL;

const entry = (patch: Partial<MailLogEntry>): MailLogEntry => ({
  workspaceId: null,
  envelopeId: null,
  recipientId: null,
  kind: 'invite',
  recipientEmail: 'asha@example.com',
  subject: 'Please sign',
  providerMessageId: null,
  status: 'sent',
  error: null,
  attachmentCount: 0,
  attachmentBytes: 0,
  ...patch,
});

describe.skipIf(!url)('live updates and the mail log against PostgreSQL', () => {
  const schema = `web_live_test_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  const ws = { a: `ws_${randomUUID().slice(0, 8)}`, b: `ws_${randomUUID().slice(0, 8)}` };

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 4, onnotice: () => {}, connection: { search_path: schema } });
    expect(await migrateAll(sql)).toContain('app/0008_mail_log');
    for (const id of [ws.a, ws.b]) {
      await sql`insert into app_workspaces (id, slug, name) values (${id}, ${id}, ${id})`;
    }
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  it('fans NOTIFY out to subscribers of the right workspace only', async () => {
    const hub = createLiveHub((channel, onMessage, onListen) =>
      sql.listen(channel, onMessage, onListen),
    );
    const a: LiveSignal[] = [];
    const b: LiveSignal[] = [];
    await hub.subscribe(ws.a, (s) => a.push(s));
    await hub.subscribe(ws.b, (s) => b.push(s));
    const raw: string[] = [];
    await sql.listen(LIVE_CHANNEL, (payload) => raw.push(payload));

    await publishChange(sql, {
      workspaceId: ws.a,
      envelopeId: 'env_1',
      actions: ['recipient.signed'],
    });
    await expect.poll(() => a.length).toBe(1);
    expect(a[0]).toEqual({
      type: 'change',
      change: { workspaceId: ws.a, envelopeId: 'env_1', actions: ['recipient.signed'] },
    });
    expect(b).toEqual([]);
    await expect.poll(() => raw.length).toBe(1);
    expect(JSON.parse(raw[0]!)).toEqual({ w: ws.a, e: 'env_1', a: ['recipient.signed'] });
  });

  it('logs sends and failures and lists them newest first, per envelope', async () => {
    let fail = false;
    const mailer = loggingMailer(
      {
        send: async () => {
          if (fail) throw new Error('421 4.7.0 Try again later');
          return { messageId: '<ok@sign.example.com>' };
        },
      },
      (e) => recordMail(sql, e),
    );
    const meta = {
      kind: 'completed_copy',
      workspaceId: ws.a,
      envelopeId: 'env_9',
      recipientId: 'r1',
    };
    await mailer.send({ to: 'asha@example.com', subject: 'Completed', text: 'x', meta });
    fail = true;
    await expect(
      mailer.send({
        to: 'ravi@example.com',
        subject: 'Completed',
        text: 'x',
        meta: { ...meta, recipientId: 'r2' },
      }),
    ).rejects.toThrow('421');
    await recordMail(sql, entry({ workspaceId: ws.b, envelopeId: 'env_9' }));

    const rows = await listMailLog(sql, ws.a, { envelopeId: 'env_9' });
    expect(rows.map((r) => [r.recipientEmail, r.status, r.error])).toEqual([
      ['ravi@example.com', 'failed', '421 4.7.0 Try again later'],
      ['asha@example.com', 'sent', null],
    ]);
    expect(rows[1]!.providerMessageId).toBe('<ok@sign.example.com>');
    const copies = await completedCopyMail(sql, ws.a, 'env_9');
    expect(copies.r1?.status).toBe('sent');
    expect(copies.r2?.status).toBe('failed');
    expect((await listMailLog(sql, ws.b)).every((r) => r.workspaceId === ws.b)).toBe(true);
  });

  it('keeps only the latest copy email per recipient', async () => {
    await recordMail(
      sql,
      entry({
        workspaceId: ws.a,
        envelopeId: 'env_7',
        recipientId: 'r1',
        kind: 'completed_copy',
        status: 'failed',
        error: 'x',
      }),
    );
    await new Promise((r) => setTimeout(r, 5));
    await recordMail(
      sql,
      entry({ workspaceId: ws.a, envelopeId: 'env_7', recipientId: 'r1', kind: 'completed_copy' }),
    );
    expect((await completedCopyMail(sql, ws.a, 'env_7')).r1?.status).toBe('sent');
  });

  it('deletes rows older than 90 days', async () => {
    await recordMail(sql, entry({ workspaceId: ws.b, subject: 'old' }));
    await sql`update app_mail_log set created_at = now() - interval '91 days' where subject = 'old'`;
    await recordMail(sql, entry({ workspaceId: ws.b, subject: 'recent' }));
    await sql`update app_mail_log set created_at = now() - interval '89 days' where subject = 'recent'`;
    expect(await pruneMailLog(sql)).toBe(1);
    const subjects = (await listMailLog(sql, ws.b)).map((r) => r.subject);
    expect(subjects).toContain('recent');
    expect(subjects).not.toContain('old');
  });

  it('emails the member who sent a declined envelope, with the reason', async () => {
    const userId = randomUUID();
    await sql`insert into auth_users (id, name, email) values (${userId}, 'Meera', ${`meera-${userId.slice(0, 6)}@example.com`})`;
    await sql`insert into app_envelope_senders (envelope_id, workspace_id, user_id) values ('env_d', ${ws.a}, ${userId})`;
    const sent: { to: string; subject: string; text: string; meta?: unknown }[] = [];
    const deps = {
      sql,
      appUrl: 'https://sign.example.com',
      mailer: { send: async (m: (typeof sent)[number]) => void sent.push(m) },
      load: async () =>
        ({
          id: 'env_d',
          title: 'Offer letter',
          recipients: [
            {
              id: 'r1',
              name: 'Satyam',
              role: 'approver',
              status: 'declined',
              declineReason: 'Clause 4',
            },
          ],
        }) as never,
    };
    await mailSenderOnDecline(deps, {
      workspaceId: ws.a,
      envelopeId: 'env_d',
      actions: ['recipient.signed'],
    });
    expect(sent).toEqual([]);
    await mailSenderOnDecline(deps, {
      workspaceId: ws.a,
      envelopeId: 'env_d',
      actions: ['recipient.declined', 'envelope.declined'],
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toBe('Declined: Offer letter');
    expect(sent[0]!.text).toContain('Their reason: Clause 4');
    expect(sent[0]!.text).toContain(`https://sign.example.com/dashboard/${ws.a}/envelopes/env_d`);
    expect(sent[0]!.meta).toMatchObject({ kind: 'decline_notice', envelopeId: 'env_d' });
    await mailSenderOnDecline(deps, {
      workspaceId: ws.b,
      envelopeId: 'env_d',
      actions: ['envelope.declined'],
    });
    expect(sent).toHaveLength(1);
  });
});
