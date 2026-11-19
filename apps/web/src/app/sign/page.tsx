import { FileSignature } from 'lucide-react';
import type { Metadata } from 'next';
import { StatusPage } from '@/components/shell/status-page';

export const metadata: Metadata = { title: 'Sign a document' };

/**
 * Where signing links land once `/api/sign/<token>` has moved the token into its cookie. The
 * signing lane replaces this with the branded signing experience built on `/api/v1/sign/link`.
 */
export default function SigningPage() {
  return (
    <StatusPage
      icon={FileSignature}
      title="Open your signing link"
      description="To sign a document, open the link in the email you received. Links work for a limited time; if yours has expired, ask the sender for a new one."
    />
  );
}
