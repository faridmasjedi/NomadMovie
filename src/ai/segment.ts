import type { Clip, MediaItem } from "../types";
import { boundsOf, normalizeOutline, pointInPolygon } from "../engine/mask";
import { getImage } from "../engine/media";
// the ONNX runtime ships with the app (works offline once the model itself is cached)
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import ortMjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";

/*
 * AI subject selection: EdgeTAM (a fast SAM 2 variant) runs locally through transformers.js.
 * The model is downloaded once (~30 MB) and cached by the browser. A click on a subject gives a pixel mask,
 * which is traced into an editable outline; tracking repeats that frame by frame, prompting each frame
 * with the subject's box and center from the frame before.
 */

const MODEL = "onnx-community/EdgeTAM-ONNX";
/** points of every AI outline, so tracked keys line up point by point */
export const AI_POINTS = 96;
/** the model's input size */
const MODEL_SIZE = 1024;

type TF = typeof import("@huggingface/transformers");
interface Seg {
  tf: TF;
  model: Awaited<ReturnType<TF["AutoModel"]["from_pretrained"]>>;
  processor: Awaited<ReturnType<TF["AutoProcessor"]["from_pretrained"]>>;
  device: string;
}
let loading: Promise<Seg> | null = null;
type Progress = (msg: string) => void;

export function loadSegmenter(onProgress?: Progress): Promise<Seg> {
  loading ??= (async () => {
    const tf = await import("@huggingface/transformers");
    if (tf.env.backends.onnx.wasm) tf.env.backends.onnx.wasm.wasmPaths = { wasm: ortWasm, mjs: ortMjs };
    const files = new Map<string, [number, number]>();
    const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== "progress" || !p.file) return;
      files.set(p.file, [p.loaded ?? 0, p.total ?? 0]);
      let a = 0, b = 0;
      for (const [l, t] of files.values()) { a += l; b += t; }
      if (b) onProgress?.(`Downloading the AI selection model… ${Math.round((a / b) * 100)}%`);
    };
    const gpu = "gpu" in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
    const device = gpu ? "webgpu" : "wasm";
    const model = await tf.AutoModel.from_pretrained(MODEL, { device, dtype: "fp32", progress_callback } as never);
    const processor = await tf.AutoProcessor.from_pretrained(MODEL, {});
    return { tf, model, processor, device };
  })();
  loading.catch(() => (loading = null));
  return loading;
}

/* ---------------- frames ---------------- */

const grabVideos = new Map<string, HTMLVideoElement>();
const frameCanvas = document.createElement("canvas");
const fctx = frameCanvas.getContext("2d", { willReadFrequently: true })!;

/** the clip's source time for clip-local time `local` */
export const sourceTime = (c: Clip, m: MediaItem, local: number) =>
  Math.min(Math.max(0, c.reverse ? c.offset + (c.duration - local) * c.speed : c.offset + local * c.speed), Math.max(0, m.duration - 0.04));

type Frame = { px: Float32Array; w: number; h: number };

async function grabFrame(c: Clip, m: MediaItem, local: number): Promise<Frame> {
  let src: CanvasImageSource, iw: number, ih: number;
  if (m.kind === "image") {
    const img = getImage(m.id, m.url);
    if (!img.complete || !img.naturalWidth) await img.decode();
    [src, iw, ih] = [img, img.naturalWidth, img.naturalHeight];
  } else {
    let v = grabVideos.get(m.url);
    if (!v) {
      v = document.createElement("video");
      v.muted = true;
      v.preload = "auto";
      v.src = m.url;
      grabVideos.set(m.url, v);
    }
    if (v.readyState < 1) await new Promise((r) => v!.addEventListener("loadedmetadata", r, { once: true }));
    const target = sourceTime(c, m, local);
    if (Math.abs(v.currentTime - target) > 1e-4 || v.readyState < 2) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 4000);
        v!.addEventListener("seeked", () => { clearTimeout(t); resolve(); }, { once: true });
        v!.currentTime = target;
      });
    }
    [src, iw, ih] = [v, v.videoWidth, v.videoHeight];
  }
  // SAM 2 sees the frame stretched to a 1024×1024 square, normalized with the ImageNet mean / std
  frameCanvas.width = frameCanvas.height = MODEL_SIZE;
  fctx.drawImage(src, 0, 0, MODEL_SIZE, MODEL_SIZE);
  const d = fctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE).data;
  const N = MODEL_SIZE * MODEL_SIZE;
  const px = new Float32Array(3 * N);
  const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
  for (let ch = 0; ch < 3; ch++) {
    const mu = MEAN[ch], k = 1 / (255 * STD[ch]), o = ch * N, sd = mu / STD[ch];
    for (let i = 0; i < N; i++) px[o + i] = d[i * 4 + ch] * k - sd;
  }
  return { px, w: iw, h: ih };
}

/* ---------------- model ---------------- */

/** picture-space prompt: points are 0..1, label 1 = the subject, 0 = not the subject */
export interface Prompt {
  points?: [number, number, number][];
  box?: [number, number, number, number];
}

export interface SegResult {
  /** traced outline, 0..1 picture space, AI_POINTS points */
  pts: number[];
  score: number;
  /** the model thinks the subject is no longer visible */
  lost: boolean;
  /** subject's pixel-mask box and an inside point, 0..1 (used to prompt the next frame) */
  box: [number, number, number, number];
  inside: [number, number];
}

interface ImageProc {
  reshape_input_points(p: unknown, o: unknown, r: unknown, box?: boolean): unknown;
  add_input_labels(l: unknown, p: unknown): unknown;
}
interface DecoderOut {
  pred_masks: { data: Float32Array; dims: number[] };
  iou_scores: { data: Float32Array };
  object_score_logits?: { data: Float32Array };
}

let cache: { key: string; emb: Record<string, unknown>; w: number; h: number } | null = null;

export async function segment(c: Clip, m: MediaItem, local: number, prompt: Prompt, onProgress?: Progress, frame?: Promise<Frame>): Promise<SegResult | null> {
  const seg = await loadSegmenter(onProgress);
  const key = `${m.id}@${sourceTime(c, m, local).toFixed(4)}`;
  if (cache?.key !== key) {
    const f = await (frame ?? grabFrame(c, m, local));
    onProgress?.("Analyzing the frame…");
    const pixel_values = new seg.tf.Tensor("float32", f.px, [1, 3, MODEL_SIZE, MODEL_SIZE]);
    const emb = await (seg.model as unknown as { get_image_embeddings(x: unknown): Promise<Record<string, unknown>> }).get_image_embeddings({ pixel_values });
    cache = { key, emb, w: f.w, h: f.h };
  }
  const { w, h } = cache;
  // pixel prompts → model inputs (rescaled to the model's 1024 grid)
  const ip = (seg.processor as unknown as { image_processor: ImageProc }).image_processor;
  const sizes = [[[h, w]], [[MODEL_SIZE, MODEL_SIZE]]] as const;
  const dec: Record<string, unknown> = { ...cache.emb };
  if (prompt.points?.length) {
    dec.input_points = ip.reshape_input_points([[prompt.points.map(([x, y]) => [x * w, y * h])]], ...sizes);
    dec.input_labels = ip.add_input_labels([[prompt.points.map((p) => p[2])]], dec.input_points);
  }
  if (prompt.box) {
    const [x0, y0, x1, y1] = prompt.box;
    dec.input_boxes = ip.reshape_input_points([[[x0 * w, y0 * h, x1 * w, y1 * h]]], ...sizes, true);
  }
  const out = await (seg.model as unknown as (x: unknown) => Promise<DecoderOut>)(dec);
  const scores = out.iou_scores.data;
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;
  // low-res logits of the best mask cover the whole (stretched) frame
  const [mh, mw] = out.pred_masks.dims.slice(-2);
  const logits = out.pred_masks.data.subarray(best * mw * mh, (best + 1) * mw * mh);
  const traced = traceMask(logits, mw, mh, w / h);
  if (!traced) return null;
  const objectLogit = out.object_score_logits?.data[0] ?? 1;
  return { ...traced, score: scores[best], lost: objectLogit < 0 };
}

/** outline of the biggest blob in a binary mask */
function traceMask(logits: Float32Array, w: number, h: number, aspect: number): Omit<SegResult, "score" | "lost"> | null {
  // upsample the logits (bilinear) onto a grid with the picture's aspect, then threshold at 0
  const G = 512;
  const gw = aspect >= 1 ? G : Math.max(2, Math.round(G * aspect)), gh = aspect >= 1 ? Math.max(2, Math.round(G / aspect)) : G;
  const g = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const fy = Math.min(h - 1, Math.max(0, ((y + 0.5) / gh) * h - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < gw; x++) {
      const fx = Math.min(w - 1, Math.max(0, ((x + 0.5) / gw) * w - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const top = logits[y0 * w + x0] * (1 - tx) + logits[y0 * w + x1] * tx;
      const bot = logits[y1 * w + x0] * (1 - tx) + logits[y1 * w + x1] * tx;
      g[y * gw + x] = top * (1 - ty) + bot * ty > 0 ? 1 : 0;
    }
  }
  // largest 4-connected component
  const label = new Int32Array(gw * gh);
  let bestId = 0, bestSize = 0, id = 0;
  const stack: number[] = [];
  for (let i = 0; i < g.length; i++) {
    if (!g[i] || label[i]) continue;
    id++;
    let size = 0;
    label[i] = id;
    stack.push(i);
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p % gw, y = (p - x) / gw;
      if (x > 0 && g[p - 1] && !label[p - 1]) { label[p - 1] = id; stack.push(p - 1); }
      if (x < gw - 1 && g[p + 1] && !label[p + 1]) { label[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && g[p - gw] && !label[p - gw]) { label[p - gw] = id; stack.push(p - gw); }
      if (y < gh - 1 && g[p + gw] && !label[p + gw]) { label[p + gw] = id; stack.push(p + gw); }
    }
    if (size > bestSize) { bestSize = size; bestId = id; }
  }
  if (bestSize < 12) return null;
  const inBlob = (x: number, y: number) => x >= 0 && y >= 0 && x < gw && y < gh && label[y * gw + x] === bestId;

  // Moore-neighbour boundary trace, clockwise, from the first blob pixel in scan order
  let start = 0;
  while (label[start] !== bestId) start++;
  const sx = start % gw, sy = (start - sx) / gw;
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const ring: number[] = [];
  let cx = sx, cy = sy, dir = 7;
  for (let guard = 0; guard < gw * gh * 4; guard++) {
    ring.push((cx + 0.5) / gw, (cy + 0.5) / gh);
    let found = false;
    for (let i = 0; i < 8; i++) {
      const d = (dir + 6 + i) % 8; // start looking left of where we came from
      const nx = cx + DX[d], ny = cy + DY[d];
      if (inBlob(nx, ny)) {
        cx = nx;
        cy = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found || (cx === sx && cy === sy)) break;
  }
  if (ring.length < 6) return null;

  let mx = 0, my = 0, n = 0;
  for (let i = 0; i < label.length; i++) if (label[i] === bestId) { mx += i % gw; my += Math.floor(i / gw); n++; }
  mx = (mx / n + 0.5) / gw;
  my = (my / n + 0.5) / gh;
  const pts = normalizeOutline(ring, AI_POINTS, aspect);

  // a point that is surely inside: the blob pixel nearest to the center
  let ix = mx, iy = my;
  if (!inBlob(Math.floor(mx * gw), Math.floor(my * gh))) {
    let bd = Infinity;
    for (let i = 0; i < label.length; i++) {
      if (label[i] !== bestId) continue;
      const x = ((i % gw) + 0.5) / gw, y = (Math.floor(i / gw) + 0.5) / gh;
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bd) { bd = d; ix = x; iy = y; }
    }
  }
  const b = boundsOf(ring);
  return { pts, box: [b.x0, b.y0, b.x1, b.y1], inside: [ix, iy] };
}

/**
 * Follows the subject from `from` towards the clip's end (dir 1) or start (dir -1), calling `onKey`
 * with the outline found every `step` seconds. Stops early when the subject is lost or `signal` aborts.
 */
export async function trackSubject(
  c: Clip, m: MediaItem, from: number, first: SegResult, opts: { dir: 1 | -1; step: number; signal: AbortSignal },
  onKey: (t: number, pts: number[]) => void, onProgress: (done: number) => void, onStatus?: Progress,
): Promise<{ frames: number; stoppedAt?: number }> {
  let prev = first;
  let frames = 0;
  const end = opts.dir > 0 ? c.duration - 1e-3 : 0;
  const span = Math.abs(end - from) || 1;
  const times: number[] = [];
  for (let t = from + opts.step * opts.dir; opts.dir > 0 ? t < end + opts.step - 1e-6 : t > -opts.step + 1e-6; t += opts.step * opts.dir) {
    const tt = Math.min(Math.max(t, 0), end > 0 ? end : c.duration - 1e-3);
    times.push(tt);
    if (tt === end || tt === 0) break;
  }
  // the next frame is decoded while the model works on the current one
  let next = times.length ? grabFrame(c, m, times[0]) : null;
  for (let i = 0; i < times.length; i++) {
    if (opts.signal.aborted) break;
    const tt = times[i];
    const frame = await next!;
    next = i + 1 < times.length ? grabFrame(c, m, times[i + 1]) : null;
    const [x0, y0, x1, y1] = prev.box;
    const px = (x1 - x0) * 0.1, py = (y1 - y0) * 0.1;
    const r = await segment(c, m, tt, {
      box: [Math.max(0, x0 - px), Math.max(0, y0 - py), Math.min(1, x1 + px), Math.min(1, y1 + py)],
      points: [[prev.inside[0], prev.inside[1], 1]],
    }, onStatus, Promise.resolve(frame));
    if (!r || r.lost) {
      await next?.catch(() => {});
      return { frames, stoppedAt: tt };
    }
    onKey(tt, r.pts);
    prev = r;
    frames++;
    onProgress(Math.min(1, Math.abs(tt - from) / span));
  }
  await next?.catch(() => {});
  return { frames };
}

/** bounding box of an outline (for picking up tracking from an edited mask) */
export function resultFromPts(pts: number[]): SegResult {
  const b = boundsOf(pts);
  let inside: [number, number] = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  // an L- or U-shaped subject can have its box center outside: search a small grid for a point inside
  if (!pointInPolygon(inside[0], inside[1], pts)) {
    search: for (let gy = 1; gy < 8; gy++)
      for (let gx = 1; gx < 8; gx++) {
        const x = b.x0 + ((b.x1 - b.x0) * gx) / 8, y = b.y0 + ((b.y1 - b.y0) * gy) / 8;
        if (pointInPolygon(x, y, pts)) {
          inside = [x, y];
          break search;
        }
      }
  }
  return { pts, score: 1, lost: false, box: [b.x0, b.y0, b.x1, b.y1], inside };
}
