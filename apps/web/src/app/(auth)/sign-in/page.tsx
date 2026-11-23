import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthFrame } from '@/components/shell/status-page';
import { safeNext } from '@/lib/safe-next';
import { getSessionUser } from '@/server/auth/session';
import { env, googleEnabled } from '@/server/env';
import { turnstileSiteKey } from '@/server/human-check';
import { SignInForm } from './sign-in-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (await getSessionUser()) redirect(next);
  return (
    <AuthFrame>
      <p className="eyebrow mb-2">Codevibe Sign</p>
      <h1 className="text-[26px] leading-tight font-bold">Sign in</h1>
      <p className="mt-1.5 mb-6 text-muted">
        Use your password, or have a sign-in link sent to your email.
      </p>
      <SignInForm
        next={next}
        google={googleEnabled(env())}
        failed={params.error !== undefined}
        humanCheckKey={turnstileSiteKey()}
        {...(params.reset !== undefined
          ? { notice: 'Your password was changed. Sign in with the new one.' }
          : {})}
      />
    </AuthFrame>
  );
}
