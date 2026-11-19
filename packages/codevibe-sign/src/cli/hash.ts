import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { EXIT, fileProblem, parse, UsageError, type Command } from './io';

async function sha256(input: Readable): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of input) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export const hash: Command = {
  name: 'hash',
  summary: 'SHA-256 of a file, as printed on the certificate page',
  help: `Usage
  codevibe-sign hash <file...> [options]

Prints the SHA-256 of each file in the same format as sha256sum. Compare it with the
document hashes on a sealed file's certificate page. Use - to read stdin.

Options
  --json            Print [{ "file", "sha256" }] as JSON
  -h, --help        Show this help

Examples
  codevibe-sign hash offer-letter.pdf
  curl -s https://example.com/offer.pdf | codevibe-sign hash -`,

  async run(args, io) {
    const { values, positionals } = parse(args, { json: { type: 'boolean' } });
    if (positionals.length === 0) throw new UsageError('Missing file. Pass one or more files.');
    const results: { file: string; sha256: string }[] = [];
    let failed = false;
    for (const file of positionals) {
      try {
        const input = file === '-' ? process.stdin : createReadStream(file);
        results.push({ file, sha256: await sha256(input) });
      } catch (error) {
        failed = true;
        io.err(fileProblem(file, error));
      }
    }
    if (values.json) io.out(JSON.stringify(results, null, 2));
    else for (const r of results) io.out(`${r.sha256}  ${r.file}`);
    return failed ? EXIT.usage : EXIT.ok;
  },
};
