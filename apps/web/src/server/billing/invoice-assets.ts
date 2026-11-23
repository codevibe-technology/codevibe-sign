import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { seal } from '@codevibe_technology/sign-pdf';
import type { Env } from '../env';
import type { BillingConfig } from './config';
import type { InvoiceAssets } from './invoice-pdf';
import type { InvoiceRendering } from './orders';

const MAX_IMAGE_BYTES = 1024 * 1024;

/** A file the invoice can do without: missing, unreadable or oversized means "not there". */
async function optional(path: string | null, maxBytes?: number): Promise<Uint8Array | undefined> {
  if (!path) return undefined;
  try {
    const bytes = await readFile(path);
    if (maxBytes && bytes.byteLength > maxBytes) return undefined;
    return new Uint8Array(bytes);
  } catch {
    return undefined;
  }
}

const holder = globalThis as unknown as {
  __cvsInvoiceFonts?: Promise<InvoiceAssets['fonts']>;
};

/** Inter, shipped with the app in `assets/fonts`; `INVOICE_FONT_DIR` points somewhere else. */
function fonts(source: NodeJS.ProcessEnv): Promise<InvoiceAssets['fonts']> {
  holder.__cvsInvoiceFonts ??= (async () => {
    const dir = source.INVOICE_FONT_DIR?.trim() || join(process.cwd(), 'assets', 'fonts');
    const [regular, bold] = await Promise.all([
      optional(join(dir, 'Inter-Regular.ttf')),
      optional(join(dir, 'Inter-Bold.ttf')),
    ]);
    return regular && bold ? { regular, bold } : undefined;
  })();
  return holder.__cvsInvoiceFonts;
}

/**
 * How this install draws and signs its invoices: the shipped fonts, the operator's logo and
 * signature images, and the install's seal when it has one. Tax invoices are sealed as plain
 * approval signatures so the file opens without a "certified" banner.
 */
export function invoiceRendering(
  config: BillingConfig,
  env: Pick<Env, 'SEAL_P12_PATH' | 'SEAL_PASSPHRASE' | 'SEAL_ALLOW_WEAK_KEY'>,
  source: NodeJS.ProcessEnv = process.env,
): InvoiceRendering {
  const p12Path = env.SEAL_P12_PATH;
  return {
    assets: async () => ({
      fonts: await fonts(source),
      logo: await optional(config.invoiceLogoPath, MAX_IMAGE_BYTES),
      signature: await optional(config.invoiceSignaturePath, MAX_IMAGE_BYTES),
    }),
    ...(p12Path
      ? {
          seal: async (pdf: Uint8Array, at: Date) =>
            seal(pdf, {
              p12: new Uint8Array(await readFile(p12Path)),
              passphrase: env.SEAL_PASSPHRASE,
              allowWeakKey: env.SEAL_ALLOW_WEAK_KEY,
              reason: 'Tax invoice issued by the seller',
              signingTime: at,
              certify: false,
            }),
        }
      : {}),
  };
}
