'use client';

import { loadPdf } from '@codevibe_technology/sign-react';
import { FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { usePdfjs } from './use-pdfjs';

/**
 * The first page of a PDF as a small picture, drawn in the browser from the file's bytes.
 * Shows a document icon until it is ready, or when there are no bytes to draw from.
 */
export function DocumentThumb({
  bytes,
  width = 64,
  className,
}: {
  bytes: Uint8Array | null | undefined;
  width?: number;
  className?: string;
}) {
  const pdf = usePdfjs();
  const holder = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!pdf || !bytes) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const source = await loadPdf(bytes.slice(), pdf);
        const page = source.pages[0];
        if (!page || controller.signal.aborted) return;
        const dpr = window.devicePixelRatio || 1;
        const rendered = await source.renderPage(0, (width / page.width) * dpr, controller.signal);
        const el = holder.current;
        if (!el || controller.signal.aborted || !(rendered instanceof HTMLCanvasElement)) return;
        rendered.className = 'block h-auto w-full';
        rendered.setAttribute('aria-hidden', 'true');
        el.replaceChildren(rendered);
        setReady(true);
      } catch {
        setReady(false);
      }
    })();
    return () => controller.abort();
  }, [pdf, bytes, width]);

  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-white shadow-[0_1px_2px_rgb(13_27_42/0.08)]',
        className,
      )}
      style={{ width, minHeight: Math.round(width * 1.3) }}
    >
      <span ref={holder} className={cn('block w-full', !ready && 'hidden')} />
      {ready ? null : <FileText aria-hidden className="h-6 w-6 text-primary" />}
    </span>
  );
}
