/** A point in pad coordinates: 0..1 across the width and down the height. */
export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export interface Stroke {
  color: string;
  points: StrokePoint[];
}

/** Points closer than this (as a fraction of the pad width) are dropped to cut jitter. */
const MIN_STEP = 0.0025;

/** Appends a point unless it is too close to the previous one. Returns whether it was added. */
export function addPoint(stroke: Stroke, point: StrokePoint): boolean {
  const last = stroke.points[stroke.points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_STEP) return false;
  stroke.points.push(point);
  return true;
}

/** Line width in pixels for a pad `width` pixels wide at the given pen pressure. */
export function lineWidth(width: number, pressure: number): number {
  const base = Math.max(1.5, width * 0.005);
  return base * (0.6 + Math.min(1, Math.max(0, pressure)) * 0.8);
}

/**
 * Draws strokes as quadratic curves through segment midpoints, which smooths the
 * corners of raw pointer samples. Each segment takes the width of its pressure.
 */
export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  width: number,
  height: number,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const stroke of strokes) {
    const pts = stroke.points.map((p) => ({ x: p.x * width, y: p.y * height, p: p.pressure }));
    const first = pts[0];
    if (!first) continue;
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(first.x, first.y, lineWidth(width, first.p) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    let from = first;
    for (let i = 1; i < pts.length; i++) {
      const control = pts[i]!;
      const next = pts[i + 1];
      const to = next ? { x: (control.x + next.x) / 2, y: (control.y + next.y) / 2 } : control;
      ctx.beginPath();
      ctx.lineWidth = lineWidth(width, control.p);
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
      ctx.stroke();
      from = { ...to, p: control.p };
    }
  }
}
