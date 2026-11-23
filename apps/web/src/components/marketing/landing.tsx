import { ArrowRight, Check, Mail, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { formatBytes, type PlanLimits } from '@/lib/plans';
import { APP_HOME } from '@/lib/safe-next';
import { Clip } from './clip';
import { CLIPS } from './clips';
import { ExternalLink } from './external-link';
import {
  CONTACT_EMAIL,
  DOCS_URL,
  EVIDENCE_GUIDE,
  GITHUB_URL,
  SELF_HOST_DOCS,
  VERIFY_URL,
} from './links';
import { reveal } from './reveal';
import { RevealOnScroll } from './reveal-on-scroll';
import { SAMPLE_TRAIL, shortHash } from './sample-trail';
import { ScrollStory, type StoryStep } from './scroll-story';
import { SiteFooter } from './site-footer';
import { SiteHeader, type SiteViewer } from './site-header';
import { SmoothAnchors } from './smooth-anchors';

const STEPS: StoryStep[] = [
  {
    id: 'send',
    name: 'Send',
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
    name: 'Sign',
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
    name: 'Seal',
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
    name: 'Track',
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
    name: 'Verify',
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
    name: 'Scale',
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

const MORE: { title: string; text: string }[] = [
  {
    title: 'Signing order',
    text: 'One after another or all at once, with reminders that go out on their own.',
  },
  {
    title: 'Fix after sending',
    text: 'Correct a mistyped email, resend a link, or recall the envelope to edit it.',
  },
  {
    title: 'Your brand and words',
    text: 'Logo, colour and font on the signing page, and your own text in every email.',
  },
  {
    title: 'Time zones',
    text: 'Each workspace picks its zone; every date on screen and on paper names it.',
  },
  {
    title: 'Team workspaces',
    text: 'Invite people by email and give each the role they need.',
  },
  {
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
        Not in the app yet. The open-source <code>sign-aadhaar</code> package is a standalone
        library: the server and the web app do not call it, so today you use it from your own
        backend with your own eSign provider account. Aadhaar eSign in the app, through a licensed
        eSign provider, is planned.
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

/** A sheet of paper: the frame for the app's own screens on this page. */
function Sheet({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[3px] bg-surface shadow-[0_1px_0_rgb(13_27_42/0.04),0_24px_48px_-24px_rgb(13_27_42/0.45)] ring-1 ring-line',
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A signature in the app's blue ink, written once across the edge of the sealed copy, the way
 * people sign across an envelope's flap so that opening it shows.
 */
function InkSignature({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 240 90"
      fill="none"
      className={cn('text-primary', className)}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        pathLength={1}
        className="ink-stroke"
        stroke="currentColor"
        strokeWidth={2.4}
        d="M14 64 C18 42 22 22 31 17 C41 12 47 26 37 35 C31 41 22 43 28 46 C36 50 44 62 53 67 M59 58 C63 50 67 44 71 50 C73 54 72 62 75 60 C79 52 83 46 87 52 C89 56 88 62 92 60 C97 54 101 44 105 50 C107 54 105 60 111 58 C119 55 121 46 117 46 C111 46 111 58 121 60 C129 62 135 50 139 34 C141 26 141 22 139 30 C135 46 135 60 141 60 C147 60 151 48 157 48 C163 48 159 60 167 58 C175 56 177 48 181 50 C187 52 183 60 191 60 C197 60 201 54 206 51"
      />
      <path
        pathLength={1}
        className="ink-stroke ink-stroke-late"
        stroke="currentColor"
        strokeWidth={1.8}
        d="M22 77 C78 72 146 67 228 57"
      />
    </svg>
  );
}

/** The slip a sealed copy carries: what the certificate page says, in brief. */
function SealSlip() {
  const last = SAMPLE_TRAIL.at(-1)!;
  return (
    <div
      aria-hidden
      className="relative bg-[#0D1B2A] px-4 py-3.5 font-mono text-[11px] leading-5 text-white/75 shadow-[0_16px_32px_-16px_rgb(13_27_42/0.6)] sm:px-5"
    >
      <p className="flex items-center justify-between gap-4 font-sans text-[13px] font-semibold text-white">
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-accent" />
          Seal intact
        </span>
        <span className="font-mono text-[11px] font-medium text-accent">PAdES</span>
      </p>
      <p className="mt-1.5">
        SHA-256 <span className="text-white">{shortHash(last.hash)}</span>
      </p>
      <p>Signed 23 Nov 2026, {last.at.slice(0, 5)} IST</p>
    </div>
  );
}

function AuditSheet() {
  return (
    <figure className="min-w-0">
      <Sheet>
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
          <p className="truncate text-sm font-semibold">Design services agreement</p>
          <p className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-success">
            <Check aria-hidden className="h-3.5 w-3.5" />
            Chain intact
          </p>
        </div>
        <ol className="px-5 py-2">
          {SAMPLE_TRAIL.map((entry, i) => (
            <li
              key={entry.action}
              className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 sm:grid-cols-[4.5rem_minmax(0,1fr)] sm:gap-x-4"
            >
              <time className="pt-[1.1rem] font-mono text-[11px] text-muted tabular-nums sm:text-xs">
                {entry.at}
              </time>
              <div className="relative min-w-0 py-3.5 pl-5">
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-0 bottom-0 left-0 w-px bg-line-strong',
                    i === 0 && 'top-[1.35rem]',
                    i === SAMPLE_TRAIL.length - 1 && 'bottom-auto h-[1.35rem]',
                  )}
                />
                <span
                  aria-hidden
                  className="absolute top-[1.1rem] -left-[3px] h-[7px] w-[7px] rotate-45 bg-ink"
                />
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{entry.title}</span>
                  <code className="font-mono text-[11px] text-muted">{entry.action}</code>
                </p>
                <p className="mt-0.5 text-sm text-muted">{entry.detail}</p>
                <p className="mt-1.5 truncate font-mono text-[11px] leading-4 text-muted">
                  <span className="text-ink">{shortHash(entry.hash)}</span>
                  {entry.prev ? (
                    <> &nbsp;covers {shortHash(entry.prev)}</>
                  ) : (
                    <> &nbsp;first entry</>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t border-dashed border-line-strong bg-surface-2/60 px-5 py-3.5 text-sm">
          <span className="font-semibold">And at any time later,</span>{' '}
          <span className="text-muted">
            anyone can drop the PDF on the verify page and see the seal intact and the trail
            complete.
          </span>
        </div>
      </Sheet>
      <figcaption className="mt-3 text-sm text-muted">
        An example trail with made-up people. The hashes are real SHA-256 hashes of it.
      </figcaption>
    </figure>
  );
}

function PlanColumn({
  name,
  price,
  note,
  lines,
  action,
  first,
}: {
  name: string;
  price: string;
  note: string;
  lines: string[];
  action: ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex flex-col p-6 transition-colors duration-200 ease-out sm:p-8',
        first ? 'bg-surface' : 'hover:bg-surface/60',
      )}
    >
      <h3 className="text-lg font-semibold">{name}</h3>
      <p className="mt-3 font-display text-4xl font-bold tracking-tight">{price}</p>
      <p className="mt-2 text-muted">{note}</p>
      <ul className="mt-6 flex-1 space-y-2.5 border-t border-line pt-5 text-sm">
        {lines.map((line) => (
          <li key={line} className="flex gap-2">
            <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            {line}
          </li>
        ))}
      </ul>
      <div className="mt-8">{action}</div>
    </div>
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
    <div className="marketing flex min-h-dvh flex-col bg-canvas">
      <SmoothAnchors />
      <RevealOnScroll />
      <SiteHeader viewer={viewer} />
      <main id="main" className="flex-1">
        <section
          aria-labelledby="hero-title"
          className="overflow-hidden px-4 pt-8 pb-14 sm:px-6 sm:pt-12 sm:pb-16 lg:flex lg:min-h-[calc(100svh-4rem)] lg:items-center lg:py-10"
        >
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-x-14 gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <h1
                id="hero-title"
                className="enter text-[clamp(2.4rem,1.2rem+3.2vw,3.4rem)] leading-[1.02] font-bold tracking-[-0.03em]"
              >
                Get it signed. <br />
                <span className="text-primary">Keep the proof.</span>
              </h1>
              <p className="enter mt-5 max-w-[34rem] text-muted sm:text-lg [--enter-order:1]">
                Upload a PDF, place the fields and send. People sign on any phone or laptop, and you
                get back a sealed PDF with a certificate page that anyone can check, no account
                needed.
              </p>
              <div className="enter mt-7 flex flex-col gap-3 sm:flex-row [--enter-order:2]">
                <Button asChild className="h-12 px-6 text-base">
                  <Link href={start.href}>
                    {start.label} <ArrowRight aria-hidden className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="secondary" className="h-12 px-6 text-base">
                  <ExternalLink href={GITHUB_URL} bare>
                    Self-host it
                  </ExternalLink>
                </Button>
              </div>
              <div className="enter [--enter-order:3]">
                <p className="mt-5 text-sm text-muted">
                  Start on the Free plan, no card needed. Or self-host it, free and unlimited.
                </p>
                <p className="mt-1 text-sm text-muted">
                  Received a signed PDF?{' '}
                  <Link
                    href={VERIFY_URL}
                    className="font-semibold text-primary underline underline-offset-2 hover:no-underline"
                  >
                    Check it here
                  </Link>
                  .
                </p>
              </div>
            </div>
            <figure className="min-w-0">
              <div className="relative pr-2 pb-2 sm:pr-3">
                <div
                  aria-hidden
                  className="absolute inset-0 top-3 left-3 rotate-[1.4deg] rounded-[3px] bg-surface ring-1 ring-line"
                />
                <div
                  aria-hidden
                  className="absolute inset-0 top-1.5 left-1.5 rotate-[0.6deg] rounded-[3px] bg-surface ring-1 ring-line"
                />
                <Sheet className="relative">
                  <Clip clip={CLIPS.hero} describedBy="hero-clip-text" eager />
                </Sheet>
              </div>
              <div className="relative -mt-8 flex items-end pl-4 sm:-mt-10 sm:pl-8">
                <InkSignature className="pointer-events-none absolute -top-9 left-[34%] z-20 w-[36%] max-w-[13rem] sm:left-[45%] sm:w-[32%] sm:-top-11" />
                <div className="enter relative z-10 w-[min(18rem,72%)] [--enter-order:4]">
                  <SealSlip />
                </div>
              </div>
              <figcaption id="hero-clip-text" className="mt-3 text-sm text-muted">
                The real app, with made-up people: fields placed on a PDF, the sealed copy, and the
                public seal check.
              </figcaption>
            </figure>
          </div>
        </section>

        <section
          id="proof"
          aria-labelledby="proof-title"
          className="scroll-mt-16 border-t border-line bg-surface-2/50 px-4 py-20 sm:px-6 sm:py-28"
        >
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <div className="lg:pt-4" {...reveal()}>
              <h2 id="proof-title" className="text-3xl font-bold sm:text-4xl">
                Every step goes on the record
              </h2>
              <p className="mt-4 text-lg text-muted">
                Each entry in an envelope&rsquo;s audit trail carries a SHA-256 hash of the entry
                before it. Change or remove one and the chain stops adding up.
              </p>
              <p className="mt-4 text-muted">
                The signer only sees the document after typing a one-time code from their email.
                When the last person signs, the PDF is sealed and gets a certificate page: who
                signed, when, and from which IP address and device.
              </p>
              <ul className="mt-8 space-y-3 border-t border-line pt-6 text-sm font-semibold">
                <li>
                  <Link
                    href={VERIFY_URL}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Check a signed PDF on the verify page
                  </Link>
                </li>
                <li>
                  <a
                    href={EVIDENCE_GUIDE}
                    className="text-primary underline-offset-2 hover:underline"
                  >
                    Read how the certificate serves as evidence
                  </a>
                </li>
              </ul>
            </div>
            <div className="min-w-0" {...reveal(1)}>
              <AuditSheet />
            </div>
          </div>
        </section>

        <ScrollStory
          id="features"
          title="From PDF to sealed copy, on any device"
          intro="Each clip is the real app, recorded with made-up people and companies."
          steps={STEPS}
        />

        <section aria-labelledby="more-title" className="px-4 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <div {...reveal()}>
              <h2 id="more-title" className="text-3xl font-bold sm:text-4xl">
                Also in the box
              </h2>
              <p className="mt-3 text-lg text-muted">
                The parts you notice on the second day, when real people start signing.
              </p>
            </div>
            <dl className="grid grid-cols-1 gap-x-10 sm:grid-cols-2">
              {MORE.map((item, i) => (
                <div key={item.title} className="border-t border-line py-5" {...reveal(i % 2)}>
                  <dt className="font-semibold">{item.title}</dt>
                  <dd className="mt-1 text-muted">{item.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section
          id="developers"
          aria-labelledby="developers-title"
          className="scroll-mt-16 bg-[#0D1B2A] px-4 py-20 text-white sm:px-6 sm:py-28"
        >
          <div className="mx-auto max-w-6xl">
            <h2
              id="developers-title"
              className="max-w-2xl text-3xl font-bold sm:text-4xl"
              {...reveal()}
            >
              An API for everything in the app
            </h2>
            <p className="mt-4 max-w-2xl text-lg text-white/80" {...reveal()}>
              Make an API key for each system, send envelopes from your backend, and get a signed
              webhook when something happens.
            </p>
            <div className="mt-12 grid grid-cols-1 gap-10 lg:grid-cols-2">
              <div className="min-w-0" {...reveal(1)}>
                <div className="overflow-hidden rounded-[3px] ring-1 ring-white/12">
                  <p className="border-b border-white/10 bg-white/[0.04] px-4 py-2 font-mono text-xs text-white/70">
                    send-agreement.ts
                  </p>
                  <pre
                    tabIndex={0}
                    aria-label="Sending an envelope with the TypeScript client"
                    className="overflow-x-auto bg-black/25 p-5 font-mono text-[13px] leading-6 text-white/90"
                  >
                    <code>{API_SNIPPET}</code>
                  </pre>
                </div>
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
              <figure className="min-w-0" {...reveal(2)}>
                <Sheet className="ring-white/10">
                  <Clip clip={CLIPS.api} describedBy="api-clip-text" />
                </Sheet>
                <figcaption id="api-clip-text" className="mt-3 text-sm text-white/70">
                  Creating an API key for a billing system, then a webhook endpoint for the events
                  it needs.
                </figcaption>
              </figure>
            </div>
          </div>
        </section>

        <section
          id="open-source"
          aria-labelledby="open-source-title"
          className="scroll-mt-16 px-4 py-20 sm:px-6 sm:py-28"
        >
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <div {...reveal()}>
              <h2 id="open-source-title" className="text-3xl font-bold sm:text-4xl">
                Read the code. Run it yourself.
              </h2>
              <p className="mt-4 text-lg text-muted">
                The cloud runs the same code you can download. Nothing is held back for a paid
                edition.
              </p>
              <div className="mt-8 grid grid-cols-1 gap-6 border-t border-line pt-6 sm:grid-cols-2">
                <div>
                  <h3 className="font-semibold">Libraries under Apache-2.0</h3>
                  <p className="mt-1 text-sm text-muted">
                    The signing rules, PDF sealing, the React signing view and the API client. Use
                    them in any product, open or closed.
                  </p>
                </div>
                <div>
                  <h3 className="font-semibold">Server and app under AGPL-3.0</h3>
                  <p className="mt-1 text-sm text-muted">
                    Run them, change them and keep them. If you offer a changed version to others
                    over a network, share your changes.
                  </p>
                </div>
              </div>
            </div>
            <div className="min-w-0 self-end" {...reveal(1)}>
              <div className="overflow-hidden rounded-[3px] bg-[#0D1B2A] text-white">
                <div className="border-b border-white/10 px-5 py-3">
                  <h3 className="font-semibold">Self-host with Docker</h3>
                  <p className="mt-0.5 text-sm text-white/75">
                    One container for the app, one for PostgreSQL. Your documents never leave your
                    server, and there are no limits.
                  </p>
                </div>
                <pre
                  tabIndex={0}
                  aria-label="Commands to self-host with Docker"
                  className="overflow-x-auto p-5 font-mono text-[13px] leading-6 text-white/90"
                >
                  <code>{`git clone ${GITHUB_URL}.git
cd codevibe-sign/deploy
cp .env.example .env    # set your domain and secrets
docker compose up -d`}</code>
                </pre>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
                <a
                  className="text-primary underline-offset-2 hover:underline"
                  href={SELF_HOST_DOCS}
                >
                  Read the self-hosting guide
                </a>
                <ExternalLink
                  className="text-primary underline-offset-2 hover:underline"
                  href={GITHUB_URL}
                >
                  View on GitHub
                </ExternalLink>
              </div>
            </div>
          </div>
        </section>

        <section
          id="pricing"
          aria-labelledby="pricing-title"
          className="scroll-mt-16 border-t border-line bg-surface-2/50 px-4 py-20 sm:px-6 sm:py-28"
        >
          <div className="mx-auto max-w-6xl">
            <div {...reveal()}>
              <h2 id="pricing-title" className="max-w-2xl text-3xl font-bold sm:text-4xl">
                Start free. <span className="whitespace-nowrap">Self-host</span> for nothing.
              </h2>
              <p className="mt-4 max-w-2xl text-lg text-muted">
                Every plan seals the same way and keeps the same audit trail. The limits are the
                only difference.
              </p>
            </div>
            <div
              {...reveal(1)}
              className="mt-12 grid grid-cols-1 divide-y divide-line rounded-[3px] bg-canvas ring-1 ring-line lg:grid-cols-3 lg:divide-x lg:divide-y-0"
            >
              <PlanColumn
                name="Free"
                price="₹0"
                note="A cloud workspace for trying it out and small teams."
                lines={planLines(free)}
                action={
                  <Button asChild className="h-11 w-full">
                    <Link href={start.href}>{start.label}</Link>
                  </Button>
                }
                first
              />
              <PlanColumn
                name="Cloud"
                price="Coming soon"
                note="For teams that send every day. Write to us from a Free workspace to be upgraded."
                lines={planLines(cloud)}
                action={
                  <Button asChild variant="secondary" className="h-11 w-full">
                    <a
                      href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Codevibe Sign Cloud plan')}`}
                    >
                      <Mail aria-hidden className="h-4 w-4" />
                      Upgrade by email
                    </a>
                  </Button>
                }
              />
              <PlanColumn
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
                  <Button asChild variant="secondary" className="h-11 w-full">
                    <ExternalLink href={GITHUB_URL} bare>
                      Self-host it
                    </ExternalLink>
                  </Button>
                }
              />
            </div>
          </div>
        </section>

        <section
          id="faq"
          aria-labelledby="faq-title"
          className="scroll-mt-16 px-4 py-20 sm:px-6 sm:py-28"
        >
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
            <div {...reveal()}>
              <h2 id="faq-title" className="text-3xl font-bold sm:text-4xl">
                Good to know
              </h2>
              <p className="mt-4 text-muted">
                Something else on your mind? Write to{' '}
                <a
                  className="font-semibold text-primary hover:underline"
                  href={`mailto:${CONTACT_EMAIL}`}
                >
                  {CONTACT_EMAIL}
                </a>
                .
              </p>
            </div>
            <div className="divide-y divide-line border-y border-line" {...reveal(1)}>
              {FAQ.map((item) => (
                <details key={item.q} className="group py-5 [&_a]:font-semibold [&_a]:text-primary">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden
                      className="mt-1 grid h-5 w-5 shrink-0 place-items-center text-muted transition-transform duration-200 group-open:rotate-45"
                    >
                      <span className="absolute h-px w-3 bg-current" />
                      <span className="absolute h-3 w-px bg-current" />
                    </span>
                  </summary>
                  <div className="mt-3 max-w-[65ch] text-muted">{item.a}</div>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="start-title" className="px-4 pb-24 sm:px-6 sm:pb-32">
          <div
            className="mx-auto grid max-w-6xl grid-cols-1 items-end gap-10 border-t-2 border-ink pt-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]"
            {...reveal()}
          >
            <div>
              <h2 id="start-title" className="text-4xl font-bold sm:text-5xl">
                Send your first document today
              </h2>
              <p className="mt-4 max-w-xl text-lg text-muted">
                A Free plan workspace takes a minute to set up. Or run the same app on your own
                server, free and unlimited.
              </p>
            </div>
            <div>
              <div className="relative rounded-[3px] border border-dashed border-primary bg-primary-soft/60 p-3">
                <span className="absolute -top-2.5 left-3 bg-canvas px-1.5 font-mono text-[11px] font-medium text-primary">
                  Signature *
                </span>
                <Button asChild className="h-12 w-full text-base">
                  <Link href={start.href}>
                    {start.label} <ArrowRight aria-hidden className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-4 text-sm">
                <span className="text-muted">The field is yours to fill.</span>
                <a href={DOCS_URL} className="font-semibold text-primary hover:underline">
                  Read the docs
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
