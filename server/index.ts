import express from "express";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { aiAssist, aiSubtitles, aiAvailable, listModels, testProvider } from "./ai.ts";
import { claudeStatus, dataDir, findClaude, getConfig, modelFor, PROVIDERS, saveConfig, urlFor, type Config, type Provider } from "./config.ts";
import { registerImport, SAFE_INPUT } from "./importer.ts";
import { cancelSetup, installClaude, setupState, startLogin, submitCode } from "./claudeSetup.ts";

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
  if (process.env.NOMAD_FFMPEG) candidates.push(process.env.NOMAD_FFMPEG);
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

/**
 * The engine only serves the editor itself. Web pages open in the user's browser can also reach
 * 127.0.0.1, so requests from other sites (Origin / Sec-Fetch-Site) and other host names (DNS rebinding)
 * are refused, and the editor can't be framed by another page.
 */
function localOnly(req: express.Request, res: express.Response, next: express.NextFunction) {
  const host = req.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)) return void res.status(403).send("Forbidden host");
  const origin = req.headers.origin;
  const site = req.headers["sec-fetch-site"];
  if ((origin && origin !== `http://${host}`) || (site && site !== "same-origin" && site !== "none")) {
    return void res.status(403).json({ error: "Cross-site requests are not allowed" });
  }
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
}

export function createApp(opts: { staticDir?: string; token?: string } = {}) {
  const app = express();
  app.disable("x-powered-by");
  // desktop app: only requests carrying the app's secret token are answered (see startPrivateEngine)
  if (opts.token) app.use((req, res, next) => (req.headers["x-nomad-token"] === opts.token ? next() : void res.status(403).end()));
  app.use(localOnly);
  app.use("/api/ai", express.json({ limit: "25mb" }));
  app.use("/api/settings", express.json());
  app.use("/api/presets", express.json({ limit: "20mb" }));

  // the user's saved clip presets ("My presets"), kept with the app's settings so every project can use them
  const presetsFile = () => path.join(dataDir(), "presets.json");
  app.get("/api/presets", (_req, res) => {
    try {
      res.json(JSON.parse(fs.readFileSync(presetsFile(), "utf8")));
    } catch {
      res.json({ presets: [] });
    }
  });
  app.put("/api/presets", (req, res) => {
    const presets = (req.body as { presets?: unknown })?.presets;
    if (!Array.isArray(presets)) return res.status(400).json({ error: "presets must be a list" });
    fs.mkdirSync(dataDir(), { recursive: true });
    // write to a temp file first so a crash never leaves a half-written file
    const tmp = `${presetsFile()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ presets }, null, 1));
    fs.renameSync(tmp, presetsFile());
    res.json({ ok: true });
  });

  app.get("/api/health", async (_req, res) => {
    const cfg = getConfig();
    const cc = cfg.provider === "claude-code" ? await claudeStatus() : { found: !!findClaude(), loggedIn: false };
    res.json({
      ai: aiAvailable() && (cfg.provider !== "claude-code" || cc.loggedIn),
      provider: cfg.provider,
      providerLabel: PROVIDERS[cfg.provider].short,
      model: modelFor(cfg.provider),
      claudeCode: cc,
      ffmpeg: !!FFMPEG,
      whisper: WHISPER,
    });
  });

  const mask = (k: string) => (k ? `${k.slice(0, 6)}…${k.slice(-4)}` : "");

  app.get("/api/settings", (_req, res) => {
    const c = getConfig();
    const providers = Object.fromEntries((Object.keys(PROVIDERS) as Provider[]).map((p) => {
      const info = PROVIDERS[p];
      const saved = c.keys[p] ?? "";
      return [p, {
        ...info,
        key: mask(saved),
        hasKey: !!saved,
        envKey: !saved && !!info.env && !!process.env[info.env],
        model: modelFor(p),
        url: urlFor(p),
      }];
    }));
    res.json({ provider: c.provider, cliModel: c.cliModel, providers });
  });

  type SettingsBody = { provider?: Provider; key?: string; model?: string; url?: string };
  const isProvider = (p: unknown): p is Provider => typeof p === "string" && p in PROVIDERS;

  app.post("/api/settings", (req, res) => {
    const b = req.body as SettingsBody & { cliModel?: string; clearKey?: boolean };
    if (!isProvider(b.provider)) return res.status(400).json({ error: "unknown provider" });
    const p = b.provider;
    if (b.clearKey) {
      saveConfig({ keys: { [p]: "" } });
      return res.json({ ok: true });
    }
    const patch: Partial<Config> = { provider: p };
    if (p === "claude-code" && typeof b.model === "string") patch.cliModel = b.model;
    else if (typeof b.model === "string" && b.model.trim()) patch.models = { [p]: b.model.trim() };
    // the UI shows a masked key; only a newly typed key replaces the saved one
    if (typeof b.key === "string" && b.key.trim() && !b.key.includes("…")) patch.keys = { [p]: b.key.trim() };
    if (typeof b.url === "string" && (p === "ollama" || p === "custom")) patch.urls = { [p]: b.url.trim() };
    saveConfig(patch);
    res.json({ ok: true });
  });

  /** values from the Settings form: a masked key means "the saved one" */
  const formTarget = (b: SettingsBody) => {
    const p = b.provider as Provider;
    // only local / custom services take an address; a saved key is only sent to the address it was saved for
    const url = (p === "ollama" || p === "custom") && b.url?.trim() ? b.url.trim().replace(/\/+$/, "") : undefined;
    const typed = b.key && !b.key.includes("…") ? b.key.trim() : undefined;
    return { provider: p, key: typed ?? (url && url !== urlFor(p) ? "" : undefined), model: b.model?.trim() || undefined, url };
  };

  app.post("/api/settings/models", async (req, res) => {
    const b = req.body as SettingsBody;
    if (!isProvider(b.provider)) return res.status(400).json({ error: "unknown provider" });
    try {
      res.json({ models: await listModels(formTarget(b)) });
    } catch (e) {
      res.status(502).json({ error: errMsg(e) });
    }
  });

  // Claude subscription setup from inside the app (install Claude Code, browser sign-in)
  app.use("/api/claude", express.json());
  app.get("/api/claude/setup", async (_req, res) => res.json({ ...setupState(), status: await claudeStatus() }));
  app.post("/api/claude/install", async (_req, res) => res.json(await installClaude()));
  app.post("/api/claude/login", async (_req, res) => res.json(await startLogin()));
  app.post("/api/claude/code", (req, res) => res.json({ ok: submitCode(String(req.body?.code ?? "")) }));
  app.post("/api/claude/cancel", (_req, res) => {
    cancelSetup();
    res.json({ ok: true });
  });

  app.post("/api/settings/test", async (req, res) => {
    const b = req.body as SettingsBody;
    if (!isProvider(b.provider)) return res.status(400).json({ error: "unknown provider" });
    try {
      if (b.provider === "claude-code") {
        const st = await claudeStatus();
        if (!st.found) throw new Error("Claude Code is not installed.");
        if (!st.loggedIn) throw new Error("Not signed in yet — click “Sign in with Claude”.");
      }
      res.json(await testProvider(formTarget(b)));
    } catch (e) {
      res.status(200).json({ ok: false, error: errMsg(e) });
    }
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomad-"));
    const video = path.join(dir, "video.bin");
    const audio = path.join(dir, "audio.wav");
    const output = path.join(dir, `output.${fmt.ext}`);
    fs.writeFileSync(video, body.subarray(0, vlen));
    const inputs = [...SAFE_INPUT, "-i", video];
    const maps: string[] = [];
    if (vlen < body.length) {
      fs.writeFileSync(audio, body.subarray(vlen));
      inputs.push(...SAFE_INPUT, "-i", audio);
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

  // the desktop app may import straight from a file's location on disk instead of uploading a copy
  registerImport(app, FFMPEG, { allowPaths: !!opts.token });

  /** local speech-to-text with the openai-whisper CLI, if installed */
  app.post("/api/transcribe", express.raw({ type: () => true, limit: "1gb" }), async (req, res) => {
    if (!WHISPER) return void res.status(501).json({ error: "whisper CLI is not installed (pip install openai-whisper)" });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomad-stt-"));
    const input = path.join(dir, "audio.wav");
    fs.writeFileSync(input, req.body as Buffer);
    try {
      const lang = String(req.query.lang ?? "");
      const model = String(req.query.model ?? "small");
      if (!/^[a-z0-9.-]{1,32}$/i.test(model)) throw new Error("unknown whisper model");
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

/**
 * The desktop app's engine. It doesn't listen on the network: it serves a private socket (a Unix socket, or a
 * named pipe on Windows) that only the app itself talks to, and every request must carry the app's secret token.
 */
export async function startPrivateEngine(opts: { socket: string; token: string; staticDir: string }) {
  const app = createApp({ staticDir: opts.staticDir, token: opts.token });
  const unix = process.platform !== "win32";
  if (unix) fs.rmSync(opts.socket, { force: true });
  await new Promise<void>((resolve, reject) => {
    const srv = app.listen(opts.socket, () => resolve());
    srv.on("error", reject);
  });
  if (unix) fs.chmodSync(opts.socket, 0o600);
}

export const capabilities = () => ({ ffmpeg: FFMPEG, whisper: WHISPER, claude: findClaude() });

// run directly: `tsx server/index.ts`
const isMain = process.argv[1] && /server[\\/]index\.(ts|js|mjs)$/.test(process.argv[1]);
if (isMain) {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  const prod = process.env.NODE_ENV === "production";
  const port = await startServer(Number(process.env.PORT ?? 5173), { dev: !prod, staticDir: path.resolve("dist") });
  const cfg = getConfig();
  console.log(`\n  NomadMovie  →  http://localhost:${port}`);
  console.log(`  ffmpeg: ${FFMPEG ?? "no"}   whisper: ${WHISPER ? "yes" : "no"}`);
  console.log(`  AI: ${cfg.provider === "claude-code" ? `Claude subscription via Claude Code (${findClaude() ?? "not found"})` : "Anthropic API key"}\n`);
}
