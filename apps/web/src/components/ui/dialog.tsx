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
