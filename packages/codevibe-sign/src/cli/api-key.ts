import { createHash, randomBytes } from 'node:crypto';
import { EXIT, parse, UsageError, type Command } from './io';

export const apiKey: Command = {
  name: 'api-key',
  summary: 'Generate a random API key for API_KEYS',
  help: `Usage
  codevibe-sign api-key [options]

Prints a new random API key (32 bytes, base64url) on stdout. Add it to API_KEYS on the
server, comma-separated with any others, and send it from your backend as
"Authorization: Bearer <key>". The server keeps only its SHA-256.

Options
  --json            Print { "key", "sha256" } as JSON
  -h, --help        Show this help

Examples
  codevibe-sign api-key
  API_KEYS="$(codevibe-sign api-key)" codevibe-sign start`,

  async run(args, io) {
    const { values, positionals } = parse(args, { json: { type: 'boolean' } });
    if (positionals.length > 0) throw new UsageError(`Unexpected argument: ${positionals[0]}`);
    const key = randomBytes(32).toString('base64url');
    const sha256 = createHash('sha256').update(key).digest('hex');
    if (values.json) {
      io.out(JSON.stringify({ key, sha256 }, null, 2));
    } else {
      io.out(key);
    }
    return EXIT.ok;
  },
};
