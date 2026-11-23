import {
  ArrowRight,
  BadgeCheck,
  Check,
  Clock3,
  FileCode2,
  KeyRound,
  Link2,
  ListOrdered,
  Mail,
  Palette,
  ShieldCheck,
  UserRoundPen,
  UsersRound,
  Webhook,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatBytes, type PlanLimits } from '@/lib/plans';
import { APP_HOME } from '@/lib/safe-next';
import { Clip, type ClipSpec } from './clip';
import { CLIPS } from './clips';
import { CONTACT_EMAIL, DOCS_URL, GITHUB_URL, SELF_HOST_DOCS, VERIFY_URL } from './links';
import { SiteFooter } from './site-footer';
import { SiteHeader, type SiteViewer } from './site-header';

/** Only what the product does today: every line here can be checked in the code. */
const TRUST: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ShieldCheck,
    title: 'PAdES seal',
    text: 'On every completed PDF. Any later change breaks it.',
  },
  {
    icon: Link2,
    title: 'Hash-chained audit trail',
    text: 'Each step carries a SHA-256 hash of the one before.',
  },
  {
    icon: KeyRound,
    title: 'One-time email codes',
    text: 'The document opens only after the signer types the code.',
  },
  {
    icon: BadgeCheck,
    title: 'Public verify page',
    text: 'Anyone can check a signed PDF, no account needed.',
  },
  {
    icon: Webhook,
    title: 'Signed webhooks',
    text: 'HMAC-SHA256 on every delivery, with a delivery log.',
  },
  {
    icon: FileCode2,
    title: 'Open source',
    text: 'Libraries under Apache-2.0, the app under AGPL-3.0.',
  },
];

interface Feature {
  id: string;
  eyebrow: string;
  title: string;
  text: string;
  points: string[];
  clip: ClipSpec;
  /** The phone recording sits in a phone frame; the rest in a browser window. */
  phone?: boolean;
}

const FEATURES: Feature[] = [
  {
    id: 'send',
    eyebrow: 'Send',
    title: 'Send a document in a minute',
    text: 'Upload a PDF, add who signs, drag signature and date boxes onto the page, and send. The draft saves as you go.',
    points: [
      'Signers, approvers and people who only get a copy',
      'One after another, or everyone at once',
      'Reminders and an expiry date for each envelope',
    ],
    clip: CLIPS.send,
  },
  {
    id: 'sign',
    eyebrow: 'Sign',
    title: 'Signing that works on any phone',
    text: 'The signer opens the link from their email, types the one-time code we send them and signs with a finger. No account and no app.',
    points: [
      'A one-time code before the document opens',
      'Draw, type or upload a signature',
      'Your logo and colour on the signing page',
    ],
    clip: CLIPS.sign,
    phone: true,
  },
  {
    id: 'seal',
    eyebrow: 'Seal',
    title: 'A sealed PDF with its certificate',
    text: 'When the last person signs, the PDF gets a PAdES seal and a certificate page: who signed, when, from which IP address and device, and a SHA-256 fingerprint of every file.',
    points: [
      'Any later change to the file breaks the seal',
      'Times in UTC and in your workspace time zone',
      'Everyone gets the signed copy by email',
    ],
    clip: CLIPS.sealed,
  },
  {
    id: 'audit',
    eyebrow: 'Track',
    title: 'An audit trail nobody can quietly edit',
    text: 'Every step, from draft to sealed, is recorded with a hash of the step before it. The envelope page checks the chain and shows the whole history live.',
    points: [
      'Opened, verified, signed: each with its time and IP address',
      'A log of every email the workspace sent',
      'The evidence record as JSON, for your own files',
    ],
    clip: CLIPS.audit,
  },
  {
    id: 'verify',
    eyebrow: 'Verify',
    title: 'Anyone can check a signed PDF',
    text: 'Drop a signed PDF on the public verify page. It shows whether the seal is intact, who signed and when, and whether the audit trail is complete.',
    points: [
      'A changed file is caught, down to a single byte',
      'Checked in memory, not stored or logged',
      'No account needed, so you can send the link to anyone',
    ],
    clip: CLIPS.verify,
  },
  {
    id: 'templates',
    eyebrow: 'Scale',
    title: 'Templates and bulk send',
    text: 'Keep the documents you send often with roles and fields in place. Then send one to a whole list from a CSV file: every row is checked before anything goes out.',
    points: [
      'Problems named by row and column',
      'Skip the rows with problems, or fix them and upload again',
      'Sending carries on in the background',
    ],
    clip: CLIPS.bulk,
  },
];

const MORE: { icon: LucideIcon; title: string; text: string }[] = [
  {
    icon: ListOrdered,
    title: 'Signing order',
    text: 'One after another or all at once, with reminders that go out on their own.',
  },
  {
    icon: UserRoundPen,
    title: 'Fix after sending',
    text: 'Correct a mistyped email, resend a link, or recall the envelope to edit it.',
  },
  {
    icon: Palette,
    title: 'Your brand and words',
    text: 'Logo, colour and font on the signing page, and your own text in every email.',
  },
  {
    icon: Clock3,
    title: 'Time zones',
    text: 'Each workspace picks its zone; every date on screen and on paper names it.',
  },
  {
    icon: UsersRound,
    title: 'Team workspaces',
    text: 'Invite people by email and give each the role they need.',
  },
  {
    icon: Mail,
    title: 'Email log',
    text: 'See every message sent from the workspace, and to whom.',
  },
];

const API_SNIPPET = `import { createSignClient } from '@codevibe_technology/sign-client';

const sign = createSignClient({
  baseUrl: 'https://sign.codevibe.in/api',
  apiKey: process.env.SIGN_API_KEY!,
});

await sign.envelopes.create({
  title: 'Design services agreement',
  send: true,
  documents: [{ key: 'deal', name: 'agreement.pdf', content: pdf }],
  recipients: [
    { key: 'rohan', name: 'Rohan Mehta', email: 'rohan@example.com', auth: 'email_otp' },
  ],
  fields: [
    { recipient: 'rohan', type: 'signature', page: 0, x: 306, y: 330, width: 210, height: 58 },
  ],
});`;

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
          The Act does not cover some documents: wills, trust deeds, most powers of attorney and
          most negotiable instruments other than cheques. Since a 2022 amendment, property sale
          contracts are no longer on that list, though registration and stamp duty rules still
          apply. Where a law asks for an electronic signature listed in the Act&rsquo;s Second
          Schedule, use Aadhaar eSign. For high-value agreements, check with your lawyer. This is
          not legal advice.
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
  {
    q: 'Can I use it outside India?',
    a: (
      <p>
        Yes. Each workspace picks its own time zone, and the dates on signed documents, in emails
        and on the certificate use it. Every time shown on screen names its zone, so people in
        different countries read the same moment. The app is in English.
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

/** The Codevibe section label: a mono eyebrow with a short teal rule. */
function Eyebrow({ children, onDark = false }: { children: ReactNode; onDark?: boolean }) {
  return (
    <p
      className={cn(
        'flex items-center gap-2.5 font-mono text-xs font-medium tracking-[0.12em] uppercase',
        onDark ? 'text-white/75' : 'text-muted',
      )}
    >
      <span aria-hidden className="h-px w-6 bg-accent" />
      {children}
    </p>
  );
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
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={`${id}-title`} className="mt-3 max-w-2xl text-3xl font-bold sm:text-4xl">
          {title}
        </h2>
        {intro ? <p className="mt-3 max-w-2xl text-lg text-muted">{intro}</p> : null}
        <div className="mt-10 sm:mt-12">{children}</div>
      </div>
    </section>
  );
}

/** A browser window around a desktop clip, so it reads as the product and not as a picture. */
function BrowserFrame({
  clip,
  describedBy,
  eager,
  className,
}: {
  clip: ClipSpec;
  describedBy?: string;
  eager?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-line bg-surface shadow-[0_24px_60px_-20px_rgb(13_27_42/0.35)]',
        className,
      )}
    >
      <div
        aria-hidden
        className="flex h-8 items-center gap-1.5 border-b border-line bg-surface-2 px-3"
      >
        <span className="h-2.5 w-2.5 rounded-full bg-[#F26B5B]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#F5BE4F]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#4CC38A]" />
      </div>
      <Clip clip={clip} describedBy={describedBy} eager={eager} />
    </div>
  );
}

function PhoneFrame({ clip, describedBy }: { clip: ClipSpec; describedBy?: string }) {
  return (
    <div className="mx-auto w-full max-w-[280px] rounded-[2.4rem] bg-[#0D1B2A] p-2.5 shadow-[0_24px_60px_-20px_rgb(13_27_42/0.5)]">
      <div className="overflow-hidden rounded-[1.9rem]">
        <Clip clip={clip} describedBy={describedBy} />
      </div>
    </div>
  );
}

function FeatureRow({ feature, index }: { feature: Feature; index: number }) {
  const flip = index % 2 === 1;
  return (
    <li
      id={feature.id}
      className="grid scroll-mt-20 grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-14"
    >
      <div className={cn('lg:col-span-5', flip && 'lg:order-2')}>
        <p className="font-mono text-xs font-medium tracking-[0.12em] text-primary uppercase">
          {String(index + 1).padStart(2, '0')} · {feature.eyebrow}
        </p>
        <h3 id={`${feature.id}-title`} className="mt-3 text-2xl font-bold sm:text-3xl">
          {feature.title}
        </h3>
        <p id={`${feature.id}-text`} className="mt-3 text-lg text-muted">
          {feature.text}
        </p>
        <ul className="mt-5 space-y-2.5">
          {feature.points.map((point) => (
            <li key={point} className="flex gap-2.5">
              <Check aria-hidden className="mt-1 h-4 w-4 shrink-0 text-success" />
              {point}
            </li>
          ))}
        </ul>
      </div>
      <div className={cn('min-w-0 lg:col-span-7', flip && 'lg:order-1')}>
        {feature.phone ? (
          <div className="rounded-2xl bg-gradient-to-br from-primary-soft via-surface to-accent-soft px-6 py-8 sm:py-10">
            <PhoneFrame clip={feature.clip} describedBy={`${feature.id}-text`} />
          </div>
        ) : (
          <BrowserFrame clip={feature.clip} describedBy={`${feature.id}-text`} />
        )}
      </div>
    </li>
  );
}

/** The public home page of the hosted cloud. A signed-in visitor gets their dashboard instead of "Start free". */
export function Landing({
  free,
  cloud,
  viewer = null,
}: {
  free: PlanLimits;
  cloud: PlanLimits;
  viewer?: SiteViewer | null;
}) {
  const start = viewer
    ? { href: APP_HOME, label: 'Go to dashboard' }
    : { href: '/sign-in', label: 'Start free' };
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <SiteHeader viewer={viewer} />
      <main id="main" className="flex-1">
        <section
          aria-labelledby="hero-title"
          className="relative overflow-hidden bg-header px-4 pt-14 pb-16 text-header-ink sm:px-6 sm:pt-20 sm:pb-24"
        >
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:48px_48px]"
          />
          <div
            aria-hidden
            className="absolute -top-40 -right-40 h-[28rem] w-[28rem] rounded-full bg-accent/20 blur-3xl"
          />
          <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_1.15fr] lg:gap-14">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm font-medium text-white/85">
                <span className="h-2 w-2 rounded-full bg-accent" />
                Open-source e-signatures
              </p>
              <h1
                id="hero-title"
                className="mt-5 text-4xl leading-[1.06] font-bold text-white sm:text-5xl lg:text-[3.5rem]"
              >
                Send documents for signature in minutes
              </h1>
              <p className="mt-5 max-w-xl text-lg text-white/80">
                Upload a PDF, place the fields and send. People sign on any phone or laptop, and you
                get back a sealed PDF with a certificate anyone can check.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild className="h-12 px-6 text-base">
                  <Link href={start.href}>
                    {start.label} <ArrowRight aria-hidden className="h-4 w-4" />
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
              <p className="mt-4 text-sm text-white/70">
                A free cloud workspace, no card needed. Or run it on your own server with no limits.
              </p>
              <p className="mt-2 text-sm text-white/70">
                Received a signed PDF?{' '}
                <Link
                  href={VERIFY_URL}
                  className="font-semibold text-white underline underline-offset-2 hover:no-underline"
                >
                  Check it here
                </Link>
                .
              </p>
            </div>
            <figure className="min-w-0">
              <BrowserFrame
                clip={CLIPS.hero}
                describedBy="hero-clip-text"
                eager
                className="border-white/10"
              />
              <figcaption id="hero-clip-text" className="mt-3 text-sm text-white/70">
                The real app: fields placed on a PDF, the sealed copy, and the public seal check.
              </figcaption>
            </figure>
          </div>
        </section>

        <section
          aria-labelledby="trust-title"
          className="border-b border-line bg-surface px-4 sm:px-6"
        >
          <div className="mx-auto max-w-6xl py-10">
            <h2 id="trust-title" className="sr-only">
              Built to be checked
            </h2>
            <ul className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {TRUST.map((item) => (
                <li key={item.title} className="flex gap-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0D1B2A] text-accent">
                    <item.icon aria-hidden className="h-5 w-5" />
                  </span>
                  <div>
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-sm text-muted">{item.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <Section
          id="features"
          eyebrow="How it works"
          title="From PDF to sealed copy, on any device"
          intro="Each clip below is the real app, recorded with made-up people and companies."
        >
          <ol className="space-y-20 sm:space-y-28">
            {FEATURES.map((feature, i) => (
              <FeatureRow key={feature.id} feature={feature} index={i} />
            ))}
          </ol>
          <div className="mt-24 rounded-2xl border border-line bg-surface p-6 sm:p-8">
            <h3 className="text-xl font-bold">Also in the box</h3>
            <ul className="mt-6 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {MORE.map((item) => (
                <li key={item.title} className="flex gap-3.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <item.icon aria-hidden className="h-[18px] w-[18px]" />
                  </span>
                  <div>
                    <h4 className="font-semibold">{item.title}</h4>
                    <p className="text-sm text-muted">{item.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <section
          id="developers"
          aria-labelledby="developers-title"
          className="scroll-mt-16 bg-header px-4 py-16 text-header-ink sm:px-6 sm:py-24"
        >
          <div className="mx-auto max-w-6xl">
            <Eyebrow onDark>Developers</Eyebrow>
            <h2
              id="developers-title"
              className="mt-3 max-w-2xl text-3xl font-bold text-white sm:text-4xl"
            >
              An API for everything in the app
            </h2>
            <p className="mt-3 max-w-2xl text-lg text-white/80">
              Make an API key for each system, send envelopes from your backend, and get a signed
              webhook when something happens.
            </p>
            <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-10">
              <div className="min-w-0">
                <pre
                  tabIndex={0}
                  aria-label="Sending an envelope with the TypeScript client"
                  className="overflow-x-auto rounded-xl border border-white/10 bg-black/30 p-5 font-mono text-[13px] leading-6 text-white/90"
                >
                  <code>{API_SNIPPET}</code>
                </pre>
                <ul className="mt-6 grid gap-3 text-white/85 sm:grid-cols-2">
                  {[
                    'OpenAPI 3.1 and a Postman collection',
                    'Webhooks signed with HMAC-SHA256',
                    'Idempotency keys: a retry never sends twice',
                    'Typed client for Node, browsers and edge',
                  ].map((point) => (
                    <li key={point} className="flex gap-2.5 text-sm">
                      <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      {point}
                    </li>
                  ))}
                </ul>
                <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
                  <a
                    className="text-accent underline-offset-2 hover:underline"
                    href={`${DOCS_URL}/http-api/`}
                  >
                    Read the API docs
                  </a>
                  <a
                    className="text-accent underline-offset-2 hover:underline"
                    href={`${DOCS_URL}/guides/webhooks`}
                  >
                    Verify webhooks
                  </a>
                </div>
              </div>
              <figure className="min-w-0">
                <BrowserFrame
                  clip={CLIPS.api}
                  describedBy="api-clip-text"
                  className="border-white/10"
                />
                <figcaption id="api-clip-text" className="mt-3 text-sm text-white/70">
                  Creating an API key for a billing system, then a webhook endpoint for the events
                  it needs.
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

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
              <pre
                tabIndex={0}
                aria-label="Commands to self-host with Docker"
                className="mt-4 overflow-x-auto rounded-lg bg-black/30 p-4 font-mono text-sm leading-6 text-white/90"
              >
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
                  <Link href={start.href}>{start.label}</Link>
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

        <section aria-labelledby="start-title" className="px-4 pb-20 sm:px-6 sm:pb-28">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl bg-header px-6 py-12 text-center sm:px-12 sm:py-16">
            <div
              aria-hidden
              className="absolute -bottom-32 -left-24 h-72 w-72 rounded-full bg-primary/30 blur-3xl"
            />
            <div
              aria-hidden
              className="absolute -top-32 -right-24 h-72 w-72 rounded-full bg-accent/25 blur-3xl"
            />
            <h2 id="start-title" className="relative text-3xl font-bold text-white sm:text-4xl">
              Send your first document today
            </h2>
            <p className="relative mx-auto mt-3 max-w-xl text-lg text-white/80">
              A free cloud workspace takes a minute to set up. Or run the same app on your own
              server.
            </p>
            <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild className="h-12 px-6 text-base">
                <Link href={start.href}>
                  {start.label} <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="ghost"
                className="h-12 border border-white/25 px-6 text-base text-white hover:bg-white/10"
              >
                <a href={DOCS_URL}>Read the docs</a>
              </Button>
            </div>
          </div>
        </section>
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
