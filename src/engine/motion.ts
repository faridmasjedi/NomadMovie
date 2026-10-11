import type { Clip, Easing, Keyframe, Project } from "../types";
import { valueAt } from "./animate";

export type MotionPreset = "zoomIn" | "zoomOut" | "punchIn" | "kenBurns" | "panLeft" | "panRight" | "panUp" | "panDown";

export const MOTION_PRESETS: [MotionPreset, string][] = [
  ["zoomIn", "Zoom in"],
  ["zoomOut", "Zoom out"],
  ["punchIn", "Punch in & back"],
  ["kenBurns", "Ken Burns"],
  ["panLeft", "Pan left"],
  ["panRight", "Pan right"],
  ["panUp", "Pan up"],
  ["panDown", "Pan down"],
];

export interface MotionOptions {
  preset: MotionPreset;
  /** clip-local start time (s) */
  start: number;
  duration: number;
  /** zoom factor, e.g. 1.4 */
  amount: number;
  /** focus point in project pixels (what the camera zooms toward) */
  focusX: number;
  focusY: number;
  ease: Easing;
}

/**
 * Writes scale / x / y keyframes so the clip zooms or pans over [start, start + duration].
 * Keyframes of those properties inside that range are replaced; the rest are kept.
 */
export function applyMotion(c: Clip, p: Project, o: MotionOptions) {
  const t0 = Math.max(0, o.start);
  const t1 = Math.min(c.duration, t0 + Math.max(0.1, o.duration));
  const x0 = valueAt(c.keyframes.x, t0, c.transform.x);
  const y0 = valueAt(c.keyframes.y, t0, c.transform.y);
  const A = Math.max(1.01, o.amount);
  const F = { x: o.focusX, y: o.focusY };
  // keeping point F fixed on screen while scaling by k moves the clip center to F - (F - c) * k
  const at = (k: number, f = F) => ({ x: f.x - (f.x - x0) * k, y: f.y - (f.y - y0) * k });
  const panR = { x: ((A - 1) * p.width) / 2, y: ((A - 1) * p.height) / 2 };

  type Pt = { t: number; k: number; x: number; y: number };
  let pts: Pt[] = [];
  switch (o.preset) {
    case "zoomIn": pts = [{ t: t0, k: 1, ...at(1) }, { t: t1, k: A, ...at(A) }]; break;
    case "zoomOut": pts = [{ t: t0, k: A, ...at(A) }, { t: t1, k: 1, ...at(1) }]; break;
    case "punchIn": {
      const d = t1 - t0;
      pts = [{ t: t0, k: 1, ...at(1) }, { t: t0 + d * 0.3, k: A, ...at(A) }, { t: t0 + d * 0.7, k: A, ...at(A) }, { t: t1, k: 1, ...at(1) }];
      break;
    }
    case "kenBurns": {
      const center = { x: p.width / 2, y: p.height / 2 };
      pts = [{ t: t0, k: 1.05, ...at(1.05, center) }, { t: t1, k: A, ...at(A) }];
      break;
    }
    case "panLeft": pts = [{ t: t0, k: A, x: x0 - panR.x, y: y0 }, { t: t1, k: A, x: x0 + panR.x, y: y0 }]; break;
    case "panRight": pts = [{ t: t0, k: A, x: x0 + panR.x, y: y0 }, { t: t1, k: A, x: x0 - panR.x, y: y0 }]; break;
    case "panUp": pts = [{ t: t0, k: A, x: x0, y: y0 - panR.y }, { t: t1, k: A, x: x0, y: y0 + panR.y }]; break;
    case "panDown": pts = [{ t: t0, k: A, x: x0, y: y0 + panR.y }, { t: t1, k: A, x: x0, y: y0 - panR.y }]; break;
  }

  const write = (prop: "scale" | "x" | "y", val: (q: Pt) => number) => {
    const keep = (c.keyframes[prop] ?? []).filter((k) => k.t < t0 - 1e-3 || k.t > t1 + 1e-3);
    const add: Keyframe[] = pts.map((q, i) => ({ t: q.t, v: val(q), ease: i === pts.length - 1 ? "linear" : o.ease }));
    c.keyframes[prop] = [...keep, ...add].sort((a, b) => a.t - b.t);
  };
  write("scale", (q) => q.k);
  write("x", (q) => q.x);
  write("y", (q) => q.y);
}

export function clearMotion(c: Clip) {
  delete c.keyframes.scale;
  delete c.keyframes.x;
  delete c.keyframes.y;
}
