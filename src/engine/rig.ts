import type { Clip, MediaItem, Project } from "../types";
import { frameState, valueAt } from "./animate";
import { contentSize } from "./render";

/*
 * Rigging helpers: parenting and anchor points. Both change how a clip's transform is interpreted, so they
 * convert the clip's position (and position keyframes) to keep it exactly where it is on screen.
 */

type Pose = { x: number; y: number; sx: number; sy: number; rotation: number };

/** a clip's pose without motion presets or in/out animations — its "rest" pose at clip-local time */
function restState(c: Clip, local: number, p: Project) {
  return frameState({ ...c, behaviors: undefined, animIn: "none", animOut: "none" }, Math.min(Math.max(local, 0), Math.max(0, c.duration - 1e-4)), p.width, p.height);
}

/** a clip's rest pose in frame coordinates at timeline time t (through all its parents) */
function worldPose(c: Clip, p: Project, t: number, depth = 0): Pose {
  const s: Pose = restState(c, t - c.start, p);
  const par = c.parentId && depth < 8 ? p.clips.find((x) => x.id === c.parentId) : undefined;
  if (!par) return s;
  const ps = worldPose(par, p, t, depth + 1);
  const r = (ps.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const lx = s.x * ps.sx, ly = s.y * ps.sy;
  return { x: ps.x + lx * cos - ly * sin, y: ps.y + lx * sin + ly * cos, rotation: s.rotation + ps.rotation, sx: s.sx * ps.sx, sy: s.sy * ps.sy };
}

/** rewrites every position (base and keyframes) of a clip through `map` */
function mapPositions(c: Clip, map: (x: number, y: number) => [number, number]) {
  const kx = c.keyframes.x ? c.keyframes.x.map((k) => ({ ...k })) : undefined;
  const ky = c.keyframes.y ? c.keyframes.y.map((k) => ({ ...k })) : undefined;
  const xAt = (t: number) => valueAt(c.keyframes.x, t, c.transform.x);
  const yAt = (t: number) => valueAt(c.keyframes.y, t, c.transform.y);
  kx?.forEach((k) => (k.v = map(k.v, yAt(k.t))[0]));
  ky?.forEach((k) => (k.v = map(xAt(k.t), k.v)[1]));
  [c.transform.x, c.transform.y] = map(c.transform.x, c.transform.y);
  if (kx) c.keyframes.x = kx;
  if (ky) c.keyframes.y = ky;
}

/** would parenting `child` to `parentId` create a loop? */
export function makesLoop(p: Project, childId: string, parentId: string) {
  let id: string | undefined = parentId;
  for (let i = 0; id && i < 20; i++) {
    if (id === childId) return true;
    id = p.clips.find((x) => x.id === id)?.parentId;
  }
  return false;
}

/**
 * Attaches a clip to a parent (or detaches it with null) without moving it on screen at time t:
 * its transform becomes relative to the parent.
 */
export function setParent(c: Clip, parentId: string | null, p: Project, t: number) {
  if (parentId && (parentId === c.id || makesLoop(p, c.id, parentId))) return false;
  // 1) back to frame coordinates (if it had a parent)
  if (c.parentId) {
    const par = p.clips.find((x) => x.id === c.parentId);
    if (par) {
      const ps = worldPose(par, p, t);
      const r = (ps.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
      mapPositions(c, (x, y) => [ps.x + x * ps.sx * cos - y * ps.sy * sin, ps.y + x * ps.sx * sin + y * ps.sy * cos]);
      c.transform.rotation += ps.rotation;
      scaleBy(c, ps.sx, ps.sy);
    }
    delete c.parentId;
  }
  // 2) into the new parent's space
  if (parentId) {
    const par = p.clips.find((x) => x.id === parentId);
    if (!par) return false;
    const ps = worldPose(par, p, t);
    const r = (ps.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    mapPositions(c, (x, y) => {
      const dx = x - ps.x, dy = y - ps.y;
      return [(dx * cos + dy * sin) / (ps.sx || 1), (-dx * sin + dy * cos) / (ps.sy || 1)];
    });
    c.transform.rotation -= ps.rotation;
    scaleBy(c, 1 / (ps.sx || 1), 1 / (ps.sy || 1));
    c.parentId = parentId;
  }
  return true;
}

/** multiplies a clip's scale, keeping flips as flips */
function scaleBy(c: Clip, fx: number, fy: number) {
  const ax = Math.abs(fx), ay = Math.abs(fy);
  const avg = (ax + ay) / 2 || 1;
  c.transform.scale *= avg;
  c.transform.scaleX *= ax / avg;
  c.transform.scaleY *= ay / avg;
  if (fx < 0) c.transform.flipH = !c.transform.flipH;
  if (fy < 0) c.transform.flipV = !c.transform.flipV;
}

/** moves the anchor point (0..1 of the picture) without moving the picture at clip-local time `local` */
export function setAnchor(c: Clip, ax: number, ay: number, p: Project, media: MediaItem | undefined, local: number) {
  const [w, h] = contentSize(c, media, p.width, p.height);
  const s = restState(c, local, p);
  const ox = c.anchor?.x ?? 0.5, oy = c.anchor?.y ?? 0.5;
  // the anchor's position moves by the (rotated, scaled) distance between the old and new anchor
  const dx = (ax - ox) * w * s.sx, dy = (ay - oy) * h * s.sy;
  const r = (s.rotation * Math.PI) / 180;
  const mx = dx * Math.cos(r) - dy * Math.sin(r), my = dx * Math.sin(r) + dy * Math.cos(r);
  mapPositions(c, (x, y) => [x + mx, y + my]);
  if (Math.abs(ax - 0.5) < 1e-6 && Math.abs(ay - 0.5) < 1e-6) delete c.anchor;
  else c.anchor = { x: ax, y: ay };
}
