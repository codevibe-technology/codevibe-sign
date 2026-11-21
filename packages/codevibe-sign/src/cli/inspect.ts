import { SignError, type PageSize } from '@codevibe_technology/sign-core';
import { inspectPdf, sha256Hex, verifySeal } from '@codevibe_technology/sign-pdf';
import { formatBytes, isPdf, pageSize, signerName } from './format';
import { EXIT, painter, parse, readInput, rows, UsageError, type Command } from './io';

type Problem = 'not_pdf' | 'encrypted' | 'empty' | 'too_complex' | 'already_signed' | 'unreadable';

export interface InspectReport {
  file: string;
  bytes: number;
  sha256: string;
  /** Codevibe Sign can read the file and place fields on it. */
  usable: boolean;
  problem?: Problem;
  message?: string;
  encrypted: boolean;
  pageCount?: number;
  pages?: PageSize[];
  sealed: boolean;
  signatureCount: number;
  signer?: string;
}

function problemOf(error: unknown): { problem: Problem; message: string } {
  const fallback = 'The PDF could not be read. It may be damaged.';
  if (!(error instanceof SignError)) return { problem: 'unreadable', message: fallback };
  if (error.code === 'PDF_ALREADY_SIGNED')
    return { problem: 'already_signed', message: error.message };
  const reason = error.details?.reason;
  const problem: Problem =
    reason === 'encrypted'
      ? 'encrypted'
      : reason === 'empty'
        ? 'empty'
        : reason === 'limit' || reason === 'timeout'
          ? 'too_complex'
          : 'unreadable';
  return { problem, message: error.message || fallback };
}

/** Consecutive pages of the same size, as `[first, last, size]`. */
function runs(pages: PageSize[]): [number, number, string][] {
  const out: [number, number, string][] = [];
  pages.forEach((page, index) => {
    const size = pageSize(page.width, page.height);
    const last = out.at(-1);
    if (last && last[2] === size) last[1] = index + 1;
    else out.push([index + 1, index + 1, size]);
  });
  return out;
}

export async function inspectFile(file: string): Promise<InspectReport> {
  const bytes = await readInput(file);
  const base = { file, bytes: bytes.byteLength, sha256: sha256Hex(bytes) };
  if (!isPdf(bytes)) {
    return {
      ...base,
      usable: false,
      problem: 'not_pdf',
      message: 'The file is not a PDF.',
      encrypted: false,
      sealed: false,
      signatureCount: 0,
    };
  }

  const seal = await verifySeal(bytes).catch(() => undefined);
  const sealInfo = {
    sealed: seal?.sealed ?? false,
    signatureCount: seal?.signatureCount ?? 0,
    ...(seal?.signer ? { signer: signerName(seal.signer) } : {}),
  };
  try {
    const info = await inspectPdf(bytes, { maxBytes: Number.MAX_SAFE_INTEGER });
    return {
      ...base,
      usable: true,
      encrypted: false,
      pageCount: info.pageCount,
      pages: info.pages,
      ...sealInfo,
    };
  } catch (error) {
    const { problem, message } = problemOf(error);
    return {
      ...base,
      usable: false,
      problem,
      message,
      encrypted: problem === 'encrypted',
      ...sealInfo,
    };
  }
}

export const inspect: Command = {
  name: 'inspect',
  summary: 'Pages, page sizes, encryption and seal of a PDF',
  help: `Usage
  codevibe-sign inspect <file.pdf> [options]

Reads a PDF the way the server does before it accepts an upload, and prints its pages and
sizes in PDF points (field boxes use the same units), whether it is encrypted and whether it
carries a seal. Use it to check a file before you send it. A file that already carries
digital signatures, such as a sealed one, is reported as not usable: signing it again would
remove them.

Options
  --json            Print the result as JSON
  -h, --help        Show this help

Exit codes
  0  the file is a readable PDF
  1  the file is not a PDF, is password protected, is damaged, or is already signed
  2  invalid usage, or the file could not be read

Examples
  codevibe-sign inspect offer-letter.pdf
  codevibe-sign inspect signed.pdf --json`,

  async run(args, io) {
    const { values, positionals } = parse(args, { json: { type: 'boolean' } });
    const file = positionals[0];
    if (!file) throw new UsageError('Missing file. Usage: codevibe-sign inspect <file.pdf>');
    if (positionals.length > 1) throw new UsageError('Pass one file at a time.');

    const r = await inspectFile(file);
    if (values.json) {
      io.out(JSON.stringify(r, null, 2));
      return r.usable ? EXIT.ok : EXIT.failed;
    }

    const paint = painter(io.color);
    const details: [string, string][] = [
      ['Size', formatBytes(r.bytes)],
      ['SHA-256', r.sha256],
    ];
    if (r.pages) {
      details.push(['Pages', String(r.pageCount)]);
      for (const [first, last, size] of runs(r.pages)) {
        details.push([first === last ? `  page ${first}` : `  pages ${first}-${last}`, size]);
      }
    }
    if (r.problem !== 'not_pdf') {
      details.push(['Encrypted', r.encrypted ? paint('red', 'yes') : 'no']);
      const count = `${r.signatureCount} signature${r.signatureCount === 1 ? '' : 's'}`;
      details.push([
        'Sealed',
        r.sealed ? `yes, ${count}${r.signer ? ` by ${r.signer}` : ''}` : 'no',
      ]);
    }
    const head = r.usable
      ? `${paint('bold', file)}`
      : `${paint('bold', file)}\n${paint('red', r.message ?? '')}`;
    io.out(`${head}\n\n${rows(details)}`);
    if (r.sealed) io.out(`\nCheck the seal with: codevibe-sign verify ${file}`);
    return r.usable ? EXIT.ok : EXIT.failed;
  },
};
