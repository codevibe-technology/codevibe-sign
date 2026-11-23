import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import type { PageSize } from '../geometry';
import type { DocumentState } from '../pdf/usePdfSources';
import type { ViewerDocument } from '../pdf/types';
import { PageImage } from './PageImage';

export interface ViewerLabels {
  page: (page: number, total: number) => string;
  loadingDocument: string;
  loadingPage: string;
  documentError: string;
  pageError: string;
  zoomIn: string;
  zoomOut: string;
  fitWidth: string;
  zoomLevel: (percent: number) => string;
}

export const defaultViewerLabels: ViewerLabels = {
  page: (page, total) => `Page ${page} of ${total}`,
  loadingDocument: 'Loading document…',
  loadingPage: 'Loading page…',
  documentError: 'This document could not be opened.',
  pageError: 'This page could not be shown.',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fitWidth: 'Fit to width',
  zoomLevel: (percent) => `Zoom ${percent}%`,
};

export interface PageContext {
  documentId: string;
  pageIndex: number;
  page: PageSize;
  /** CSS pixels per PDF point. */
  scale: number;
}

const FALLBACK_WIDTH = 800;

/**
 * Tracks the width an element has for its content, its padding left out, so a page fitted to
 * it does not spill past the padding and bring a sideways scrollbar with it. Falls back when
 * layout is unavailable.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(FALLBACK_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth <= 0) return;
      const style = getComputedStyle(el);
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      setWidth(Math.max(1, el.clientWidth - padding));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom * 100) / 100));
}

/** One scale for every page so pages keep their relative sizes; the widest page fits the width. */
export function viewerScale(
  pages: PageSize[],
  containerWidth: number,
  zoom: number,
  maxPageWidth: number,
): number {
  const widest = Math.max(1, ...pages.map((p) => p.width));
  return (Math.min(containerWidth, maxPageWidth) / widest) * zoom;
}

interface DocumentPagesProps {
  documents: ViewerDocument[];
  states: Record<string, DocumentState>;
  containerWidth: number;
  zoom: number;
  maxPageWidth?: number;
  labels: ViewerLabels;
  renderOverlay: (ctx: PageContext) => ReactNode;
}

export function DocumentPages({
  documents,
  states,
  containerWidth,
  zoom,
  maxPageWidth = 960,
  labels,
  renderOverlay,
}: DocumentPagesProps) {
  const allPages = documents.flatMap((d) => states[d.id]?.source?.pages ?? []);
  const scale = viewerScale(allPages, containerWidth, zoom, maxPageWidth);

  return (
    <>
      {documents.map((doc) => {
        const state = states[doc.id];
        const source = state?.source;
        return (
          <section
            key={doc.id}
            className="cvs-document"
            aria-label={doc.name}
            data-cvs-document={doc.id}
          >
            {doc.name && documents.length > 1 && <h2 className="cvs-document-name">{doc.name}</h2>}
            {!source && (
              <p className="cvs-document-status" role={state?.error ? 'alert' : 'status'}>
                {state?.error ? labels.documentError : labels.loadingDocument}
              </p>
            )}
            {source?.pages.map((page, pageIndex) => (
              <div
                key={pageIndex}
                className="cvs-page"
                role="group"
                aria-label={labels.page(pageIndex + 1, source.pages.length)}
                data-cvs-page={pageIndex}
                data-cvs-document={doc.id}
                style={{ width: page.width * scale, height: page.height * scale }}
              >
                <PageImage
                  source={source}
                  pageIndex={pageIndex}
                  scale={scale}
                  loadingLabel={labels.loadingPage}
                  errorLabel={labels.pageError}
                />
                <div className="cvs-page-overlay">
                  {renderOverlay({ documentId: doc.id, pageIndex, page, scale })}
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </>
  );
}

interface ZoomControlsProps {
  zoom: number;
  onZoom: (zoom: number) => void;
  labels: ViewerLabels;
}

export function ZoomControls({ zoom, onZoom, labels }: ZoomControlsProps) {
  return (
    <div className="cvs-zoom" role="group" aria-label={labels.zoomLevel(Math.round(zoom * 100))}>
      <button
        type="button"
        className="cvs-button cvs-button--icon"
        onClick={() => onZoom(clampZoom(zoom - 0.25))}
        disabled={zoom <= MIN_ZOOM}
        aria-label={labels.zoomOut}
        title={labels.zoomOut}
      >
        <span aria-hidden="true">−</span>
      </button>
      <button
        type="button"
        className="cvs-button cvs-button--ghost cvs-zoom-level"
        onClick={() => onZoom(1)}
        aria-label={labels.fitWidth}
        title={labels.fitWidth}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        className="cvs-button cvs-button--icon"
        onClick={() => onZoom(clampZoom(zoom + 0.25))}
        disabled={zoom >= MAX_ZOOM}
        aria-label={labels.zoomIn}
        title={labels.zoomIn}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
