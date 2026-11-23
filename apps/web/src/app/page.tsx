import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Landing } from '@/components/marketing/landing';
import { limitsFor } from '@/lib/plans';
import { APP_HOME } from '@/lib/safe-next';
import { getSessionUser } from '@/server/auth/session';
import { env } from '@/server/env';
import { planSettings } from '@/server/plans';

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
 * The public home page, for everyone on the hosted cloud: someone signed in sees it too, with
 * a way to their dashboard in place of the sign-in buttons. A self-hosted install has no
 * public site, so it goes to the dashboard or to sign-in.
 */
export default async function Home() {
  const user = await getSessionUser();
  const settings = planSettings();
  if (settings.mode !== 'hosted') redirect(user ? APP_HOME : '/sign-in');
  return (
    <Landing
      free={limitsFor('free', settings)}
      cloud={limitsFor('cloud', settings)}
      viewer={user ? { name: user.name, email: user.email } : null}
    />
  );
}
