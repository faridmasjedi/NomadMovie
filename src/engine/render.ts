import type { Clip, Effect, MediaItem, Project, ShapeProps, TextProps } from "../types";
import { frameState, type FrameState } from "./animate";
import { getImage, getSvgImage, getVideo, pauseVideosExcept } from "./media";

export interface Bounds {
  x: number;
  y: number;
  w: number; // unscaled content size
  h: number;
  sx: number;
  sy: number;
  rotation: number;
}

/** last rendered bounds of each visible clip (for selection/hit-test in the preview) */
export const lastBounds = new Map<string, Bounds>();

const layerCanvas = document.createElement("canvas");
const layer = layerCanvas.getContext("2d", { willReadFrequently: false })!;
const fxCanvas = document.createElement("canvas");
const fx = fxCanvas.getContext("2d")!;
const keyCanvas = document.createElement("canvas");
const keyCtx = keyCanvas.getContext("2d", { willReadFrequently: true })!;
let grain: HTMLCanvasElement | null = null;
const tmpCanvas = document.createElement("canvas");
const tmpCtx = tmpCanvas.getContext("2d")!;

const RTL = /[֐-ࣿיִ-ﻼ]/;

const ensureSize = (c: HTMLCanvasElement, w: number, h: number) => {
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
};

/** pseudo random but deterministic per time */
const noise = (t: number, seed = 0) => {
  const x = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export interface RenderOpts {
  playing: boolean;
  /** export renders must use exact frames */
  exporting?: boolean;
  scale?: number; // output scale vs project size
  /** decoded frames supplied by the exporter (clipId → frame), used instead of <video> elements */
  frames?: Map<string, VideoFrame | null>;
}

/** seeks every video visible at `t` to its exact frame and waits until it is decoded */
export async function prepareVideosAt(p: Project, media: Record<string, MediaItem>, t: number, skip?: { has(id: string): boolean }) {
  const waits: Promise<void>[] = [];
  for (const c of p.clips) {
    if (skip?.has(c.id)) continue;
    if (c.kind !== "video" || t < c.start || t >= c.start + c.duration || !c.mediaId) continue;
    const tr = p.tracks.find((x) => x.id === c.trackId);
    if (!tr || tr.hidden) continue;
    const m = media[c.mediaId];
    if (!m) continue;
    const v = getVideo(c.id, m.url);
    if (!v.paused) v.pause();
    const target = Math.min(c.offset + (t - c.start) * c.speed, Math.max(0, m.duration - 0.001));
    if (Math.abs(v.currentTime - target) < 1e-4 && v.readyState >= 2 && !v.seeking) continue;
    waits.push(
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          v.removeEventListener("seeked", done);
          resolve();
        };
        const timer = setTimeout(done, 3000);
        v.addEventListener("seeked", done);
        v.currentTime = target;
      }),
    );
  }
  await Promise.all(waits);
}

export function activeClipsAt(p: Project, t: number) {
  return p.clips.filter((c) => t >= c.start && t < c.start + c.duration);
}

export function renderFrame(ctx: CanvasRenderingContext2D, p: Project, media: Record<string, MediaItem>, t: number, opts: RenderOpts) {
  const scale = opts.scale ?? 1;
  const W = p.width, H = p.height;
  const cw = Math.round(W * scale), ch = Math.round(H * scale);
  ensureSize(layerCanvas, cw, ch);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  ctx.fillStyle = p.background;
  ctx.fillRect(0, 0, cw, ch);

  const activeVideo = new Set<string>();
  lastBounds.clear();
  // bottom track first
  const tracks = p.tracks.filter((tr) => tr.kind === "video");
  for (let ti = tracks.length - 1; ti >= 0; ti--) {
    const tr = tracks[ti];
    if (tr.hidden) continue;
    for (const c of p.clips) {
      if (c.trackId !== tr.id || t < c.start || t >= c.start + c.duration) continue;
      if (c.kind === "video") activeVideo.add(c.id);
      drawClip(ctx, c, p, media, t - c.start, opts, scale);
    }
  }
  pauseVideosExcept(activeVideo);
  ctx.restore();
}

function cssFilter(c: Clip, s: FrameState, scale: number) {
  const f = c.filters;
  const parts: string[] = [];
  const b = f.brightness * s.brightness;
  if (b !== 100) parts.push(`brightness(${b}%)`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturation !== 100) parts.push(`saturate(${f.saturation}%)`);
  if (f.hue) parts.push(`hue-rotate(${f.hue}deg)`);
  if (f.grayscale) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.sepia) parts.push(`sepia(${f.sepia}%)`);
  if (f.invert) parts.push(`invert(${f.invert}%)`);
  const blur = (f.blur + s.blur) * scale;
  if (blur > 0.05) parts.push(`blur(${blur}px)`);
  return parts.length ? parts.join(" ") : "none";
}

function contentSize(c: Clip, m: MediaItem | undefined, W: number, H: number): [number, number] {
  if (c.kind === "text" && c.text) return measureText(c.text);
  if (c.kind === "shape" && c.shape) return [c.shape.width, c.shape.height];
  if (c.kind === "solid") return [W, H];
  let iw = m?.width || W, ih = m?.height || H;
  if (c.svg) {
    const img = getSvgImage(c.svg);
    iw = img.naturalWidth || 400;
    ih = img.naturalHeight || 400;
    return [iw, ih];
  }
  const cw = 1 - (c.crop.left + c.crop.right) / 100, chh = 1 - (c.crop.top + c.crop.bottom) / 100;
  if (c.fit === "stretch") return [W * cw, H * chh];
  const k = c.fit === "cover" ? Math.max(W / iw, H / ih) : Math.min(W / iw, H / ih);
  return [iw * k * cw, ih * k * chh];
}

function drawClip(out: CanvasRenderingContext2D, c: Clip, p: Project, media: Record<string, MediaItem>, local: number, opts: RenderOpts, scale: number) {
  const W = p.width, H = p.height;
  const m = c.mediaId ? media[c.mediaId] : undefined;
  const s = frameState(c, local, W, H);
  const t = c.start + local;

  // time-based effects that modify the transform
  for (const e of c.effects) {
    const a = e.amount / 100;
    if (e.type === "shake") {
      s.x += (noise(t * 30, 1) - 0.5) * 60 * a;
      s.y += (noise(t * 30, 2) - 0.5) * 60 * a;
      s.rotation += (noise(t * 30, 3) - 0.5) * 4 * a;
    } else if (e.type === "zoomPulse") {
      const k = 1 + a * 0.12 * Math.abs(Math.sin(t * Math.PI * 2));
      s.sx *= k;
      s.sy *= k;
    } else if (e.type === "flicker") {
      if (noise(Math.floor(t * 20), 4) < a * 0.5) s.opacity *= 0.55;
    }
  }
  if (s.opacity <= 0.001 || s.sx === 0 || s.sy === 0) return;

  const [w, h] = contentSize(c, m, W, H);
  lastBounds.set(c.id, { x: s.x, y: s.y, w, h, sx: s.sx, sy: s.sy, rotation: s.rotation });

  // ---- draw into the layer
  const L = layer;
  L.setTransform(1, 0, 0, 1, 0, 0);
  L.globalAlpha = 1;
  L.globalCompositeOperation = "source-over";
  L.filter = "none";
  L.clearRect(0, 0, layerCanvas.width, layerCanvas.height);
  L.save();
  L.scale(scale, scale);
  if (s.wipe) {
    L.beginPath();
    if ("circle" in s.wipe) {
      L.arc(W / 2, H / 2, Math.hypot(W, H) / 2 * s.wipe.circle, 0, Math.PI * 2);
    } else if (s.wipe.dir === "left") L.rect(W * (1 - s.wipe.p), 0, W * s.wipe.p, H);
    else if (s.wipe.dir === "right") L.rect(0, 0, W * s.wipe.p, H);
    else L.rect(0, H * (1 - s.wipe.p), W, H * s.wipe.p);
    L.clip();
  }
  L.translate(s.x, s.y);
  L.rotate((s.rotation * Math.PI) / 180);
  L.scale(s.sx, s.sy);
  L.filter = cssFilter(c, s, scale * Math.abs(s.sx));

  switch (c.kind) {
    case "video": {
      if (!m) break;
      if (opts.frames?.has(c.id)) {
        const f = opts.frames.get(c.id);
        if (f) drawMedia(L, f, c, w, h, f.displayWidth, f.displayHeight);
        break;
      }
      const v = getVideo(c.id, m.url);
      syncVideo(v, c, local, opts);
      if (v.readyState >= 2) drawMedia(L, v, c, w, h, v.videoWidth, v.videoHeight);
      break;
    }
    case "image": {
      const img = c.svg ? getSvgImage(c.svg) : m ? getImage(m.id, m.url) : null;
      if (img && img.complete && img.naturalWidth) drawMedia(L, img, c, w, h, img.naturalWidth, img.naturalHeight);
      break;
    }
    case "solid":
      L.fillStyle = c.color ?? "#000";
      L.fillRect(-w / 2, -h / 2, w, h);
      break;
    case "text":
      if (c.text) drawText(L, c.text, s);
      break;
    case "shape":
      if (c.shape) drawShape(L, c.shape);
      break;
  }
  L.restore();

  // ---- pixel / layer effects
  const f = c.filters;
  if (c.chroma.enabled && (c.kind === "video" || c.kind === "image")) chromaKey(c);
  if (f.temperature || f.tint) {
    L.save();
    L.globalCompositeOperation = "source-atop";
    if (f.temperature) {
      L.fillStyle = f.temperature > 0 ? `rgba(255,140,30,${(f.temperature / 100) * 0.22})` : `rgba(40,120,255,${(-f.temperature / 100) * 0.22})`;
      L.fillRect(0, 0, layerCanvas.width, layerCanvas.height);
    }
    if (f.tint) {
      L.fillStyle = f.tint > 0 ? `rgba(255,40,200,${(f.tint / 100) * 0.18})` : `rgba(40,255,90,${(-f.tint / 100) * 0.18})`;
      L.fillRect(0, 0, layerCanvas.width, layerCanvas.height);
    }
    L.restore();
  }
  if (f.vignette > 0) {
    L.save();
    L.globalCompositeOperation = "source-atop";
    const cw = layerCanvas.width, chh = layerCanvas.height;
    const g = L.createRadialGradient(cw / 2, chh / 2, Math.min(cw, chh) * 0.3, cw / 2, chh / 2, Math.hypot(cw, chh) / 2);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${f.vignette / 100})`);
    L.fillStyle = g;
    L.fillRect(0, 0, cw, chh);
    L.restore();
  }
  for (const e of c.effects) applyLayerEffect(e, t, scale);

  out.save();
  out.globalAlpha = Math.min(1, s.opacity);
  out.globalCompositeOperation = c.blend;
  out.drawImage(layerCanvas, 0, 0);
  out.restore();
}

function drawMedia(L: CanvasRenderingContext2D, src: CanvasImageSource, c: Clip, w: number, h: number, iw: number, ih: number) {
  const cr = c.crop;
  const sx = (iw * cr.left) / 100, sy = (ih * cr.top) / 100;
  const sw = iw * (1 - (cr.left + cr.right) / 100), sh = ih * (1 - (cr.top + cr.bottom) / 100);
  if (sw <= 0 || sh <= 0) return;
  L.drawImage(src, sx, sy, sw, sh, -w / 2, -h / 2, w, h);
}

function syncVideo(v: HTMLVideoElement, c: Clip, local: number, opts: RenderOpts) {
  const target = c.offset + local * c.speed;
  if (opts.exporting && !opts.playing) return; // the frame exporter seeks videos itself, exactly
  if (opts.playing) {
    v.playbackRate = c.speed;
    if (v.paused) {
      v.currentTime = target;
      v.play().catch(() => {});
    } else if (Math.abs(v.currentTime - target) > 0.25) {
      v.currentTime = target;
    }
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - target) > 0.02 && !v.seeking) v.currentTime = target;
  }
}

/* ---------------- text ---------------- */
const measureCtx = document.createElement("canvas").getContext("2d")!;
const fontOf = (t: TextProps) => `${t.italic ? "italic " : ""}${t.bold ? 800 : 400} ${t.size}px "${t.font}", Vazirmatn, sans-serif`;

export function measureText(t: TextProps): [number, number] {
  measureCtx.font = fontOf(t);
  (measureCtx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${t.letterSpacing}px`;
  const lines = t.content.split("\n");
  const w = Math.max(...lines.map((l) => measureCtx.measureText(l).width), 10);
  const pad = t.background ? t.size * 0.35 : 0;
  return [w + pad * 2, lines.length * t.size * t.lineHeight + pad * 2];
}

function drawText(L: CanvasRenderingContext2D, t: TextProps, s: FrameState) {
  const [w, h] = measureText(t);
  const lines = t.content.split("\n");
  L.font = fontOf(t);
  (L as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${t.letterSpacing}px`;
  const rtl = RTL.test(t.content);
  L.direction = rtl ? "rtl" : "ltr";
  L.textBaseline = "middle";
  const pad = t.background ? t.size * 0.35 : 0;
  if (t.background) {
    L.fillStyle = t.background;
    L.beginPath();
    L.roundRect(-w / 2, -h / 2, w, h, t.size * 0.2);
    L.fill();
  }
  // reveal (typewriter / word-by-word)
  let budget = Infinity;
  if (s.reveal < 1) {
    if (s.revealMode === "chars") budget = Math.floor(t.content.replace(/\n/g, "").length * s.reveal);
    else budget = Math.floor(t.content.split(/\s+/).length * s.reveal + 0.0001);
  }
  const lh = t.size * t.lineHeight;
  const innerW = w - pad * 2;
  lines.forEach((line, i) => {
    let text = line;
    if (budget !== Infinity) {
      if (s.revealMode === "chars") {
        text = [...line].slice(0, Math.max(0, budget)).join("");
        budget -= [...line].length;
      } else {
        const words = line.split(/\s+/);
        text = words.slice(0, Math.max(0, budget)).join(" ");
        budget -= words.length;
      }
    }
    if (!text) return;
    const y = -h / 2 + pad + lh * i + lh / 2;
    const x = t.align === "left" ? -innerW / 2 : t.align === "right" ? innerW / 2 : 0;
    L.textAlign = t.align;
    if (t.shadow > 0) {
      L.shadowColor = t.shadowColor;
      L.shadowBlur = t.shadow;
      L.shadowOffsetY = t.shadow / 4;
    }
    if (t.strokeWidth > 0) {
      L.lineJoin = "round";
      L.strokeStyle = t.strokeColor;
      L.lineWidth = t.strokeWidth * 2;
      L.strokeText(text, x, y);
      L.shadowColor = "transparent";
    }
    L.fillStyle = t.color;
    L.fillText(text, x, y);
    L.shadowColor = "transparent";
  });
}

/* ---------------- shapes ---------------- */
export function shapePath(L: CanvasRenderingContext2D | Path2D, sh: ShapeProps) {
  const w = sh.width, h = sh.height;
  const P = L as CanvasRenderingContext2D;
  switch (sh.type) {
    case "rect":
      P.roundRect(-w / 2, -h / 2, w, h, Math.min(sh.radius, w / 2, h / 2));
      break;
    case "circle":
      P.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case "triangle":
      P.moveTo(0, -h / 2);
      P.lineTo(w / 2, h / 2);
      P.lineTo(-w / 2, h / 2);
      P.closePath();
      break;
    case "star": {
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 1 : 0.42;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const px = Math.cos(a) * (w / 2) * r, py = Math.sin(a) * (h / 2) * r;
        if (i === 0) P.moveTo(px, py);
        else P.lineTo(px, py);
      }
      P.closePath();
      break;
    }
    case "heart":
      P.moveTo(0, h * 0.35);
      P.bezierCurveTo(-w * 0.55, -h * 0.05, -w * 0.35, -h * 0.55, 0, -h * 0.22);
      P.bezierCurveTo(w * 0.35, -h * 0.55, w * 0.55, -h * 0.05, 0, h * 0.35);
      P.closePath();
      break;
    case "arrow":
      P.moveTo(-w / 2, -h * 0.15);
      P.lineTo(w * 0.15, -h * 0.15);
      P.lineTo(w * 0.15, -h / 2);
      P.lineTo(w / 2, 0);
      P.lineTo(w * 0.15, h / 2);
      P.lineTo(w * 0.15, h * 0.15);
      P.lineTo(-w / 2, h * 0.15);
      P.closePath();
      break;
    case "line":
      P.rect(-w / 2, -Math.max(2, h) / 2, w, Math.max(2, h));
      break;
  }
}

function drawShape(L: CanvasRenderingContext2D, sh: ShapeProps) {
  L.beginPath();
  shapePath(L, sh);
  if (sh.gradient) {
    const g = L.createLinearGradient(0, -sh.height / 2, 0, sh.height / 2);
    g.addColorStop(0, sh.fill);
    g.addColorStop(1, sh.gradient);
    L.fillStyle = g;
  } else L.fillStyle = sh.fill;
  L.fill();
  if (sh.strokeWidth > 0) {
    L.strokeStyle = sh.stroke;
    L.lineWidth = sh.strokeWidth;
    L.stroke();
  }
}

/* ---------------- pixel effects ---------------- */
function chromaKey(c: Clip) {
  const w = layerCanvas.width, h = layerCanvas.height;
  // process at reduced resolution for speed, then mask the layer
  const k = Math.min(1, 640 / w);
  const kw = Math.max(1, Math.round(w * k)), kh = Math.max(1, Math.round(h * k));
  ensureSize(keyCanvas, kw, kh);
  keyCtx.clearRect(0, 0, kw, kh);
  keyCtx.drawImage(layerCanvas, 0, 0, kw, kh);
  const img = keyCtx.getImageData(0, 0, kw, kh);
  const d = img.data;
  const kr = parseInt(c.chroma.color.slice(1, 3), 16), kg = parseInt(c.chroma.color.slice(3, 5), 16), kb = parseInt(c.chroma.color.slice(5, 7), 16);
  const th = (c.chroma.threshold / 100) * 255, sm = Math.max(1, (c.chroma.smoothness / 100) * 255);
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.sqrt((d[i] - kr) ** 2 + (d[i + 1] - kg) ** 2 + (d[i + 2] - kb) ** 2);
    if (dist < th) d[i + 3] = 0;
    else if (dist < th + sm) d[i + 3] = Math.round(d[i + 3] * ((dist - th) / sm));
    // despill
    if (kg > kr && kg > kb && d[i + 1] > Math.max(d[i], d[i + 2])) d[i + 1] = Math.max(d[i], d[i + 2]);
  }
  keyCtx.putImageData(img, 0, 0);
  layer.save();
  layer.setTransform(1, 0, 0, 1, 0, 0);
  layer.clearRect(0, 0, w, h);
  layer.imageSmoothingEnabled = true;
  layer.drawImage(keyCanvas, 0, 0, w, h);
  layer.restore();
}

function applyLayerEffect(e: Effect, t: number, scale: number) {
  const w = layerCanvas.width, h = layerCanvas.height;
  const a = e.amount / 100;
  const L = layer;
  L.save();
  L.setTransform(1, 0, 0, 1, 0, 0);
  switch (e.type) {
    case "pixelate": {
      const block = Math.max(2, Math.round(4 + a * 40 * scale));
      const sw = Math.max(1, Math.round(w / block)), sh = Math.max(1, Math.round(h / block));
      ensureSize(fxCanvas, sw, sh);
      fx.clearRect(0, 0, sw, sh);
      fx.drawImage(layerCanvas, 0, 0, sw, sh);
      L.clearRect(0, 0, w, h);
      L.imageSmoothingEnabled = false;
      L.drawImage(fxCanvas, 0, 0, w, h);
      break;
    }
    case "mirror": {
      ensureSize(fxCanvas, w, h);
      fx.clearRect(0, 0, w, h);
      fx.drawImage(layerCanvas, 0, 0);
      L.clearRect(w / 2, 0, w / 2, h);
      L.translate(w, 0);
      L.scale(-1, 1);
      L.drawImage(fxCanvas, 0, 0, w / 2, h, 0, 0, w / 2, h);
      break;
    }
    case "glitch": {
      const frame = Math.floor(t * 12);
      if (noise(frame, 9) > 0.35 + (1 - a) * 0.5) {
        ensureSize(fxCanvas, w, h);
        fx.clearRect(0, 0, w, h);
        fx.drawImage(layerCanvas, 0, 0);
        const slices = 4 + Math.floor(noise(frame, 3) * 8);
        for (let i = 0; i < slices; i++) {
          const y = Math.floor(noise(frame, i + 10) * h);
          const sh = Math.max(2, Math.floor(noise(frame, i + 30) * h * 0.08));
          const dx = (noise(frame, i + 50) - 0.5) * w * 0.12 * a;
          L.clearRect(0, y, w, sh);
          L.drawImage(fxCanvas, 0, y, w, sh, dx, y, w, sh);
        }
      }
      if (a > 0.2) splitRGB(w, h, Math.round(a * 8 * scale * (noise(frame, 77) > 0.5 ? 1 : 0.3)));
      break;
    }
    case "rgbSplit":
      splitRGB(w, h, Math.round(a * 20 * scale));
      break;
    case "filmGrain": {
      if (!grain) {
        grain = document.createElement("canvas");
        grain.width = grain.height = 256;
        const g = grain.getContext("2d")!;
        const id = g.createImageData(256, 256);
        for (let i = 0; i < id.data.length; i += 4) {
          const v = Math.random() * 255;
          id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
          id.data[i + 3] = 255;
        }
        g.putImageData(id, 0, 0);
      }
      L.globalCompositeOperation = "source-atop";
      L.globalAlpha = a * 0.25;
      const pat = L.createPattern(grain, "repeat")!;
      pat.setTransform(new DOMMatrix().translate(noise(t, 1) * 256, noise(t, 2) * 256));
      L.fillStyle = pat;
      L.fillRect(0, 0, w, h);
      break;
    }
    case "letterbox": {
      const bar = h * 0.14 * a;
      L.fillStyle = "#000";
      L.fillRect(0, 0, w, bar);
      L.fillRect(0, h - bar, w, bar);
      break;
    }
  }
  L.restore();
}

function splitRGB(w: number, h: number, off: number) {
  if (off < 1) return;
  ensureSize(fxCanvas, w, h);
  // red channel copy
  fx.save();
  fx.globalCompositeOperation = "source-over";
  fx.clearRect(0, 0, w, h);
  fx.drawImage(layerCanvas, 0, 0);
  fx.globalCompositeOperation = "multiply";
  fx.fillStyle = "#ff0000";
  fx.fillRect(0, 0, w, h);
  fx.globalCompositeOperation = "destination-in";
  fx.drawImage(layerCanvas, 0, 0);
  fx.restore();
  // turn layer into cyan (G+B) copy
  layer.save();
  layer.globalCompositeOperation = "multiply";
  layer.fillStyle = "#00ffff";
  layer.fillRect(0, 0, w, h);
  layer.globalCompositeOperation = "destination-in";
  layer.drawImage(fxCanvas, 0, 0); // keeps alpha roughly
  layer.restore();
  // recombine shifted channels
  ensureSize(tmpCanvas, w, h);
  const tc = tmpCtx;
  tc.globalCompositeOperation = "source-over";
  tc.clearRect(0, 0, w, h);
  tc.drawImage(layerCanvas, off, 0);
  tc.globalCompositeOperation = "lighter";
  tc.drawImage(fxCanvas, -off, 0);
  layer.clearRect(0, 0, w, h);
  layer.drawImage(tmpCanvas, 0, 0);
}

/** hit-test in project coords: returns topmost clip id */
export function hitTest(p: Project, x: number, y: number): string | null {
  const order = p.tracks.filter((t) => t.kind === "video" && !t.hidden && !t.locked).map((t) => t.id);
  let best: { id: string; rank: number } | null = null;
  for (const [id, b] of lastBounds) {
    const c = p.clips.find((cc) => cc.id === id);
    if (!c) continue;
    const rank = order.indexOf(c.trackId);
    if (rank < 0) continue;
    const r = (-b.rotation * Math.PI) / 180;
    const dx = x - b.x, dy = y - b.y;
    const lx = (dx * Math.cos(r) - dy * Math.sin(r)) / b.sx;
    const ly = (dx * Math.sin(r) + dy * Math.cos(r)) / b.sy;
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2 && (!best || rank < best.rank)) best = { id, rank };
  }
  return best?.id ?? null;
}
