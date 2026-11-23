import { KeyRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthFrame, StatusPage } from '@/components/shell/status-page';
import { Button } from '@/components/ui/button';
import { ResetPasswordForm } from './reset-password-form';

export const metadata: Metadata = { title: 'Choose a new password', referrer: 'no-referrer' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await searchParams;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) {
    return (
      <StatusPage
        icon={KeyRound}
        title="This link no longer works"
        description="A reset link works once and expires after 30 minutes. Ask for a new one."
        action={
          <Button asChild>
            <Link href="/forgot-password">Send a new link</Link>
          </Button>
        }
      />
    );
  }
  return (
    <AuthFrame>
      <p className="eyebrow mb-2">Codevibe Sign</p>
      <h1 className="text-[26px] leading-tight font-bold">Choose a new password</h1>
      <p className="mt-1.5 mb-6 text-muted">
        Saving it signs you out everywhere, so you sign in again with the new password.
      </p>
      <ResetPasswordForm token={token} />
    </AuthFrame>
  );
}
