import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { preload } from 'react-dom';
import { CLIPS, posterOf } from '@/components/marketing/clips';
import { Landing } from '@/components/marketing/landing';
import {
  HOME_DESCRIPTION as DESCRIPTION,
  HOME_TITLE as TITLE,
  jsonLdScript,
  softwareApplicationJsonLd,
} from '@/lib/home-seo';
import { limitsFor } from '@/lib/plans';
import { APP_HOME } from '@/lib/safe-next';
import { getSessionUser } from '@/server/auth/session';
import { env } from '@/server/env';
import { planSettings } from '@/server/plans';

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
  // The hero clip's poster is the largest thing in the first view.
  preload(posterOf(CLIPS.hero), { as: 'image', fetchPriority: 'high' });
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(softwareApplicationJsonLd(env().APP_URL)) }}
      />
      <Landing
        free={limitsFor('free', settings)}
        cloud={limitsFor('cloud', settings)}
        viewer={user ? { name: user.name, email: user.email } : null}
      />
    </>
  );
}
