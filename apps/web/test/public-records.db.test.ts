import { randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import {
  consoleMailer,
  consoleOtpSender,
  createSignServer,
  memoryFileStore,
  postgresStore,
} from '@codevibe_technology/sign-server';
import {
  auditTrailPdf,
  certificatePdf,
  sealCertificate,
  verify,
} from '@codevibe_technology/sign-pdf';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString } from 'pdf-lib';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG, makeP12, makePdf } from './fixtures';
import { createApiKey, resolveApiKey } from '@/server/api-keys';
import { recordSender } from '@/server/envelopes';
import { migrateAll } from '@/server/migrate';
import {
  certificateSender,
  ensurePublicRecord,
  findLiveRecord,
  loadRecordSource,
  publicRecordView,
  publicRecordsEnabled,
  recordCertificates,
  recordOfEnvelope,
  recordUrl,
  setPublicRecords,
  setRecordRevoked,
  type SealChecker,
} from '@/server/public-records';
import { createAuthenticate } from '@/server/sign/principal';
import { createWorkspace } from '@/server/workspaces';

const url = process.env.DATABASE_URL;
const APP_URL = 'https://sign.example.com';
const PASSPHRASE = 'seal-passphrase';
const BROWSER = 'TestBrowser/9.9 (Record Suite)';

/** Every piece of text drawn on the pages of a PDF made by pdf-lib with standard fonts. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const text: string[] = [];
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    if (!(object instanceof PDFRawStream)) continue;
    const raw = object.getContents();
    let content: string;
    try {
      content = inflateSync(raw).toString('latin1');
    } catch {
      content = Buffer.from(raw).toString('latin1');
    }
    for (const match of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) {
      text.push(Buffer.from(match[1] ?? '', 'hex').toString('latin1'));
    }
  }
  return text.join('\n');
}

/** The link on the last page of a sealed file, where the certificate page prints its record. */
async function certificateLink(bytes: Uint8Array): Promise<string | null> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(doc.getPageCount() - 1);
  const annotations = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
  for (let index = 0; index < (annotations?.size() ?? 0); index += 1) {
    const annotation = annotations!.lookup(index, PDFDict);
    if (annotation.lookup(PDFName.of('Subtype')) !== PDFName.of('Link')) continue;
    return annotation
      .lookup(PDFName.of('A'), PDFDict)
      .lookup(PDFName.of('URI'), PDFString)
      .asString();
  }
  return null;
}

describe.skipIf(!url)('public records against PostgreSQL', () => {
  const schema = `web_records_test_${process.pid}_${Date.now()}`;
  const p12 = makeP12(PASSPHRASE);
  let admin: postgres.Sql;
  let sql: postgres.Sql;
  let asha: { id: string; email: string };
  let sign: ReturnType<typeof createSignServer>;
  const mailer = consoleMailer({ silent: true });

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create schema ${schema}`);
    sql = postgres(url!, { max: 4, onnotice: () => {}, connection: { search_path: schema } });
    expect(await migrateAll(sql)).toContain('app/0012_public_records');
    const id = randomUUID();
    asha = { id, email: `asha-${id.slice(0, 6)}@acme.example` };
    await sql`insert into auth_users (id, name, email) values (${id}, 'Asha Rao', ${asha.email})`;
    sign = createSignServer({
      store: postgresStore(sql),
      files: memoryFileStore(),
      mailer,
      otp: consoleOtpSender({ silent: true }),
      sealer: { p12, passphrase: PASSPHRASE },
      apiKeys: [],
      authenticate: createAuthenticate({
        appUrl: APP_URL,
        resolveApiKey: (key) => resolveApiKey(sql, key),
        sessionUser: async () => null,
        roleOf: async () => null,
      }),
      certificateDetails: async ({ workspaceId, envelope }) => {
        const [sender, recordId] = await Promise.all([
          certificateSender(sql, workspaceId, envelope.id),
          ensurePublicRecord(sql, { workspaceId, envelopeId: envelope.id }),
        ]);
        return {
          ...(sender ? { sender } : {}),
          ...(recordId ? { recordUrl: recordUrl(APP_URL, recordId) } : {}),
        };
      },
      basePath: '/api',
      publicUrl: APP_URL,
    });
  });

  afterAll(async () => {
    await sql?.end();
    await admin?.unsafe(`drop schema ${schema} cascade`);
    await admin?.end();
  });

  /** Sends one document to one signer, signs it and waits for the sealed file. */
  async function complete(workspaceId: string, options: { sentFromApp?: boolean } = {}) {
    const { key } = await createApiKey(sql, { workspaceId, name: 'k', createdBy: asha.id });
    const auth = { authorization: `Bearer ${key}` };
    const created = await sign.app.request('/api/v1/envelopes', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Supply agreement',
        message: 'A private note for the signer only',
        documents: [
          {
            key: 'doc',
            name: 'agreement.pdf',
            content: Buffer.from(await makePdf(2)).toString('base64'),
          },
        ],
        recipients: [
          { key: 'ravi', name: 'Ravi Menon', email: 'ravi.menon@example.com', auth: 'email_link' },
        ],
        fields: [
          { recipient: 'ravi', type: 'signature', page: 0, x: 72, y: 600, width: 180, height: 48 },
        ],
      }),
    });
    expect(created.status).toBe(201);
    const envelope = (await created.json()) as {
      id: string;
      fields: { id: string }[];
      documents: { id: string }[];
    };
    if (options.sentFromApp) {
      await recordSender(sql, { workspaceId, envelopeId: envelope.id, userId: asha.id });
    }
    const sent = await sign.app.request(`/api/v1/envelopes/${envelope.id}/send`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(sent.status).toBe(200);
    const token = /\/api\/sign\/([A-Za-z0-9_-]+)/.exec(mailer.sent.at(-1)!.text)![1]!;
    const signed = await sign.app.request(`/api/v1/sign/${token}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': BROWSER },
      body: JSON.stringify({
        consent: true,
        values: [{ fieldId: envelope.fields[0]!.id, value: PNG }],
      }),
    });
    expect(signed.status).toBe(200);
    const documentId = envelope.documents[0]!.id;
    const sealedPath = `/api/v1/envelopes/${envelope.id}/documents/${documentId}?version=sealed`;
    await expect
      .poll(async () => (await sign.app.request(sealedPath, { headers: auth })).status, {
        timeout: 20_000,
      })
      .toBe(200);
    const sealed = new Uint8Array(
      await (await sign.app.request(sealedPath, { headers: auth })).arrayBuffer(),
    );
    const checkSeal: SealChecker = async (_workspace, envelopeId, docId) => {
      const res = await sign.app.request(
        `/api/v1/envelopes/${envelopeId}/documents/${docId}/verification`,
        { headers: auth },
      );
      return res.ok ? ((await res.json()) as Awaited<ReturnType<SealChecker>>) : null;
    };
    return { envelopeId: envelope.id, sealed, checkSeal };
  }

  it('gives a completed envelope a record and prints its link under the seal', async () => {
    const ws = await createWorkspace(sql, { name: 'Acme Pvt Ltd', userId: asha.id });
    const { envelopeId, sealed } = await complete(ws.id, { sentFromApp: true });

    const record = await recordOfEnvelope(sql, ws.id, envelopeId);
    expect(record?.revokedAt).toBeNull();
    // 18 random bytes as base64url, and never the envelope id.
    expect(record!.id).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(record!.id).not.toContain(envelopeId);
    expect(await ensurePublicRecord(sql, { workspaceId: ws.id, envelopeId })).toBe(record!.id);

    expect(await certificateLink(sealed)).toBe(`${APP_URL}/r/${record!.id}`);
    expect((await PDFDocument.load(sealed)).getPageCount()).toBe(3);
    const text = await pdfText(sealed);
    expect(text).toContain('Signing certificate');
    expect(text).toContain('Asha Rao, Acme Pvt Ltd');
    expect(text).toContain('r****@example.com');
    expect(text).not.toContain('ravi.menon@example.com');
    expect(text).not.toContain(asha.email);
    expect(text).not.toContain('TestBrowser');
    expect(text).not.toContain('IP address');

    const trust = { fingerprints: [sealCertificate({ p12, passphrase: PASSPHRASE }).sha256] };
    const check = await verify(sealed, { trust });
    expect(check).toMatchObject({ valid: true, trustedBy: 'certificate' });
    expect(check.seal.coversWholeDocument).toBe(true);

    // The public verify API gives the same answer for the file and for its hash.
    const posted = await sign.app.request('/api/v1/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: Buffer.from(sealed),
    });
    const answer = (await posted.json()) as {
      valid: boolean;
      sha256: string;
      envelope: { id: string } | null;
    };
    expect(answer).toMatchObject({ valid: true, envelope: { id: envelopeId } });
    const byHash = await sign.app.request(`/api/v1/verify/${answer.sha256}`);
    expect(await byHash.json()).toMatchObject({ valid: true, envelope: { id: envelopeId } });
    expect(JSON.stringify(answer)).not.toContain('TestBrowser');
  });

  it('shows the record without addresses, browsers, messages or signature data', async () => {
    const ws = await createWorkspace(sql, { name: 'Brightside Traders', userId: asha.id });
    const { envelopeId, checkSeal } = await complete(ws.id, { sentFromApp: true });
    const record = (await recordOfEnvelope(sql, ws.id, envelopeId))!;

    const source = (await loadRecordSource(sql, record.id))!;
    // The stored events do hold the browser; the view must not.
    expect(JSON.stringify(source.events)).toContain('TestBrowser');
    const view = await publicRecordView(source, checkSeal);
    expect(view).toMatchObject({
      id: record.id,
      envelopeId,
      title: 'Supply agreement',
      status: 'completed',
      sender: { name: 'Asha Rao', organization: 'Brightside Traders' },
      chain: { valid: true },
    });
    // The head printed on the certificate is the hash of the last step before sealing.
    const sealedStep = view.trail.findIndex((e) => e.action === 'document.sealed');
    expect(view.chain.headAtSealing).toBe(view.trail[sealedStep - 1]!.hash);
    expect(view.chain.head).toBe(view.trail.at(-1)!.hash);
    expect(view.documents).toHaveLength(1);
    expect(view.documents[0]).toMatchObject({
      name: 'agreement.pdf',
      pageCount: 2,
      seal: 'verified',
    });
    expect(view.documents[0]!.sealedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(view.signers).toEqual([
      expect.objectContaining({
        name: 'Ravi Menon',
        contact: 'r****@example.com',
        auth: 'email_link',
        status: 'signed',
      }),
    ]);
    expect(view.trail.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        'envelope.sent',
        'recipient.signed',
        'envelope.completed',
        'document.sealed',
      ]),
    );
    expect(
      view.trail.every((e) => Object.keys(e).sort().join() === 'action,actor,at,hash,seq'),
    ).toBe(true);

    const shown = JSON.stringify(view);
    for (const hidden of [
      'TestBrowser',
      'userAgent',
      '"ip"',
      'context',
      'ravi.menon@example.com',
      asha.email,
      'A private note',
      PNG,
      'fileKey',
    ]) {
      expect(shown).not.toContain(hidden);
    }

    const certificates = recordCertificates(source, APP_URL, 'Asia/Kolkata');
    expect(JSON.stringify(certificates.map((c) => c.events))).not.toContain('TestBrowser');
    for (const bytes of [
      await certificatePdf(certificates),
      await auditTrailPdf({ envelope: source.envelope, events: certificates[0]!.events }),
    ]) {
      const text = await pdfText(bytes);
      expect(text).toContain('Supply agreement');
      expect(text).not.toContain('TestBrowser');
      expect(text).not.toContain('ravi.menon@example.com');
      expect(text).not.toContain('A private note');
    }
    expect(await certificateLink(await certificatePdf(certificates))).toBe(
      `${APP_URL}/r/${record.id}`,
    );
  });

  it('reports a stored file that no longer matches its recorded fingerprint', async () => {
    const ws = await createWorkspace(sql, { name: 'Mismatch', userId: asha.id });
    const { envelopeId } = await complete(ws.id);
    const record = (await recordOfEnvelope(sql, ws.id, envelopeId))!;
    const source = (await loadRecordSource(sql, record.id))!;
    const swapped = await publicRecordView(source, async () => ({
      valid: true,
      sha256: '0'.repeat(64),
      signedAt: null,
    }));
    expect(swapped.documents[0]!.seal).toBe('failed');
    const broken = await publicRecordView(source, async () => {
      throw new Error('storage is down');
    });
    expect(broken.documents[0]!.seal).toBe('failed');
    // An envelope created through the API names the workspace as its sender.
    expect(swapped.sender).toEqual({ name: null, organization: 'Mismatch' });
  });

  it('hides a revoked record like one that never existed, until it is turned on again', async () => {
    const ws = await createWorkspace(sql, { name: 'Revoker', userId: asha.id });
    const other = await createWorkspace(sql, { name: 'Bystander', userId: asha.id });
    const { envelopeId } = await complete(ws.id);
    const record = (await recordOfEnvelope(sql, ws.id, envelopeId))!;
    expect((await findLiveRecord(sql, record.id))?.envelopeId).toBe(envelopeId);

    // Another workspace can neither see nor revoke it.
    expect(await recordOfEnvelope(sql, other.id, envelopeId)).toBeNull();
    expect(
      await setRecordRevoked(sql, {
        workspaceId: other.id,
        envelopeId,
        revoked: true,
        userId: asha.id,
      }),
    ).toBe(false);
    expect(await findLiveRecord(sql, record.id)).not.toBeNull();

    const revoke = (revoked: boolean) =>
      setRecordRevoked(sql, { workspaceId: ws.id, envelopeId, revoked, userId: asha.id });
    expect(await revoke(true)).toBe(true);
    expect(await findLiveRecord(sql, record.id)).toBeNull();
    expect(await loadRecordSource(sql, record.id)).toBeNull();
    expect((await recordOfEnvelope(sql, ws.id, envelopeId))?.revokedAt).not.toBeNull();
    // Sealing again must not bring it back or mint another id.
    expect(await ensurePublicRecord(sql, { workspaceId: ws.id, envelopeId })).toBe(record.id);
    expect(await findLiveRecord(sql, record.id)).toBeNull();

    expect(await revoke(false)).toBe(true);
    expect(await findLiveRecord(sql, record.id)).not.toBeNull();

    for (const id of [
      '',
      'short',
      `${record.id}x`,
      "'; drop table app_public_records; --",
      envelopeId,
    ]) {
      expect(await findLiveRecord(sql, id)).toBeNull();
    }
  });

  it('makes no records, and hides old ones, while a workspace has them turned off', async () => {
    const ws = await createWorkspace(sql, { name: 'Private Co', userId: asha.id });
    expect(await publicRecordsEnabled(sql, ws.id)).toBe(true);
    const before = await complete(ws.id);
    const record = (await recordOfEnvelope(sql, ws.id, before.envelopeId))!;

    expect(await setPublicRecords(sql, ws.id, false)).toBe(false);
    expect(await findLiveRecord(sql, record.id)).toBeNull();
    const during = await complete(ws.id);
    expect(await recordOfEnvelope(sql, ws.id, during.envelopeId)).toBeNull();
    expect(await certificateLink(during.sealed)).toBeNull();
    const text = await pdfText(during.sealed);
    expect(text).toContain('Signing certificate');
    expect(text).not.toContain('Public record');
    const trust = { fingerprints: [sealCertificate({ p12, passphrase: PASSPHRASE }).sha256] };
    expect((await verify(during.sealed, { trust })).valid).toBe(true);

    await setPublicRecords(sql, ws.id, true);
    expect(await findLiveRecord(sql, record.id)).not.toBeNull();
    expect(await publicRecordsEnabled(sql, 'ws_missing')).toBe(false);
  });
});
