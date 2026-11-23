import { ArrowRight, BadgeCheck, Check, Fingerprint, Smartphone } from 'lucide-react';
import type { PricingView } from '@/server/billing/pricing';
import { AADHAAR_GUIDE } from './links';
import { reveal } from './reveal';

const STEPS = [
  {
    title: 'Pick Aadhaar eSign for a signer',
    text: 'In the send flow, under Identity check. You see the price and your credits before you send.',
  },
  {
    title: 'They confirm with an Aadhaar OTP',
    text: 'On Leegality’s page, with a code sent to the mobile number linked to their Aadhaar.',
  },
  {
    title: 'Two signatures in one PDF',
    text: 'Their Aadhaar signature, kept byte for byte, and our seal over the whole file.',
  },
];

const POINTS = [
  'Pay only for an eSign that is completed',
  'Prepaid credits that never expire',
  'On Cloud, connect your own Leegality account instead',
  'We never see or store the Aadhaar number',
];

/** `₹35 per eSign` as the amount and its unit, or null while the price is not published. */
function splitPrice(text: string): { amount: string; unit: string } | null {
  const match = /^(.+?) (per eSign)$/.exec(text);
  return match ? { amount: match[1]!, unit: match[2]! } : null;
}

function PriceTile({ plan, price }: { plan: string; price: string }) {
  const parts = splitPrice(price);
  return (
    <div className="rounded-xl bg-white/12 px-3.5 py-2.5 ring-1 ring-white/25">
      <dt className="text-[13px] text-white/85">{plan}</dt>
      {parts ? (
        <dd>
          <span className="font-display text-2xl leading-8 font-bold tracking-tight">
            {parts.amount}
          </span>
          <span className="block text-xs text-white/85">{parts.unit} + GST</span>
        </dd>
      ) : (
        <dd className="mt-0.5 font-display text-lg font-bold">{price}</dd>
      )}
    </div>
  );
}

/** What a signer sees, drawn rather than recorded: Leegality's page is not ours to film. */
function SignerCard() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-[22rem] lg:max-w-[19rem]">
      <div className="rounded-[1.75rem] bg-white p-5 text-ink lg:rounded-3xl lg:p-4 shadow-[0_40px_80px_-30px_rgb(5_20_50/0.7)] ring-1 ring-white/40">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FFF1E0] text-[#B45309]">
              <Fingerprint className="h-4.5 w-4.5" />
            </span>
            Aadhaar eSign
          </span>
          <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-muted">
            via Leegality
          </span>
        </div>
        <div className="mt-5 rounded-xl bg-[#F5F8FF] p-4 lg:mt-4 lg:p-3">
          <p className="text-xs text-muted">Document</p>
          <p className="mt-0.5 font-semibold">Offer letter, Priya Nair</p>
          <p className="text-xs text-muted">Kestrel Design Studio · 2 pages</p>
        </div>
        <p className="mt-5 text-sm font-medium lg:mt-4">
          Enter the OTP sent to your Aadhaar-linked mobile
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
          <Smartphone className="h-3.5 w-3.5" />
          +91 ••••• ••821
        </p>
        <div className="mt-3 grid grid-cols-6 gap-2 lg:gap-1.5">
          {['4', '8', '1', '9', '2', ''].map((digit, i) => (
            <span
              key={i}
              className={
                digit
                  ? 'flex h-11 items-center justify-center rounded-lg bg-white font-mono lg:h-10 text-lg font-semibold ring-1 ring-line-strong'
                  : 'flex h-11 items-center justify-center rounded-lg bg-white ring-2 lg:h-10 ring-primary'
              }
            >
              {digit}
            </span>
          ))}
        </div>
        <span className="mt-5 flex h-11 items-center justify-center rounded-full bg-primary lg:mt-4 lg:h-10 text-sm font-semibold text-white">
          Sign with Aadhaar
        </span>
      </div>
      <div className="absolute -bottom-6 -left-4 flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-ink lg:-bottom-9 lg:py-2.5 shadow-[0_16px_32px_-12px_rgb(5_20_50/0.5)] ring-1 ring-line sm:-left-10">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-success-soft text-success">
          <BadgeCheck className="h-4.5 w-4.5" />
        </span>
        <span className="text-sm">
          <span className="block font-semibold">Signed with Aadhaar</span>
          <span className="block text-xs text-muted">Priya Nair · seal intact</span>
        </span>
      </div>
    </div>
  );
}

/** The Aadhaar eSign band of the home page: what it is, how a signer uses it and what it costs. */
export function AadhaarSection({ pricing }: { pricing: PricingView }) {
  return (
    <section
      id="aadhaar"
      aria-labelledby="aadhaar-title"
      className="scroll-mt-20 px-4 py-12 sm:px-6 sm:py-14 lg:scroll-mt-16 lg:px-8 lg:py-4"
    >
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] bg-[linear-gradient(125deg,#0B47A8_0%,#1B6AE0_55%,#0F7C8E_100%)] text-white">
        <div className="grid gap-10 px-6 py-10 sm:px-10 sm:py-12 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:gap-10 lg:px-12 lg:py-8">
          <div {...reveal()}>
            <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-sm font-semibold ring-1 ring-white/25">
              <Fingerprint aria-hidden className="h-4 w-4" />
              Aadhaar eSign, with Leegality
            </p>
            <h2
              id="aadhaar-title"
              className="mt-3 max-w-[22ch] text-[clamp(1.75rem,1.2rem+1.2vw,2.25rem)] leading-[1.1] font-bold text-balance"
            >
              Legally valid Aadhaar <span className="whitespace-nowrap">e-signatures,</span> built
              in
            </h2>
            <p className="mt-3 max-w-[60ch] text-white/90 sm:text-lg lg:text-base">
              When a law asks for an electronic signature under the IT Act, send the document for
              Aadhaar eSign. The signer confirms with a one-time code, no paper and no dongle, and
              you get back one PDF that carries it all.
            </p>
            <ol className="mt-5 grid gap-3 sm:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title} className="rounded-xl bg-white/10 p-3 ring-1 ring-white/20">
                  <p className="flex items-start gap-2 text-[15px] leading-5 font-semibold">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white font-display text-xs font-bold text-[#0B47A8]">
                      {i + 1}
                    </span>
                    {step.title}
                  </p>
                  <p className="mt-1.5 text-[13px] leading-[1.15rem] text-white/85">{step.text}</p>
                </li>
              ))}
            </ol>
            <div className="mt-5 grid items-end gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <p className="text-sm font-semibold text-white/90">Price of one eSign</p>
                <dl className="mt-2 grid grid-cols-2 gap-3">
                  <PriceTile plan="Free plan" price={pricing.esignFree} />
                  <PriceTile plan="Cloud" price={pricing.esignCloud} />
                </dl>
              </div>
              <ul className="space-y-1.5 text-sm leading-5">
                {POINTS.map((point) => (
                  <li key={point} className="flex gap-2">
                    <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-[#7CF0DF]" />
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <a
              href={AADHAAR_GUIDE}
              className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#0B47A8] hover:bg-white/90"
            >
              How Aadhaar eSign works
              <ArrowRight aria-hidden className="h-4 w-4" />
            </a>
          </div>
          <div className="flex items-center pb-8 lg:pb-9" {...reveal(1)}>
            <SignerCard />
          </div>
        </div>
      </div>
    </section>
  );
}
