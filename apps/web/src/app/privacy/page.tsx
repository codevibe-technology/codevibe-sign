import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalPage, LegalSection } from '@/components/marketing/legal-page';
import { CONTACT_EMAIL } from '@/components/marketing/links';
import { siteViewer } from '@/server/auth/session';
import { isHosted } from '@/server/plans';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'What the Codevibe Sign cloud stores about you and the people you send to, and why.',
  robots: { index: true, follow: true },
  alternates: { canonical: '/privacy' },
};

export default async function PrivacyPage() {
  if (!isHosted()) notFound();
  return (
    <LegalPage
      viewer={await siteViewer()}
      title="Privacy"
      updated="23 November 2026"
      intro={
        <p>
          Codevibe Technology runs the Codevibe Sign cloud at sign.codevibe.in. This page says what
          we store, why, and what you can ask us to do with it.
        </p>
      }
    >
      <LegalSection title="What we store">
        <ul>
          <li>
            <strong>Your account:</strong> name, email address, profile picture if you sign in with
            Google, and your sign-in sessions with the IP address and browser they came from.
          </li>
          <li>
            <strong>Your workspace:</strong> its name, members and roles, invitations, brand
            settings, email wording, templates, webhook endpoints, and API keys (stored only as a
            hash).
          </li>
          <li>
            <strong>Documents:</strong> the PDFs you upload, the sealed copies, and the signing
            certificates.
          </li>
          <li>
            <strong>People you send to:</strong> the names, email addresses and, if you add them,
            phone numbers of recipients.
          </li>
          <li>
            <strong>Signing evidence:</strong> each step of every envelope (sent, opened, signed,
            declined) with its time, IP address and browser, in a hash-chained audit trail.
          </li>
          <li>
            <strong>Usage counts</strong> for your plan, and a 30-day log of webhook deliveries.
          </li>
          <li>
            <strong>Billing:</strong> if you pay for something, the billing name, address, GSTIN and
            email you give us, your orders, invoices and Aadhaar eSign credits, and the payment
            reference from Razorpay. We never receive or store card, UPI or bank details.
          </li>
          <li>
            <strong>Aadhaar eSign:</strong> the signer&apos;s name and the details of the signing
            certificate as the eSign provider returns them. We never receive or store an Aadhaar
            number. If you connect your own Leegality account, its credentials are stored encrypted.
          </li>
        </ul>
      </LegalSection>
      <LegalSection title="Why we store it">
        <p>
          To run the service you use: to send envelopes, show the signing page, seal the documents
          and keep the record that shows who signed what and when. We also use your email address to
          send you sign-in links and messages about your account.
        </p>
      </LegalSection>
      <LegalSection title="Who else sees it">
        <ul>
          <li>The people you send an envelope to see its documents and its signing progress.</li>
          <li>Members of your workspace see what their role allows.</li>
          <li>
            Our hosting and email delivery providers process data only to run the service for us.
          </li>
          <li>
            Razorpay takes payments for us. It receives the amount, your billing name and email, and
            whatever you enter on its payment page.
          </li>
          <li>
            Leegality runs Aadhaar eSign. When a signer is asked to sign that way, Leegality
            receives the document and the signer&apos;s name and email address or mobile number, and
            the signer gives their Aadhaar details to Leegality directly.
          </li>
        </ul>
        <p>
          We do not sell your data, use it for advertising, or put third-party trackers in the app.
        </p>
      </LegalSection>
      <LegalSection title="Cookies">
        <p>
          We use a cookie to keep you signed in, one that keeps a signer&rsquo;s link working while
          they sign, and one that remembers your light or dark theme. There are no advertising or
          analytics cookies.
        </p>
      </LegalSection>
      <LegalSection title="How long we keep it">
        <p>
          We keep workspace data, documents and their audit trails while the workspace exists,
          because a signed document is only useful with its record. Webhook delivery logs are kept
          for 30 days. Ask us to delete a workspace or your account and we will remove it, except
          where the law requires us to keep something, such as invoices and payment records.
        </p>
      </LegalSection>
      <LegalSection title="Your choices">
        <p>
          You can ask for a copy of your data, a correction, or its deletion. Write to{' '}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> from the address on your account.
        </p>
      </LegalSection>
      <LegalSection title="Self-hosted installs">
        <p>
          If you run Codevibe Sign on your own server, your data stays there and Codevibe has no
          access to it. Whoever runs that server is responsible for it.
        </p>
      </LegalSection>
      <LegalSection title="Changes">
        <p>
          When this page changes, we update the date at the top. If a change affects how we use your
          data, we will email workspace owners before it applies.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
