import type { LucideIcon } from 'lucide-react';
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
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
          <Icon aria-hidden className="h-6 w-6" />
        </span>
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="mt-2 text-muted">{description}</div>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </AuthFrame>
  );
}

/** Navy band with the wordmark over a centred card; for sign-in, onboarding and messages. */
export function AuthFrame({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="bg-header px-4 pt-6 pb-24 text-header-ink">
        <div className="mx-auto max-w-md">
          <Wordmark />
        </div>
      </div>
      <main id="main" className="-mt-16 flex-1 px-4 pb-12">
        <div
          className={`mx-auto rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8 ${wide ? 'max-w-xl' : 'max-w-md'}`}
        >
          {children}
        </div>
      </main>
    </div>
  );
}
