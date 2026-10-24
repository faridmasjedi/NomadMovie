import type { MediaItem } from "../types";

/*
 * Lottie animations (the JSON format After Effects animations are exported to, e.g. from LottieFiles).
 * Each one gets its own canvas player; the renderer asks for the frame at a given time, so preview and
 * export draw exactly the same frames. Lottie files loop.
 * The "light" player is used on purpose: it ignores expressions, which are JavaScript embedded in the file.
 */

import type { AnimationConfigWithData, AnimationItem, LottiePlayer } from "lottie-web";

type LottieModule = LottiePlayer;
type Anim = AnimationItem;

let lib: LottieModule | null = null;
let loading: Promise<LottieModule> | null = null;
const loadLib = () => (loading ??= import("lottie-web/build/player/lottie_light_canvas").then((m) => (lib = ((m as { default?: LottieModule }).default ?? m) as LottieModule)));

interface Player {
  anim: Anim;
  canvas: HTMLCanvasElement;
  frames: number;
  last: number;
}
const players = new Map<string, Player>();
const data = new Map<string, unknown>();
let onReady: () => void = () => {};
export const setLottieReadyListener = (fn: () => void) => (onReady = fn);

interface LottieJson {
  v?: string;
  fr?: number;
  ip?: number;
  op?: number;
  w?: number;
  h?: number;
  layers?: unknown[];
}

/** is this parsed JSON a Lottie animation? */
export const isLottie = (j: unknown): j is LottieJson =>
  !!j && typeof j === "object" && typeof (j as LottieJson).fr === "number" && typeof (j as LottieJson).op === "number" && Array.isArray((j as LottieJson).layers);

/** reads a Lottie file into a media item (picture size, frame rate, length, thumbnail) */
export async function loadLottie(file: Blob, id: string, name: string): Promise<MediaItem> {
  const json = JSON.parse(await file.text());
  if (!isLottie(json)) throw new Error(`${name} is a JSON file but not a Lottie animation. (To open a project, use the folder button at the top.)`);
  const fr = json.fr || 30, frames = Math.max(1, (json.op ?? 1) - (json.ip ?? 0));
  data.set(id, json);
  const item: MediaItem = {
    id, name, kind: "image", url: "", duration: frames / fr, width: json.w || 512, height: json.h || 512, hasAudio: false, blob: file,
    lottie: { fr, frames },
  };
  await loadLib();
  const c = lottieFrame(item, (frames / fr) * 0.5);
  if (c) {
    const t = document.createElement("canvas");
    t.height = 90;
    t.width = Math.max(1, Math.round((90 * item.width) / item.height));
    const g = t.getContext("2d")!;
    g.fillStyle = "#2a2c35";
    g.fillRect(0, 0, t.width, t.height);
    g.drawImage(c, 0, 0, t.width, t.height);
    item.thumb = t.toDataURL("image/png");
  }
  return item;
}

/** the animation's picture at `time` seconds (looping), or null while the player is loading */
export function lottieFrame(m: MediaItem, time: number): HTMLCanvasElement | null {
  if (!m.lottie) return null;
  if (!lib) {
    loadLib().then(() => onReady());
    return null;
  }
  let p = players.get(m.id);
  if (!p) {
    const json = data.get(m.id);
    if (!json) return null;
    const canvas = document.createElement("canvas");
    canvas.width = m.width;
    canvas.height = m.height;
    const anim = lib.loadAnimation({
      renderer: "canvas",
      loop: false,
      autoplay: false,
      // the player mutates its data: give it a copy
      animationData: structuredClone(json),
      rendererSettings: { context: canvas.getContext("2d")!, clearCanvas: true, preserveAspectRatio: "xMidYMid meet" },
    } as AnimationConfigWithData<"canvas">);
    // embedded images load asynchronously: redraw when they arrive
    anim.addEventListener("loaded_images", () => {
      if (p) p.last = -1;
      onReady();
    });
    p = { anim, canvas, frames: m.lottie.frames, last: -1 };
    players.set(m.id, p);
  }
  const f = ((time * m.lottie.fr) % p.frames + p.frames) % p.frames;
  if (Math.abs(f - p.last) > 1e-3) {
    p.anim.goToAndStop(f, true);
    p.last = f;
  }
  return p.canvas;
}

export function disposeLottie(id: string) {
  players.get(id)?.anim.destroy();
  players.delete(id);
  data.delete(id);
}
