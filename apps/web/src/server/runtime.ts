import 'server-only';
import type { FileStore, Mailer } from '@codevibe_technology/sign-core';
import { localFileStore } from '@codevibe_technology/sign-server';
import { db } from './db';
import { env } from './env';
import { loggingMailer, recordMail } from './mail-log';
import { createMailTransport } from './mail-transport';

export interface AppRuntime {
  files: FileStore;
  mailer: Mailer;
}

const holder = globalThis as unknown as { __cvsRuntime?: AppRuntime };

/**
 * File store and mailer shared by the app and the sign server, created on first use. Every
 * email goes through the mailer, so every send, sent or failed, lands in the mail log.
 */
export function appRuntime(): AppRuntime {
  if (!holder.__cvsRuntime) {
    const config = env();
    const transport = createMailTransport(config);
    holder.__cvsRuntime = {
      files: localFileStore(config.FILES_DIR),
      mailer: loggingMailer(transport, (entry) => recordMail(db(), entry)),
    };
  }
  return holder.__cvsRuntime;
}

export { db };
