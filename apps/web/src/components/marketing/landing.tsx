import {
  ArrowLeftRight,
  ArrowRight,
  BellRing,
  Blocks,
  Check,
  CodeXml,
  FileStack,
  Fingerprint,
  GitFork,
  Hash,
  LayoutGrid,
  ListOrdered,
  MapPin,
  Palette,
  Plus,
  QrCode,
  Server,
  ShieldCheck,
  Users,
  UserCog,
  Webhook,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { pricedFeatures } from '@/components/billing/plan-comparison';
import { cn } from '@/lib/cn';
import type { PlanFeature } from '@/lib/plans';
import type { PricingView } from '@/server/billing/pricing';
import { APP_HOME } from '@/lib/safe-next';
import { AadhaarSection } from './aadhaar-section';
import { BrowserFrame } from './browser-frame';
import { Clip, type ClipSpec } from './clip';
import { CLIPS } from './clips';
import { ExternalLink } from './external-link';
import {
  API_DOCS,
  CONTACT_EMAIL,
  DOCS_URL,
  EVIDENCE_GUIDE,
  GITHUB_URL,
  SELF_HOST_DOCS,
  VERIFY_URL,
  WEBHOOKS_GUIDE,
} from './links';
import { PricingPlans } from './pricing-plans';
import { reveal } from './reveal';
import { RevealOnScroll } from './reveal-on-scroll';
import { SAMPLE_TRAIL, shortHash } from './sample-trail';
import { SiteFooter } from './site-footer';
import { SiteHeader, type SiteViewer } from './site-header';
import { SmoothAnchors } from './smooth-anchors';

/** The colour of each icon tile, from the brand blue and teal out to the recipient colours. */
const TILES = {
  blue: 'bg-[#E6EFFC] text-[#1860D0]',
  teal: 'bg-[#DDF7F2] text-[#0E7466]',
  violet: 'bg-[#F1E8FB] text-[#7A35B5]',
  orange: 'bg-[#FDEDE3] text-[#B4471A]',
  green: 'bg-[#E1F5EA] text-[#167347]',
  pink: 'bg-[#FBE7EF] text-[#A62D60]',
} as const;

type Tile = keyof typeof TILES;

function IconTile({ icon: Icon, tone }: { icon: typeof Check; tone: Tile }) {
  return (
    <span
      aria-hidden
      className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', TILES[tone])}
    >
      <Icon className="h-5 w-5" />
    </span>
  );
}

const TRUST: { icon: typeof Check; tone: Tile; title: string; text: string }[] = [
  { icon: ShieldCheck, tone: 'blue', title: 'PAdES seal', text: 'Any later change shows' },
  { icon: Hash, tone: 'teal', title: 'Hash-chained trail', text: 'Every step on the record' },
  { icon: Fingerprint, tone: 'orange', title: 'Aadhaar eSign', text: 'Through Leegality' },
  { icon: GitFork, tone: 'violet', title: 'Open source', text: 'Apache-2.0 and AGPL-3.0' },
  { icon: MapPin, tone: 'green', title: 'Made in India', text: 'Our cloud or your server' },
];

const STEPS: {
  title: string;
  text: string;
  points: string[];
  clip: ClipSpec;
  phone?: boolean;
  tint: string;
}[] = [
  {
    title: 'Upload a PDF and place the fields',
    text: 'Add who signs, approves or only gets a copy, drag signature and date boxes onto the page and send. The draft saves as you go.',
    points: [
      'In order, or everyone at once',
      'Reminders and an expiry date',
      'Fields on one page, every page or a few',
    ],
    clip: CLIPS.send,
    tint: 'bg-[#EEF4FF]',
  },
  {
    title: 'People sign on any phone',
    text: 'The signer opens the link from their email, types the one-time code we send and signs with a finger. No account and no app.',
    points: [
      'A one-time code before the document opens',
      'Draw, type or upload a signature',
      'Your logo and colour on the page',
    ],
    clip: CLIPS.sign,
    phone: true,
    tint: 'bg-[#E8FAF6]',
  },
  {
    title: 'Get a sealed PDF anyone can check',
    text: 'When the last person signs, the PDF gets a PAdES seal and a one-page certificate: who signed, how and when, and a QR code that opens the record.',
    points: [
      'Everyone gets the signed copy by email',
      'Times in UTC and your workspace zone',
      'Checked by anyone on the verify page',
    ],
    clip: CLIPS.sealed,
    tint: 'bg-[#F4EEFC]',
  },
];

const FEATURES: { icon: typeof Check; tone: Tile; title: string; text: string }[] = [
  {
    icon: FileStack,
    tone: 'blue',
    title: 'Templates',
    text: 'Keep the documents you send often with their roles and fields in place.',
  },
  {
    icon: Users,
    tone: 'teal',
    title: 'Bulk send',
    text: 'Send one template to a whole list from a CSV file. Every row is checked first.',
  },
  {
    icon: BellRing,
    tone: 'orange',
    title: 'Reminders',
    text: 'Reminders go out on their own until the document is signed or expires.',
  },
  {
    icon: ListOrdered,
    tone: 'violet',
    title: 'Signing order',
    text: 'Signers, approvers and people who only get a copy, in order or all at once.',
  },
  {
    icon: Palette,
    tone: 'pink',
    title: 'Your brand',
    text: 'Logo, colour and font on the signing page, and your own words in every email.',
  },
  {
    icon: LayoutGrid,
    tone: 'green',
    title: 'Workspaces',
    text: 'One for each team or client, each with its own members, brand and time zone.',
  },
  {
    icon: UserCog,
    tone: 'blue',
    title: 'Roles and Billing admin',
    text: 'Admins and members, plus a Billing admin who pays and buys credits without running the team.',
  },
  {
    icon: ArrowLeftRight,
    tone: 'teal',
    title: 'Workspace transfer',
    text: 'Hand a workspace to another account with its documents, templates and members.',
  },
];

const PROOF: { icon: typeof Check; tone: Tile; title: string; text: string }[] = [
  {
    icon: ShieldCheck,
    tone: 'blue',
    title: 'A PAdES seal on every PDF',
    text: 'Any later change to the file, down to one byte, breaks the seal in every PDF reader.',
  },
  {
    icon: Hash,
    tone: 'teal',
    title: 'An audit trail nobody can quietly edit',
    text: 'Each step carries a SHA-256 hash of the step before it, with its time and IP address.',
  },
  {
    icon: QrCode,
    tone: 'violet',
    title: 'A certificate page with a QR code',
    text: 'Who signed, how and when, and a code that opens the public record.',
  },
];

const DEVELOPER_POINTS: { icon: typeof Check; tone: Tile; title: string; text: string }[] = [
  {
    icon: CodeXml,
    tone: 'blue',
    title: 'HTTP API',
    text: 'Everything in the app, with OpenAPI 3.1, a Postman collection and idempotency keys.',
  },
  {
    icon: Blocks,
    tone: 'violet',
    title: 'SDKs',
    text: 'A typed client for Node, browsers and edge, and a React signing view for your own app.',
  },
  {
    icon: Webhook,
    tone: 'orange',
    title: 'Webhooks',
    text: 'Signed with HMAC-SHA256, retried until your endpoint answers.',
  },
  {
    icon: Server,
    tone: 'teal',
    title: 'Self-host',
    text: 'The same app on your server with Docker. Free, unlimited, and your documents stay there.',
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

const faq = (pricing: PricingView): { q: string; a: ReactNode }[] => [
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
      <>
        <p>
          Yes. When you send a document you can ask a signer to sign with Aadhaar eSign: they
          confirm with a one-time code from Aadhaar on Leegality&rsquo;s page, and the signed file
          carries their Aadhaar-based digital signature as well as our seal. You pay for each
          completed eSign with prepaid credits: {pricing.esignFree} on the Free plan and{' '}
          {pricing.esignCloud} on Cloud, plus GST. An eSign that is not completed costs nothing, and
          credits do not expire.
        </p>
        <p className="mt-3">
          On Cloud you can also connect your own Leegality account, once for all your workspaces,
          and be billed by Leegality directly. Self-hosted installs use their own account.
        </p>
      </>
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
        further, upgrade to Cloud from Settings, Plan and usage in your workspace: it takes effect
        as soon as the payment is confirmed. The Free plan includes one workspace, and its limits on
        members, templates and API requests are counted across your account.
      </p>
    ),
  },
  {
    q: 'How does paying for Cloud work?',
    a: (
      <p>
        Cloud is {pricing.cloudMonth} a month for your account, with as many workspaces as you need
        and {pricing.includedMembers} members across them, or {pricing.cloudYear} for a year, plus{' '}
        {pricing.gstPercent}% GST. You pay for each term up front by card, UPI or net banking and
        get a GST tax invoice by email. There is no automatic charge: we remind you before a term
        ends, and if it is not renewed your workspaces have {pricing.graceDays} more days on Cloud
        and then move back to the Free plan with all their documents. You can cancel at any time and
        keep Cloud until the end of the term you paid for.
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

/** A section's eyebrow pill, centred heading and one-line lead. */
function SectionHead({
  id,
  eyebrow,
  title,
  lead,
  tone = 'blue',
}: {
  id: string;
  eyebrow: string;
  title: ReactNode;
  lead?: ReactNode;
  tone?: Tile;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center" {...reveal()}>
      <p
        className={cn('inline-flex rounded-full px-3 py-1 text-[13px] font-semibold', TILES[tone])}
      >
        {eyebrow}
      </p>
      <h2
        id={id}
        className="mt-4 text-[clamp(1.9rem,1.3rem+1.9vw,2.75rem)] leading-[1.1] font-bold"
      >
        {title}
      </h2>
      {lead ? <p className="mt-4 text-lg text-muted">{lead}</p> : null}
    </div>
  );
}

/** A short line that floats over the hero screen, the way a notification would. */
function Toast({
  icon: Icon,
  tone,
  title,
  text,
  className,
}: {
  icon: typeof Check;
  tone: Tile;
  title: string;
  text: string;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'enter absolute z-10 hidden items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-[0_18px_40px_-16px_rgb(13_27_42/0.45)] ring-1 ring-line md:flex',
        className,
      )}
    >
      <span className={cn('flex h-9 w-9 items-center justify-center rounded-full', TILES[tone])}>
        <Icon className="h-4.5 w-4.5" />
      </span>
      <span className="text-sm leading-5">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-xs text-muted">{text}</span>
      </span>
    </div>
  );
}

function AuditCard() {
  return (
    <figure className="min-w-0">
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_24px_56px_-28px_rgb(13_27_42/0.35)] ring-1 ring-line">
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <p className="truncate text-sm font-semibold">Design services agreement</p>
          <p className="flex shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success">
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
              <div className="relative min-w-0 py-3 pl-5">
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
                  className="absolute top-[1.05rem] -left-[4px] h-[9px] w-[9px] rounded-full bg-primary ring-2 ring-white"
                />
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{entry.title}</span>
                  <code className="font-mono text-[11px] text-muted">{entry.action}</code>
                </p>
                <p className="mt-0.5 text-sm text-muted">{entry.detail}</p>
                <p className="mt-1 truncate font-mono text-[11px] leading-4 text-muted">
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
      </div>
      <figcaption className="mt-3 text-sm text-muted">
        An example trail with made-up people. The hashes are real SHA-256 hashes of it.
      </figcaption>
    </figure>
  );
}

/** The public home page of the hosted cloud. A signed-in visitor gets their dashboard instead of "Start free". */
export function Landing({
  features,
  pricing,
  viewer = null,
}: {
  /** The plan comparison, from `planFeatures`. */
  features: PlanFeature[];
  /** Every price on the page, as text made on the server. */
  pricing: PricingView;
  viewer?: SiteViewer | null;
}) {
  const rows = pricedFeatures(features, pricing);
  const start = viewer
    ? { href: APP_HOME, label: 'Go to dashboard' }
    : { href: '/sign-in', label: 'Start free' };
  return (
    <div className="marketing flex min-h-dvh flex-col bg-white text-ink">
      <SmoothAnchors />
      <RevealOnScroll />
      <SiteHeader viewer={viewer} samePage />
      <main id="main" className="flex-1">
        <section
          aria-labelledby="hero-title"
          className="relative overflow-hidden bg-[radial-gradient(60rem_32rem_at_15%_-10%,#DCE9FF_0%,transparent_60%),radial-gradient(50rem_30rem_at_90%_10%,#D5F6F0_0%,transparent_60%),linear-gradient(#F7FAFF,#FFFFFF_70%)] px-4 pt-12 pb-16 sm:px-6 sm:pt-16 lg:px-8"
        >
          <div className="mx-auto max-w-4xl text-center">
            <ul
              aria-label="What it does"
              className="enter flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-medium text-ink"
            >
              {[
                ['PDF e-signatures', 'bg-primary'],
                ['Aadhaar eSign', 'bg-[#E07A1F]'],
                ['API and webhooks', 'bg-[#8A3FC2]'],
                ['Self-host', 'bg-[#12A08A]'],
              ].map(([label, dot]) => (
                <li key={label} className="flex items-center gap-2">
                  <span aria-hidden className={cn('h-2 w-2 rounded-full', dot)} />
                  {label}
                </li>
              ))}
            </ul>
            <h1
              id="hero-title"
              className="enter mt-6 text-[clamp(2.4rem,1.3rem+3.6vw,4.1rem)] leading-[1.04] font-bold [--enter-order:1]"
            >
              Get documents signed. <span className="block text-primary">Keep the proof.</span>
            </h1>
            <p className="enter mx-auto mt-5 max-w-2xl text-lg text-muted sm:text-xl sm:leading-8 [--enter-order:2]">
              Send a PDF, people sign on any phone, and you get back a sealed PDF with a certificate
              anyone can check. Add Aadhaar eSign when a law asks for it.
            </p>
            <div className="enter mt-8 flex flex-col justify-center gap-3 sm:flex-row [--enter-order:3]">
              <Button pill asChild className="h-12 px-7 text-base">
                <Link href={start.href}>
                  {start.label} <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              </Button>
              <Button pill asChild variant="secondary" className="h-12 px-7 text-base">
                <ExternalLink href={GITHUB_URL} bare>
                  <Server aria-hidden className="h-4 w-4" />
                  Self-host
                </ExternalLink>
              </Button>
            </div>
            <ul className="enter mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted [--enter-order:4]">
              {['Free plan, no card needed', 'Prices in ₹ with a GST invoice', 'Open source'].map(
                (line) => (
                  <li key={line} className="flex items-center gap-1.5">
                    <Check aria-hidden className="h-4 w-4 text-success" />
                    {line}
                  </li>
                ),
              )}
            </ul>
          </div>

          <figure className="enter relative mx-auto mt-14 max-w-6xl [--enter-order:5]">
            <Toast
              icon={Check}
              tone="green"
              title="Rohan Mehta signed"
              text="10:42 IST · on a phone"
              className="bottom-40 -left-6 lg:-left-12"
            />
            <Toast
              icon={ShieldCheck}
              tone="blue"
              title="Seal intact"
              text="PAdES · SHA-256 f6d3…5b1c"
              className="-right-6 bottom-16 lg:-right-12"
            />
            <BrowserFrame address="sign.codevibe.in">
              <Clip clip={CLIPS.hero} describedBy="hero-clip-text" eager />
            </BrowserFrame>
            <figcaption id="hero-clip-text" className="mt-4 text-center text-sm text-muted">
              The real app, with made-up people: fields placed on a PDF, the sealed copy and the
              public seal check.
            </figcaption>
          </figure>
        </section>

        <section
          aria-label="Why teams trust it"
          className="border-y border-line bg-white px-4 sm:px-6 lg:px-8"
        >
          <ul className="mx-auto grid max-w-7xl grid-cols-1 gap-x-6 gap-y-5 py-8 sm:grid-cols-2 lg:grid-cols-5">
            {TRUST.map((item) => (
              <li key={item.title} className="flex items-center gap-3">
                <IconTile icon={item.icon} tone={item.tone} />
                <span>
                  <span className="block font-display font-semibold">{item.title}</span>
                  <span className="block text-sm text-muted">{item.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="how-it-works"
          aria-labelledby="how-title"
          className="scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28 lg:px-8"
        >
          <SectionHead
            id="how-title"
            eyebrow="How it works"
            title="From PDF to sealed copy in three steps"
            lead="Each clip is the real app, recorded with made-up people and companies."
          />
          <ol className="mx-auto mt-16 max-w-6xl space-y-20 sm:space-y-24">
            {STEPS.map((step, i) => (
              <li
                key={step.title}
                className="grid grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16"
              >
                <div className={cn(i % 2 === 1 && 'lg:order-2')} {...reveal()}>
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-display text-lg font-bold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-5 text-2xl font-bold sm:text-3xl">{step.title}</h3>
                  <p id={`step-${i + 1}-text`} className="mt-3 text-lg text-muted">
                    {step.text}
                  </p>
                  <ul className="mt-6 space-y-2.5">
                    {step.points.map((point) => (
                      <li key={point} className="flex gap-2.5">
                        <Check aria-hidden className="mt-1 h-4 w-4 shrink-0 text-success" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
                <div
                  className={cn(
                    'min-w-0 rounded-3xl p-4 sm:p-8',
                    step.tint,
                    i % 2 === 1 && 'lg:order-1',
                  )}
                  {...reveal(1)}
                >
                  {step.phone ? (
                    <div className="mx-auto w-[min(15rem,62%)] overflow-hidden rounded-[2rem] bg-white p-2 shadow-[0_24px_48px_-24px_rgb(13_27_42/0.45)] ring-1 ring-line">
                      <Clip
                        clip={step.clip}
                        describedBy={`step-${i + 1}-text`}
                        className="overflow-hidden rounded-[1.5rem]"
                      />
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-xl bg-white shadow-[0_24px_48px_-24px_rgb(13_27_42/0.45)] ring-1 ring-line">
                      <Clip clip={step.clip} describedBy={`step-${i + 1}-text`} />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <AadhaarSection pricing={pricing} />

        <section
          id="features"
          aria-labelledby="features-title"
          className="scroll-mt-20 bg-[#F6F8FC] px-4 py-20 sm:px-6 sm:py-28 lg:px-8"
        >
          <SectionHead
            id="features-title"
            eyebrow="For teams"
            tone="violet"
            title="Everything a team needs to send at scale"
            lead="The parts you notice on the second day, when real people start signing."
          />
          <ul className="mx-auto mt-14 grid max-w-7xl grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((item, i) => (
              <li
                key={item.title}
                className="rounded-2xl bg-white p-6 ring-1 ring-line transition-shadow duration-200 hover:shadow-[0_18px_40px_-24px_rgb(13_27_42/0.35)]"
                {...reveal(i % 4)}
              >
                <IconTile icon={item.icon} tone={item.tone} />
                <h3 className="mt-5 text-lg font-bold">{item.title}</h3>
                <p className="mt-1.5 text-muted">{item.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section
          id="proof"
          aria-labelledby="proof-title"
          className="scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28 lg:px-8"
        >
          <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
            <div {...reveal()}>
              <p
                className={cn(
                  'inline-flex rounded-full px-3 py-1 text-[13px] font-semibold',
                  TILES.teal,
                )}
              >
                Proof built in
              </p>
              <h2
                id="proof-title"
                className="mt-4 text-[clamp(1.9rem,1.3rem+1.9vw,2.75rem)] leading-[1.1] font-bold"
              >
                Every signature comes with its evidence
              </h2>
              <p className="mt-4 text-lg text-muted">
                The signer sees the document only after typing a one-time code from their email.
                Every step after that goes on a record you can show anyone.
              </p>
              <ul className="mt-8 space-y-6">
                {PROOF.map((item) => (
                  <li key={item.title} className="flex gap-4">
                    <IconTile icon={item.icon} tone={item.tone} />
                    <span>
                      <span className="block font-display text-lg font-semibold">{item.title}</span>
                      <span className="mt-0.5 block text-muted">{item.text}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <Button pill asChild variant="secondary" className="h-11 px-5">
                  <Link href={VERIFY_URL}>Check a signed PDF</Link>
                </Button>
                <a
                  href={EVIDENCE_GUIDE}
                  className="inline-flex h-11 items-center gap-1.5 px-2 text-sm font-semibold text-primary hover:underline"
                >
                  How the certificate serves as evidence
                  <ArrowRight aria-hidden className="h-4 w-4" />
                </a>
              </div>
            </div>
            <div className="min-w-0" {...reveal(1)}>
              <AuditCard />
            </div>
          </div>
        </section>

        <section
          id="developers"
          aria-labelledby="developers-title"
          className="scroll-mt-20 bg-[linear-gradient(180deg,#F2F6FF,#EEFBF8)] px-4 py-20 sm:px-6 sm:py-28 lg:px-8"
        >
          <SectionHead
            id="developers-title"
            eyebrow="For developers"
            tone="orange"
            title="An API for everything in the app"
            lead="Make an API key for each system, send envelopes from your backend, and get a signed webhook when something happens."
          />
          <div className="mx-auto mt-14 grid max-w-7xl grid-cols-1 gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
            <div
              className="min-w-0 overflow-hidden rounded-2xl bg-[#0D1B2A] shadow-[0_24px_56px_-28px_rgb(13_27_42/0.6)]"
              {...reveal()}
            >
              <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2.5">
                <span aria-hidden className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
                </span>
                <span className="font-mono text-xs text-white/75">send-agreement.ts</span>
              </div>
              <pre
                tabIndex={0}
                aria-label="Sending an envelope with the TypeScript client"
                className="overflow-x-auto p-5 font-mono text-[13px] leading-6 text-white/90"
              >
                <code>{API_SNIPPET}</code>
              </pre>
            </div>
            <div className="grid content-start gap-4" {...reveal(1)}>
              {DEVELOPER_POINTS.map((item) => (
                <div
                  key={item.title}
                  className="flex gap-4 rounded-2xl bg-white p-5 ring-1 ring-line"
                >
                  <IconTile icon={item.icon} tone={item.tone} />
                  <span>
                    <span className="block font-display font-semibold">{item.title}</span>
                    <span className="mt-0.5 block text-sm text-muted">{item.text}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div
            id="open-source"
            className="mx-auto mt-8 grid max-w-7xl scroll-mt-20 grid-cols-1 items-center gap-6 rounded-2xl bg-white p-6 ring-1 ring-line sm:p-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]"
            {...reveal()}
          >
            <div>
              <h3 className="text-xl font-bold">Open source. Run it yourself.</h3>
              <p className="mt-2 text-muted">
                The cloud runs the same code you can download, nothing held back. Libraries under
                Apache-2.0; the server and app under AGPL-3.0.
              </p>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
                <a className="text-primary hover:underline" href={API_DOCS}>
                  Read the API docs
                </a>
                <a className="text-primary hover:underline" href={WEBHOOKS_GUIDE}>
                  Verify webhooks
                </a>
                <a className="text-primary hover:underline" href={SELF_HOST_DOCS}>
                  Self-hosting guide
                </a>
                <ExternalLink className="text-primary hover:underline" href={GITHUB_URL}>
                  View on GitHub
                </ExternalLink>
              </div>
            </div>
            <pre
              tabIndex={0}
              aria-label="Commands to self-host with Docker"
              className="overflow-x-auto rounded-xl bg-[#0D1B2A] p-5 font-mono text-[13px] leading-6 text-white/90"
            >
              <code>{`git clone ${GITHUB_URL}.git
cd codevibe-sign/deploy
cp .env.example .env    # your domain and secrets
docker compose up -d`}</code>
            </pre>
          </div>
        </section>

        <section
          id="pricing"
          aria-labelledby="pricing-title"
          className="scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28 lg:px-8"
        >
          <SectionHead
            id="pricing-title"
            eyebrow="Pricing"
            tone="green"
            title="Simple pricing, in rupees"
            lead="Every plan seals the same way and keeps the same audit trail. The limits are the only difference."
          />
          <div className="mx-auto mt-14 max-w-6xl" {...reveal(1)}>
            <PricingPlans rows={rows} pricing={pricing} start={start} signedIn={viewer !== null} />
            <p className="mt-6 text-center text-sm text-muted">
              Prices are in Indian rupees and do not include {pricing.gstPercent}% GST. Every
              payment gets a GST tax invoice. Aadhaar eSign is paid per completed eSign with prepaid
              credits.
            </p>
          </div>
        </section>

        <section
          id="faq"
          aria-labelledby="faq-title"
          className="scroll-mt-20 bg-[#F6F8FC] px-4 py-20 sm:px-6 sm:py-28 lg:px-8"
        >
          <SectionHead
            id="faq-title"
            eyebrow="FAQ"
            title="Questions people ask"
            lead={
              <>
                Something else on your mind? Write to{' '}
                <a
                  className="font-semibold text-primary hover:underline"
                  href={`mailto:${CONTACT_EMAIL}`}
                >
                  {CONTACT_EMAIL}
                </a>
                .
              </>
            }
          />
          <div className="mx-auto mt-12 max-w-3xl space-y-3" {...reveal(1)}>
            {faq(pricing).map((item) => (
              <details
                key={item.q}
                className="group rounded-2xl bg-white px-6 ring-1 ring-line open:shadow-[0_12px_32px_-20px_rgb(13_27_42/0.35)] [&_a]:font-semibold [&_a]:text-primary"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 py-5 font-display text-lg font-semibold [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary transition-transform duration-200 group-open:rotate-45"
                  >
                    <Plus className="h-4 w-4" />
                  </span>
                </summary>
                <div className="max-w-[65ch] pb-6 text-muted">{item.a}</div>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="start-title" className="px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <div
            className="mx-auto max-w-6xl overflow-hidden rounded-[2rem] bg-[radial-gradient(40rem_20rem_at_10%_0%,#DCE9FF,transparent_70%),radial-gradient(40rem_20rem_at_95%_100%,#CDF4EC,transparent_70%),#F4F8FF] px-6 py-14 text-center ring-1 ring-[#D6E2F5] sm:px-12 sm:py-20"
            {...reveal()}
          >
            <h2
              id="start-title"
              className="mx-auto max-w-2xl text-[clamp(2rem,1.4rem+2.2vw,3.2rem)] leading-[1.08] font-bold"
            >
              Send your first document today
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-muted">
              A Free plan workspace takes a minute to set up. Or run the same app on your own
              server, free and unlimited.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button pill asChild className="h-12 px-7 text-base">
                <Link href={start.href}>
                  {start.label} <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              </Button>
              <Button pill asChild variant="secondary" className="h-12 px-7 text-base">
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
