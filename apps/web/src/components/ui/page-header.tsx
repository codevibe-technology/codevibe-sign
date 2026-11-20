import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  action,
  badge,
  eyebrow,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Shown beside the title, for example a live-updates label. */
  badge?: ReactNode;
  /** A short mono label above the title that names the section. */
  eyebrow?: string;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-5">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="eyebrow mb-2 flex items-center gap-2">
            <span aria-hidden className="h-[2px] w-5 bg-accent" />
            {eyebrow}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[26px] leading-[1.15] font-bold text-ink md:text-[30px]">{title}</h1>
          {badge}
        </div>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[15px] text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  );
}
