import { writeFile } from 'node:fs/promises';
import { createDevSeal } from '../dev-seal';
import { EXIT, fileProblem, painter, parse, rows, UsageError, type Command } from './io';

const WARNING = `This certificate is self-signed, for development and testing only. Adobe Reader and
other PDF readers show seals made with it as untrusted. In production, seal with a
certificate issued by a certificate authority (a document signing or AATL certificate).`;

async function writeNew(path: string, data: Uint8Array | string, force: boolean): Promise<void> {
  try {
    await writeFile(path, data, { mode: 0o600, flag: force ? 'w' : 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new UsageError(`${path} already exists. Pass --force to replace it.`);
    }
    throw new UsageError(fileProblem(path, error));
  }
}

export const keygen: Command = {
  name: 'keygen',
  summary: 'Create a self-signed sealing certificate for development',
  help: `Usage
  codevibe-sign keygen --out seal.p12 [options]

Creates an RSA-2048 key and a self-signed certificate in a PKCS#12 file that the server
and seal() accept. For development and testing only: production needs a certificate
issued by a certificate authority.

Options
  --out <file>          Where to write the PKCS#12 file (required)
  --cn <name>           Certificate common name (default "Codevibe Sign Development Seal")
  --org <name>          Organisation name
  --days <n>            Days the certificate is valid (default 365, at most 3650)
  --cert <file>         Also write the certificate as PEM, for verify --trust
  --force               Replace files that already exist

The passphrase is read from SEAL_P12_PASSPHRASE, or generated and printed.

Examples
  codevibe-sign keygen --out seal.p12 --cn "Acme HR" --cert seal.pem
  SEAL_P12_PASSPHRASE=dev-only codevibe-sign keygen --out seal.p12`,

  async run(args, io) {
    const { values, positionals } = parse(args, {
      out: { type: 'string', short: 'o' },
      cn: { type: 'string' },
      org: { type: 'string' },
      days: { type: 'string' },
      cert: { type: 'string' },
      force: { type: 'boolean' },
    });
    if (positionals.length > 0) throw new UsageError(`Unexpected argument: ${positionals[0]}`);
    if (!values.out)
      throw new UsageError('Missing --out. Usage: codevibe-sign keygen --out seal.p12');
    const days = values.days === undefined ? 365 : Number(values.days);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      throw new UsageError('--days must be a whole number from 1 to 3650.');
    }

    const passphraseFromEnv = io.env.SEAL_P12_PASSPHRASE;
    const seal = createDevSeal({
      days,
      ...(values.cn ? { commonName: values.cn } : {}),
      ...(values.org ? { organization: values.org } : {}),
      ...(passphraseFromEnv !== undefined ? { passphrase: passphraseFromEnv } : {}),
    });
    await writeNew(values.out, seal.p12, values.force ?? false);
    if (values.cert) await writeNew(values.cert, seal.certificatePem, values.force ?? false);

    const paint = painter(io.color);
    const details: [string, string][] = [
      ['PKCS#12', values.out],
      ...(values.cert ? ([['Certificate', values.cert]] as [string, string][]) : []),
      ['Key', 'RSA-2048, certificate signed with SHA-256'],
      ['Valid until', seal.notAfter.toISOString().slice(0, 10)],
      ['SHA-256', seal.sha256],
      [
        'Passphrase',
        passphraseFromEnv !== undefined ? 'from SEAL_P12_PASSPHRASE' : seal.passphrase,
      ],
    ];
    io.out(`Created a development sealing certificate.\n\n${rows(details)}\n`);
    io.err(paint('yellow', `Warning: ${WARNING}`));
    io.out(
      `\nUse it with the server:\n` +
        `  SEAL_P12_BASE64="$(base64 < ${values.out} | tr -d '\\n')"\n` +
        `  SEAL_P12_PASSPHRASE=${passphraseFromEnv !== undefined ? '...' : seal.passphrase}`,
    );
    return EXIT.ok;
  },
};
