import { readFile } from 'node:fs/promises';
import { parseArgs, type ParseArgsConfig } from 'node:util';

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
  env: NodeJS.ProcessEnv;
  color: boolean;
}

export interface Command {
  name: string;
  summary: string;
  help: string;
  run(args: string[], io: Io): Promise<number>;
}

/** Exit codes shared by every command. */
export const EXIT = { ok: 0, failed: 1, usage: 2 } as const;

export class UsageError extends Error {}

const codes = { red: 31, green: 32, yellow: 33, cyan: 36, gray: 90, bold: 1 } as const;
export type Style = keyof typeof codes;

export function painter(on: boolean) {
  return (style: Style, text: string) => (on ? `\x1b[${codes[style]}m${text}\x1b[0m` : text);
}

export function wantsColor(env: NodeJS.ProcessEnv, isTty: boolean, args: string[]): boolean {
  if (args.includes('--no-color') || env.NO_COLOR) return false;
  return isTty || Boolean(env.FORCE_COLOR);
}

type Options = NonNullable<ParseArgsConfig['options']>;

/** `parseArgs` with the flags every command takes, and friendly errors. */
export function parse<O extends Options>(args: string[], options: O) {
  try {
    return parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      options: {
        ...options,
        help: { type: 'boolean', short: 'h' },
        'no-color': { type: 'boolean' },
      },
    });
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

/** Left-aligned two-column rows, for the human-readable reports. */
export function rows(entries: [string, string][], indent = '  '): string {
  const width = Math.max(...entries.map(([label]) => label.length));
  return entries.map(([label, value]) => `${indent}${label.padEnd(width)}  ${value}`).join('\n');
}

/** A short, plain reason a file could not be read. */
export function fileProblem(file: string, error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') return `${file}: no such file`;
  if (code === 'EISDIR') return `${file}: is a directory, not a file`;
  if (code === 'EACCES') return `${file}: permission denied`;
  return `${file}: ${error instanceof Error ? error.message : String(error)}`;
}

export async function readInput(file: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(file));
  } catch (error) {
    throw new UsageError(fileProblem(file, error));
  }
}
