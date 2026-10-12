import { useEffect, useState } from "react";
import { useStore, type MaskTool } from "../store";
import type { Clip } from "../types";
import { lastBounds, type Bounds } from "../engine/render";
import { deletePoint, ellipsePts, fromLocal, insertPoint, maskPtsAt, newMask, rectPts, setMaskPts, simplify, toLocal, tracePath } from "../engine/mask";
import { aiSelect } from "../ai/maskTools";

/** the space a clip's picture is drawn in (an effect layer covers the whole frame) */
export function maskSpace(c: Clip, W: number, H: number): Bounds | undefined {
  if (c.kind === "adjustment") return { x: W / 2, y: H / 2, w: W, h: H, sx: 1, sy: 1, rotation: 0 };
  return lastBounds.get(c.id);
}

/** picture space (0..1) → project pixels */
function toProject(c: Clip, b: Bounds, pts: number[]): number[] {
  const lp = toLocal(c, pts, b.w, b.h);
  const r = (b.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const out = new Array<number>(lp.length);
  for (let i = 0; i < lp.length; i += 2) {
    const x = lp[i] * b.sx, y = lp[i + 1] * b.sy;
    out[i] = b.x + x * cos - y * sin;
    out[i + 1] = b.y + x * sin + y * cos;
  }
  return out;
}

/** project pixels → picture space (0..1) */
function toPicture(c: Clip, b: Bounds, x: number, y: number): [number, number] {
  const r = (b.rotation * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
  const dx = x - b.x, dy = y - b.y;
  return fromLocal(c, (dx * cos + dy * sin) / b.sx, (-dx * sin + dy * cos) / b.sy, b.w, b.h);
}

const projToPicture = (c: Clip, b: Bounds, pts: number[]) => {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(...toPicture(c, b, pts[i], pts[i + 1]));
  return out;
};

function svgPath(d: number[], smooth: boolean) {
  let s = "";
  const f = (n: number) => n.toFixed(1);
  tracePath({
    moveTo: (x, y) => void (s += `M${f(x)} ${f(y)}`),
    lineTo: (x, y) => void (s += `L${f(x)} ${f(y)}`),
    bezierCurveTo: (a, b, c, d2, x, y) => void (s += `C${f(a)} ${f(b)} ${f(c)} ${f(d2)} ${f(x)} ${f(y)}`),
    closePath: () => void (s += "Z"),
  }, d, smooth);
  return s;
}

const HINT: Record<MaskTool, string> = {
  edit: "Drag points to reshape · drag inside to move · Alt-click a point to remove it",
  rect: "Drag a rectangle around what you want to keep",
  ellipse: "Drag an ellipse around what you want to keep",
  lasso: "Draw around what you want to keep",
  pen: "Click to place points · click the first point or press Enter to close",
  ai: "Click the person or object · Alt-click to exclude a part",
};

export function MaskOverlay({ clip, k, W, H }: { clip: Clip; k: number; W: number; H: number }) {
  const edit = useStore((s) => s.maskEdit)!;
  const work = useStore((s) => s.maskWork);
  const time = useStore((s) => s.currentTime);
  const [draft, setDraft] = useState<number[] | null>(null);
  const b = maskSpace(clip, W, H);
  const local = Math.min(Math.max(0, time - clip.start), clip.duration);
  const mask = clip.mask;
  const outline = mask ? maskPtsAt(mask, local) : [];
  const tool = edit.tool;
  const px = 1 / k; // one screen pixel in project units

  const setTool = (t: MaskTool) => useStore.getState().set({ maskEdit: { clipId: clip.id, tool: t } });
  const exit = () => useStore.getState().set({ maskEdit: null });

  const commitShape = (projPts: number[], smooth: boolean) => {
    if (!b || projPts.length < 6) return;
    const pic = projToPicture(clip, b, projPts);
    useStore.getState().updateClip(clip.id, (x) => {
      const keep = x.mask;
      x.mask = { ...newMask(pic, smooth), feather: keep?.feather ?? 0, expand: keep?.expand ?? 0, invert: keep?.invert ?? false };
    });
    setDraft(null);
    setTool("edit");
  };

  // keys: Enter closes the pen path, Esc leaves, Delete removes the selected point (instead of the clip)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select")) return;
      const key = e.key;
      if (key === "Escape") {
        if (draft) setDraft(null);
        else exit();
      } else if (key === "Enter" && tool === "pen" && draft && draft.length >= 6) commitShape(draft, false);
      else if ((key === "Delete" || key === "Backspace") && edit.point !== undefined) {
        const i = edit.point;
        useStore.getState().updateClip(clip.id, (x) => x.mask && deletePoint(x.mask, i));
        useStore.getState().set({ maskEdit: { ...edit, point: undefined } });
      } else if (key === "Delete" || key === "Backspace") {
        /* never delete the clip while editing its mask */
      } else return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  if (!b) {
    return (
      <div className="pick-banner">
        Move the playhead over this clip to edit its mask <button className="ghost" onClick={exit}>Done</button>
      </div>
    );
  }

  const svgPoint = (e: { clientX: number; clientY: number }, el: Element) => {
    const r = (el.closest("svg") as SVGSVGElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k };
  };

  const drag = (onMove: (ev: PointerEvent) => void, onUp?: (ev: PointerEvent) => void) => {
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", up);
      onUp?.(ev);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", up);
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const el = e.currentTarget;
    const p0 = svgPoint(e, el);
    if (tool === "rect" || tool === "ellipse") {
      drag((ev) => {
        const p = svgPoint(ev, el);
        const [x0, y0, x1, y1] = [Math.min(p0.x, p.x), Math.min(p0.y, p.y), Math.max(p0.x, p.x), Math.max(p0.y, p.y)];
        setDraft(tool === "rect" ? rectPts(x0, y0, x1, y1) : ellipsePts(x0, y0, x1, y1));
      }, (ev) => {
        const p = svgPoint(ev, el);
        if (Math.abs(p.x - p0.x) < 6 * px || Math.abs(p.y - p0.y) < 6 * px) return setDraft(null);
        const [x0, y0, x1, y1] = [Math.min(p0.x, p.x), Math.min(p0.y, p.y), Math.max(p0.x, p.x), Math.max(p0.y, p.y)];
        commitShape(tool === "rect" ? rectPts(x0, y0, x1, y1) : ellipsePts(x0, y0, x1, y1), tool === "ellipse");
      });
    } else if (tool === "lasso") {
      const pts = [p0.x, p0.y];
      setDraft(pts.slice());
      drag((ev) => {
        const p = svgPoint(ev, el);
        if (Math.hypot(p.x - pts[pts.length - 2], p.y - pts[pts.length - 1]) < 3 * px) return;
        pts.push(p.x, p.y);
        setDraft(pts.slice());
      }, () => {
        if (pts.length < 12) return setDraft(null);
        commitShape(simplify(pts, 1.5 * px, 80), true);
      });
    } else if (tool === "pen") {
      const pts = draft ?? [];
      if (pts.length >= 6 && Math.hypot(p0.x - pts[0], p0.y - pts[1]) < 9 * px) return commitShape(pts, false);
      setDraft([...pts, p0.x, p0.y]);
    } else if (tool === "ai") {
      if (work) return;
      const [u, v] = toPicture(clip, b, p0.x, p0.y);
      if (u < 0 || v < 0 || u > 1 || v > 1) return;
      const ai = [...(edit.ai ?? []), [u, v, e.altKey ? 0 : 1] as [number, number, number]];
      useStore.getState().set({ maskEdit: { ...edit, ai } });
      aiSelect(clip.id, ai);
    }
  };

  /** drags one point (or, with i = -1, the whole outline) */
  const startEdit = (e: React.PointerEvent, i: number) => {
    e.stopPropagation();
    if (e.button !== 0 || !mask) return;
    if (e.altKey && i >= 0) {
      useStore.getState().updateClip(clip.id, (x) => x.mask && deletePoint(x.mask, i));
      return;
    }
    useStore.getState().set({ maskEdit: { ...edit, point: i >= 0 ? i : undefined } });
    const el = e.currentTarget;
    const p0 = svgPoint(e, el);
    const start = toPicture(clip, b, p0.x, p0.y);
    const base = outline.slice();
    const key = `mask-edit-${clip.id}-${Date.now()}`;
    drag((ev) => {
      const p = svgPoint(ev, el);
      const [u, v] = toPicture(clip, b, p.x, p.y);
      const next = base.slice();
      if (i >= 0) {
        next[i * 2] = u;
        next[i * 2 + 1] = v;
      } else for (let j = 0; j < next.length; j += 2) {
        next[j] += u - start[0];
        next[j + 1] += v - start[1];
      }
      useStore.getState().updateClip(clip.id, (x) => x.mask && setMaskPts(x.mask, local, next), key);
    });
  };

  const insertAt = (e: React.PointerEvent, i: number) => {
    e.stopPropagation();
    useStore.getState().updateClip(clip.id, (x) => x.mask && insertPoint(x.mask, i));
    // the new point sits at index i + 1: keep dragging it
    const st = useStore.getState().project.clips.find((x) => x.id === clip.id)!;
    const pts = maskPtsAt(st.mask!, local);
    const el = e.currentTarget;
    const key = `mask-edit-${clip.id}-${Date.now()}`;
    useStore.getState().set({ maskEdit: { ...edit, point: i + 1 } });
    drag((ev) => {
      const p = svgPoint(ev, el);
      const [u, v] = toPicture(clip, b, p.x, p.y);
      const next = pts.slice();
      next[(i + 1) * 2] = u;
      next[(i + 1) * 2 + 1] = v;
      useStore.getState().updateClip(clip.id, (x) => x.mask && setMaskPts(x.mask, local, next), key);
    });
  };

  const proj = outline.length >= 6 ? toProject(clip, b, outline) : [];
  const n = proj.length / 2;
  const editing = tool === "edit" && n >= 3;
  const cursor = tool === "edit" ? "default" : "crosshair";
  const aiDots = tool === "ai" ? edit.ai ?? [] : [];

  return (
    <>
      <svg
        className="mask-svg" viewBox={`0 0 ${W} ${H}`} style={{ width: W * k, height: H * k, cursor }}
        onPointerDown={onDown} onDoubleClick={(e) => { e.stopPropagation(); if (tool === "pen" && draft && draft.length >= 8) commitShape(draft.slice(0, -2), false); }}
      >
        {n >= 3 && (
          <path
            d={svgPath(proj, mask!.smooth)}
            className={`mask-outline ${editing ? "editing" : ""}`}
            style={{ strokeWidth: 1.5 * px }}
            onPointerDown={editing ? (e) => startEdit(e, -1) : undefined}
          />
        )}
        {draft && draft.length >= 4 && (
          <path d={tool === "pen" ? `M${draft.join(" ")}` : svgPath(draft, tool !== "rect" && tool !== "lasso")} className="mask-draft" style={{ strokeWidth: 1.5 * px }} />
        )}
        {draft && tool === "pen" && draft.length >= 2 && (
          <circle cx={draft[0]} cy={draft[1]} r={6 * px} className="mask-handle first" />
        )}
        {editing && n <= 48 && Array.from({ length: n }, (_, i) => {
          const j = (i + 1) % n;
          return (
            <rect key={`m${i}`} className="mask-mid" x={(proj[i * 2] + proj[j * 2]) / 2 - 3 * px} y={(proj[i * 2 + 1] + proj[j * 2 + 1]) / 2 - 3 * px}
              width={6 * px} height={6 * px} onPointerDown={(e) => insertAt(e, i)}>
              <title>Drag to add a point</title>
            </rect>
          );
        })}
        {editing && Array.from({ length: n }, (_, i) => (
          <circle key={i} cx={proj[i * 2]} cy={proj[i * 2 + 1]} r={(n > 48 ? 3.5 : 5) * px}
            className={`mask-handle ${edit.point === i ? "sel" : ""}`} style={{ strokeWidth: 1.5 * px }}
            onPointerDown={(e) => startEdit(e, i)} />
        ))}
        {aiDots.map(([u, v, l], i) => {
          const [x, y] = toProject(clip, b, [u, v]);
          return <circle key={`ai${i}`} cx={x} cy={y} r={6 * px} className={`mask-ai ${l ? "pos" : "neg"}`} style={{ strokeWidth: 2 * px }} />;
        })}
      </svg>
      <div className="pick-banner" onPointerDown={(e) => e.stopPropagation()}>
        {work?.clipId === clip.id ? <><span className="spin" /> {work.label}{work.progress !== undefined && ` ${Math.round(work.progress * 100)}%`}</> : HINT[tool]}
        {tool === "ai" && !!edit.ai?.length && !work && (
          <button className="ghost" onClick={() => useStore.getState().set({ maskEdit: { ...edit, ai: [] } })}>Clear clicks</button>
        )}
        {tool !== "edit" && mask && <button className="ghost" onClick={() => setTool("edit")}>Edit points</button>}
        <button className="ghost" onClick={exit}>Done</button>
      </div>
    </>
  );
}
