import 'server-only';
import type { FileStore, Mailer } from '@codevibe_technology/sign-core';
import { consoleMailer, localFileStore, smtpMailer } from '@codevibe_technology/sign-server';
import { db } from './db';
import { env } from './env';

export interface AppRuntime {
  files: FileStore;
  mailer: Mailer;
}

const holder = globalThis as unknown as { __cvsRuntime?: AppRuntime };

/** File store and mailer shared by the app and the sign server, created on first use. */
export function appRuntime(): AppRuntime {
  if (!holder.__cvsRuntime) {
    const config = env();
    holder.__cvsRuntime = {
      files: localFileStore(config.FILES_DIR),
      mailer:
        config.MAIL_TRANSPORT === 'console'
          ? consoleMailer()
          : smtpMailer({ transport: config.MAIL_TRANSPORT, from: config.MAIL_FROM }),
    };
  }
  return holder.__cvsRuntime;
}

export { db };
