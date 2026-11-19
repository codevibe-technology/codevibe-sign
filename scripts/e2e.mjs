#!/usr/bin/env node
// Smoke test of the built packages over real HTTP with in-memory adapters.
// Run `pnpm build` first, then `node scripts/e2e.mjs`. Exits non-zero on the first failure.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const pkg = (path) => fileURLToPath(new URL(path, root));
const server = await import(pkg('packages/server/dist/index.js'));
const { verify, verifySeal } = await import(pkg('packages/pdf/dist/index.js'));
const { verifyChain } = await import(pkg('packages/core/dist/index.js'));
const require = createRequire(pkg('packages/server/package.json'));
const { PDFDocument, StandardFonts } = require('pdf-lib');
const forge = require('node-forge');

const API_KEY = 'smoke-key-0123456789abcdef0123456789';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function check(condition, message) {
  if (!condition) throw new Error(`Failed: ${message}`);
  console.log(`  ok  ${message}`);
}

async function makePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 2; i++) {
    doc.addPage([595.28, 841.89]).drawText(`Smoke test, page ${i}`, { x: 72, y: 760, font });
  }
  return doc.save();
}

function makeP12(passphrase) {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 2048, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 86_400_000);
  const subject = [{ name: 'commonName', value: 'Smoke Test Seal' }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], passphrase, {
    algorithm: '3des',
  });
  return {
    p12: new Uint8Array(Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary')),
    certificatePem: forge.pki.certificateToPem(cert),
  };
}

const mailer = server.consoleMailer({ silent: true });
const otp = server.consoleOtpSender({ silent: true });
const operator = makeP12('pw');
const stranger = makeP12('pw');
const sign = server.createSignServer({
  store: server.memoryStore(),
  files: server.memoryFileStore(),
  mailer,
  otp,
  sealer: { p12: operator.p12, passphrase: 'pw' },
  apiKeys: [API_KEY],
  publicUrl: 'https://sign.example.com',
});
const http = await server.listen(sign.app, { port: 0, hostname: '127.0.0.1' });
const base = `http://127.0.0.1:${http.address().port}`;

async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(path.startsWith('/v1/envelopes') ? { authorization: `Bearer ${API_KEY}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = res.headers.get('content-type')?.includes('json') ? await res.json() : undefined;
  return { res, status: res.status, json };
}

function tokenFor(email) {
  const mail = mailer.sent.findLast((m) => m.to === email && /\/sign\//.test(m.text));
  const token = mail?.text.match(/\/sign\/([A-Za-z0-9_-]+)/)?.[1];
  if (!token) throw new Error(`No signing link sent to ${email}`);
  return token;
}

try {
  console.log(`Codevibe Sign smoke test on ${base}`);
  const pdf = await makePdf();
  const created = await call('POST', '/v1/envelopes', {
    title: 'Smoke test',
    routing: 'sequential',
    documents: [{ name: 'smoke.pdf', content: Buffer.from(pdf).toString('base64') }],
    recipients: [
      { name: 'Asha Rao', email: 'asha@example.com', auth: 'email_otp' },
      { name: 'Ravi Kumar', email: 'ravi@example.com' },
    ],
  });
  check(created.status === 201, 'create a draft with a real PDF');
  const { id, recipients, documents } = created.json;
  const docId = documents[0].id;

  const placed = await call('PATCH', `/v1/envelopes/${id}`, {
    fields: recipients.map((r, i) => ({
      recipient: r.id,
      type: 'signature',
      page: 1,
      x: 72 + i * 240,
      y: 600,
      width: 180,
      height: 48,
    })),
  });
  check(placed.status === 200 && placed.json.fields.length === 2, 'place one field per signer');
  check((await call('POST', `/v1/envelopes/${id}/send`)).json?.status === 'sent', 'send');

  const asha = tokenFor('asha@example.com');
  const opened = await fetch(`${base}/sign/${asha}`, { redirect: 'manual' });
  check(
    opened.status === 303 &&
      !opened.headers.get('location')?.includes(asha) &&
      /HttpOnly/.test(opened.headers.get('set-cookie') ?? ''),
    'opening the link swaps the token for a cookie and redirects without it',
  );
  const lockedDoc = await call('GET', `/v1/sign/${asha}/documents/${docId}`);
  const lockedView = await call('POST', `/v1/sign/${asha}/view`);
  check(
    lockedDoc.json?.error?.code === 'OTP_INVALID' && lockedView.json?.error?.code === 'OTP_INVALID',
    'documents and actions stay locked until the code is verified',
  );
  await call('POST', `/v1/sign/${asha}/otp`);
  const code = otp.sent.at(-1)?.code;
  const verified = await call('POST', `/v1/sign/${asha}/otp/verify`, { code });
  check(verified.status === 200, 'verify the one-time code');
  const session = { 'x-sign-session': verified.json.sessionToken };
  const ashaField = (await call('GET', `/v1/sign/${asha}`, undefined, session)).json.fields[0].id;
  check((await call('POST', `/v1/sign/${asha}/view`, undefined, session)).status === 200, 'view');
  const ashaDone = await call(
    'POST',
    `/v1/sign/${asha}/submit`,
    { consent: true, values: [{ fieldId: ashaField, value: PNG }] },
    session,
  );
  check(ashaDone.json?.recipientStatus === 'signed', 'first signer signs');

  const ravi = tokenFor('ravi@example.com');
  const raviField = (await call('GET', `/v1/sign/${ravi}`)).json.fields[0].id;
  const raviDone = await call('POST', `/v1/sign/${ravi}/submit`, {
    consent: true,
    values: [{ fieldId: raviField, value: PNG }],
  });
  check(raviDone.json?.envelopeStatus === 'completed', 'second signer completes the envelope');

  const download = await call('GET', `/v1/envelopes/${id}/documents/${docId}`);
  const sealed = new Uint8Array(await download.res.arrayBuffer());
  const trust = { certificates: [operator.certificatePem] };
  const result = await verify(sealed, { trust });
  check(result.valid, 'the sealed PDF verifies against the operator certificate');
  const untrusted = await verify(sealed, { trust: { certificates: [stranger.certificatePem] } });
  check(
    !untrusted.valid && untrusted.reason === 'untrusted_signer' && untrusted.seal.valid,
    'the same file is refused against another certificate',
  );
  const report = await call('GET', `/v1/envelopes/${id}/documents/${docId}/verification`);
  check(report.json?.valid === true, 'the server reports the seal as valid');

  const events = (await call('GET', `/v1/envelopes/${id}/events`)).json;
  const hasher = server.nodeHasher;
  check(events.chainValid && (await verifyChain(events.events, hasher)).valid, 'audit chain');

  const tampered = new Uint8Array(sealed);
  tampered[tampered.length >> 2] ^= 0xff;
  check(!(await verify(tampered, { trust })).valid, 'a changed byte breaks the seal');
  check(!(await verifySeal(tampered)).valid, 'verifySeal sees the change too');
  events.events[1].at = '2020-01-01T00:00:00.000Z';
  check(!(await verifyChain(events.events, hasher)).valid, 'an edited event breaks the chain');
  console.log('Smoke test passed');
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  http.close();
  await sign.idle();
}
