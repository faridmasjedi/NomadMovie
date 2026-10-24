import type { MediaItem } from "../types";
import { uid } from "../factory";
import { audioEngine } from "./audio";
import { loadLottie } from "./lottie";

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

// what Chromium plays natively; everything else goes through the local engine (ffmpeg / sips)
const NATIVE: Record<MediaItem["kind"], RegExp> = {
  video: /\.(mp4|m4v|mov|webm)$/i,
  audio: /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba)$/i,
  image: /\.(png|jpe?g|jfif|gif|webp|svg|bmp|avif|ico)$/i,
};
const EXT: Record<MediaItem["kind"], RegExp> = {
  video: /\.(mp4|m4v|mov|qt|webm|mkv|avi|wmv|asf|flv|f4v|mpg|mpeg|mpe|m1v|m2v|m2p|m2ts|mts|ts|m2t|tod|mod|vob|3gp|3g2|ogv|mxf|divx|xvid|rm|rmvb|dv|y4m|hevc|h264|264|265|nut|amv|mjpeg|gifv|dvr-ms|wtv|bik)$/i,
  audio: /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|weba|wma|aif|aiff|aifc|ac3|eac3|dts|amr|awb|ape|caf|alac|mka|au|snd|ra|wv|tta|mpc|mp2|m4b|m4r|w64|voc|gsm|spx|mid|midi)$/i,
  image: /\.(png|jpe?g|jfif|gif|webp|svg|bmp|avif|ico|heic|heif|tiff?|psd|tga|exr|jp2|j2k|jxl|cr2|cr3|nef|nrw|arw|srf|sr2|dng|orf|rw2|raf|pef|srw|x3f|3fr|erf|kdc|mrw|raw|rwl|iiq|pcx|ppm|pgm|pbm|hdr|dds|icns|pict|pct|sgi)$/i,
};

export const ACCEPTED_FORMATS_HINT =
  "Video: MP4, MOV, MKV, AVI, WMV, FLV, MPEG, MTS/M2TS, WebM, 3GP, MXF, ProRes, HEVC… · Audio: MP3, WAV, FLAC, AAC, M4A, OGG, WMA, AIFF, AC3, OPUS… · Photos: JPG, PNG, HEIC, RAW (CR2/NEF/ARW/DNG…), PSD, TIFF, WebP, GIF, SVG… · Animations: Lottie (.json)";

const kindOf = (type: string, name: string): MediaItem["kind"] | null => {
  for (const k of ["video", "audio", "image"] as const) if (EXT[k].test(name)) return k;
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("image/")) return "image";
  return null;
};

export type ImportProgress = (stage: string, progress: number) => void;

const MIME: Record<string, string> = { mp4: "video/mp4", flac: "audio/flac", jpg: "image/jpeg", png: "image/png" };

/** converts any file on the local engine; returns a browser-playable blob */
async function convertOnEngine(file: Blob, name: string, force: boolean, onProgress?: ImportProgress) {
  onProgress?.("Sending to converter", 0);
  const res = await fetch(`/api/import?name=${encodeURIComponent(name)}${force ? "&force=1" : ""}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Converter is not available");
  const { id } = await res.json();
  for (;;) {
    await new Promise((r) => setTimeout(r, 350));
    const st = await (await fetch(`/api/import/${id}`)).json();
    if (st.status === "error") throw new Error(st.error ?? "Conversion failed");
    onProgress?.(st.stage, st.progress);
    if (st.status === "done") {
      const out = await fetch(`/api/import/${id}/file`);
      const ext = String(st.name).split(".").pop()!.toLowerCase();
      // arrayBuffer, not blob(): large response blobs fail in Chrome when disk space is low
      const blob = new Blob([await out.arrayBuffer()], { type: MIME[ext] ?? "application/octet-stream" });
      return { blob, name: st.name as string, kind: st.kind as MediaItem["kind"], hasAudio: !!st.hasAudio };
    }
  }
}

class NeedsEngine extends Error {}

export async function importFile(file: Blob & { name?: string }, id = uid("med"), knownName?: string, onProgress?: ImportProgress): Promise<MediaItem | null> {
  const name = knownName ?? (file as File).name ?? "media";
  // Lottie animation (.json exported from After Effects / LottieFiles)
  if (/\.json$/i.test(name) || file.type === "application/json") return loadLottie(file, id, name);
  let kind = kindOf(file.type, name);
  let src: Blob = file, srcName = name, expectAudio: boolean | undefined;
  const state: { converted: "" | "remux" | "forced" } = { converted: "" };
  const viaEngine = async (force: boolean) => {
    const r = await convertOnEngine(file, name, force, onProgress);
    src = r.blob;
    srcName = r.name;
    kind = r.kind;
    expectAudio = r.hasAudio;
    state.converted = force ? "forced" : "remux";
  };
  // unknown extension or a format Chromium can't open → convert first
  if (!kind || !NATIVE[kind].test(name)) await viaEngine(false);
  for (;;) {
    try {
      return await loadMedia(src, id, srcName, kind!, expectAudio);
    } catch (e) {
      if (!(e instanceof NeedsEngine) || state.converted === "forced") throw e instanceof NeedsEngine ? new Error(`Could not open ${name}`) : e;
      // native attempt failed (e.g. ProRes .mov, AC-3 audio) or a remux wasn't enough → re-encode
      await viaEngine(state.converted === "remux");
    }
  }
}

async function loadMedia(file: Blob, id: string, name: string, kind: MediaItem["kind"], expectAudio?: boolean): Promise<MediaItem> {
  const url = URL.createObjectURL(file);
  const item: MediaItem = { id, name, kind, url, duration: 0, width: 0, height: 0, hasAudio: kind !== "image", blob: file };
  const fail = () => {
    URL.revokeObjectURL(url);
    return new NeedsEngine();
  };

  if (kind === "video") {
    const v = document.createElement("video");
    v.muted = true;
    v.preload = "auto";
    v.src = url;
    const ok = await new Promise<boolean>((res) => {
      v.onloadeddata = () => res(true);
      v.onerror = () => res(false);
      setTimeout(() => res(v.readyState >= 1), 15000);
    });
    if (!ok || !v.videoWidth || !isFinite(v.duration)) throw fail();
    item.duration = v.duration;
    item.width = v.videoWidth;
    item.height = v.videoHeight;
    item.thumb = await captureThumb(v, Math.min(1, v.duration / 3));
    if (expectAudio === undefined && /\.(mp4|m4v|mov)$/i.test(name)) expectAudio = await mp4HasAudio(file);
  } else if (kind === "image") {
    const img = new Image();
    img.src = url;
    const ok = await img.decode().then(() => true, () => false);
    if (!ok || !img.naturalWidth) throw fail();
    item.width = img.naturalWidth;
    item.height = img.naturalHeight;
    item.duration = 5;
    item.thumb = url;
  }

  if (kind !== "image" && expectAudio !== false) {
    try {
      const buf = await audioEngine.decode(id, await file.arrayBuffer());
      if (kind === "audio") item.duration = buf.duration;
      const pps = 50;
      item.peaks = computePeaks(buf, pps);
      item.peaksPerSec = pps;
    } catch {
      // the file has sound we can't decode (e.g. AC-3 / DTS) → let the engine convert it
      if (kind === "audio" || expectAudio === true) throw fail();
      item.hasAudio = false;
    }
  } else if (kind !== "image") item.hasAudio = false;
  return item;
}

/** does an MP4/MOV contain an audio track? (avoids treating silent clips as undecodable) */
async function mp4HasAudio(file: Blob): Promise<boolean | undefined> {
  const { default: MP4Box } = await import("mp4box");
  return new Promise((resolve) => {
    const f = MP4Box.createFile();
    f.onReady = (info: { audioTracks: unknown[] }) => resolve(info.audioTracks.length > 0);
    f.onError = () => resolve(undefined);
    file.arrayBuffer().then((buf) => {
      (buf as ArrayBuffer & { fileStart: number }).fileStart = 0;
      try {
        f.appendBuffer(buf);
        f.flush();
      } catch {
        resolve(undefined);
      }
      setTimeout(() => resolve(undefined), 100);
    });
  });
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
