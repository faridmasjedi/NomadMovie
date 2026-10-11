import type { Clip, Project, Transition } from "../types";
import { transitionDef, type TransitionDef } from "./transitionsLib";

// Transitions live on cuts: `b.transitionIn` blends the previous adjacent clip `a` into `b`,
// centered on the cut (half before, half after). Without a previous clip it reveals `b` from
// transparent; `transitionOut` (when no next transition) hides the clip into transparent.

const EPS = 1 / 120;

export const transOf = (tr: Transition | undefined): (Transition & { def: TransitionDef }) | null => {
  if (!tr || tr.type === "none" || tr.duration <= 0) return null;
  const def = transitionDef(tr.type);
  return def ? { ...tr, def } : null;
};

export const prevAdjacent = (p: Project, c: Clip) =>
  p.clips.find((x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(x.start + x.duration - c.start) < EPS);

export const nextAdjacent = (p: Project, c: Clip) =>
  p.clips.find((x) => x.trackId === c.trackId && x.id !== c.id && Math.abs(x.start - (c.start + c.duration)) < EPS);

export type TrackOp =
  | { kind: "single"; c: Clip }
  | { kind: "trans"; a: Clip | null; b: Clip | null; p: number; def: TransitionDef };

/** what to draw on a track at time t */
export function trackOp(p: Project, trackId: string, t: number): TrackOp | null {
  const clips = p.clips.filter((x) => x.trackId === trackId);
  for (const b of clips) {
    const tr = transOf(b.transitionIn);
    if (!tr) continue;
    const a = prevAdjacent(p, b);
    if (a) {
      const d = Math.min(tr.duration, a.duration, b.duration);
      if (t >= b.start - d / 2 && t < b.start + d / 2) return { kind: "trans", a, b, p: (t - (b.start - d / 2)) / d, def: tr.def };
    } else {
      const d = Math.min(tr.duration, b.duration);
      if (t >= b.start && t < b.start + d) return { kind: "trans", a: null, b, p: (t - b.start) / d, def: tr.def };
    }
  }
  const c = clips.find((x) => t >= x.start && t < x.start + x.duration);
  if (!c) return null;
  const out = transOf(c.transitionOut);
  const n = out && nextAdjacent(p, c);
  if (out && !(n && transOf(n.transitionIn))) {
    const d = Math.min(out.duration, c.duration);
    if (t >= c.start + c.duration - d) return { kind: "trans", a: c, b: null, p: (t - (c.start + c.duration - d)) / d, def: out.def };
  }
  return { kind: "single", c };
}

/** time range in which a clip can be visible, including transition overlaps */
export function visibleWindow(p: Project, c: Clip): [number, number] {
  let start = c.start, end = c.start + c.duration;
  const tin = transOf(c.transitionIn);
  const prev = tin && prevAdjacent(p, c);
  if (tin && prev) start -= Math.min(tin.duration, prev.duration, c.duration) / 2;
  const next = nextAdjacent(p, c);
  const tn = next && transOf(next.transitionIn);
  if (next && tn) end += Math.min(tn.duration, next.duration, c.duration) / 2;
  return [start, end];
}

export const isVisibleAt = (p: Project, c: Clip, t: number) => {
  const [a, b] = visibleWindow(p, c);
  return t >= a && t < b;
};
