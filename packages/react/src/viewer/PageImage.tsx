import { useEffect, useRef, useState, type RefObject } from 'react';
import type { PdfSource, RenderedPage } from '../pdf/types';

interface PageImageProps {
  source: PdfSource;
  pageIndex: number;
  /** CSS pixels per point. */
  scale: number;
  loadingLabel: string;
  errorLabel: string;
}

function toElement(rendered: RenderedPage): HTMLCanvasElement | HTMLImageElement {
  if (rendered instanceof HTMLCanvasElement || rendered instanceof HTMLImageElement) {
    return rendered;
  }
  const canvas = document.createElement('canvas');
  canvas.width = rendered.width;
  canvas.height = rendered.height;
  canvas.getContext('2d')?.drawImage(rendered, 0, 0);
  return canvas;
}

function useVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (visible || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, visible]);
  return visible;
}

/** Renders one page bitmap once it is near the viewport, re-rendering when the scale changes. */
export function PageImage({ source, pageIndex, scale, loadingLabel, errorLabel }: PageImageProps) {
  const holder = useRef<HTMLDivElement>(null);
  const visible = useVisible(holder);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
    source.renderPage(pageIndex, scale * dpr, controller.signal).then(
      (rendered) => {
        const el = holder.current;
        if (controller.signal.aborted || !el) return;
        const node = toElement(rendered);
        node.className = 'cvs-page-bitmap';
        node.setAttribute('alt', '');
        node.setAttribute('aria-hidden', 'true');
        el.replaceChildren(node);
        setStatus('ready');
      },
      () => {
        if (!controller.signal.aborted) setStatus('error');
      },
    );
    return () => controller.abort();
  }, [source, pageIndex, scale, visible]);

  return (
    <div className="cvs-page-image" data-status={status}>
      <div ref={holder} className="cvs-page-bitmap-holder" />
      {status === 'loading' && <span className="cvs-page-status">{loadingLabel}</span>}
      {status === 'error' && <span className="cvs-page-status">{errorLabel}</span>}
    </div>
  );
}
