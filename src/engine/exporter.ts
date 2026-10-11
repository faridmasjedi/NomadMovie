import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { MediaItem, Project } from "../types";
import { audioEngine, encodeWav } from "./audio";
import { renderFrame, prepareVideosAt } from "./render";
import { allVideos, getImage, getSvgImage } from "./media";
import { FrameSource } from "./decoder";
import { isVisibleAt, visibleWindow } from "./timeline";

export type ExportFormat = "mp4" | "webm" | "mov" | "gif" | "mp3" | "wav";

export interface ExportOptions {
  format: ExportFormat;
  scale: number; // 0.5 / 1 / ...
  fps: number;
  quality: "low" | "medium" | "high";
  from: number;
  to: number;
  onProgress: (p: number, label: string) => void;
  signal: { cancelled: boolean };
  serverFfmpeg: boolean;
}

export function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}

async function convert(parts: Blob[], q: { format: string; fps: number; quality: string; duration?: number; vlen?: number; copy?: boolean }) {
  const params = new URLSearchParams({
    format: q.format,
    fps: String(q.fps),
    quality: q.quality,
    duration: String(q.duration ?? 0),
    ...(q.vlen ? { vlen: String(q.vlen) } : {}),
    ...(q.copy ? { copy: "1" } : {}),
  });
  const res = await fetch(`/api/convert?${params}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: new Blob(parts),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "ffmpeg conversion failed");
  return res.blob();
}

export async function exportProject(p: Project, media: Record<string, MediaItem>, o: ExportOptions): Promise<Blob> {
  const dur = o.to - o.from;
  if (dur <= 0) throw new Error("The timeline is empty");

  if (o.format === "wav" || o.format === "mp3") {
    o.onProgress(0.2, "Mixing audio…");
    const wav = encodeWav(await audioEngine.mixdown(p, media, o.from, o.to));
    if (o.format === "wav") return wav;
    if (!o.serverFfmpeg) throw new Error("MP3 export needs ffmpeg");
    o.onProgress(0.7, "Converting to MP3…");
    return convert([wav], { format: "mp3", fps: o.fps, quality: o.quality });
  }

  if (o.serverFfmpeg && "VideoEncoder" in window) {
    const codec = await pickCodec(Math.round(p.width * o.scale / 2) * 2, Math.round(p.height * o.scale / 2) * 2, o.fps);
    if (codec) return fastExport(p, media, o, codec);
  }
  return realtimeExport(p, media, o);
}

/* ------------------------------------------------------------------------------------------------
 * Fast export: renders every frame as fast as the machine can (no playback), hardware-encodes it
 * with WebCodecs, mixes audio offline, then ffmpeg muxes both (stream copy for MP4/MOV).
 * ---------------------------------------------------------------------------------------------- */

interface CodecChoice {
  codec: string;
  muxCodec: "avc" | "vp9";
  bitrate: (q: ExportOptions["quality"], w: number, h: number) => number;
}

async function pickCodec(width: number, height: number, fps: number): Promise<CodecChoice | null> {
  const bitrate = (q: ExportOptions["quality"], w: number, h: number) =>
    Math.round({ low: 5, medium: 12, high: 24 }[q] * 1_000_000 * Math.max(0.35, (w * h) / (1920 * 1080)) * Math.max(1, fps / 30));
  const options: CodecChoice[] = [
    { codec: "avc1.640034", muxCodec: "avc", bitrate }, // H.264 High @ L5.2 (up to 4K)
    { codec: "avc1.4d0034", muxCodec: "avc", bitrate },
    { codec: "avc1.42003e", muxCodec: "avc", bitrate },
    { codec: "vp09.00.51.08", muxCodec: "vp9", bitrate },
  ];
  for (const c of options) {
    for (const hw of ["prefer-hardware", "no-preference"] as const) {
      try {
        const r = await VideoEncoder.isConfigSupported({ codec: c.codec, width, height, bitrate: c.bitrate("high", width, height), framerate: fps, hardwareAcceleration: hw });
        if (r.supported) return c;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

async function preloadStills(p: Project, media: Record<string, MediaItem>) {
  await document.fonts.ready;
  const imgs: HTMLImageElement[] = [];
  for (const c of p.clips) {
    if (c.kind !== "image") continue;
    if (c.svg) imgs.push(getSvgImage(c.svg));
    else if (c.mediaId && media[c.mediaId]) imgs.push(getImage(c.mediaId, media[c.mediaId].url));
  }
  await Promise.all(imgs.map((i) => i.decode().catch(() => {})));
}

async function fastExport(p: Project, media: Record<string, MediaItem>, o: ExportOptions, choice: CodecChoice): Promise<Blob> {
  const width = Math.round(p.width * o.scale / 2) * 2;
  const height = Math.round(p.height * o.scale / 2) * 2;
  const total = Math.max(1, Math.round((o.to - o.from) * o.fps));
  const t0 = performance.now();

  o.onProgress(0.01, "Mixing audio…");
  const wav = encodeWav(await audioEngine.mixdown(p, media, o.from, o.to));
  await preloadStills(p, media);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false })!;

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: choice.muxCodec, width, height, frameRate: o.fps },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  encoder.configure({
    codec: choice.codec,
    width,
    height,
    bitrate: choice.bitrate(o.quality, width, height),
    framerate: o.fps,
    hardwareAcceleration: "prefer-hardware",
    latencyMode: "quality",
    ...(choice.muxCodec === "avc" ? { avc: { format: "avc" as const } } : {}),
  });

  const frameDur = 1e6 / o.fps;
  // per-clip sequential decoders (null = format not decodable → falls back to seeking the <video>)
  const sources = new Map<string, FrameSource | null>();
  const frames = new Map<string, VideoFrame | null>();
  const videoClips = p.clips.filter((c) => c.kind === "video" && c.mediaId && media[c.mediaId] && !p.tracks.find((t) => t.id === c.trackId)?.hidden);
  try {
    for (let i = 0; i < total; i++) {
      if (o.signal.cancelled) throw new Error("Cancelled");
      if (encodeError) throw encodeError;
      const t = o.from + i / o.fps;
      frames.clear();
      for (const c of videoClips) {
        if (!isVisibleAt(p, c, t)) {
          if (t >= visibleWindow(p, c)[1] && sources.get(c.id)) {
            sources.get(c.id)!.close();
            sources.set(c.id, null);
          }
          continue;
        }
        if (!sources.has(c.id)) {
          const m = media[c.mediaId!];
          sources.set(c.id, await FrameSource.open(m.id, m.blob, m.name));
        }
        const src = sources.get(c.id);
        if (src) frames.set(c.id, await src.frameAt(Math.max(0, c.offset + (t - c.start) * c.speed)));
      }
      await prepareVideosAt(p, media, t, frames);
      renderFrame(ctx, p, media, t, { playing: false, exporting: true, scale: o.scale, frames });
      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
      encoder.encode(frame, { keyFrame: i % (o.fps * 2) === 0 });
      frame.close();
      // backpressure: let the encoder drain
      while (encoder.encodeQueueSize > 6) await new Promise((r) => encoder.addEventListener("dequeue", r, { once: true }));
      if (i % 5 === 0) {
        const elapsed = (performance.now() - t0) / 1000;
        const speed = (i + 1) / o.fps / Math.max(0.001, elapsed);
        o.onProgress(0.02 + (i / total) * 0.88, `Rendering frame ${i + 1} / ${total}  ·  ${speed.toFixed(1)}× real-time`);
        await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
      }
    }
    await encoder.flush();
  } finally {
    for (const src of sources.values()) src?.close();
    if (encoder.state !== "closed") encoder.close();
    for (const v of allVideos().values()) v.pause();
  }
  muxer.finalize();
  const video = new Blob([muxer.target.buffer], { type: "video/mp4" });

  o.onProgress(0.92, o.format === "mp4" || o.format === "mov" ? "Muxing audio…" : `Encoding ${o.format.toUpperCase()}…`);
  return convert([video, wav], {
    format: o.format,
    fps: o.fps,
    quality: o.quality,
    duration: o.to - o.from,
    vlen: video.size,
    copy: choice.muxCodec === "avc" && (o.format === "mp4" || o.format === "mov"),
  });
}

/* ------------------------------------------------------------------------------------------------
 * Fallback: real-time capture with MediaRecorder (used only when WebCodecs or ffmpeg is missing).
 * ---------------------------------------------------------------------------------------------- */
async function realtimeExport(p: Project, media: Record<string, MediaItem>, o: ExportOptions): Promise<Blob> {
  const dur = o.to - o.from;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(p.width * o.scale / 2) * 2;
  canvas.height = Math.round(p.height * o.scale / 2) * 2;
  const ctx = canvas.getContext("2d")!;

  await prepareVideosAt(p, media, o.from);
  renderFrame(ctx, p, media, o.from, { playing: false, exporting: true, scale: o.scale });

  const stream = canvas.captureStream(o.fps);
  for (const tr of audioEngine.recordDest.stream.getAudioTracks()) stream.addTrack(tr);
  const mime = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((m) =>
    MediaRecorder.isTypeSupported(m),
  )!;
  const bits = { low: 4, medium: 10, high: 24 }[o.quality] * 1_000_000 * Math.max(0.5, o.scale * o.scale);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bits, audioBitsPerSecond: 192_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((r) => (rec.onstop = () => r()));

  await audioEngine.play(p, media, o.from);
  rec.start(500);
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = audioEngine.time();
      if (o.signal.cancelled || t >= o.to) return resolve();
      renderFrame(ctx, p, media, t, { playing: true, exporting: true, scale: o.scale });
      o.onProgress(((t - o.from) / dur) * 0.85, "Recording in real time…");
      requestAnimationFrame(tick);
    };
    tick();
  });
  audioEngine.stop();
  // keep painting the final frame briefly so the encoder flushes everything
  const tailEnd = performance.now() + 500;
  while (performance.now() < tailEnd) {
    renderFrame(ctx, p, media, Math.max(o.from, o.to - 1 / o.fps), { playing: false, exporting: true, scale: o.scale });
    await new Promise((r) => requestAnimationFrame(r));
  }
  rec.stop();
  for (const v of allVideos().values()) v.pause();
  await stopped;
  if (o.signal.cancelled) throw new Error("Cancelled");

  const recorded = new Blob(chunks, { type: mime.split(";")[0] });
  const native = mime.startsWith("video/mp4") ? "mp4" : "webm";
  if (!o.serverFfmpeg) {
    if (o.format === native) return recorded;
    throw new Error(`${o.format.toUpperCase()} export needs ffmpeg; only ${native.toUpperCase()} is available`);
  }
  o.onProgress(0.9, "Final encode with ffmpeg…");
  return convert([recorded], { format: o.format, fps: o.fps, quality: o.quality, duration: dur });
}

export async function snapshotPng(p: Project, media: Record<string, MediaItem>, t: number) {
  const canvas = document.createElement("canvas");
  canvas.width = p.width;
  canvas.height = p.height;
  const ctx = canvas.getContext("2d")!;
  await preloadStills(p, media);
  await prepareVideosAt(p, media, t);
  renderFrame(ctx, p, media, t, { playing: false, exporting: true });
  return new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
}
