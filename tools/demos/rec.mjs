// Recording harness for the website demos: drives the editor in Chrome with a visible cursor, records it with the
// DevTools screencast and encodes GIFs. Used by demos.mjs.
import puppeteer from "puppeteer-core";
import ffmpegPath from "ffmpeg-static";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const WORK = path.join(import.meta.dirname, "work");
export const MEDIA = path.join(WORK, "media");
export const OUT = path.join(WORK, "gifs");
export const URL = process.env.DEMO_URL ?? "http://127.0.0.1:5180/";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const W = 1440, H = 810;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

/** a visible pointer with a click ripple (screencasts don't show the real one) */
const CURSOR = `
(() => {
  const init = () => {
    if (document.getElementById("__cur")) return;
    const st = document.createElement("style");
    st.textContent = "#__cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px)}" +
      ".__rip{position:fixed;z-index:2147483646;pointer-events:none;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #ffd34d;animation:__r .5s ease-out forwards}" +
      "@keyframes __r{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}";
    document.documentElement.appendChild(st);
    const c = document.createElement("div");
    c.id = "__cur";
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 22 22"><path d="M2 2 L2 18 L6.5 14 L9.5 20.5 L12.5 19 L9.6 12.8 L15.5 12.5 Z" fill="#fff" stroke="#111" stroke-width="1.3" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    const at = (e) => (c.style.transform = "translate(" + (e.clientX - 3) + "px," + (e.clientY - 2) + "px)");
    addEventListener("pointermove", at, true);
    addEventListener("dragover", at, true);
    addEventListener("pointerdown", (e) => {
      const r = document.createElement("div");
      r.className = "__rip";
      r.style.left = e.clientX + "px";
      r.style.top = e.clientY + "px";
      document.documentElement.appendChild(r);
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", init); else init();
})();`;

/** stand-in for the desktop app's bridge, so desktop-only parts (Export → Save to) show up in the recordings */
const DESKTOP = `
window.nomadDesktop = {
  platform: "linux",
  pathForFile: () => "",
  onUpdate: () => () => {},
  installUpdate: async () => {},
  defaultSavePath: async (name) => "/Users/you/Movies/" + name,
  chooseSavePath: async (suggested) => suggested,
  showInFolder: async () => {},
};`;

export async function launch() {
  // outside the project: files Chrome writes there would make the dev server reload the page
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomad-demos-chrome-"));
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir: dir,
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
    ignoreDefaultArgs: ["--enable-automation"],
    // a fake microphone: never the real one
    args: [`--window-size=${W + 20},${H + 120}`, "--autoplay-policy=no-user-gesture-required", "--disable-infobars", "--hide-scrollbars", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const page = (await browser.pages())[0];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.evaluateOnNewDocument(CURSOR);
  await page.evaluateOnNewDocument(DESKTOP);
  await page.setRequestInterception(true);
  page.on("request", async (req) => {
    const p = new globalThis.URL(req.url()).pathname;
    // the export is "saved" to the stand-in location
    if (p === "/api/save") return req.respond({ status: 200, contentType: "application/json", body: '{"ok":true}' });
    // never show the real Claude account (email) in recordings
    if (!/^\/api\/(health|claude\/setup)$/.test(p)) return req.continue();
    try {
      const r = await fetch(req.url(), { headers: { Origin: new globalThis.URL(URL).origin, "Sec-Fetch-Site": "same-origin" } });
      const text = (await r.text()).replace(/"account":"[^"]*"/g, '"account":"you@example.com"').replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "you@example.com");
      req.respond({ status: r.status, contentType: "application/json", body: text });
    } catch {
      req.continue();
    }
  });
  await page.goto(URL, { waitUntil: "networkidle2" });
  const ctx = new Ctx(page, errors, browser);
  ctx.profile = dir;
  await ctx.attach();
  await ctx.reset();
  return ctx;
}

export class Ctx {
  constructor(page, errors, browser) {
    this.page = page;
    this.errors = errors;
    this.browser = browser;
    this.mx = W / 2;
    this.my = H / 2;
  }
  st(fn, arg) {
    return this.page.evaluate(fn, arg);
  }
  /** hooks into the editor's state (again after a reload); returns false if the page had reloaded */
  async attach() {
    await this.page.waitForSelector(".tabs-v");
    return this.page.evaluate(async () => {
      if (window.__S) return true;
      window.__S = (await import("/src/store.ts")).useStore;
      window.__F = await import("/src/factory.ts");
      return false;
    });
  }
  /** a fresh project with fewer empty tracks, and the Inspector back on its Basic tab */
  async reset({ keepMedia = false } = {}) {
    await this.page.evaluate((keep) => {
      window.__fresh = () => {
        const s = window.__S.getState();
        s.setPlaying(false);
        s.setProject(window.__F.newProject());
        for (const n of ["Video 3", "Audio 2"]) {
          const t = window.__S.getState().project.tracks.find((x) => x.name === n);
          if (t) window.__S.getState().removeTrack(t.id);
        }
      };
      window.__fresh();
      const s = window.__S.getState();
      s.set({ selected: [], currentTime: 0, maskEdit: null, pick: null, focus: null, toast: null, ...(keep ? {} : { media: {} }) });
      s.setLeftTab("media");
      // the Inspector remembers its last tab: select a temporary clip with a focus request for "basic"
      const c = window.__F.makeClip(s.project, "solid", s.project.tracks[0].id, 0, 1, { name: "tmp", color: "#000" });
      s.addClip(c);
      s.focusClip(c.id, "basic");
    }, keepMedia);
    await sleep(250);
    await this.page.evaluate(() => {
      window.__fresh();
      window.__S.getState().set({ selected: [], past: [], future: [], focus: null });
    });
    await sleep(300);
  }
  async importFiles(names, { wait = true } = {}) {
    const input = await this.page.$(".dropzone input[type=file]");
    await input.uploadFile(...names.map((n) => path.join(MEDIA, n)));
    if (wait) await this.waitIdle(names.length);
  }
  async waitIdle(n) {
    await this.page.waitForFunction((n) => !window.__S.getState().busy && Object.keys(window.__S.getState().media).length >= n, { timeout: 180000, polling: 200 }, n ?? 0);
  }
  /** puts a media item on the timeline (setup, not recorded as a user action) */
  async place(name, opts = {}) {
    return this.page.evaluate(({ name, opts }) => {
      const s = window.__S.getState();
      const m = Object.values(s.media).find((x) => x.name === name || x.name.startsWith(name.replace(/\.[^.]+$/, "")));
      if (!m) throw new Error("no media " + name);
      const start = opts.start ?? 0;
      const dur = opts.duration ?? (m.kind === "image" ? 5 : m.duration);
      const trackId = s.ensureTrackFor(m.kind === "audio" ? "audio" : "video", start, dur);
      const c = window.__F.clipFromMedia(window.__S.getState().project, m, trackId, start);
      if (opts.duration) c.duration = opts.duration;
      s.addClip(c);
      return c.id;
    }, { name, opts });
  }
  setTime(t) {
    return this.page.evaluate((t) => window.__S.getState().setTime(t), t);
  }
  select(id) {
    return this.page.evaluate((id) => window.__S.getState().select(id ? [id] : []), id);
  }
  zoom(z) {
    return this.page.evaluate((z) => window.__S.getState().setZoom(z), z);
  }
  tab(name) {
    return this.page.evaluate((t) => window.__S.getState().setLeftTab(t), name);
  }
  async find(selector, text, { timeout = 8000 } = {}) {
    try {
      const h = await this.page.waitForFunction(
        (sel, text) => [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.trim().toLowerCase().includes(text.toLowerCase())) ?? null,
        { timeout, polling: 100 },
        selector,
        text ?? "",
      );
      return h.asElement();
    } catch {
      throw new Error(`not found: ${selector} "${text ?? ""}"`);
    }
  }
  async box(target) {
    if (Array.isArray(target)) target = await this.find(...target);
    else if (typeof target === "string") target = await this.find(target);
    if (typeof target.x === "number" && !target.boundingBox) return target;
    await target.evaluate((e) => e.scrollIntoView({ block: "nearest", inline: "nearest" }));
    const b = await target.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }
  /** smooth, human-looking pointer movement */
  async move(target, { ms = 450, dx = 0, dy = 0 } = {}) {
    const p = await this.box(target);
    const x = p.x + dx, y = p.y + dy;
    const steps = Math.max(6, Math.round(ms / 16));
    const x0 = this.mx, y0 = this.my;
    for (let i = 1; i <= steps; i++) {
      const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      await this.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e);
      await sleep(ms / steps);
    }
    this.mx = x;
    this.my = y;
    return { x, y };
  }
  async click(target, o = {}) {
    await this.move(target, o);
    await sleep(o.pause ?? 120);
    await this.page.mouse.down({ button: o.button ?? "left" });
    await sleep(70);
    await this.page.mouse.up({ button: o.button ?? "left" });
    await sleep(o.after ?? 350);
  }
  rclick(target, o = {}) {
    return this.click(target, { ...o, button: "right" });
  }
  async dblclick(target, o = {}) {
    await this.move(target, o);
    await sleep(120);
    await this.page.mouse.click(this.mx, this.my, { clickCount: 2 });
    await sleep(o.after ?? 350);
  }
  async drag(from, to, o = {}) {
    await this.move(from);
    await sleep(150);
    await this.page.mouse.down();
    await sleep(120);
    await this.move(to, { ms: o.ms ?? 900 });
    await sleep(200);
    await this.page.mouse.up();
    await sleep(o.after ?? 400);
  }
  /** HTML5 drag and drop (Effects / Transitions panels) along a visible pointer path */
  async dnd(from, to, o = {}) {
    const a = await this.move(from);
    await sleep(150);
    const b = await this.box(to);
    const tx = b.x + (o.dx ?? 0), ty = b.y + (o.dy ?? 0);
    await this.page.evaluate(({ a, tx, ty, ms }) => new Promise((res) => {
      const src = document.elementFromPoint(a.x, a.y)?.closest("[draggable=true]");
      const dt = new DataTransfer();
      const fire = (el, type, x, y) => el && el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: x, clientY: y }));
      fire(src, "dragstart", a.x, a.y);
      const cur = document.getElementById("__cur");
      const steps = Math.round(ms / 16);
      let i = 0, last = null;
      const tick = () => {
        i++;
        const k = i / steps, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        const x = a.x + (tx - a.x) * e, y = a.y + (ty - a.y) * e;
        if (cur) cur.style.transform = "translate(" + (x - 3) + "px," + (y - 2) + "px)";
        const el = document.elementFromPoint(x, y);
        if (el !== last) {
          fire(last, "dragleave", x, y);
          fire(el, "dragenter", x, y);
          last = el;
        }
        fire(el, "dragover", x, y);
        if (i < steps) requestAnimationFrame(tick);
        else setTimeout(() => (fire(el, "drop", x, y), fire(src, "dragend", x, y), res()), 250);
      };
      requestAnimationFrame(tick);
    }), { a, tx, ty, ms: o.ms ?? 1000 });
    this.mx = tx;
    this.my = ty;
    await this.page.mouse.move(tx, ty);
    await sleep(o.after ?? 500);
  }
  async type(text, { delay = 45 } = {}) {
    await this.page.keyboard.type(text, { delay });
  }
  /** plays with the real transport button, so audio and the clock start the way they do for users */
  async play(seconds, from) {
    if (from !== undefined) await this.setTime(from);
    await sleep(150);
    const btn = "[title='Play/pause (Space)']";
    await this.click(btn, { after: 0 });
    await sleep(seconds * 1000);
    if (await this.page.evaluate(() => window.__S.getState().playing)) await this.page.$eval(btn, (b) => b.click());
    await sleep(250);
  }
  clipEl(name) {
    return this.find(".clip", name);
  }
  async rect(selector, text) {
    const b = await (await this.find(selector, text)).boundingBox();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  }
}

/** records the page with the DevTools screencast; `fast(k)` speeds up waiting in the result */
export class Rec {
  constructor(ctx) {
    this.ctx = ctx;
  }
  async start(name) {
    this.name = name;
    this.frames = [];
    this.speed = 1;
    await sleep(900); // let the preview draw before the first frame
    this.cdp = await this.ctx.page.createCDPSession();
    this.cdp.on("Page.screencastFrame", (f) => {
      this.frames.push({ data: f.data, t: f.metadata.timestamp, speed: this.speed });
      this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    await sleep(500);
  }
  fast(k = 8) {
    this.speed = k;
  }
  normal() {
    this.speed = 1;
  }
  /** crop: {x,y,w,h} in page pixels */
  async stop({ crop, width = 1040, fps = 10, hold = 1.5 } = {}) {
    await sleep(300);
    await this.cdp.send("Page.stopScreencast");
    await this.cdp.detach();
    const dir = fs.mkdtempSync(path.join(WORK, "frames-"));
    try {
      const fr = this.frames;
      let list = "";
      fr.forEach((f, i) => {
        const file = path.join(dir, `f${String(i).padStart(5, "0")}.jpg`);
        fs.writeFileSync(file, Buffer.from(f.data, "base64"));
        const d = i < fr.length - 1 ? Math.max(0.001, (fr[i + 1].t - f.t) / f.speed) : hold;
        list += `file '${file}'\nduration ${d.toFixed(4)}\n`;
      });
      list += `file '${path.join(dir, `f${String(fr.length - 1).padStart(5, "0")}.jpg`)}'\n`;
      fs.writeFileSync(path.join(dir, "list.txt"), list);
      const c = crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : "";
      const out = path.join(OUT, `${this.name}.gif`);
      execFileSync(ffmpegPath, [
        "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt"),
        "-vf", `${c}fps=${fps},scale=${Math.min(width, crop ? crop.w : W)}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=200:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
        "-loop", "0", out,
      ]);
      console.log(`  ${this.name}.gif  ${(fs.statSync(out).size / 1e6).toFixed(2)} MB`);
      return out;
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      this.frames = [];
    }
  }
}
