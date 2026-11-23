import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A light browser window around a screen of the app: three dots, the address and a "Sample data"
 * tag, so a visitor reads it as the real product with made-up people.
 */
export function BrowserFrame({
  address,
  children,
  className,
}: {
  address: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl bg-white shadow-[0_2px_4px_rgb(13_27_42/0.04),0_32px_64px_-24px_rgb(27_106_224/0.35)] ring-1 ring-[#D6E2F5]',
        className,
      )}
    >
      <div className="flex items-center gap-3 border-b border-line bg-[#F7F9FC] px-4 py-2.5">
        <span aria-hidden className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#F26B5B]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#F5BE4F]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#4CC38A]" />
        </span>
        <span className="mx-auto max-w-[60%] truncate rounded-md bg-white px-4 py-1 text-center text-xs text-muted ring-1 ring-line sm:min-w-64">
          {address}
        </span>
        <span className="hidden rounded-full bg-surface-2 px-2.5 py-0.5 text-[11px] font-medium text-muted sm:inline">
          Sample data
        </span>
      </div>
      {children}
    </div>
  );
}
