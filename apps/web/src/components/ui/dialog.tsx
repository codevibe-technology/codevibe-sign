'use client';

import { X } from 'lucide-react';
import { Dialog as Primitive } from 'radix-ui';
import type { ReactNode } from 'react';

export const DialogRoot = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

export function DialogContent({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-[#0D1B2A]/50" />
      <Primitive.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-line border-t-[3px] border-t-accent bg-surface p-6 shadow-[0_24px_64px_rgb(13_27_42/0.28)] focus:outline-none">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <Primitive.Title className="font-display text-lg font-semibold">
              {title}
            </Primitive.Title>
            {description ? (
              <Primitive.Description className="mt-1 text-sm text-muted">
                {description}
              </Primitive.Description>
            ) : (
              <Primitive.Description className="sr-only">{title}</Primitive.Description>
            )}
          </div>
          <Primitive.Close
            className="rounded-md p-1 text-muted hover:bg-surface-2"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </Primitive.Close>
        </div>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}

/** A panel from the right edge, for a form too long for a dialog. Full width on a phone. */
export function SheetContent({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="fixed inset-0 z-40 bg-[#0D1B2A]/50" />
      <Primitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-[0_24px_64px_rgb(13_27_42/0.28)] focus:outline-none">
        <div className="flex items-start justify-between gap-4 border-b border-line border-t-[3px] border-t-accent px-5 py-4">
          <div>
            <Primitive.Title className="font-display text-lg font-semibold">
              {title}
            </Primitive.Title>
            {description ? (
              <Primitive.Description className="mt-1 text-sm text-muted">
                {description}
              </Primitive.Description>
            ) : (
              <Primitive.Description className="sr-only">{title}</Primitive.Description>
            )}
          </div>
          <Primitive.Close
            className="rounded-md p-1 text-muted hover:bg-surface-2"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden />
          </Primitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </Primitive.Content>
    </Primitive.Portal>
  );
}
