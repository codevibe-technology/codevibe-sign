import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Landing } from '@/components/marketing/landing';
import { limitsFor } from '@/lib/plans';
import { getSessionUser } from '@/server/auth/session';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { planSettings } from '@/server/plans';
import { listWorkspacesForUser } from '@/server/workspaces';

const TITLE = 'Codevibe Sign: send documents for signature in minutes';
const DESCRIPTION =
  'Open-source e-signatures. Upload a PDF, add who signs, place the fields and send. Signers sign in the browser and you get a sealed PDF with a signing certificate. Free cloud workspace, or self-host with Docker.';

export async function generateMetadata(): Promise<Metadata> {
  const appUrl = env().APP_URL;
  return {
    metadataBase: new URL(appUrl),
    title: { absolute: TITLE },
    description: DESCRIPTION,
    alternates: { canonical: '/' },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website',
      siteName: 'Codevibe Sign',
      title: TITLE,
      description: DESCRIPTION,
      url: '/',
      locale: 'en_IN',
    },
    twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
  };
}

/**
 * Signed-in people go to their workspace. On the hosted cloud, everyone else gets the public
 * home page; a self-hosted install sends them to sign-in.
 */
export default async function Home() {
  const user = await getSessionUser();
  if (user) {
    const [first] = await listWorkspacesForUser(db(), user.id);
    redirect(first ? `/w/${first.workspace.slug}` : '/onboarding');
  }
  const settings = planSettings();
  if (settings.mode !== 'hosted') redirect('/sign-in');
  return <Landing free={limitsFor('free', settings)} cloud={limitsFor('cloud', settings)} />;
}
