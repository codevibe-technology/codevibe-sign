import { describe, expect, it } from 'vitest';
import { loadPdf, type PdfjsModule } from './pdfjs';

/** A one-page pdf.js stand-in: 612 x 792 points, shown upright or turned 90 degrees. */
function fakePdfjs(rotation: 0 | 90): PdfjsModule {
  const page = {
    getViewport: () => ({
      width: rotation ? 792 : 612,
      height: rotation ? 612 : 792,
      // PDF space (bottom-left origin) to the page as shown (top-left origin).
      convertToViewportPoint: (x: number, y: number): [number, number] =>
        rotation ? [y, x] : [x, 792 - y],
    }),
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
    getTextContent: async () => ({
      items: [
        // 12 pt text at (100, 92) in PDF space, running along x, or along y when rotated.
        {
          str: '{{signature:1}}',
          transform: rotation ? [0, 12, -12, 0, 100, 92] : [12, 0, 0, 12, 100, 92],
          width: 90,
          height: 12,
        },
        { str: '', transform: [12, 0, 0, 12, 0, 0], width: 0, height: 12 },
      ],
    }),
  };
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => page,
        destroy: () => undefined,
      }),
    }),
  };
}

describe('loadPdf text', () => {
  it('reports text runs in top-left page points', async () => {
    const source = await loadPdf(new Uint8Array([1]), { pdfjs: fakePdfjs(0) });
    expect(await source.textItems!(0)).toEqual([
      { str: '{{signature:1}}', x: 100, y: 700 - 12, width: 90, height: 12 },
    ]);
  });

  it('follows the page rotation', async () => {
    const source = await loadPdf(new Uint8Array([1]), { pdfjs: fakePdfjs(90) });
    const [item] = await source.textItems!(0);
    expect(item).toMatchObject({ str: '{{signature:1}}', width: 90, height: 12 });
    expect(item!.x).toBe(92);
  });
});
