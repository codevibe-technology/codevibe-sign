import { run } from './run';

run({ env: process.env, signals: process, exit: (code) => process.exit(code) }).catch(
  (error: unknown) => {
    // Only the message: configuration errors name variables, never their values.
    console.error(error instanceof Error ? error.message : 'Failed to start');
    process.exit(1);
  },
);
