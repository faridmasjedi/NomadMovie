// Records the website's feature demos as GIFs into tools/demos/work/gifs.
//   node tools/demos/demos.mjs            all demos
//   node tools/demos/demos.mjs text color  only these
// Needs the dev server (PORT=5180 npm run dev) and the media from prepare-media.sh. The AI demos use whatever AI is
// connected in the app's settings.
import { launch, Rec, sleep } from "./rec.mjs";
import fs from "node:fs";

const CORE = ["bridge.mp4", "street.mp4", "city.mp4", "scope.mp4", "room.mp4", "oldstreet.mp4", "ruins.mp4", "lab.mp4", "music.m4a", "speech.m4a", "greenscreen.mp4", "robot.svg", "stars.json", "photo_30.jpg", "photo_265.jpg", "photo_228.jpg", "photo_450.jpg"];

/* ---------- helpers ---------- */
const tlX = (c, t) => c.page.evaluate((t) => document.querySelector(".tl-lane").getBoundingClientRect().left + t * window.__S.getState().zoom, t);
const laneY = (c, name) => c.page.evaluate((name) => {
  const i = window.__S.getState().project.tracks.findIndex((t) => t.name === name);
  const r = document.querySelectorAll(".tl-lane")[i].getBoundingClientRect();
  return r.top + r.height / 2;
}, name);
const ruler = async (c, t) => ({ x: await tlX(c, t), y: (await c.rect(".tl-ruler")).y + 12 });
/** project pixel → point on the preview */
const pv = (c, x, y) => c.page.evaluate(({ x, y }) => {
  const r = document.querySelector(".stage canvas").getBoundingClientRect();
  const p = window.__S.getState().project;
  return { x: r.left + (x / p.width) * r.width, y: r.top + (y / p.height) * r.height };
}, { x, y });
const insp = (c, label) => c.click([".inspector-tabs button", label]);
/** scrolls to an Inspector section (on the Basic tab if needed) and opens it */
const section = async (c, title) => {
  let h = await c.find(".section-head", title, { timeout: 1500 }).catch(() => null);
  if (!h) {
    await insp(c, "Basic");
    h = await c.find(".section-head", title);
  }
  await h.evaluate((e) => e.scrollIntoView({ block: "start" }));
  await sleep(200);
  if (!(await h.evaluate((e) => !!e.parentElement.querySelector(":scope > .section-body")))) await c.click(h);
  return h;
};
/** drags an Inspector slider (found by its label) to a position 0..1 */
const slider = async (c, label, frac, ms = 700) => {
  const h = await c.page.waitForFunction((label) => {
    for (const r of document.querySelectorAll(".panel-body .slider-row")) if (r.querySelector("label")?.textContent.trim().startsWith(label)) return r.querySelector("input[type=range]");
    return null;
  }, { timeout: 5000 }, label);
  const inp = h.asElement();
  await inp.evaluate((e) => e.scrollIntoView({ block: "center" }));
  const b = await inp.boundingBox();
  const v = await inp.evaluate((e) => (Number(e.value) - Number(e.min)) / (Number(e.max) - Number(e.min)));
  await c.drag({ x: b.x + 6 + v * (b.width - 12), y: b.y + b.height / 2 }, { x: b.x + 6 + frac * (b.width - 12), y: b.y + b.height / 2 }, { ms });
};
/** native dropdowns aren't captured by the screencast: point at the select and set it */
const selectIn = async (c, el, value) => {
  await c.move(el);
  await sleep(200);
  await el.evaluate((e, v) => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(e, v);
    e.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await sleep(400);
};
const fieldSelect = async (c, label, value) => {
  const h = await c.page.waitForFunction((label) => {
    for (const r of document.querySelectorAll(".panel-body .row, .modal .row")) {
      const l = r.querySelector(":scope > label");
      if (l && l.textContent.trim().startsWith(label) && r.querySelector("select")) return r.querySelector("select");
    }
    return null;
  }, { timeout: 5000 }, label);
  await h.asElement().evaluate((e) => e.scrollIntoView({ block: "center" }));
  await selectIn(c, h.asElement(), value);
};
/** the ◆ keyframe button of an Inspector slider */
const kfBtn = (c, label) => c.page.waitForFunction((label) =>
  [...document.querySelectorAll(".slider-row")].find((r) => r.querySelector("label")?.textContent.trim() === label)?.querySelector(".kf-btn"), {}, label).then((h) => h.asElement());
const gradients = (c) => c.page.$$(".panel-body .grid3 .tile");

/* ---------- demos ---------- */
const DEMOS = {
  // runs first, on an empty library
  async import(c, r) {
    await r.start("import");
    await c.move(".dropzone", { ms: 700 });
    await sleep(400);
    await c.importFiles(["street.mkv", "photo_room.heic", "bridge.mp4", "music.m4a", "photo_30.jpg"], { wait: false });
    await c.waitIdle(5);
    await sleep(800);
    for (const n of ["street", "bridge", "photo_room", "music"]) {
      await c.dblclick([".media-card", n]);
      await sleep(300);
    }
    await c.play(3, 0);
  },

  async editing(c, r) {
    await c.zoom(80);
    await c.place("bridge", { start: 0 });
    await c.place("street", { start: 8 });
    await c.place("room", { start: 16 });
    await c.place("music", { start: 0, duration: 23 });
    await c.select(null);
    await r.start("editing");
    await c.click(await ruler(c, 4));
    await c.click([".clip", "bridge"], { dx: 40 });
    await c.click("[title='Split at playhead (S)']");
    await sleep(400);
    const st = await (await c.clipEl("street")).boundingBox();
    await c.drag({ x: st.x + st.width - 3, y: st.y + 20 }, { x: st.x + st.width - 140, y: st.y + 20 });
    const rm = await (await c.clipEl("room")).boundingBox();
    await c.drag({ x: rm.x + 80, y: rm.y + 30 }, { x: rm.x - 60, y: rm.y + 30 }, { ms: 1000 });
    await c.click({ x: await tlX(c, 1.5), y: await laneY(c, "Video 1") });
    await c.click("[title='Ripple delete (Shift+Delete)']");
    await sleep(500);
    await c.click("[title='Undo (Ctrl+Z)']");
    await sleep(500);
    await c.click(await ruler(c, 6));
    await c.play(3);
  },

  async "right-click"(c, r) {
    await c.zoom(90);
    await c.place("street", { start: 0 });
    await c.place("bridge", { start: 8 });
    await c.select(null);
    await c.setTime(2);
    await r.start("right-click");
    await c.rclick([".clip", "street"], { dx: -60 });
    await c.move([".ctx-item", "Speed"]);
    await sleep(500);
    await c.click([".ctx-item", "2×"]);
    await sleep(500);
    await c.rclick([".clip", "street"], { dx: -60 });
    await c.move([".ctx-item", "Zoom & pan"]);
    await sleep(500);
    await c.click([".ctx-item", "Punch in"]);
    await sleep(500);
    await c.rclick([".clip", "bridge"], { dx: -40 });
    await c.move([".ctx-item", "Transition in"]);
    await sleep(500);
    await c.click([".ctx-item", "Cube"]);
    await sleep(600);
    await c.play(5.5, 0.5);
  },

  async text(c, r) {
    await c.zoom(90);
    await c.place("scope", { start: 0 });
    await c.select(null);
    await c.tab("text");
    await r.start("text");
    await c.click([".tile", "Neon"]);
    await sleep(500);
    const ta = await c.find(".panel-body textarea");
    await c.click(ta);
    await ta.evaluate((e) => e.select());
    await c.type("CITY OF STEEL", { delay: 70 });
    await sleep(300);
    await fieldSelect(c, "Font", "Bebas Neue");
    await slider(c, "Size", 0.45);
    await insp(c, "Animation");
    await fieldSelect(c, "Type", "typewriter");
    await sleep(300);
    await c.play(4.5, 0);
  },

  async elements(c, r) {
    await c.zoom(90);
    await c.select(null);
    await c.tab("elements");
    await r.start("elements");
    const g = await gradients(c);
    await c.click(g[g.length - 3]);
    await sleep(300);
    await c.setTime(0);
    await c.click([".tile", "Star"]);
    await sleep(300);
    await c.drag(await pv(c, 960, 540), await pv(c, 600, 420));
    await c.setTime(0);
    await c.click([".tile", "Heart"]);
    await sleep(300);
    await c.drag(await pv(c, 960, 540), await pv(c, 1350, 640));
    await c.tab("text");
    await c.setTime(0);
    await c.click([".tile", "Bold display"]);
    await sleep(500);
    await c.play(3, 0);
  },

  async effects(c, r) {
    await c.zoom(90);
    await c.place("oldstreet", { start: 0 });
    await c.select(null);
    await c.setTime(2);
    await c.tab("effects");
    await r.start("effects");
    for (const name of ["Deep Glow", "Slice Glitch", "VHS"]) {
      await c.move([".fx-tile", name]).catch(() => {});
      await sleep(900);
    }
    await c.dnd([".fx-tile", "VHS"], [".clip", "oldstreet"]);
    await sleep(600);
    await slider(c, "Amount", 0.9);
    await c.dnd([".fx-tile", "Light Sweep"], [".clip", "oldstreet"]);
    await sleep(500);
    await c.play(4, 0.5);
  },

  async "effect-layer"(c, r) {
    await c.zoom(70);
    await c.place("bridge", { start: 0 });
    await c.place("street", { start: 8 });
    await c.select(null);
    await c.setTime(6);
    await c.tab("effects");
    await r.start("effect-layer");
    await c.dnd([".fx-tile", "Black & White Film"], { x: await tlX(c, 5), y: await laneY(c, "Video 2") });
    await sleep(600);
    const b = await (await c.page.$$(".clip"))[0].boundingBox();
    await c.drag({ x: b.x + b.width - 3, y: b.y + 20 }, { x: b.x + b.width + 120, y: b.y + 20 });
    await c.play(5, 3.5);
  },

  async transitions(c, r) {
    await c.zoom(80);
    await c.place("bridge", { start: 0, duration: 5 });
    await c.place("street", { start: 5, duration: 5 });
    await c.place("ruins", { start: 10, duration: 5 });
    await c.select(null);
    await c.setTime(3.5);
    await c.tab("transitions");
    await r.start("transitions");
    for (const name of ["Cube", "Ripple", "Burn"]) {
      await c.move([".fx-tile", name]).catch(() => {});
      await sleep(1000);
    }
    const b1 = await (await c.clipEl("bridge")).boundingBox();
    await c.dnd([".fx-tile", "Cube"], { x: b1.x + b1.width - 12, y: b1.y + 30 });
    await sleep(500);
    const b2 = await (await c.clipEl("street")).boundingBox();
    await c.dnd([".fx-tile", "Glitch Displace"], { x: b2.x + b2.width - 12, y: b2.y + 30 });
    await sleep(500);
    await c.play(8, 3);
  },

  async keyframes(c, r) {
    await c.zoom(110);
    await c.place("ruins", { start: 0, duration: 6 });
    await c.select(null);
    await c.tab("elements");
    await c.setTime(0);
    await r.start("keyframes");
    await c.click([".tile", "Star"]);
    await c.setTime(0.6);
    await sleep(300);
    for (const prop of ["X", "Y", "Rotation"]) await c.click(await kfBtn(c, prop));
    await c.click(await ruler(c, 2.2));
    await c.drag(await pv(c, 960, 540), await pv(c, 1500, 300), { ms: 900 });
    await slider(c, "Rotation", 0.75);
    await c.click(await ruler(c, 4));
    await c.drag(await pv(c, 1500, 300), await pv(c, 520, 780), { ms: 900 });
    await insp(c, "Animation");
    await sleep(800);
    await c.play(4.5, 0.4);
  },

  async "motion-presets"(c, r) {
    await c.zoom(110);
    await c.tab("elements");
    const g = await gradients(c);
    await c.click(g[g.length - 5]);
    await c.place("robot.svg", { start: 0 });
    await c.setTime(1);
    await r.start("motion-presets");
    await insp(c, "Animation");
    await section(c, "Motion presets");
    await c.click([".chips .chip", "Float"]);
    await sleep(300);
    await c.click([".chips .chip", "Wiggle"]);
    await sleep(300);
    await c.play(3, 0);
    await c.click([".chips .chip", "Wiggle"]);
    await c.click([".chips .chip", "Jelly"]);
    await c.play(3, 0);
  },

  async "animate-parts"(c, r) {
    await c.zoom(110);
    await c.tab("elements");
    const g = await gradients(c);
    await c.click(g[g.length - 6]);
    const id = await c.place("robot.svg", { start: 0 });
    await c.select(id);
    await c.setTime(1);
    await r.start("animate-parts");
    await insp(c, "Basic");
    await c.click([".panel-body button", "Split into layers"]);
    await sleep(1500);
    const part = (name) => c.page.evaluate((n) => window.__S.getState().project.clips.find((x) => x.name.toLowerCase().includes(n))?.id, name);
    await c.select(await part("right-arm"));
    await sleep(400);
    // anchor at the shoulder: Pick, then click the shoulder on the preview (svg 308,222 → frame)
    const pick = await c.page.waitForFunction(() => [...document.querySelectorAll(".panel-body button")].find((b) => b.textContent.trim() === "🎯 Pick")).then((h) => h.asElement());
    await pick.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await c.click(pick);
    await c.click(await pv(c, 960 + 108 * 2.16, 540 - 28 * 2.16));
    await sleep(500);
    await insp(c, "Animation");
    await c.click([".chips .chip", "Pendulum"]);
    await c.select(await part("head"));
    await sleep(300);
    await c.click([".chips .chip", "Wiggle"]);
    await c.select(await part("antenna"));
    await sleep(300);
    await c.click([".chips .chip", "Pulse"]);
    await c.play(5, 0);
  },

  async lottie(c, r) {
    await c.zoom(110);
    await c.place("bridge", { start: 0, duration: 6 });
    await c.place("stars", { start: 0, duration: 6 });
    await c.setTime(1);
    await r.start("lottie");
    await c.move([".media-card", "stars"]);
    await sleep(600);
    await c.play(5, 0);
  },

  async "zoom-pan"(c, r) {
    await c.zoom(110);
    const id = await c.place("oldstreet", { start: 0 });
    await c.select(id);
    await c.setTime(1);
    await r.start("zoom-pan");
    await insp(c, "Animation");
    await section(c, "Zoom & pan");
    await c.click([".panel-body button", "Pick on preview"]);
    await c.click(await pv(c, 1180, 420));
    await slider(c, "Zoom", 0.45);
    await c.click([".panel-body button", "Apply move"]);
    await sleep(500);
    await c.play(4, 0.5);
  },

  async masks(c, r) {
    await c.zoom(110);
    await c.place("bridge", { start: 0 });
    const id = await c.place("room", { start: 0, duration: 6 });
    await c.select(id);
    await c.setTime(1.5);
    await r.start("masks");
    await section(c, "Mask & cut-out");
    await c.click([".mask-tools button", "Ellipse"]);
    await c.drag(await pv(c, 520, 160), await pv(c, 1420, 960), { ms: 900 });
    await sleep(400);
    await slider(c, "Feather", 0.45);
    await sleep(500);
    await c.click([".toggle", "Invert"]);
    await sleep(900);
    await c.click([".toggle", "Invert"]);
    await c.play(3, 0.5);
  },

  async "ai-cutout"(c, r) {
    await c.zoom(110);
    await c.tab("elements");
    const g = await gradients(c);
    await c.click(g[g.length - 4]);
    const id = await c.place("street", { start: 0, duration: 5 });
    await c.select(id);
    await c.setTime(0.3);
    await r.start("ai-cutout");
    await section(c, "Mask & cut-out");
    await c.click([".panel-body button", "Select a subject with AI"]);
    await sleep(500);
    r.fast(8);
    await c.click(await pv(c, 630, 450)); // the actor's shirt
    await c.page.waitForFunction(() => { const s = window.__S.getState(); return s.project.clips.some((x) => x.mask) && !s.maskWork; }, { timeout: 300000, polling: 300 });
    r.normal();
    await sleep(1200);
    const fwd = await c.find(".panel-body button", "Track forward");
    await fwd.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await fieldSelect(c, "Track subject", "3");
    await c.click(fwd);
    r.fast(14);
    await sleep(1500);
    await c.page.waitForFunction(() => !window.__S.getState().maskWork, { timeout: 900000, polling: 500 });
    r.normal();
    await sleep(600);
    await c.play(4.5, 0.2);
  },

  async color(c, r) {
    await c.zoom(110);
    const id = await c.place("bridge", { start: 0 });
    await c.select(id);
    await c.setTime(2);
    await r.start("color");
    await insp(c, "Color");
    for (const look of ["Cinematic", "Teal & orange", "Noir", "Cyberpunk", "Vintage"]) {
      await c.click([".panel-body .tile", look]);
      await sleep(700);
    }
    await c.click([".panel-body .tile", "Original"]);
    await slider(c, "Temperature", 0.75);
    await slider(c, "Saturation", 0.5);
    await slider(c, "Vignette", 0.6);
    await sleep(600);
  },

  async chroma(c, r) {
    await c.zoom(110);
    await c.place("ruins", { start: 0 });
    const id = await c.place("greenscreen", { start: 0 });
    await c.select(id);
    await c.setTime(1.5);
    await r.start("chroma");
    await section(c, "Chroma key");
    await c.click([".toggle", "Enabled"]);
    await sleep(700);
    await slider(c, "Threshold", 0.45);
    await c.play(4, 0);
  },

  async "audio-line"(c, r) {
    await c.zoom(55);
    await c.place("bridge", { start: 0, duration: 20 });
    await c.place("music", { start: 0, duration: 20 });
    await c.select(null);
    await r.start("audio-line");
    const b = await (await c.clipEl("music")).boundingBox();
    await c.drag({ x: b.x + b.width * 0.5, y: b.y + 18 }, { x: b.x + b.width * 0.5, y: b.y + 34 }, { ms: 800 });
    const fh = await c.page.$$(".fade-handle");
    const f1 = await fh[0].boundingBox(), f2 = await fh[1].boundingBox();
    await c.drag({ x: f1.x + 5, y: f1.y + 5 }, { x: f1.x + 150, y: f1.y + 5 }, { ms: 800 });
    await c.drag({ x: f2.x + 5, y: f2.y + 5 }, { x: f2.x - 170, y: f2.y + 5 }, { ms: 800 });
    const lb = await (await c.clipEl("music")).boundingBox();
    const yLine = await c.page.evaluate(() => {
      const pts = [...document.querySelectorAll(".clip .vol-line")].at(-1).getAttribute("points").split(" ").map((p) => p.split(",").map(Number));
      return pts[Math.floor(pts.length / 2)][1];
    });
    for (const fx of [0.38, 0.45, 0.58, 0.65]) {
      await c.dblclick({ x: lb.x + lb.width * fx, y: lb.y + yLine });
      await sleep(200);
    }
    const kfs = await c.page.$$(".vol-kf");
    if (kfs.length >= 4) {
      for (const k of [kfs[1], kfs[2]]) {
        const kb = await k.boundingBox();
        await c.drag({ x: kb.x + 4, y: kb.y + 4 }, { x: kb.x + 4, y: kb.y + 22 }, { ms: 600 });
      }
    }
    await sleep(800);
    const t = await c.rect(".timeline");
    return { crop: { x: 0, y: t.y, w: 1120, h: t.h } };
  },

  async "audio-tools"(c, r) {
    await c.zoom(70);
    await c.place("lab", { start: 0 });
    const sp = await c.place("speech", { start: 0 });
    await c.select(sp);
    await r.start("audio-tools");
    await insp(c, "Audio");
    await c.click([".chips .chip", "Warm voice"]);
    await c.click([".toggle", "Noise"]);
    await c.click([".toggle", "Voice enhance"]);
    const b = await c.find(".panel-body button", "Remove silences");
    await b.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await c.click(b);
    await sleep(1500);
    const m = await c.place("music", { start: 0, duration: 16 });
    await c.select(m);
    await sleep(400);
    await c.rclick([".clip", "music"]);
    await c.move([".ctx-item", "Smart audio"]);
    await sleep(400);
    await c.click([".ctx-item", "Beats"]);
    await sleep(1500);
  },

  async presets(c, r) {
    await c.zoom(70);
    const a = await c.place("bridge", { start: 0, duration: 5 });
    await c.place("street", { start: 5, duration: 5 });
    await c.place("ruins", { start: 10, duration: 5 });
    await c.page.evaluate(async ({ a }) => {
      const { newEffect } = await import("/src/components/timelineParts.tsx");
      const { LOOKS } = await import("/src/engine/presets.ts");
      const { defaultFilters } = await import("/src/factory.ts");
      window.__S.getState().updateClip(a, (x) => {
        x.filters = { ...defaultFilters(), ...LOOKS.find((l) => l.label === "Teal & orange").f };
        x.effects = [newEffect("filmGrain")];
        x.animIn = "zoom";
      });
    }, { a });
    await c.select(a);
    await c.setTime(2);
    await r.start("presets");
    await c.click([".preset-bar button", "Save as preset"]);
    await sleep(400);
    await c.type("My teal look", { delay: 60 });
    await c.click([".modal button", "Save preset"]);
    await sleep(800);
    await c.click([".clip", "street"]);
    await c.page.keyboard.down("Shift");
    await c.click([".clip", "ruins"]);
    await c.page.keyboard.up("Shift");
    await sleep(400);
    const sel = await c.find(".preset-bar select");
    const val = await sel.evaluate((e) => [...e.options].find((o) => o.textContent.includes("My teal look"))?.value);
    await selectIn(c, sel, val);
    await sleep(600);
    await c.play(5, 3);
  },

  async export(c, r) {
    await c.zoom(70);
    await c.place("bridge", { start: 0, duration: 4 });
    await c.place("street", { start: 4, duration: 4 });
    await c.place("music", { start: 0, duration: 8 });
    await c.page.evaluate(() => {
      const s = window.__S.getState();
      const st = s.project.clips.find((x) => x.name.startsWith("street"));
      s.updateClip(st.id, (x) => void (x.transitionIn = { type: "cube", duration: 1 }));
      s.commit((p) => void (p.name = "Amsterdam trip"));
    });
    await c.select(null);
    await r.start("export");
    await c.click([".topbar button", "Export"]);
    await sleep(900);
    await fieldSelect(c, "Quality", "high");
    await c.move([".modal button", "Change"]);
    await sleep(700);
    await c.click([".modal button", "Render"]);
    await c.page.waitForFunction(() => /Exported in/.test(window.__S.getState().toast?.msg ?? ""), { timeout: 120000, polling: 200 });
    await sleep(2500);
  },

  async settings(c, r) {
    await r.start("settings");
    await c.click("[title='Settings']");
    await sleep(1200);
    for (const n of ["OpenAI", "Gemini", "Local", "Claude subscription"]) {
      await c.click([".ai-choice", n]).catch(() => {});
      await sleep(1100);
    }
    await sleep(800);
    await c.click([".modal button", "Cancel"]).catch(() => {});
  },

  async aspect(c, r) {
    await c.zoom(80);
    await c.place("oldstreet", { start: 0 });
    await c.tab("text");
    await c.setTime(0);
    await c.click([".tile", "Bold display"]);
    await c.setTime(2);
    await c.select(null);
    await r.start("aspect");
    const sel = await c.find("[title='Project size']");
    for (const v of ["3", "4", "0"]) {
      await selectIn(c, sel, v);
      await sleep(1400);
    }
  },

  async "ai-assistant"(c, r) {
    await c.zoom(80);
    await c.place("bridge", { start: 0 });
    await c.tab("ai");
    await c.setTime(0);
    await r.start("ai-assistant");
    const ta = await c.find(".panel-body textarea");
    await c.click(ta);
    await c.type('Add a cinematic title "AMSTERDAM 2050" that fades in with a slow zoom, a thin line under it, and give the video a teal & orange look.', { delay: 22 });
    await c.click([".panel-body button", "Send"]);
    r.fast(12);
    await c.page.waitForFunction(() => !document.querySelector(".msg.assistant .spin") && document.querySelectorAll(".msg.assistant").length > 0, { timeout: 400000, polling: 500 });
    r.normal();
    const reply = await c.page.evaluate(() => [...document.querySelectorAll(".msg.assistant")].at(-1).textContent);
    if (reply.startsWith("❌")) throw new Error(`AI: ${reply.slice(0, 120)}`);
    await sleep(1500);
    await c.play(5, 0);
  },

  async "ai-subtitles"(c, r) {
    await c.zoom(70);
    await c.place("oldstreet", { start: 0, duration: 12 });
    const sp = await c.place("speech", { start: 0 });
    await c.select(sp);
    await c.tab("ai");
    await r.start("ai-subtitles");
    const tas = await c.page.$$(".panel-body textarea");
    const script = tas[tas.length - 1];
    await script.evaluate((e) => e.scrollIntoView({ block: "center" }));
    await c.click(script);
    await c.type("Welcome to my travel diary. Today we explore the old city by the canals. Every bridge here has a story. Let's go and find out.", { delay: 12 });
    await c.click([".panel-body button", "Sync script to speech"]);
    r.fast(12);
    await c.page.waitForFunction(() => window.__S.getState().project.tracks.some((t) => t.name === "Captions") && !window.__S.getState().busy, { timeout: 400000, polling: 500 });
    r.normal();
    await sleep(800);
    await c.play(7, 0);
  },

  // last: it removes everything but the photos from the library
  async slideshow(c, r) {
    await c.zoom(55);
    await c.page.evaluate(() => { const s = window.__S.getState(); for (const m of Object.values(s.media)) if (m.kind !== "image" || !m.name.startsWith("photo_")) s.removeMedia(m.id); });
    await c.tab("media");
    await r.start("slideshow");
    await c.move([".panel-body button", "Import photos"]);
    await sleep(500);
    await c.click([".panel-body button", "Photo slideshow"]);
    await sleep(800);
    await c.play(7, 0);
  },
};

/* ---------- runner ---------- */
const asked = process.argv.slice(2);
const names = asked.length ? asked : Object.keys(DEMOS);
const c = await launch();
const failed = [];
const run = async (n) => {
  const r = new Rec(c);
  try {
    const opts = await DEMOS[n](c, r);
    await r.stop(opts ?? {});
  } catch (e) {
    failed.push(n);
    console.log(`  ${n} FAILED: ${e.message.split("\n")[0]}`);
    await r.stop().catch(() => {});
  }
  if (c.errors.length) console.log("  page errors:", c.errors.splice(0).slice(0, 5));
};
if (names.includes("import")) await run("import");
await c.reset();
await c.importFiles(CORE);
/** after an unexpected page reload: reconnect, and import the media again if it didn't come back */
const recover = async () => {
  if (await c.attach()) return;
  console.log("  (the page reloaded: reconnecting)");
  await c.waitIdle(0);
  if (Object.keys(await c.st(() => window.__S.getState().media)).length < CORE.length) {
    await c.reset();
    await c.importFiles(CORE);
  }
};
for (const n of names.filter((n) => n !== "import" && n !== "slideshow")) {
  if (!DEMOS[n]) {
    console.log("unknown demo", n);
    continue;
  }
  await recover();
  await c.reset({ keepMedia: true });
  await run(n);
}
if (names.includes("slideshow")) {
  await recover();
  await c.reset({ keepMedia: true });
  await run("slideshow");
}
await c.browser.close();
fs.rmSync(c.profile, { recursive: true, force: true });
if (failed.length) {
  console.log("failed:", failed.join(", "));
  process.exitCode = 1;
}
