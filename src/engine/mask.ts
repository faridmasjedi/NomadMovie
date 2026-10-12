import type { Clip, Mask } from "../types";

/*
 * Mask points live in the clip's uncropped picture space (0..1 on both axes), so a mask stays glued to the
 * picture when the clip is moved, scaled, rotated or cropped. Animated masks interpolate point by point.
 */

export const newMask = (pts: number[] = [], smooth = true): Mask => ({
  enabled: true, pts, keys: [], smooth, feather: 0, expand: 0, invert: false,
});

const KEY_EPS = 1 / 60;

/** outline at clip-local time `t` */
export function maskPtsAt(m: Mask, t: number): number[] {
  const k = m.keys;
  if (!k.length) return m.pts;
  if (k.length === 1 || t <= k[0].t) return k[0].pts;
  const last = k[k.length - 1];
  if (t >= last.t) return last.pts;
  let i = 0;
  while (i < k.length - 2 && t > k[i + 1].t) i++;
  const a = k[i], b = k[i + 1];
  const p = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
  return a.pts.map((v, j) => v + ((b.pts[j] ?? v) - v) * p);
}

export const keyAt = (m: Mask, t: number) => m.keys.find((k) => Math.abs(k.t - t) < KEY_EPS);

/** stores an edited outline: as a key at `t` when the mask is animated, otherwise as the static outline */
export function setMaskPts(m: Mask, t: number, pts: number[]) {
  if (!m.keys.length) {
    m.pts = pts;
    return;
  }
  const k = keyAt(m, t);
  if (k) k.pts = pts;
  else m.keys.push({ t, pts });
  m.keys.sort((a, b) => a.t - b.t);
}

export function addMaskKey(m: Mask, t: number) {
  if (keyAt(m, t)) return;
  m.keys.push({ t, pts: maskPtsAt(m, t).slice() });
  m.keys.sort((a, b) => a.t - b.t);
}

export function removeMaskKey(m: Mask, t: number) {
  const k = keyAt(m, t);
  if (!k) return;
  if (m.keys.length === 1) m.pts = k.pts;
  m.keys = m.keys.filter((x) => x !== k);
}

/** inserts a point after index `i` (in every key, so the outlines stay comparable) */
export function insertPoint(m: Mask, i: number) {
  const ins = (pts: number[]) => {
    const n = pts.length / 2, j = (i + 1) % n;
    pts.splice((i + 1) * 2, 0, (pts[i * 2] + pts[j * 2]) / 2, (pts[i * 2 + 1] + pts[j * 2 + 1]) / 2);
  };
  ins(m.pts);
  for (const k of m.keys) ins(k.pts);
}

export function deletePoint(m: Mask, i: number) {
  if (m.pts.length / 2 <= 3 && (!m.keys.length || m.keys[0].pts.length / 2 <= 3)) return;
  m.pts.splice(i * 2, 2);
  for (const k of m.keys) k.pts.splice(i * 2, 2);
}

export function boundsOf(pts: number[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]);
    y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]);
  }
  return { x0, y0, x1, y1 };
}

/* ---------------- shape builders (all in 0..1 picture space) ---------------- */

export const rectPts = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1];

export function ellipsePts(x0: number, y0: number, x1: number, y1: number, n = 24) {
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = Math.abs(x1 - x0) / 2, ry = Math.abs(y1 - y0) / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    out.push(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  }
  return out;
}

/** evenly spaced `n` points along a closed polyline */
export function resample(pts: number[], n: number): number[] {
  const m = pts.length / 2;
  if (m < 2) return pts.slice();
  const seg: number[] = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    const d = Math.hypot(pts[j * 2] - pts[i * 2], pts[j * 2 + 1] - pts[i * 2 + 1]);
    seg.push(d);
    total += d;
  }
  if (total === 0) return pts.slice(0, n * 2);
  const out: number[] = [];
  let i = 0, acc = 0;
  for (let s = 0; s < n; s++) {
    const target = (s / n) * total;
    while (i < m - 1 && acc + seg[i] < target) acc += seg[i++];
    const j = (i + 1) % m;
    const f = seg[i] ? (target - acc) / seg[i] : 0;
    out.push(pts[i * 2] + (pts[j * 2] - pts[i * 2]) * f, pts[i * 2 + 1] + (pts[j * 2 + 1] - pts[i * 2 + 1]) * f);
  }
  return out;
}

/**
 * `n` evenly spaced points, clockwise on screen, starting straight above the center. Outlines of the same
 * subject in different frames then line up point by point, so animating between them looks natural.
 */
export function normalizeOutline(pts: number[], n: number, aspect = 1): number[] {
  const m = pts.length / 2;
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
    cx += pts[i * 2];
    cy += pts[i * 2 + 1];
  }
  cx /= m;
  cy /= m;
  let ring = pts.slice();
  if (area < 0) {
    // counter-clockwise (y points down): reverse
    ring = [];
    for (let i = m - 1; i >= 0; i--) ring.push(pts[i * 2], pts[i * 2 + 1]);
  }
  ring = resample(ring, Math.max(n * 4, m));
  // start where the outline crosses the vertical line through the center, on the upper side
  let a = 0, ad = Infinity;
  for (let i = 0; i < ring.length; i += 2) {
    const d = Math.abs(ring[i] - cx) * aspect + (ring[i + 1] > cy ? 10 : 0);
    if (d < ad) { ad = d; a = i; }
  }
  return resample([...ring.slice(a), ...ring.slice(0, a)], n);
}

/** Douglas–Peucker on a closed outline, keeps at most `max` points */
export function simplify(pts: number[], tol: number, max = 200): number[] {
  const n = pts.length / 2;
  if (n <= 4) return pts.slice();
  const keep = new Uint8Array(n);
  // split the ring at the two points farthest apart so both halves are open polylines
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) {
    const d = (pts[i * 2] - pts[0]) ** 2 + (pts[i * 2 + 1] - pts[1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  keep[0] = keep[far] = 1;
  const rec = (a: number, b: number) => {
    // indices along the ring from a to b
    const len = (b - a + n) % n;
    if (len < 2) return;
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1];
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1, bd = 0;
    for (let s = 1; s < len; s++) {
      const i = (a + s) % n;
      const d = Math.abs((bx - ax) * (ay - pts[i * 2 + 1]) - (ax - pts[i * 2]) * (by - ay)) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best >= 0 && bd > tol) {
      keep[best] = 1;
      rec(a, best);
      rec(best, b);
    }
  };
  rec(0, far);
  rec(far, 0);
  let out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1]);
  if (out.length / 2 > max) out = resample(out, max);
  return out;
}

/* ---------------- drawing ---------------- */

type PathSink = Pick<Path2D, "moveTo" | "lineTo" | "bezierCurveTo" | "closePath">;

/** closed path through device-space points; smooth = Catmull-Rom curve through every point */
export function tracePath(ctx: PathSink, d: number[], smooth: boolean) {
  const n = d.length / 2;
  if (n < 3) return;
  const P = (i: number) => {
    const j = ((i % n) + n) % n;
    return [d[j * 2], d[j * 2 + 1]];
  };
  ctx.moveTo(d[0], d[1]);
  for (let i = 0; i < n; i++) {
    const [x1, y1] = P(i + 1);
    if (!smooth) ctx.lineTo(x1, y1);
    else {
      const [x0, y0] = P(i - 1), [xa, ya] = P(i), [x2, y2] = P(i + 2);
      ctx.bezierCurveTo(xa + (x1 - x0) / 6, ya + (y1 - y0) / 6, x1 - (x2 - xa) / 6, y1 - (y2 - ya) / 6, x1, y1);
    }
  }
  ctx.closePath();
}

/** maps picture-space points (0..1) to the clip's local drawing space (centered content box of size w×h) */
export function toLocal(c: Clip, pts: number[], w: number, h: number): number[] {
  const cr = c.crop;
  const cw = 1 - (cr.left + cr.right) / 100 || 1, ch = 1 - (cr.top + cr.bottom) / 100 || 1;
  const out = new Array<number>(pts.length);
  for (let i = 0; i < pts.length; i += 2) {
    out[i] = -w / 2 + ((pts[i] - cr.left / 100) / cw) * w;
    out[i + 1] = -h / 2 + ((pts[i + 1] - cr.top / 100) / ch) * h;
  }
  return out;
}

export function fromLocal(c: Clip, x: number, y: number, w: number, h: number): [number, number] {
  const cr = c.crop;
  const cw = 1 - (cr.left + cr.right) / 100 || 1, ch = 1 - (cr.top + cr.bottom) / 100 || 1;
  return [cr.left / 100 + ((x + w / 2) / w) * cw, cr.top / 100 + ((y + h / 2) / h) * ch];
}

export function pointInPolygon(x: number, y: number, pts: number[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** every outline of the mask (static and keys) */
export const allOutlines = (m: Mask) => (m.keys.length ? m.keys.map((k) => k.pts) : [m.pts]);

export const hasMask = (c: Clip) => !!c.mask?.enabled && (c.mask.keys.length ? c.mask.keys[0].pts.length : c.mask.pts.length) >= 6;

const maskCanvas = document.createElement("canvas");
const mctx = maskCanvas.getContext("2d")!;

/**
 * Cuts the layer down to the mask. `m` is the transform that maps the clip's local space to layer pixels,
 * `scale` the output scale (for feather / expand sizes).
 */
export function applyMask(layer: CanvasRenderingContext2D, c: Clip, local: number, w: number, h: number, m: DOMMatrix, scale: number) {
  const mask = c.mask!;
  const lp = toLocal(c, maskPtsAt(mask, local), w, h);
  const d = new Array<number>(lp.length);
  for (let i = 0; i < lp.length; i += 2) {
    d[i] = m.a * lp[i] + m.c * lp[i + 1] + m.e;
    d[i + 1] = m.b * lp[i] + m.d * lp[i + 1] + m.f;
  }
  const W = layer.canvas.width, H = layer.canvas.height;
  if (maskCanvas.width !== W || maskCanvas.height !== H) {
    maskCanvas.width = W;
    maskCanvas.height = H;
  }
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.globalCompositeOperation = "source-over";
  mctx.filter = "none";
  mctx.clearRect(0, 0, W, H);
  const feather = mask.feather * scale;
  if (feather > 0.3) mctx.filter = `blur(${feather / 2}px)`;
  mctx.fillStyle = mctx.strokeStyle = "#fff";
  mctx.lineJoin = "round";
  mctx.beginPath();
  tracePath(mctx, d, mask.smooth);
  mctx.fill();
  const ex = mask.expand * scale;
  if (ex > 0.3) {
    mctx.lineWidth = ex * 2;
    mctx.stroke();
  } else if (ex < -0.3) {
    mctx.globalCompositeOperation = "destination-out";
    mctx.lineWidth = -ex * 2;
    mctx.stroke();
  }
  layer.save();
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.filter = "none";
  layer.globalAlpha = 1;
  layer.globalCompositeOperation = mask.invert ? "destination-out" : "destination-in";
  layer.drawImage(maskCanvas, 0, 0);
  layer.restore();
}
