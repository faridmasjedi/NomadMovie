import type { MediaItem } from "../types";
import { uid } from "../factory";
import { audioEngine } from "./audio";

/** ------------ element caches used by the renderer ------------ */
const videos = new Map<string, HTMLVideoElement>(); // key: clipId
const images = new Map<string, HTMLImageElement>(); // key: mediaId or svg hash
let onFrameReady: () => void = () => {};
export const setFrameReadyListener = (fn: () => void) => (onFrameReady = fn);

export function getVideo(clipId: string, url: string): HTMLVideoElement {
  let v = videos.get(clipId);
  if (v && v.dataset.src !== url) {
    v.pause();
    v = undefined;
  }
  if (!v) {
    v = document.createElement("video");
    v.dataset.src = url;
    v.src = url;
    v.muted = true; // sound is played by the Web Audio engine
    v.playsInline = true;
    v.preload = "auto";
    v.addEventListener("seeked", () => onFrameReady());
    v.addEventListener("loadeddata", () => onFrameReady());
    videos.set(clipId, v);
  }
  return v;
}

export function pauseVideosExcept(active: Set<string>) {
  for (const [id, v] of videos) if (!active.has(id) && !v.paused) v.pause();
}

export function allVideos() {
  return videos;
}

export function getImage(key: string, url: string): HTMLImageElement {
  let img = images.get(key);
  if (!img) {
    img = new Image();
    img.decoding = "async";
    img.onload = () => onFrameReady();
    img.src = url;
    images.set(key, img);
  }
  return img;
}

const svgUrls = new Map<string, string>();
export function getSvgImage(svg: string): HTMLImageElement {
  let url = svgUrls.get(svg);
  if (!url) {
    url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    svgUrls.set(svg, url);
  }
  return getImage(`svg:${url}`, url);
}

/** ------------ import ------------ */
const kindOf = (type: string, name: string): MediaItem["kind"] | null => {
  if (type.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(name)) return "video";
  if (type.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return "audio";
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name)) return "image";
  return null;
};

export async function importFile(file: Blob & { name?: string }, id = uid("med"), knownName?: string): Promise<MediaItem | null> {
  const name = knownName ?? (file as File).name ?? "media";
  const kind = kindOf(file.type, name);
  if (!kind) return null;
  const url = URL.createObjectURL(file);
  const item: MediaItem = { id, name, kind, url, duration: 0, width: 0, height: 0, hasAudio: kind !== "image", blob: file };

  if (kind === "video") {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = url;
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error("Unsupported video format"));
    });
    item.duration = v.duration;
    item.width = v.videoWidth;
    item.height = v.videoHeight;
    item.thumb = await captureThumb(v, Math.min(1, v.duration / 3));
  } else if (kind === "image") {
    const img = new Image();
    img.src = url;
    await img.decode();
    item.width = img.naturalWidth || 1000;
    item.height = img.naturalHeight || 1000;
    item.duration = 5;
    item.thumb = url;
  }

  if (kind !== "image") {
    try {
      const buf = await audioEngine.decode(id, await file.arrayBuffer());
      if (kind === "audio") item.duration = buf.duration;
      const pps = 50;
      item.peaks = computePeaks(buf, pps);
      item.peaksPerSec = pps;
    } catch {
      item.hasAudio = false; // video without an audio track
    }
  }
  return item;
}

async function captureThumb(v: HTMLVideoElement, t: number): Promise<string> {
  v.currentTime = t;
  await new Promise<void>((res) => {
    const done = () => res();
    v.onseeked = done;
    setTimeout(done, 1500);
  });
  const c = document.createElement("canvas");
  const ratio = v.videoWidth / v.videoHeight || 16 / 9;
  c.height = 90;
  c.width = Math.round(90 * ratio);
  c.getContext("2d")!.drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

export function computePeaks(buf: AudioBuffer, perSec: number): Float32Array {
  const n = Math.ceil(buf.duration * perSec);
  const out = new Float32Array(n);
  const step = buf.sampleRate / perSec;
  const chans = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i));
  for (let i = 0; i < n; i++) {
    let max = 0;
    const s0 = Math.floor(i * step), s1 = Math.min(buf.length, Math.floor((i + 1) * step));
    for (const ch of chans) for (let s = s0; s < s1; s += 4) max = Math.max(max, Math.abs(ch[s]));
    out[i] = max;
  }
  return out;
}

/** snapshot frame of any media at time (used for AI vision, thumbnails) */
export function canvasToJpeg(c: HTMLCanvasElement, maxW = 1024, q = 0.8): string {
  const scale = Math.min(1, maxW / c.width);
  const t = document.createElement("canvas");
  t.width = Math.round(c.width * scale);
  t.height = Math.round(c.height * scale);
  t.getContext("2d")!.drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", q);
}
