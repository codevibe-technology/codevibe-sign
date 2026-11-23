import { Check, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Wordmark } from './brand-mark';

/** A centred page for errors, not-found and messages outside a workspace. */
export function StatusPage({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <AuthFrame>
      <div className="text-center">
        <span className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-md bg-nav text-accent">
          <Icon aria-hidden strokeWidth={1.8} className="h-6 w-6" />
        </span>
        <h1 className="text-[22px] font-bold">{title}</h1>
        <div className="mt-2 text-muted">{description}</div>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </AuthFrame>
  );
}

const POINTS = [
  'Upload a PDF, place the boxes, send',
  'Signers need no account, on any device',
  'Every copy sealed with an audit trail',
];

/** Brand panel beside a centred card; for sign-in, onboarding and messages. */
export function AuthFrame({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="relative overflow-hidden bg-nav text-white lg:flex lg:w-[44%] lg:max-w-[620px] lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 hidden opacity-[0.07] lg:block"
          style={{
            backgroundImage:
              'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="relative px-4 py-4 lg:p-0">
          <Wordmark surface="dark" />
        </div>
        <div className="relative hidden lg:block">
          <p className="mb-4 flex items-center gap-2 font-mono text-[11px] tracking-[0.12em] text-accent uppercase">
            <span aria-hidden className="h-[2px] w-6 bg-accent" />
            E-signatures by Codevibe
          </p>
          <p className="max-w-md font-display text-[40px] leading-[1.08] font-bold tracking-tight">
            Send it, sign it, <span className="text-accent">seal it.</span>
          </p>
          <ul className="mt-8 space-y-3 text-[15px] text-nav-ink/85">
            {POINTS.map((point) => (
              <li key={point} className="flex items-center gap-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[3px] bg-accent/15 text-accent">
                  <Check aria-hidden className="h-3.5 w-3.5" strokeWidth={2.5} />
                </span>
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative hidden font-mono text-[11px] tracking-[0.1em] text-nav-muted uppercase lg:block">
          sign.codevibe.in
        </p>
      </aside>
      <main
        id="main"
        className="flex flex-1 items-start justify-center px-4 py-8 sm:py-12 lg:items-center lg:px-10"
      >
        <div
          className={`page-enter w-full rounded-xl border border-line border-t-[3px] border-t-accent bg-surface p-6 shadow-card sm:p-8 ${wide ? 'max-w-xl' : 'max-w-md'}`}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
