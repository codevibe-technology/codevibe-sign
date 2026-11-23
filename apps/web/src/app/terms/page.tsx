import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalPage, LegalSection } from '@/components/marketing/legal-page';
import { CONTACT_EMAIL, GITHUB_URL } from '@/components/marketing/links';
import { siteViewer } from '@/server/auth/session';
import { isHosted } from '@/server/plans';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'The terms for using the Codevibe Sign cloud.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/terms' },
};

export default async function TermsPage() {
  if (!isHosted()) notFound();
  return (
    <LegalPage
      viewer={await siteViewer()}
      title="Terms"
      updated="20 November 2026"
      intro={
        <p>
          These terms cover the Codevibe Sign cloud at sign.codevibe.in, run by Codevibe Technology.
          By creating an account or a workspace, you agree to them.
        </p>
      }
    >
      <LegalSection title="Your account and workspace">
        <p>
          Keep access to your email address safe: it is how you sign in. The owners of a workspace
          decide who joins it and what each member can do, and are responsible for what is sent from
          it.
        </p>
      </LegalSection>
      <LegalSection title="Plans and limits">
        <p>
          The Free plan is free and has the limits shown in Settings under Plan and usage. When a
          limit is reached, new sends are refused until the count starts again or the workspace
          moves to another plan; nothing already sent is affected. We may change the Free
          plan&rsquo;s limits, and will tell workspace owners by email before a lower limit applies.
        </p>
      </LegalSection>
      <LegalSection title="Your documents">
        <p>
          What you upload stays yours. You allow us to store it, show it to the people you send it
          to, and seal it, only to provide the service. Do not upload anything you do not have the
          right to share with your recipients.
        </p>
      </LegalSection>
      <LegalSection title="Fair use">
        <ul>
          <li>No unlawful content, fraud, phishing or impersonation.</li>
          <li>No unsolicited bulk email: send envelopes only to people who expect them.</li>
          <li>No malware, and no attempts to break into or overload the service.</li>
        </ul>
        <p>We may suspend a workspace that breaks these rules, and will say why.</p>
      </LegalSection>
      <LegalSection title="Electronic signatures">
        <p>
          Codevibe Sign records who signed, when and how, and seals the result. Whether an
          electronic signature suits a particular document is your decision; some documents need
          Aadhaar eSign, a wet signature or registration under Indian law.
        </p>
      </LegalSection>
      <LegalSection title="Availability and liability">
        <p>
          We work to keep the service running and your data safe, but the cloud is provided as it
          is, without a guarantee that it will always be available or free of errors. To the extent
          the law allows, Codevibe Technology is not liable for indirect losses, and our total
          liability is limited to the amount you paid us in the twelve months before the claim.
        </p>
      </LegalSection>
      <LegalSection title="Ending">
        <p>
          You can stop using the service at any time and ask us to delete your workspace. If we ever
          close the Free plan, we will give at least 30 days&rsquo; notice so you can download your
          documents.
        </p>
      </LegalSection>
      <LegalSection title="Open source">
        <p>
          The software itself is open source: the libraries under Apache-2.0, the server and app
          under AGPL-3.0, published on <a href={GITHUB_URL}>GitHub</a>. These terms cover only our
          running of the cloud.
        </p>
      </LegalSection>
      <LegalSection title="Law and contact">
        <p>
          These terms are governed by the laws of India. Questions:{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
