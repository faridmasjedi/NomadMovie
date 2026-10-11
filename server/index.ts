import express from "express";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { aiAssist, aiSubtitles, aiAvailable } from "./ai.ts";
import { claudeStatus, findClaude, getConfig, saveConfig, type Config } from "./config.ts";

const has = (bin: string, arg = "-version") => {
  try {
    return spawnSync(bin, [arg], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
};

/** bundled ffmpeg (ffmpeg-static) first, then a system install */
function resolveFfmpeg(): string | null {
  const candidates: string[] = [];
  if (process.env.NOVA_FFMPEG) candidates.push(process.env.NOVA_FFMPEG);
  try {
    const p = createRequire(import.meta.url)("ffmpeg-static") as string;
    // inside a packaged Electron app the binary lives outside the asar archive
    candidates.push(p.replace("app.asar", "app.asar.unpacked"));
  } catch {
    /* not installed */
  }
  candidates.push("ffmpeg", "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg");
  return candidates.find((c) => (c.includes(path.sep) ? fs.existsSync(c) : true) && has(c)) ?? null;
}

const FFMPEG = resolveFfmpeg();
const WHISPER = has("whisper", "--help");

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function run(cmd: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}: ${err.slice(-800)}`))));
  });
}

interface FormatSpec {
  ext: string;
  mime: string;
  /** args when the input is a recorded/encoded video+audio file */
  args: (o: { fps: number; quality: string; copy: boolean }) => string[];
}

const crf = (q: string) => (q === "high" ? "18" : q === "low" ? "28" : "22");
const FORMATS: Record<string, FormatSpec> = {
  mp4: {
    ext: "mp4",
    mime: "video/mp4",
    args: ({ fps, quality, copy }) => [
      ...(copy ? ["-c:v", "copy"] : ["-c:v", "libx264", "-preset", quality === "high" ? "medium" : "veryfast", "-crf", crf(quality), "-pix_fmt", "yuv420p", "-r", String(fps)]),
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
    ],
  },
  mov: {
    ext: "mov",
    mime: "video/quicktime",
    args: ({ fps, copy }) => [...(copy ? ["-c:v", "copy"] : ["-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(fps)]), "-c:a", "aac", "-b:a", "256k"],
  },
  webm: {
    ext: "webm",
    mime: "video/webm",
    args: ({ fps }) => ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-row-mt", "1", "-deadline", "realtime", "-cpu-used", "8", "-r", String(fps), "-c:a", "libopus"],
  },
  gif: {
    ext: "gif",
    mime: "image/gif",
    args: () => ["-vf", "fps=15,scale=640:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse", "-an"],
  },
  mp3: { ext: "mp3", mime: "audio/mpeg", args: () => ["-vn", "-c:a", "libmp3lame", "-b:a", "256k"] },
  wav: { ext: "wav", mime: "audio/wav", args: () => ["-vn", "-c:a", "pcm_s16le"] },
};

export function createApp(opts: { staticDir?: string } = {}) {
  const app = express();
  app.use("/api/ai", express.json({ limit: "25mb" }));
  app.use("/api/settings", express.json());

  app.get("/api/health", async (_req, res) => {
    const cfg = getConfig();
    const cc = cfg.provider === "claude-code" ? await claudeStatus() : { found: !!findClaude(), loggedIn: false };
    res.json({
      ai: aiAvailable() && (cfg.provider !== "claude-code" || cc.loggedIn),
      provider: cfg.provider,
      claudeCode: cc,
      ffmpeg: !!FFMPEG,
      whisper: WHISPER,
    });
  });

  app.get("/api/settings", (_req, res) => {
    const c = getConfig();
    res.json({ ...c, apiKey: c.apiKey ? `${c.apiKey.slice(0, 10)}…${c.apiKey.slice(-4)}` : "", hasApiKey: !!c.apiKey, envKey: !!process.env.ANTHROPIC_API_KEY });
  });
  app.post("/api/settings", (req, res) => {
    const b = req.body as Partial<Config>;
    const patch: Partial<Config> = {};
    if (b.provider === "claude-code" || b.provider === "api") patch.provider = b.provider;
    if (typeof b.cliModel === "string") patch.cliModel = b.cliModel;
    if (typeof b.apiModel === "string" && b.apiModel.trim()) patch.apiModel = b.apiModel.trim();
    if (typeof b.apiKey === "string" && !b.apiKey.includes("…")) patch.apiKey = b.apiKey.trim();
    saveConfig(patch);
    res.json({ ok: true });
  });

  app.post("/api/ai/assist", async (req, res) => {
    try {
      res.json(await aiAssist(req.body));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: errMsg(e) });
    }
  });

  app.post("/api/ai/subtitles", async (req, res) => {
    try {
      res.json(await aiSubtitles(req.body));
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: errMsg(e) });
    }
  });

  /**
   * Final encode. Body is the browser-encoded video (or a recording), optionally followed by a WAV
   * of the audio mix: `vlen` = byte length of the video part. Output is trimmed to `duration`.
   */
  app.post("/api/convert", express.raw({ type: () => true, limit: "8gb" }), async (req, res) => {
    if (!FFMPEG) return void res.status(501).json({ error: "ffmpeg is not available" });
    const fmt = FORMATS[String(req.query.format ?? "mp4")];
    if (!fmt) return void res.status(400).json({ error: "unknown format" });
    const fps = Math.min(120, Math.max(1, Number(req.query.fps ?? 30)));
    const quality = String(req.query.quality ?? "medium");
    const dur = Number(req.query.duration);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) return void res.status(400).json({ error: "empty upload" });
    const vlen = Math.min(body.length, Number(req.query.vlen ?? body.length));
    const copy = req.query.copy === "1";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-"));
    const video = path.join(dir, "video.bin");
    const audio = path.join(dir, "audio.wav");
    const output = path.join(dir, `output.${fmt.ext}`);
    fs.writeFileSync(video, body.subarray(0, vlen));
    const inputs = ["-i", video];
    const maps: string[] = [];
    if (vlen < body.length) {
      fs.writeFileSync(audio, body.subarray(vlen));
      inputs.push("-i", audio);
      maps.push("-map", "0:v:0", "-map", "1:a:0");
    }
    try {
      await run(FFMPEG, ["-y", ...inputs, ...maps, ...fmt.args({ fps, quality, copy }), ...(dur > 0 ? ["-t", dur.toFixed(3)] : []), output]);
      res.setHeader("Content-Type", fmt.mime);
      res.sendFile(output, () => fs.rmSync(dir, { recursive: true, force: true }));
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      res.status(500).json({ error: errMsg(e) });
    }
  });

  /** converts photos browsers can't show (HEIC from iPhone, TIFF…) to JPEG */
  app.post("/api/image", express.raw({ type: () => true, limit: "300mb" }), async (req, res) => {
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || !body.length) return void res.status(400).json({ error: "empty upload" });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-img-"));
    const ext = String(req.query.ext ?? "heic").replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
    const input = path.join(dir, `in.${ext}`);
    const output = path.join(dir, "out.jpg");
    fs.writeFileSync(input, body);
    try {
      if (process.platform === "darwin") await run("/usr/bin/sips", ["-s", "format", "jpeg", "-s", "formatOptions", "92", input, "--out", output]);
      else if (FFMPEG) await run(FFMPEG, ["-y", "-i", input, "-q:v", "2", output]);
      else throw new Error("no image converter available");
      res.setHeader("Content-Type", "image/jpeg");
      res.sendFile(output, () => fs.rmSync(dir, { recursive: true, force: true }));
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      res.status(500).json({ error: errMsg(e) });
    }
  });

  /** local speech-to-text with the openai-whisper CLI, if installed */
  app.post("/api/transcribe", express.raw({ type: () => true, limit: "1gb" }), async (req, res) => {
    if (!WHISPER) return void res.status(501).json({ error: "whisper CLI is not installed (pip install openai-whisper)" });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nova-stt-"));
    const input = path.join(dir, "audio.wav");
    fs.writeFileSync(input, req.body as Buffer);
    try {
      const lang = String(req.query.lang ?? "");
      const model = String(req.query.model ?? "small");
      await run("whisper", [input, "--model", model, "--output_format", "json", "--output_dir", dir, ...(lang ? ["--language", lang] : [])]);
      const out = JSON.parse(fs.readFileSync(path.join(dir, "audio.json"), "utf8"));
      res.json({
        segments: (out.segments ?? []).map((s: { start: number; end: number; text: string }) => ({ start: s.start, end: s.end, text: s.text.trim() })),
      });
    } catch (e) {
      res.status(500).json({ error: errMsg(e) });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  if (opts.staticDir) {
    app.use(express.static(opts.staticDir));
    app.get("*", (_req, res) => res.sendFile(path.join(opts.staticDir!, "index.html")));
  }
  return app;
}

/** starts the server; resolves with the port actually used */
export async function startServer(port: number, opts: { staticDir?: string; dev?: boolean } = {}) {
  const app = createApp({ staticDir: opts.dev ? undefined : opts.staticDir });
  if (opts.dev) {
    const { createServer } = await import("vite");
    const vite = await createServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  }
  return new Promise<number>((resolve, reject) => {
    const srv = app.listen(port, "127.0.0.1", () => resolve((srv.address() as AddressInfo).port));
    srv.on("error", reject);
  });
}

export const capabilities = () => ({ ffmpeg: FFMPEG, whisper: WHISPER, claude: findClaude() });

// run directly: `tsx server/index.ts`
const isMain = process.argv[1] && /server[\\/]index\.(ts|js|mjs)$/.test(process.argv[1]);
if (isMain) {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const prod = process.env.NODE_ENV === "production";
  const port = await startServer(Number(process.env.PORT ?? 5173), { dev: !prod, staticDir: path.resolve("dist") });
  const cfg = getConfig();
  console.log(`\n  Farid Editor  →  http://localhost:${port}`);
  console.log(`  ffmpeg: ${FFMPEG ?? "no"}   whisper: ${WHISPER ? "yes" : "no"}`);
  console.log(`  AI: ${cfg.provider === "claude-code" ? `Claude subscription via Claude Code (${findClaude() ?? "not found"})` : "Anthropic API key"}\n`);
}
