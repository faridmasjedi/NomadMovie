import type { Clip, MediaItem } from "../types";
import { audioEngine } from "./audio";

export interface Range {
  start: number;
  end: number;
}

/** mono RMS envelope of a buffer region, window seconds */
function envelope(buf: AudioBuffer, from: number, to: number, win = 0.02) {
  const sr = buf.sampleRate;
  const s0 = Math.max(0, Math.floor(from * sr)), s1 = Math.min(buf.length, Math.floor(to * sr));
  const step = Math.max(1, Math.floor(win * sr));
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const out: number[] = [];
  for (let s = s0; s < s1; s += step) {
    let sum = 0, n = 0;
    for (let i = s; i < Math.min(s + step, s1); i += 2) {
      let v = 0;
      for (const ch of chans) v += ch[i];
      v /= chans.length;
      sum += v * v;
      n++;
    }
    out.push(Math.sqrt(sum / Math.max(1, n)));
  }
  return { env: out, win: step / sr };
}

const toDb = (x: number) => 20 * Math.log10(Math.max(1e-9, x));

/**
 * Speech/sound segments inside the clip's used source range, returned in CLIP-LOCAL timeline seconds.
 * Threshold is adaptive: relative to the clip's loud level.
 */
export function soundSegments(c: Clip, opts: { thresholdDb?: number; minSilence?: number; pad?: number } = {}): Range[] {
  const buf = c.mediaId ? audioEngine.buffers.get(c.mediaId) : undefined;
  if (!buf) return [];
  const srcFrom = c.offset, srcTo = Math.min(buf.duration, c.offset + c.duration * c.speed);
  const { env, win } = envelope(buf, srcFrom, srcTo);
  if (!env.length) return [];
  const sorted = [...env].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 0;
  const thr = opts.thresholdDb !== undefined ? Math.pow(10, opts.thresholdDb / 20) : Math.max(loud * Math.pow(10, -26 / 20), 0.003);
  const minSil = opts.minSilence ?? 0.45;
  const pad = opts.pad ?? 0.12;
  const segs: Range[] = [];
  let cur: Range | null = null;
  let quiet = 0;
  env.forEach((v, i) => {
    const t = i * win;
    if (v >= thr) {
      if (!cur) cur = { start: t, end: t + win };
      else cur.end = t + win;
      quiet = 0;
    } else if (cur) {
      quiet += win;
      if (quiet >= minSil) {
        segs.push(cur);
        cur = null;
      }
    }
  });
  if (cur) segs.push(cur);
  const total = (srcTo - srcFrom);
  // pad, merge, convert from source seconds to clip-local timeline seconds
  const merged: Range[] = [];
  for (const s of segs) {
    const r = { start: Math.max(0, s.start - pad), end: Math.min(total, s.end + pad) };
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push(r);
  }
  return merged.map((r) => ({ start: r.start / c.speed, end: r.end / c.speed })).filter((r) => r.end - r.start > 0.08);
}

/** beat/onset detection on the clip; returns clip-local times */
export function detectBeats(c: Clip): number[] {
  const buf = c.mediaId ? audioEngine.buffers.get(c.mediaId) : undefined;
  if (!buf) return [];
  const { env, win } = envelope(buf, c.offset, Math.min(buf.duration, c.offset + c.duration * c.speed), 0.023);
  const flux = env.map((v, i) => Math.max(0, v - (env[i - 1] ?? 0)));
  const beats: number[] = [];
  const W = Math.round(0.5 / win);
  let lastBeat = -1;
  for (let i = 1; i < flux.length - 1; i++) {
    let mean = 0, n = 0;
    for (let j = Math.max(0, i - W); j < Math.min(flux.length, i + W); j++) { mean += flux[j]; n++; }
    mean /= n;
    const t = i * win;
    if (flux[i] > mean * 2.2 && flux[i] > flux[i - 1] && flux[i] >= flux[i + 1] && flux[i] > 0.01 && t - lastBeat > 0.28) {
      beats.push(t / c.speed);
      lastBeat = t;
    }
  }
  return beats;
}

/** gain multiplier to bring the clip to a target RMS level (≈ -16 dBFS RMS of active parts) */
export function normalizeGain(c: Clip, targetDb = -16): number {
  const buf = c.mediaId ? audioEngine.buffers.get(c.mediaId) : undefined;
  if (!buf) return 1;
  const { env } = envelope(buf, c.offset, Math.min(buf.duration, c.offset + c.duration * c.speed), 0.05);
  const active = env.filter((v) => toDb(v) > -50);
  if (!active.length) return 1;
  const rms = Math.sqrt(active.reduce((s, v) => s + v * v, 0) / active.length);
  return Math.min(4, Math.max(0.1, Math.pow(10, (targetDb - toDb(rms)) / 20)));
}

/** scene cut detection by sampling frames of a video; returns clip-local times */
export async function detectScenes(c: Clip, m: MediaItem, onProgress?: (p: number) => void): Promise<number[]> {
  const v = document.createElement("video");
  v.muted = true;
  v.src = m.url;
  await new Promise((r) => (v.onloadeddata = r));
  const cw = 64, chh = 36;
  const can = document.createElement("canvas");
  can.width = cw;
  can.height = chh;
  const g = can.getContext("2d", { willReadFrequently: true })!;
  const step = 0.2;
  let prev: Float32Array | null = null;
  const cuts: number[] = [];
  const diffs: { t: number; d: number }[] = [];
  const srcDur = c.duration * c.speed;
  for (let s = 0; s < srcDur; s += step) {
    v.currentTime = c.offset + s;
    await new Promise((r) => (v.onseeked = r));
    g.drawImage(v, 0, 0, cw, chh);
    const d = g.getImageData(0, 0, cw, chh).data;
    // 3x16-bin histogram
    const hist = new Float32Array(48);
    for (let i = 0; i < d.length; i += 4) {
      hist[d[i] >> 4]++;
      hist[16 + (d[i + 1] >> 4)]++;
      hist[32 + (d[i + 2] >> 4)]++;
    }
    const n = cw * chh;
    for (let i = 0; i < 48; i++) hist[i] /= n;
    if (prev) {
      let diff = 0;
      for (let i = 0; i < 48; i++) diff += Math.abs(hist[i] - prev[i]);
      diffs.push({ t: s, d: diff / 3 });
    }
    prev = hist;
    onProgress?.(s / srcDur);
  }
  const mean = diffs.reduce((a, b) => a + b.d, 0) / Math.max(1, diffs.length);
  let last = -10;
  for (const { t, d } of diffs) {
    if (d > Math.max(0.35, mean * 3) && t - last > 0.8) {
      cuts.push(t / c.speed);
      last = t;
    }
  }
  v.src = "";
  return cuts;
}
