/**
 * A small software canvas for jsdom. It keeps real RGBA pixels per canvas so the
 * trim and re-encode code can be tested: paths paint 3x3 dots at their points,
 * text paints a box, drawImage copies with nearest-neighbour scaling, and
 * toDataURL returns a base64 string whose size grows with the pixel count.
 */

interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const buffers = new WeakMap<HTMLCanvasElement, Pixels>();

export function pixelsOf(canvas: HTMLCanvasElement): Pixels {
  let px = buffers.get(canvas);
  if (!px || px.width !== canvas.width || px.height !== canvas.height) {
    px = {
      width: canvas.width,
      height: canvas.height,
      data: new Uint8ClampedArray(canvas.width * canvas.height * 4),
    };
    buffers.set(canvas, px);
  }
  return px;
}

function parseColor(color: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  if (color === 'white' || color === '#fff') return [255, 255, 255, 255];
  return [0, 0, 0, 255];
}

function setPixel(px: Pixels, x: number, y: number, rgba: [number, number, number, number]) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix >= px.width || iy >= px.height) return;
  px.data.set(rgba, (iy * px.width + ix) * 4);
}

function fillBox(
  px: Pixels,
  x: number,
  y: number,
  w: number,
  h: number,
  rgba: [number, number, number, number],
) {
  for (let yy = Math.floor(y); yy < y + h; yy++) {
    for (let xx = Math.floor(x); xx < x + w; xx++) setPixel(px, xx, yy, rgba);
  }
}

class MockContext2D {
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  font = '10px sans-serif';
  textAlign = 'start';
  textBaseline = 'alphabetic';
  imageSmoothingQuality = 'low';
  private path: Array<[number, number]> = [];

  constructor(readonly canvas: HTMLCanvasElement) {}

  private get px() {
    return pixelsOf(this.canvas);
  }

  beginPath() {
    this.path = [];
  }
  moveTo(x: number, y: number) {
    this.path.push([x, y]);
  }
  lineTo(x: number, y: number) {
    this.path.push([x, y]);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    this.path.push([cx, cy], [x, y]);
  }
  arc(x: number, y: number) {
    this.path.push([x, y]);
  }
  private paint(color: string) {
    const rgba = parseColor(color);
    for (const [x, y] of this.path) fillBox(this.px, x - 1, y - 1, 3, 3, rgba);
  }
  stroke() {
    this.paint(this.strokeStyle);
  }
  fill() {
    this.paint(this.fillStyle);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    fillBox(this.px, x, y, w, h, parseColor(this.fillStyle));
  }
  clearRect(x: number, y: number, w: number, h: number) {
    fillBox(this.px, x, y, w, h, [0, 0, 0, 0]);
  }
  private fontSize() {
    return Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
  }
  measureText(text: string) {
    return { width: text.length * this.fontSize() * 0.5 };
  }
  fillText(text: string, x: number, y: number) {
    const w = this.measureText(text).width;
    const h = this.fontSize() * 0.6;
    const left = this.textAlign === 'center' ? x - w / 2 : x;
    const top = this.textBaseline === 'middle' ? y - h / 2 : y - h;
    fillBox(this.px, left, top, w, h, parseColor(this.fillStyle));
  }
  getImageData(x: number, y: number, w: number, h: number) {
    const src = this.px;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let yy = 0; yy < h; yy++) {
      const start = ((y + yy) * src.width + x) * 4;
      data.set(src.data.subarray(start, start + w * 4), yy * w * 4);
    }
    return { width: w, height: h, data, colorSpace: 'srgb' } as ImageData;
  }
  putImageData(image: ImageData, x: number, y: number) {
    const dst = this.px;
    for (let yy = 0; yy < image.height; yy++) {
      const row = image.data.subarray(yy * image.width * 4, (yy + 1) * image.width * 4);
      dst.data.set(row, ((y + yy) * dst.width + x) * 4);
    }
  }
  drawImage(source: HTMLCanvasElement, ...args: number[]) {
    const src = pixelsOf(source);
    let [sx, sy, sw, sh, dx, dy, dw, dh] = [
      0,
      0,
      src.width,
      src.height,
      0,
      0,
      src.width,
      src.height,
    ];
    if (args.length === 2) [dx, dy] = args as [number, number];
    else if (args.length === 4) [dx, dy, dw, dh] = args as [number, number, number, number];
    else
      [sx, sy, sw, sh, dx, dy, dw, dh] = args as [
        number,
        number,
        number,
        number,
        number,
        number,
        number,
        number,
      ];
    const dst = this.px;
    for (let yy = 0; yy < dh; yy++) {
      for (let xx = 0; xx < dw; xx++) {
        const fx = Math.floor(sx + ((xx + 0.5) * sw) / dw);
        const fy = Math.floor(sy + ((yy + 0.5) * sh) / dh);
        if (fx < 0 || fy < 0 || fx >= src.width || fy >= src.height) continue;
        const i = (fy * src.width + fx) * 4;
        const rgba = src.data.subarray(i, i + 4);
        if (rgba[3] === 0) continue;
        setPixel(dst, dx + xx, dy + yy, [rgba[0]!, rgba[1]!, rgba[2]!, rgba[3]!]);
      }
    }
  }
  setTransform() {}
  scale() {}
  save() {}
  restore() {}
}

// PNG signature followed by the start of an IHDR chunk, enough for core's PNG check.
const PNG_HEADER = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82];

/** Bytes the mocked PNG encoder reports for a canvas of this size. */
export function mockPngBytes(width: number, height: number): number {
  return 64 + Math.ceil((width * height) / 4);
}

export function installCanvasMock(): void {
  const contexts = new WeakMap<HTMLCanvasElement, MockContext2D>();
  HTMLCanvasElement.prototype.getContext = function getContext(
    this: HTMLCanvasElement,
    kind: string,
  ) {
    if (kind !== '2d') return null;
    let ctx = contexts.get(this);
    if (!ctx) {
      ctx = new MockContext2D(this);
      contexts.set(this, ctx);
    }
    return ctx as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext;

  HTMLCanvasElement.prototype.toDataURL = function toDataURL(
    this: HTMLCanvasElement,
    type?: string,
  ) {
    const bytes = new Uint8Array(mockPngBytes(this.width, this.height));
    bytes.set(PNG_HEADER);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return `data:${type ?? 'image/png'};base64,${btoa(binary)}`;
  };
}

/** A canvas with a white background and a dark box: a photo of a signature on paper. */
export function paperCanvas(
  width: number,
  height: number,
  ink: { x: number; y: number; width: number; height: number },
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const px = pixelsOf(canvas);
  fillBox(px, 0, 0, width, height, [255, 255, 255, 255]);
  fillBox(px, ink.x, ink.y, ink.width, ink.height, [20, 20, 30, 255]);
  return canvas;
}
