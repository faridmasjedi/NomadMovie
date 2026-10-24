// Universal media import: anything ffmpeg (or macOS `sips` for photos) can read is converted into a
// format the editor's Chromium engine plays natively. Compatible codecs are remuxed (fast);
// everything else is transcoded. Jobs run in the background and report progress.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import type { Request, Response, Express } from "express";

interface Probe {
  duration: number;
  video?: { codec: string; width: number; height: number; isImage: boolean };
  audio?: { codec: string };
}

interface Job {
  id: string;
  status: "running" | "done" | "error";
  progress: number; // 0..1
  stage: string;
  error?: string;
  dir: string;
  output?: string;
  outName?: string;
  kind?: "video" | "audio" | "image";
  hasAudio?: boolean;
  createdAt: number;
}

const jobs = new Map<string, Job>();

const IMAGE_EXT = /\.(heic|heif|tiff?|psd|tga|exr|jp2|j2k|ico|cr2|cr3|nef|nrw|arw|srf|sr2|dng|orf|rw2|raf|pef|srw|x3f|3fr|erf|kdc|mrw|raw|rwl|iiq|jxl|pcx|ppm|pgm|pbm|xbm|dds|hdr|bmp|avif|webp|gif|png|jpe?g)$/i;
const SIPS_EXT = /\.(heic|heif|tiff?|psd|tga|exr|jp2|j2k|ico|cr2|cr3|nef|nrw|arw|srf|sr2|dng|orf|rw2|raf|pef|srw|x3f|3fr|erf|kdc|mrw|raw|rwl|iiq|bmp|gif|png|jpe?g|webp|avif|hdr|pict|pct|sgi|icns)$/i;
const ALPHA_EXT = /\.(png|psd|tga|tiff?|exr|ico|icns|webp|gif)$/i;

function parseProbe(stderr: string): Probe {
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
  const p: Probe = { duration };
  for (const line of stderr.split("\n")) {
    const m = /Stream #\d+:\d+.*?: (Video|Audio): ([a-z0-9_]+)/i.exec(line);
    if (!m) continue;
    if (m[1] === "Video" && !p.video) {
      const wh = /, (\d{2,5})x(\d{2,5})/.exec(line);
      const attached = /attached pic/.test(line);
      if (attached && /Audio:/.test(stderr)) continue; // album art inside an audio file
      p.video = { codec: m[2], width: wh ? +wh[1] : 0, height: wh ? +wh[2] : 0, isImage: attached || /^(png|mjpeg|bmp|tiff|webp|gif|jpeg2000|targa|psd|exr|pcx|ppm|pgm|sgi)$/.test(m[2]) && duration < 0.5 };
    }
    if (m[1] === "Audio" && !p.audio) p.audio = { codec: m[2] };
  }
  return p;
}

function run(bin: string, args: string[], onStderr?: (chunk: string) => void) {
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      err = (err + s).slice(-20000);
      onStderr?.(s);
    });
    proc.on("error", reject);
    proc.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(err.split("\n").filter(Boolean).slice(-3).join(" ") || `${path.basename(bin)} exited with ${code}`))));
  });
}

async function probe(ffmpeg: string, file: string) {
  // `ffmpeg -i` without an output exits with an error but prints the stream info we need
  const out = await new Promise<string>((resolve) => {
    const proc = spawn(ffmpeg, ["-hide_banner", ...SAFE_INPUT, "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let s = "";
    proc.stderr.on("data", (d) => (s += d));
    proc.on("close", () => resolve(s));
    proc.on("error", () => resolve(s));
  });
  if (LINKING_FORMATS.test(out)) throw new Error("Playlists and file lists can't be imported — import the media files themselves");
  return parseProbe(out);
}

/** input options for files we didn't create: local files only, no network or other protocols */
export const SAFE_INPUT = ["-protocol_whitelist", "file,pipe"];
/** container formats that point at other files or URLs (playlists, concat lists) — never followed */
const LINKING_FORMATS = /^Input #0, (hls|dash|concat|ffconcat|webm_dash_manifest|tee|sdp|rtsp|rtp)\b/m;

/** codecs the editor can play from an MP4 container without re-encoding */
const COPY_VIDEO = new Set(["h264", "hevc", "vp9", "av1"]);
const COPY_AUDIO = new Set(["aac", "mp3"]);

async function convert(job: Job, ffmpeg: string | null, input: string, name: string, force: boolean) {
  const base = name.replace(/\.[^.]+$/, "") || "media";
  const ext = path.extname(name).toLowerCase();
  const progressFrom = (dur: number) => (chunk: string) => {
    const m = /time=(\d+):(\d+):([\d.]+)/.exec(chunk);
    if (m && dur > 0) job.progress = Math.min(0.99, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / dur);
  };

  // photos: macOS `sips` handles HEIC, RAW camera files, PSD, TIFF…; ffmpeg as fallback
  if (IMAGE_EXT.test(ext) && (!ffmpeg || SIPS_EXT.test(ext))) {
    const fmt = ALPHA_EXT.test(ext) ? "png" : "jpeg";
    const out = path.join(job.dir, `${base}.${fmt === "png" ? "png" : "jpg"}`);
    job.stage = "Converting photo";
    try {
      if (process.platform !== "darwin" || !SIPS_EXT.test(ext)) throw new Error("no sips");
      await run("/usr/bin/sips", ["-s", "format", fmt, ...(fmt === "jpeg" ? ["-s", "formatOptions", "92"] : []), input, "--out", out]);
    } catch {
      if (!ffmpeg) throw new Error("Cannot convert this image");
      await run(ffmpeg, ["-y", ...SAFE_INPUT, "-i", input, "-frames:v", "1", ...(fmt === "jpeg" ? ["-q:v", "2"] : []), out]);
    }
    Object.assign(job, { output: out, outName: path.basename(out), kind: "image" as const });
    return;
  }

  if (!ffmpeg) throw new Error("ffmpeg is not available");
  job.stage = "Reading file";
  const info = await probe(ffmpeg, input);
  if (!info.video && !info.audio) throw new Error("No video or audio found in this file");

  if (info.video?.isImage && !info.audio) {
    const out = path.join(job.dir, `${base}.png`);
    await run(ffmpeg, ["-y", ...SAFE_INPUT, "-i", input, "-frames:v", "1", out]);
    Object.assign(job, { output: out, outName: path.basename(out), kind: "image" as const });
    return;
  }

  if (!info.video || info.video.isImage) {
    // audio only → FLAC (lossless, decodes everywhere)
    const out = path.join(job.dir, `${base}.flac`);
    job.stage = "Converting audio";
    await run(ffmpeg, ["-y", ...SAFE_INPUT, "-i", input, "-map", "0:a:0", "-vn", "-c:a", "flac", "-sample_fmt", "s16", out], progressFrom(info.duration));
    Object.assign(job, { output: out, outName: path.basename(out), kind: "audio" as const, hasAudio: true });
    return;
  }

  const copyV = !force && COPY_VIDEO.has(info.video.codec);
  const copyA = !force && !!info.audio && COPY_AUDIO.has(info.audio.codec);
  job.stage = copyV ? "Repackaging (no quality loss)" : `Converting ${info.video.codec.toUpperCase()} video`;
  const out = path.join(job.dir, `${base}.mp4`);
  await run(ffmpeg, [
    "-y", ...SAFE_INPUT, "-i", input,
    "-map", "0:v:0", "-map", "0:a:0?",
    ...(copyV
      ? ["-c:v", "copy", ...(info.video.codec === "hevc" ? ["-tag:v", "hvc1"] : [])]
      : ["-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-pix_fmt", "yuv420p"]),
    ...(info.audio ? (copyA ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "256k", "-ac", "2"]) : []),
    "-sn", "-dn", "-map_metadata", "-1", "-movflags", "+faststart",
    out,
  ], progressFrom(info.duration));
  Object.assign(job, { output: out, outName: path.basename(out), kind: "video" as const, hasAudio: !!info.audio });
}

/** removes finished jobs' temp files after a while */
setInterval(() => {
  for (const [id, j] of jobs) {
    if (Date.now() - j.createdAt > 60 * 60_000) {
      fs.rmSync(j.dir, { recursive: true, force: true });
      jobs.delete(id);
    }
  }
}, 5 * 60_000).unref();

export function registerImport(app: Express, ffmpeg: string | null) {
  /** body = the file (streamed to disk); query: name, force=1 to always re-encode */
  app.post("/api/import", async (req: Request, res: Response) => {
    const name = path.basename(String(req.query.name ?? "media.bin")).slice(0, 200);
    const job: Job = { id: randomUUID(), status: "running", progress: 0, stage: "Receiving file", dir: fs.mkdtempSync(path.join(os.tmpdir(), "nomad-imp-")), createdAt: Date.now() };
    jobs.set(job.id, job);
    const input = path.join(job.dir, `input${path.extname(name).toLowerCase() || ".bin"}`);
    try {
      await pipeline(req, fs.createWriteStream(input));
    } catch (e) {
      job.status = "error";
      job.error = "Upload failed";
      return void res.status(500).json({ error: job.error });
    }
    res.json({ id: job.id });
    convert(job, ffmpeg, input, name, req.query.force === "1")
      .then(() => {
        job.status = "done";
        job.progress = 1;
        fs.rmSync(input, { force: true });
      })
      .catch((e) => {
        job.status = "error";
        job.error = e instanceof Error ? e.message : String(e);
        fs.rmSync(input, { force: true });
      });
  });

  app.get("/api/import/:id", (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j) return void res.status(404).json({ error: "unknown job" });
    res.json({ status: j.status, progress: j.progress, stage: j.stage, error: j.error, kind: j.kind, name: j.outName, hasAudio: j.hasAudio });
  });

  app.get("/api/import/:id/file", (req, res) => {
    const j = jobs.get(req.params.id);
    if (!j?.output || j.status !== "done") return void res.status(404).json({ error: "not ready" });
    res.sendFile(j.output, () => {
      fs.rmSync(j.dir, { recursive: true, force: true });
      jobs.delete(j.id);
    });
  });
}
