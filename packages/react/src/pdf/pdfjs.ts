import type { PdfFile, PdfSource } from './types';

interface PdfjsViewport {
  width: number;
  height: number;
}

interface PdfjsPage {
  getViewport(params: { scale: number }): PdfjsViewport;
  render(params: {
    canvasContext: CanvasRenderingContext2D;
    canvas: HTMLCanvasElement;
    viewport: PdfjsViewport;
  }): { promise: Promise<void>; cancel(): void };
  cleanup?(): void;
}

interface PdfjsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPage>;
  destroy(): Promise<void> | void;
}

/** The parts of the `pdfjs-dist` module this package uses. */
export interface PdfjsModule {
  getDocument(src: { data: Uint8Array } | { url: string }): { promise: Promise<PdfjsDocument> };
  GlobalWorkerOptions: { workerSrc: string };
}

export interface LoadPdfOptions {
  /** A `pdfjs-dist` module you already imported. Without it the module is imported on first use. */
  pdfjs?: PdfjsModule;
  /** URL of the pdf.js worker script, when your bundler does not set it up. */
  workerSrc?: string;
}

async function importPdfjs(): Promise<PdfjsModule> {
  try {
    return (await import('pdfjs-dist')) as unknown as PdfjsModule;
  } catch (cause) {
    throw new Error(
      'Rendering a PDF needs the optional peer dependency "pdfjs-dist", or a custom renderPage.',
      { cause },
    );
  }
}

function toSource(file: PdfFile): { data: Uint8Array } | { url: string } {
  if (typeof file === 'string') return { url: file };
  if (file instanceof URL) return { url: file.href };
  // pdf.js may transfer the buffer to its worker, so hand it a copy.
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  return { data: bytes.slice() };
}

/** Loads a PDF with pdf.js and returns its page sizes and a renderer for the viewers. */
export async function loadPdf(file: PdfFile, options: LoadPdfOptions = {}): Promise<PdfSource> {
  const pdfjs = options.pdfjs ?? (await importPdfjs());
  if (options.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;
  const doc = await pdfjs.getDocument(toSource(file)).promise;

  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    pages.push({ width, height });
  }

  return {
    pages,
    async renderPage(pageIndex, scale, signal) {
      const page = await doc.getPage(pageIndex + 1);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D is not available.');
      const task = page.render({ canvasContext: context, canvas, viewport });
      const abort = () => task.cancel();
      signal.addEventListener('abort', abort, { once: true });
      try {
        await task.promise;
      } finally {
        signal.removeEventListener('abort', abort);
      }
      return canvas;
    },
    destroy() {
      void doc.destroy();
    },
  };
}
