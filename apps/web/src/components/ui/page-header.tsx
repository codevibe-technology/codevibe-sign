import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  action,
  badge,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  /** Shown beside the title, for example a live-updates label. */
  badge?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-ink">{title}</h1>
          {badge}
        </div>
        {description ? <p className="mt-1 text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
