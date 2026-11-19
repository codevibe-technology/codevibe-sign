'use client';

import type { LoadPdfOptions, PdfjsModule } from '@codevibe_technology/sign-react';
import { useEffect, useState } from 'react';

/** pdf.js and its worker, loaded in the browser on first use. */
export function usePdfjs(): LoadPdfOptions | null {
  const [options, setOptions] = useState<LoadPdfOptions | null>(null);
  useEffect(() => {
    let live = true;
    void import('pdfjs-dist').then((pdfjs) => {
      if (!live) return;
      setOptions({
        pdfjs: pdfjs as unknown as PdfjsModule,
        workerSrc: new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString(),
      });
    });
    return () => {
      live = false;
    };
  }, []);
  return options;
}
