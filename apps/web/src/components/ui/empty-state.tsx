import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
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
    <div className="flex flex-col items-center rounded-xl border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
      <span className="relative mb-5 flex h-12 w-12 items-center justify-center rounded-md bg-nav text-accent">
        <Icon aria-hidden strokeWidth={1.8} className="h-6 w-6" />
        <span
          aria-hidden
          className="absolute -bottom-2 left-1/2 h-[3px] w-6 -translate-x-1/2 bg-accent"
        />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
