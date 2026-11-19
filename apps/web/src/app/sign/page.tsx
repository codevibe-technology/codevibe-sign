import type { Metadata } from 'next';
import { EndStateMessage } from '@/components/signing/end-state';
import { SigningApp } from '@/components/signing/signing-app';
import { SigningShell } from '@/components/signing/signing-shell';
import { isEndState, isWorkspaceId } from '@/lib/signing';
import { getSigningBrand } from '@/server/brand';
import { db } from '@/server/db';
import { SMS_CODES } from '@/server/sign/server';

export const metadata: Metadata = {
  title: 'Sign a document',
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

/**
 * Where signing links land once `/api/sign/<token>` has moved the token into its cookie. A link
 * that no longer works arrives with `?state=` (and `&w=` for the sender's brand) and gets a page
 * that says why; everything else is the signing flow in the browser.
 */
export default async function SigningPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { state, w } = await searchParams;
  if (isEndState(state)) {
    const brand = isWorkspaceId(w) ? await getSigningBrand(db(), w) : null;
    return (
      <SigningShell brand={brand}>
        <EndStateMessage state={state} company={brand?.name ?? null} />
      </SigningShell>
    );
  }
  return <SigningApp smsAvailable={SMS_CODES} />;
}
