import type { AnimPreset, AnimProp, Clip, Easing, Keyframe } from "../types";
import { applyBehaviors } from "./behaviors";

export const EASE: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  backOut: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  bounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  elastic: (t) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  hold: (t) => (t < 1 ? 0 : 1),
};

export function valueAt(kfs: Keyframe[] | undefined, t: number, base: number): number {
  if (!kfs || kfs.length === 0) return base;
  if (kfs.length === 1 || t <= kfs[0].t) return kfs[0].v;
  const last = kfs[kfs.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (t >= a.t && t <= b.t) {
      const p = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return a.v + (b.v - a.v) * EASE[a.ease](p);
    }
  }
  return base;
}

export interface FrameState {
  x: number;
  y: number;
  sx: number;
  sy: number;
  rotation: number;
  opacity: number;
  blur: number;
  /** 0..1 portion of text revealed (typewriter / word by word) */
  reveal: number;
  revealMode: "chars" | "words";
  /** clip mask in normalized frame coords for wipes, or circle radius fraction */
  wipe?: { dir: "left" | "right" | "up"; p: number } | { circle: number };
  brightness: number; // multiplier
}

const ANIM_ENTRIES: [AnimPreset, string][] = [
  ["none", "None"], ["fade", "Fade"], ["slideUp", "Slide up"], ["slideDown", "Slide down"], ["slideLeft", "Slide left"],
  ["slideRight", "Slide right"], ["pop", "Pop"], ["zoom", "Zoom"], ["bounce", "Bounce"], ["spin", "Rotation"],
  ["typewriter", "Typewriter"], ["wordByWord", "Word by word"], ["blur", "Blur"], ["elastic", "Elastic"],
];
export const ANIM_PRESETS = ANIM_ENTRIES;



/** applies an entrance (dir=1, p:0→1) or exit (dir=-1, p:1→0) animation preset */
function applyPreset(s: FrameState, preset: AnimPreset, p: number, W: number, H: number) {
  const q = 1 - p;
  switch (preset) {
    case "fade": s.opacity *= p; break;
    case "slideUp": s.y += q * H * 0.15; s.opacity *= Math.min(1, p * 2); break;
    case "slideDown": s.y -= q * H * 0.15; s.opacity *= Math.min(1, p * 2); break;
    case "slideLeft": s.x += q * W * 0.2; s.opacity *= Math.min(1, p * 2); break;
    case "slideRight": s.x -= q * W * 0.2; s.opacity *= Math.min(1, p * 2); break;
    case "pop": { const e = EASE.backOut(p); s.sx *= e; s.sy *= e; s.opacity *= Math.min(1, p * 3); break; }
    case "zoom": s.sx *= 0.4 + 0.6 * p; s.sy *= 0.4 + 0.6 * p; s.opacity *= p; break;
    case "bounce": s.y -= (1 - EASE.bounce(p)) * H * 0.3; break;
    case "spin": s.rotation -= q * 180; s.sx *= p; s.sy *= p; break;
    case "typewriter": s.reveal = Math.min(s.reveal, p); s.revealMode = "chars"; break;
    case "wordByWord": s.reveal = Math.min(s.reveal, p); s.revealMode = "words"; break;
    case "blur": s.blur += q * 30; s.opacity *= p; break;
    case "elastic": { const e = EASE.elastic(p); s.sx *= e; s.sy *= e; break; }
  }
}

export function frameState(c: Clip, local: number, W: number, H: number): FrameState {
  const k = c.keyframes;
  const tr = c.transform;
  const scale = valueAt(k.scale, local, 1) * tr.scale;
  const s: FrameState = {
    x: valueAt(k.x, local, tr.x),
    y: valueAt(k.y, local, tr.y),
    sx: scale * valueAt(k.scaleX, local, 1) * tr.scaleX * (tr.flipH ? -1 : 1),
    sy: scale * valueAt(k.scaleY, local, 1) * tr.scaleY * (tr.flipV ? -1 : 1),
    rotation: valueAt(k.rotation, local, 0) + tr.rotation,
    opacity: valueAt(k.opacity, local, 1) * tr.opacity,
    blur: valueAt(k.blur, local, 0),
    reveal: 1,
    revealMode: "chars",
    brightness: 1,
  };
  if (c.animIn !== "none" && local < c.animInDur) applyPreset(s, c.animIn, Math.max(0, local / c.animInDur), W, H);
  const fromEnd = c.duration - local;
  if (c.animOut !== "none" && fromEnd < c.animOutDur) applyPreset(s, c.animOut, Math.max(0, fromEnd / c.animOutDur), W, H);
  applyBehaviors(s, c.behaviors, local, W, H);
  return s;
}

export const PROP_LABEL: Record<AnimProp, string> = {
  x: "Position X", y: "Position Y", scale: "Scale", scaleX: "Scale X", scaleY: "Scale Y", rotation: "Rotation",
  opacity: "Opacity", blur: "Blur", volume: "Volume",
};

/** base value shown/recorded for a property when adding a keyframe */
export function currentPropValue(c: Clip, prop: AnimProp, local: number) {
  const base: Record<AnimProp, number> = {
    x: c.transform.x, y: c.transform.y, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, blur: 0, volume: 1,
  };
  return valueAt(c.keyframes[prop], local, base[prop]);
}

export function setKeyframe(c: Clip, prop: AnimProp, t: number, v: number, ease: Easing = "easeInOut") {
  const list = (c.keyframes[prop] ??= []);
  const existing = list.find((f) => Math.abs(f.t - t) < 1 / 60);
  if (existing) existing.v = v;
  else list.push({ t, v, ease });
  list.sort((a, b) => a.t - b.t);
}
