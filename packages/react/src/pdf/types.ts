import type { PageSize } from '../geometry';

/** A rendered page: anything that can be shown in the page frame. */
export type RenderedPage = HTMLCanvasElement | HTMLImageElement | ImageBitmap;

/**
 * Renders one page. `scale` is device pixels per PDF point (CSS scale times the
 * device pixel ratio). Implementations should stop work when `signal` aborts.
 */
export type RenderPage = (
  pageIndex: number,
  scale: number,
  signal: AbortSignal,
) => Promise<RenderedPage>;

/** A run of text on a page, in page points with a top-left origin, as the page is shown. */
export interface TextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Everything the viewers need about a document: page sizes for layout, and a renderer. */
export interface PdfSource {
  pages: PageSize[];
  renderPage: RenderPage;
  /** The page's text runs, when the renderer can read text; used to find field tags. */
  textItems?: (pageIndex: number) => Promise<TextItem[]>;
  destroy?: () => void;
}

/** PDF bytes or a URL the default renderer can load. */
export type PdfFile = ArrayBuffer | Uint8Array | string | URL;

/** A document shown by the viewers. Give `source` for custom rendering, or `file` to use pdf.js. */
export interface ViewerDocument {
  id: string;
  name?: string;
  source?: PdfSource;
  file?: PdfFile;
}
