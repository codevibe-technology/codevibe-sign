import {
  ArrowRight,
  BadgeCheck,
  Braces,
  Check,
  FileCheck2,
  FileStack,
  FileUp,
  KeyRound,
  Link2,
  ListOrdered,
  Mail,
  MousePointerClick,
  Palette,
  PenLine,
  Send,
  ShieldCheck,
  Table2,
  UsersRound,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatBytes, type PlanLimits } from '@/lib/plans';
import { CONTACT_EMAIL, GITHUB_URL, SELF_HOST_DOCS } from './links';
import { SiteFooter } from './site-footer';
import { SiteHeader } from './site-header';

const STEPS: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: FileUp,
    title: 'Upload',
    text: 'Add one or more PDFs: contracts, offer letters, NDAs, anything you can save as a PDF.',
  },
  {
    icon: UsersRound,
    title: 'Add people',
    text: 'Signers, approvers and people who only need a copy. Pick an order, or let everyone sign at once.',
  },
  {
    icon: MousePointerClick,
    title: 'Place fields',
    text: 'Drag signature, initials, date, name and text boxes onto the pages for each person.',
  },
  {
    icon: Send,
    title: 'Send',
    text: 'Each person gets an email with their own link when it is their turn. Reminders go out on their own.',
  },
];

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: FileCheck2,
    title: 'Sealed PDF with a PAdES seal',
    text: 'Every completed document carries a PAdES seal. Any later change to the file breaks it, and PDF readers show that.',
  },
  {
    icon: Link2,
    title: 'Hash-chained audit trail',
    text: 'Each step, from sent to signed, is recorded with a hash of the one before, so the history cannot be quietly edited.',
  },
  {
    icon: KeyRound,
    title: 'Email codes',
    text: 'Ask a signer to type a one-time code from their inbox before the document opens.',
  },
  {
    icon: ListOrdered,
    title: 'Signing order',
    text: 'One person after another, or everyone at once. Expiry dates and reminders are set per envelope.',
  },
  {
    icon: FileStack,
    title: 'Templates',
    text: 'Keep the documents you send often with roles and fields in place. Fill in the names and send.',
  },
  {
    icon: Table2,
    title: 'Bulk send from CSV',
    text: 'One template, one CSV, one envelope per row. Every row is checked and its problems shown before anything goes out.',
  },
  {
    icon: Webhook,
    title: 'Webhooks',
    text: 'Signed events to your own systems when envelopes are sent, signed, completed or declined, with a log of every delivery.',
  },
  {
    icon: Braces,
    title: 'HTTP API',
    text: 'Workspace API keys, an OpenAPI description and a Postman collection. Everything in the app is in the API.',
  },
  {
    icon: Palette,
    title: 'Your brand and your emails',
    text: 'Your logo, colour and font on the signing page, and your own words in every email people receive.',
  },
  {
    icon: ShieldCheck,
    title: 'Verify page',
    text: 'Upload a PDF that comes back to you and see whether it is exactly the document your workspace sealed.',
  },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: 'Are electronic signatures legally valid in India?',
    a: (
      <>
        <p>
          For most business documents, yes. The Information Technology Act, 2000 gives electronic
          records legal recognition, and section 10A says a contract is not unenforceable only
          because it was made electronically. Codevibe Sign keeps the evidence that matters: who
          signed, when, from which device, an audit trail that cannot be quietly edited and a seal
          that shows any later change to the PDF.
        </p>
        <p className="mt-3">
          The Act does not cover some documents, such as wills, powers of attorney, trusts,
          negotiable instruments other than cheques, and contracts for the sale of immovable
          property. Where a law asks for an electronic signature listed in the Act&rsquo;s Second
          Schedule, use Aadhaar eSign. For high-value agreements, check with your lawyer.
        </p>
      </>
    ),
  },
  {
    q: 'Is Aadhaar eSign available?',
    a: (
      <p>
        Aadhaar eSign is coming to the cloud through a licensed eSign provider. If you self-host,
        you can add it today with the open-source <code>sign-aadhaar</code> library and your own
        provider account.
      </p>
    ),
  },
  {
    q: 'Where is my data kept?',
    a: (
      <p>
        On the cloud, your documents, the audit trail and your account live in a PostgreSQL database
        and a file store on servers Codevibe runs, reached only over HTTPS. We do not sell your data
        or use it for advertising. If documents must stay on your own premises, self-host: the same
        app runs on your server and nothing is sent to us.
      </p>
    ),
  },
  {
    q: 'What happens when I reach a limit on the Free plan?',
    a: (
      <p>
        Nothing already sent is affected: people can still sign, and every sealed copy stays
        downloadable. A new send that would go past a limit is refused with a message that names the
        limit and what to do. The monthly envelope count starts again on the 1st (UTC). To go
        further, write to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
      </p>
    ),
  },
  {
    q: 'Do the people who sign need an account?',
    a: (
      <p>
        No. They open the link in their email and sign in the browser on their phone or laptop. They
        can download their copy as soon as everyone has signed.
      </p>
    ),
  },
];

const count = (n: number | null, unit: string, many = `${unit}s`) =>
  n === null ? `Unlimited ${many}` : `${n.toLocaleString('en-IN')} ${n === 1 ? unit : many}`;

const size = (n: number | null) => (n === null ? 'any size' : formatBytes(n));

function planLines(limits: PlanLimits): string[] {
  return [
    `${count(limits.envelopesPerMonth, 'envelope')} a month, bulk sends included`,
    count(limits.members, 'member'),
    limits.activeTemplates === null
      ? 'Unlimited templates'
      : `${count(limits.activeTemplates, 'active template')}`,
    count(limits.webhooks, 'webhook endpoint'),
    `Bulk send up to ${limits.bulkRows === null ? 'any number of' : limits.bulkRows.toLocaleString('en-IN')} rows`,
    `${count(limits.apiRequestsPerDay, 'API request')} a day`,
    `PDFs up to ${size(limits.fileBytes)}, ${size(limits.envelopeBytes)} per envelope`,
    `${size(limits.storageBytes)} of stored documents`,
    limits.customDomain ? 'Your own signing domain' : 'Signing links on sign.codevibe.in',
    limits.badgeRequired ? '"Secured by Codevibe Sign" badge shown' : 'Badge optional',
  ];
}

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cn('scroll-mt-16 px-4 py-16 sm:px-6 sm:py-24', className)}
    >
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
        <h2 id={`${id}-title`} className="mt-2 max-w-2xl text-3xl font-bold sm:text-4xl">
          {title}
        </h2>
        {intro ? <p className="mt-3 max-w-2xl text-lg text-muted">{intro}</p> : null}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

/** A small picture of the product: a page with a placed signature and the seal check. */
function HeroVisual() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div className="absolute -top-6 right-0 h-40 w-40 rounded-full bg-accent/25 blur-2xl" />
      <div className="relative rotate-1 rounded-2xl border border-white/10 bg-surface p-5 text-ink shadow-2xl sm:p-6">
        <div className="flex items-center justify-between">
          <p className="font-display text-sm font-semibold">Offer letter.pdf</p>
          <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold text-warning">
            Waiting for Mia
          </span>
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-2.5 w-11/12 rounded bg-surface-2" />
          <div className="h-2.5 w-full rounded bg-surface-2" />
          <div className="h-2.5 w-4/5 rounded bg-surface-2" />
          <div className="h-2.5 w-10/12 rounded bg-surface-2" />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-lg border-2 border-[var(--cvs-recipient-0)] bg-primary-soft/60 p-3">
            <p className="text-[11px] font-semibold text-[var(--cvs-recipient-0)]">Asha signed</p>
            <p className="mt-1 font-serif text-xl text-ink italic">Asha Rao</p>
          </div>
          <div className="rounded-lg border-2 border-dashed border-[var(--cvs-recipient-1)] p-3">
            <p className="text-[11px] font-semibold text-[var(--cvs-recipient-1)]">
              Mia: signature
            </p>
            <p className="mt-1 flex items-center gap-1 text-sm text-muted">
              <PenLine className="h-4 w-4" /> Sign here
            </p>
          </div>
        </div>
      </div>
      <div className="relative -mt-4 ml-auto w-64 -rotate-2 rounded-xl border border-line bg-surface p-4 text-ink shadow-xl sm:-mr-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-success">
          <BadgeCheck className="h-5 w-5" /> Seal is valid
        </p>
        <p className="mt-1 text-xs text-muted">Not changed since it was sealed.</p>
      </div>
    </div>
  );
}

/** The public home page of the hosted cloud, for visitors who are not signed in. */
export function Landing({ free, cloud }: { free: PlanLimits; cloud: PlanLimits }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SiteHeader />
      <main id="main" className="flex-1">
        <section className="relative overflow-hidden bg-header px-4 pt-14 pb-20 text-header-ink sm:px-6 sm:pt-20 sm:pb-28">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:48px_48px]"
          />
          <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-14 lg:grid-cols-[1.1fr_1fr]">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm font-medium text-white/85">
                <span className="h-2 w-2 rounded-full bg-accent" />
                Open-source e-signatures
              </p>
              <h1 className="mt-5 text-4xl leading-[1.08] font-bold text-white sm:text-5xl lg:text-6xl">
                Send documents for signature in minutes
              </h1>
              <p className="mt-5 max-w-xl text-lg text-white/80">
                Upload a PDF, add who signs, drop the boxes on the page and send. People sign in
                their browser, and you get back a sealed PDF with a certificate anyone can check.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-12 px-6 text-base">
                  <Link href="/sign-in">
                    Start free <ArrowRight aria-hidden className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  className="h-12 border border-white/25 px-6 text-base text-white hover:bg-white/10"
                >
                  <a href={GITHUB_URL} target="_blank" rel="noopener">
                    Self-host it
                  </a>
                </Button>
              </div>
              <p className="mt-4 text-sm text-white/65">
                A free cloud workspace, no card needed. Or run it on your own server with no limits.
              </p>
            </div>
            <HeroVisual />
          </div>
        </section>

        <Section
          id="how-it-works"
          eyebrow="How it works"
          title="From PDF to signed copy in four steps"
          intro="The draft saves as you go, so you can stop and pick it up later."
        >
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="rounded-xl border border-line bg-surface p-5 shadow-card"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <step.icon aria-hidden className="h-5 w-5" />
                  </span>
                  <span className="font-display text-sm font-semibold text-muted">
                    Step {i + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-1 text-muted">{step.text}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <PenLine aria-hidden className="h-5 w-5 text-primary" />
                They sign in their browser
              </h3>
              <p className="mt-1 text-muted">
                No account and no app. The signing page opens on any phone or laptop, in your brand,
                and walks them from one field to the next.
              </p>
            </div>
            <div className="rounded-xl border border-accent/60 bg-accent-soft p-5 shadow-card">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <BadgeCheck aria-hidden className="h-5 w-5" />
                You get a sealed PDF with a certificate
              </h3>
              <p className="mt-1 text-ink/80">
                When the last person signs, the PDF is sealed and a certificate is added: who
                signed, when, from where, and a fingerprint of every document.
              </p>
            </div>
          </div>
        </Section>

        <Section
          id="features"
          eyebrow="Features"
          title="Everything a signing tool needs, and the evidence to back it"
          className="bg-surface"
        >
          <ul className="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-ink">
                  <f.icon aria-hidden className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{f.title}</h3>
                  <p className="mt-1 text-muted">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </Section>

        <Section
          id="open-source"
          eyebrow="Open source"
          title="Read the code. Run it yourself."
          intro="The cloud runs the same code you can download. Nothing is held back for a paid edition."
        >
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.1fr]">
            <ul className="space-y-4">
              <li className="rounded-xl border border-line bg-surface p-5">
                <h3 className="font-semibold">Libraries under Apache-2.0</h3>
                <p className="mt-1 text-muted">
                  The signing rules, PDF sealing, the React signing view and the API client. Use
                  them in any product, open or closed.
                </p>
              </li>
              <li className="rounded-xl border border-line bg-surface p-5">
                <h3 className="font-semibold">Server and app under AGPL-3.0</h3>
                <p className="mt-1 text-muted">
                  Run them, change them and keep them. If you offer a changed version to others over
                  a network, share your changes.
                </p>
              </li>
            </ul>
            <div className="min-w-0 rounded-xl bg-header p-5 text-header-ink sm:p-6">
              <h3 className="font-semibold text-white">Self-host with Docker</h3>
              <p className="mt-1 text-sm text-white/75">
                One container for the app, one for PostgreSQL. Your documents never leave your
                server, and there are no limits.
              </p>
              <pre className="mt-4 overflow-x-auto rounded-lg bg-black/30 p-4 text-sm leading-6 text-white/90">
                <code>{`git clone ${GITHUB_URL}.git
cd codevibe-sign/deploy
cp .env.example .env    # set your domain and secrets
docker compose up -d`}</code>
              </pre>
              <div className="mt-4 flex flex-wrap gap-4 text-sm font-semibold">
                <a className="text-accent hover:underline" href={SELF_HOST_DOCS}>
                  Read the self-hosting guide
                </a>
                <a
                  className="text-accent hover:underline"
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener"
                >
                  View on GitHub
                </a>
              </div>
            </div>
          </div>
        </Section>

        <Section
          id="pricing"
          eyebrow="Pricing"
          title="Start free. Self-host for nothing."
          className="bg-surface"
        >
          <div className="grid gap-5 lg:grid-cols-3">
            <PlanCard
              name="Free"
              price="₹0"
              note="A cloud workspace for trying it out and small teams."
              lines={planLines(free)}
              action={
                <Button asChild className="w-full">
                  <Link href="/sign-in">Start free</Link>
                </Button>
              }
              highlight
            />
            <PlanCard
              name="Cloud"
              price="Coming soon"
              note="For teams that send every day."
              lines={planLines(cloud)}
              action={
                <Button asChild variant="secondary" className="w-full">
                  <a
                    href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Codevibe Sign Cloud plan')}`}
                  >
                    <Mail aria-hidden className="h-4 w-4" />
                    Talk to us
                  </a>
                </Button>
              }
            />
            <PlanCard
              name="Self-hosted"
              price="Free"
              note="On your own server, under the open-source licences."
              lines={[
                'No limits on envelopes, members or storage',
                'Every feature, including the API and webhooks',
                'Your documents stay on your server',
                'Your own domain and brand',
                'Help from the community on GitHub',
              ]}
              action={
                <Button asChild variant="secondary" className="w-full">
                  <a href={GITHUB_URL} target="_blank" rel="noopener">
                    Self-host it
                  </a>
                </Button>
              }
            />
          </div>
        </Section>

        <Section id="faq" eyebrow="Questions" title="Good to know">
          <div className="max-w-3xl divide-y divide-line rounded-xl border border-line bg-surface">
            {FAQ.map((item) => (
              <details
                key={item.q}
                className="group px-5 py-4 [&_a]:font-semibold [&_a]:text-primary"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden
                    className="text-xl leading-none text-muted transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <div className="mt-3 text-muted">{item.a}</div>
              </details>
            ))}
          </div>
        </Section>
      </main>
      <SiteFooter />
    </div>
  );
}

function PlanCard({
  name,
  price,
  note,
  lines,
  action,
  highlight,
}: {
  name: string;
  price: string;
  note: string;
  lines: string[];
  action: ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border bg-canvas p-6',
        highlight ? 'border-primary shadow-card ring-1 ring-primary' : 'border-line',
      )}
    >
      <h3 className="text-lg font-semibold">{name}</h3>
      <p className="mt-2 font-display text-3xl font-bold">{price}</p>
      <p className="mt-1 text-muted">{note}</p>
      <ul className="mt-5 flex-1 space-y-2.5 text-sm">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            {line}
          </li>
        ))}
      </ul>
      <div className="mt-6">{action}</div>
    </div>
  );
}
