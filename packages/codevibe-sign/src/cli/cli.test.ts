import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSignClient, createSignerClient } from '@codevibe_technology/sign-client';
import { seal, sealCertificate } from '@codevibe_technology/sign-pdf';
import { PDFDocument, PDFString } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDevSeal } from '../dev-seal';

const BIN = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

interface Run {
  code: number | null;
  stdout: string;
  stderr: string;
}

function cli(args: string[], env: Record<string, string> = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', NO_COLOR: '1', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function makePdf(pages: [number, number][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const size of pages) doc.addPage(size);
  return doc.save();
}

async function makeEncryptedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([595.28, 841.89]);
  const encrypt = doc.context.obj({
    Filter: 'Standard',
    V: 1,
    R: 2,
    O: PDFString.of('x'.repeat(32)),
    U: PDFString.of('y'.repeat(32)),
    P: -44,
  });
  doc.context.trailerInfo.Encrypt = doc.context.register(encrypt);
  return doc.save({ useObjectStreams: false });
}

let dir: string;
const operator = createDevSeal({ commonName: 'Acme Seal', organization: 'Acme', passphrase: 'pw' });
const stranger = createDevSeal({ commonName: 'Someone Else', passphrase: 'pw' });

beforeAll(async () => {
  if (!existsSync(BIN)) throw new Error('Build the package first: pnpm build');
  dir = await mkdtemp(join(tmpdir(), 'codevibe-sign-cli-'));
  const plain = await makePdf([
    [595.28, 841.89],
    [595.28, 841.89],
    [792, 612],
  ]);
  const sealed = await seal(plain, { p12: operator.p12, passphrase: 'pw' });
  const tampered = new Uint8Array(sealed);
  tampered[tampered.length >> 2]! ^= 0xff;
  const appended = new Uint8Array([...sealed, ...Buffer.from('\n% added later\n')]);
  await Promise.all([
    writeFile(join(dir, 'plain.pdf'), plain),
    writeFile(join(dir, 'sealed.pdf'), sealed),
    writeFile(join(dir, 'tampered.pdf'), tampered),
    writeFile(join(dir, 'appended.pdf'), appended),
    writeFile(join(dir, 'encrypted.pdf'), await makeEncryptedPdf()),
    writeFile(join(dir, 'broken.pdf'), Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog')),
    writeFile(join(dir, 'notes.txt'), 'not a pdf'),
    writeFile(join(dir, 'operator.pem'), operator.certificatePem),
    writeFile(join(dir, 'stranger.pem'), stranger.certificatePem),
  ]);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('codevibe-sign', () => {
  it('prints help and the version', async () => {
    const help = await cli(['--help']);
    expect(help.code).toBe(0);
    for (const command of ['start', 'verify', 'inspect', 'keygen', 'hash', 'api-key']) {
      expect(help.stdout).toContain(`  ${command} `);
    }
    const version = await cli(['--version']);
    const manifest = JSON.parse(
      await readFile(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { version: string };
    expect(version.stdout.trim()).toBe(manifest.version);
    expect((await cli([])).stdout).toContain('Usage');
  });

  it.each(['start', 'verify', 'inspect', 'keygen', 'hash', 'api-key'])(
    'prints help for %s',
    async (command) => {
      const run = await cli([command, '--help']);
      expect(run.code).toBe(0);
      expect(run.stdout).toContain(`codevibe-sign ${command}`);
      expect((await cli(['help', command])).stdout).toBe(run.stdout);
    },
  );

  it('rejects unknown commands and flags with exit code 2', async () => {
    const unknown = await cli(['sign']);
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Unknown command: sign');
    const flag = await cli(['hash', '--nope', 'plain.pdf']);
    expect(flag.code).toBe(2);
    expect(flag.stderr).toContain("Unknown option '--nope'");
    expect(flag.stderr).toContain('codevibe-sign hash --help');
  });
});

describe('hash', () => {
  it('prints the SHA-256 like sha256sum', async () => {
    const expected = createHash('sha256')
      .update(await readFile(join(dir, 'plain.pdf')))
      .digest('hex');
    const run = await cli(['hash', 'plain.pdf']);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(`${expected}  plain.pdf\n`);
    const json = JSON.parse((await cli(['hash', 'plain.pdf', '--json'])).stdout);
    expect(json).toEqual([{ file: 'plain.pdf', sha256: expected }]);
  });

  it('reports missing files and still hashes the others', async () => {
    const run = await cli(['hash', 'missing.pdf', 'plain.pdf']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('missing.pdf: no such file');
    expect(run.stdout).toContain('plain.pdf');
    expect((await cli(['hash'])).code).toBe(2);
  });
});

describe('verify', () => {
  it('accepts a sealed file from the trusted certificate', async () => {
    const run = await cli(['verify', 'sealed.pdf', '--trust', 'operator.pem']);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/^Valid: sealed with a trusted certificate/);
    expect(run.stdout).toContain('Acme Seal (Acme)');
    expect(run.stdout).toContain('yes, nothing was added after sealing');
    expect(run.stdout).toContain(`sha256 ${operator.sha256}`);
    expect(run.stdout).toMatch(/Signed\s+\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC/);
  });

  it('accepts a pinned fingerprint with colons and upper case', async () => {
    const pinned = operator.sha256.toUpperCase().match(/../g)!.join(':');
    const run = await cli(['verify', 'sealed.pdf', '--fingerprint', pinned, '--json']);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      valid: true,
      signerChecked: true,
      trustedBy: 'certificate',
      coversWholeDocument: true,
      signatureCount: 1,
      certificateSha256: operator.sha256,
    });
  });

  it('reports an intact seal as unchecked when no trust is given', async () => {
    const run = await cli(['verify', 'sealed.pdf']);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(
      /^Intact: the seal matches the file\. Who sealed it was not checked/,
    );
    expect(run.stdout).toContain('--trust operator.pem');
  });

  it('fails a tampered file', async () => {
    const run = await cli(['verify', 'tampered.pdf', '--trust', 'operator.pem']);
    expect(run.code).toBe(1);
    expect(run.stdout).toMatch(/^Invalid: the seal does not match the file/);
    const json = JSON.parse((await cli(['verify', 'tampered.pdf', '--json'])).stdout);
    expect(json).toMatchObject({ valid: false, reason: 'signature_invalid' });
  });

  it('fails content added after the seal', async () => {
    const run = await cli(['verify', 'appended.pdf', '--trust', 'operator.pem', '--json']);
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({
      valid: false,
      reason: 'not_whole_document',
      coversWholeDocument: false,
    });
  });

  it('fails a seal from a certificate that is not trusted', async () => {
    const run = await cli(['verify', 'sealed.pdf', '--trust', 'stranger.pem']);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('not made with a certificate you trust');
  });

  it('fails a file without a seal', async () => {
    const run = await cli(['verify', 'plain.pdf', '--trust', 'operator.pem', '--json']);
    expect(run.code).toBe(1);
    expect(JSON.parse(run.stdout)).toMatchObject({ valid: false, reason: 'not_sealed' });
  });

  it('treats bad input as a usage error', async () => {
    expect((await cli(['verify'])).code).toBe(2);
    const notPdf = await cli(['verify', 'notes.txt']);
    expect(notPdf.code).toBe(2);
    expect(notPdf.stderr).toContain('notes.txt: not a PDF file');
    const badPrint = await cli(['verify', 'sealed.pdf', '--fingerprint', 'abc']);
    expect(badPrint.code).toBe(2);
    expect(badPrint.stderr).toContain('--fingerprint must be 64 hex characters');
    const badPem = await cli(['verify', 'sealed.pdf', '--trust', 'notes.txt']);
    expect(badPem.code).toBe(2);
    expect(badPem.stderr).toContain('notes.txt: not a certificate (PEM or DER)');
    const missing = await cli(['verify', 'sealed.pdf', '--trust', 'missing.pem']);
    expect(missing.stderr).toContain('missing.pem: no such file');
  });
});

describe('inspect', () => {
  it('lists pages and sizes', async () => {
    const run = await cli(['inspect', 'plain.pdf']);
    expect(run.code).toBe(0);
    expect(run.stdout).toMatch(/Pages\s+3/);
    expect(run.stdout).toMatch(/pages 1-2\s+595 x 842 pt \(A4\)/);
    expect(run.stdout).toMatch(/page 3\s+792 x 612 pt \(Letter, landscape\)/);
    expect(run.stdout).toMatch(/Encrypted\s+no/);
    expect(run.stdout).toMatch(/Sealed\s+no/);
  });

  it('shows the seal on a sealed file', async () => {
    const run = await cli(['inspect', 'sealed.pdf', '--json']);
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({
      usable: true,
      sealed: true,
      signatureCount: 1,
      signer: 'Acme Seal (Acme)',
      pageCount: 3,
    });
  });

  it('reports an encrypted file', async () => {
    const run = await cli(['inspect', 'encrypted.pdf']);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('password protected');
    expect(run.stdout).toMatch(/Encrypted\s+yes/);
    const json = JSON.parse((await cli(['inspect', 'encrypted.pdf', '--json'])).stdout);
    expect(json).toMatchObject({ usable: false, problem: 'encrypted', encrypted: true });
  });

  it('reports a damaged file and a file that is not a PDF', async () => {
    const broken = await cli(['inspect', 'broken.pdf', '--json']);
    expect(broken.code).toBe(1);
    expect(JSON.parse(broken.stdout)).toMatchObject({ usable: false, encrypted: false });
    const text = await cli(['inspect', 'notes.txt']);
    expect(text.code).toBe(1);
    expect(text.stdout).toContain('The file is not a PDF.');
    expect((await cli(['inspect', 'missing.pdf'])).code).toBe(2);
  });
});

describe('keygen', () => {
  it('writes a PKCS#12 file that seal() accepts, with a loud warning', async () => {
    const run = await cli(
      ['keygen', '--out', 'dev.p12', '--cn', 'Dev Org', '--cert', 'dev.pem', '--days', '30'],
      { SEAL_P12_PASSPHRASE: 'dev-pass' },
    );
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('self-signed, for development and testing only');
    expect(run.stderr).toContain('certificate authority');
    expect(run.stdout).not.toContain('dev-pass');

    const p12 = new Uint8Array(await readFile(join(dir, 'dev.p12')));
    const certificate = sealCertificate({ p12, passphrase: 'dev-pass' });
    expect(certificate.subject.commonName).toBe('Dev Org');
    expect(run.stdout).toContain(certificate.sha256);
    expect(certificate.pem.trim()).toBe((await readFile(join(dir, 'dev.pem'), 'utf8')).trim());

    const sealed = await seal(await readFile(join(dir, 'plain.pdf')), {
      p12,
      passphrase: 'dev-pass',
    });
    await writeFile(join(dir, 'dev-sealed.pdf'), sealed);
    expect((await cli(['verify', 'dev-sealed.pdf', '--trust', 'dev.pem'])).code).toBe(0);
  });

  it('generates and prints a passphrase when none is set', async () => {
    const run = await cli(['keygen', '--out', 'gen.p12']);
    expect(run.code).toBe(0);
    const passphrase = /Passphrase\s+(\S+)/.exec(run.stdout)?.[1];
    expect(passphrase).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const p12 = new Uint8Array(await readFile(join(dir, 'gen.p12')));
    expect(sealCertificate({ p12, passphrase: passphrase! }).subject.commonName).toBe(
      'Codevibe Sign Development Seal',
    );
  });

  it('refuses to overwrite a file unless forced, and checks its options', async () => {
    const again = await cli(['keygen', '--out', 'gen.p12']);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain('gen.p12 already exists. Pass --force to replace it.');
    expect((await cli(['keygen', '--out', 'gen.p12', '--force'])).code).toBe(0);
    expect((await cli(['keygen'])).stderr).toContain('Missing --out');
    expect((await cli(['keygen', '--out', 'x.p12', '--days', '0'])).code).toBe(2);
  });
});

describe('api-key', () => {
  it('prints a long random key, and its hash as JSON', async () => {
    const a = (await cli(['api-key'])).stdout.trim();
    const b = (await cli(['api-key'])).stdout.trim();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    const json = JSON.parse((await cli(['api-key', '--json'])).stdout) as {
      key: string;
      sha256: string;
    };
    expect(json.sha256).toBe(createHash('sha256').update(json.key).digest('hex'));
  });
});

/** Resolves once the text `read()` returns matches, polling as the child writes. */
async function waitFor(read: () => string, pattern: RegExp): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (!pattern.test(read())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${pattern}:\n${read()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return read();
}

describe('start', () => {
  it('runs in memory, completes an envelope, and shuts down cleanly', async () => {
    const child = spawn(process.execPath, [BIN, 'start', '--memory', '--port', '0'], {
      cwd: dir,
      env: { PATH: process.env.PATH ?? '', NO_COLOR: '1' },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    try {
      const banner = await waitFor(() => output, /Press Ctrl\+C to stop/);
      expect(banner).toContain('memory mode');
      const port = /Health\s+http:\/\/localhost:(\d+)\/health/.exec(banner)?.[1];
      const apiKey = /API key\s+(\S+)/.exec(banner)?.[1];
      expect(port).toBeDefined();
      const baseUrl = `http://127.0.0.1:${port}`;

      const health = await fetch(`${baseUrl}/health`);
      expect(await health.json()).toEqual({ ok: true });

      const sign = createSignClient({ baseUrl, apiKey: apiKey! });
      const envelope = await sign.envelopes.create({
        title: 'Offer letter',
        send: true,
        documents: [
          { key: 'doc', name: 'offer.pdf', content: await readFile(join(dir, 'plain.pdf')) },
        ],
        recipients: [{ key: 'asha', name: 'Asha Rao', email: 'asha@example.com' }],
        fields: [
          { recipient: 'asha', type: 'signature', page: 0, x: 72, y: 640, width: 180, height: 48 },
        ],
      });
      await waitFor(() => output, /\/sign\/[A-Za-z0-9_-]{20,}/);
      const token = /\/sign\/([A-Za-z0-9_-]{20,})/.exec(output)![1]!;
      const signer = createSignerClient({ baseUrl, token });
      const session = await signer.session();
      await signer.view();
      await signer.submit([{ fieldId: session.fields[0]!.id, value: PNG }]);

      const sealed = await sign.envelopes.downloadDocument(envelope.id, envelope.documents[0]!.id, {
        version: 'sealed',
      });
      await writeFile(join(dir, 'from-server.pdf'), new Uint8Array(sealed));
      const verified = await cli(['verify', 'from-server.pdf', '--json']);
      expect(JSON.parse(verified.stdout)).toMatchObject({ valid: true, signatureCount: 1 });
    } finally {
      const exit = new Promise<number | null>((resolve) => child.once('exit', resolve));
      child.kill('SIGINT');
      expect(await exit).toBe(0);
    }
    expect(output).toContain('SIGINT received, closing');
  }, 30_000);

  it('lists every missing variable without --memory', async () => {
    const run = await cli(['start']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('DATABASE_URL is required');
    expect(run.stderr).toContain('API_KEYS is required');
    expect(run.stderr).toContain('codevibe-sign start --memory');
  });

  it('rejects a bad port', async () => {
    const run = await cli(['start', '--memory', '--port', 'eighty']);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('--port');
  });
});
