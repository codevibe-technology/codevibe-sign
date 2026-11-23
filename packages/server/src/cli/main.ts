import { EXIT, UsageError, wantsColor, type Command, type Io } from './io';
import { startCommand } from './start';
import { VERSION } from './version';

const COMMANDS: Command[] = [startCommand()];

const HELP = `codevibe-sign-server ${VERSION}
The Codevibe Sign HTTP API and signing runtime. AGPL-3.0-only.

Usage
  codevibe-sign-server <command> [options]

Commands
${COMMANDS.map((c) => `  ${c.name.padEnd(10)}${c.summary}`).join('\n')}

Options
  -h, --help        Show help (also: codevibe-sign-server <command> --help)
  -v, --version     Print the version
  --no-color        Disable colours (also respects NO_COLOR)

Examples
  npx @codevibe_technology/sign-server start --memory
  npx @codevibe_technology/sign-server start --seal seal.p12 --public-url https://sign.example.com

Docs: https://sign.codevibe.in?utm_source=cli`;

export async function main(argv: string[], io: Io): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === '-h' || name === '--help' || name === 'help') {
    const topic = name === 'help' ? COMMANDS.find((c) => c.name === rest[0]) : undefined;
    io.out(topic ? topic.help : HELP);
    return EXIT.ok;
  }
  if (name === '-v' || name === '--version') {
    io.out(VERSION);
    return EXIT.ok;
  }
  const command = COMMANDS.find((c) => c.name === name);
  if (!command) {
    io.err(`Unknown command: ${name}\n\nRun codevibe-sign-server --help for the list of commands.`);
    return EXIT.usage;
  }
  if (rest.includes('-h') || rest.includes('--help')) {
    io.out(command.help);
    return EXIT.ok;
  }
  try {
    return await command.run(rest, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message}\n\nRun codevibe-sign-server ${command.name} --help for usage.`);
      return EXIT.usage;
    }
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT.failed;
  }
}

const args = process.argv.slice(2);
main(args, {
  out: (text) => console.log(text),
  err: (text) => console.error(text),
  env: process.env,
  color: wantsColor(process.env, process.stdout.isTTY === true, args),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(error);
    process.exitCode = EXIT.failed;
  },
);
