import type { Metadata } from 'next';
import { AuthFrame } from '@/components/shell/status-page';
import { turnstileSiteKey } from '@/server/human-check';
import { ForgotPasswordForm } from './forgot-password-form';

export const metadata: Metadata = { title: 'Forgot password' };

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { email } = await searchParams;
  return (
    <AuthFrame>
      <p className="eyebrow mb-2">Codevibe Sign</p>
      <h1 className="text-[26px] leading-tight font-bold">Forgot your password?</h1>
      <p className="mt-1.5 mb-6 text-muted">
        Enter your email and we will send you a link to choose a new one.
      </p>
      <ForgotPasswordForm
        email={typeof email === 'string' ? email.slice(0, 254) : ''}
        humanCheckKey={turnstileSiteKey()}
      />
    </AuthFrame>
  );
}
