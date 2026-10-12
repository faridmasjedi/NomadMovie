import { useStore, getClip } from "../store";
import { allOutlines, boundsOf, maskPtsAt, newMask, normalizeOutline, setMaskPts } from "../engine/mask";
import { AI_POINTS, resultFromPts, segment, trackSubject, type SegResult } from "./segment";

const S = () => useStore.getState();
const localTime = (clipId: string) => {
  const c = getClip(clipId)!;
  return Math.min(Math.max(0, S().currentTime - c.start), Math.max(0, c.duration - 1e-3));
};

let last: { clipId: string; t: number; r: SegResult } | null = null;
let running = 0;

/** re-runs the AI selection for the clicked points and writes the outline at the playhead */
export async function aiSelect(clipId: string, points: [number, number, number][]) {
  const c = getClip(clipId);
  const m = c?.mediaId ? S().media[c.mediaId] : undefined;
  if (!c || !m || !points.length) return;
  const t = localTime(clipId);
  const job = ++running;
  S().set({ maskWork: { clipId, label: "Finding the subject…" } });
  try {
    const r = await segment(c, m, t, { points }, (label) => S().set({ maskWork: { clipId, label } }));
    if (job !== running) return;
    if (!r) {
      S().notify("Nothing found there. Click right on the subject.", "error");
      return;
    }
    last = { clipId, t, r };
    S().updateClip(clipId, (x) => {
      if (!x.mask || !x.mask.ai || (x.mask.keys.length && x.mask.keys[0].pts.length !== r.pts.length)) {
        const keep = x.mask;
        x.mask = { ...newMask(r.pts, true), feather: keep?.feather ?? 2, expand: keep?.expand ?? 0, invert: keep?.invert ?? false, ai: true };
      } else setMaskPts(x.mask, t, r.pts);
    }, `mask-ai-${clipId}`);
  } catch (e) {
    S().notify(`AI selection failed: ${e instanceof Error ? e.message : e}`, "error");
  } finally {
    if (job === running) S().set({ maskWork: null });
  }
}

let abort: AbortController | null = null;
export const stopTracking = () => abort?.abort();

/**
 * Follows the masked subject through the clip from the playhead, writing one mask key every `everyFrames` frames.
 * Keys already on that side of the playhead are replaced.
 */
export async function trackMask(clipId: string, dir: 1 | -1, everyFrames: number) {
  const st = S();
  const c = getClip(clipId);
  const m = c?.mediaId ? st.media[c.mediaId] : undefined;
  if (!c?.mask || !m || m.kind !== "video") return;
  const t0 = localTime(clipId);
  const aspect = m.width / Math.max(1, m.height);
  // start from the outline at the playhead, in the AI's point layout
  let start = maskPtsAt(c.mask, t0);
  if (start.length / 2 !== AI_POINTS) start = normalizeOutline(start, AI_POINTS, aspect);
  const first = last && last.clipId === clipId && Math.abs(last.t - t0) < 1e-3 && last.r.pts.length === start.length ? last.r : resultFromPts(start);

  const mergeKey = `mask-track-${clipId}-${Date.now()}`;
  st.updateClip(clipId, (x) => {
    const mk = x.mask!;
    if (mk.keys.length && mk.keys[0].pts.length / 2 !== AI_POINTS) {
      mk.keys = mk.keys.map((k) => ({ t: k.t, pts: normalizeOutline(k.pts, AI_POINTS, aspect) }));
    }
    if (!mk.keys.length) mk.pts = start;
    // clear this side of the playhead, then pin the start outline as a key
    mk.keys = mk.keys.filter((k) => (dir > 0 ? k.t < t0 - 1e-3 : k.t > t0 + 1e-3));
    mk.keys.push({ t: t0, pts: start });
    mk.keys.sort((a, b) => a.t - b.t);
    mk.ai = true;
  }, mergeKey);

  abort = new AbortController();
  const label = dir > 0 ? "Tracking forward…" : "Tracking backward…";
  st.set({ maskWork: { clipId, label, progress: 0 } });
  const fps = st.project.fps;
  try {
    const res = await trackSubject(c, m, t0, first, { dir, step: everyFrames / fps, signal: abort.signal },
      (t, pts) => {
        S().updateClip(clipId, (x) => setMaskPts(x.mask!, t, pts), mergeKey);
        S().setTime(c.start + t);
      },
      (p) => S().set({ maskWork: { clipId, label, progress: p } }),
      (msg) => S().set({ maskWork: { clipId, label: msg, progress: 0 } }),
    );
    if (abort.signal.aborted) S().notify(`Tracking stopped (${res.frames} keys)`, "info");
    else if (res.stoppedAt !== undefined) S().notify(`The subject was lost at ${(c.start + res.stoppedAt).toFixed(2)}s — tracked ${res.frames} keys`, "info");
    else S().notify(`Tracked: ${res.frames} mask keys`, "ok");
  } catch (e) {
    S().notify(`Tracking failed: ${e instanceof Error ? e.message : e}`, "error");
  } finally {
    abort = null;
    S().set({ maskWork: null });
  }
}

/** crops the clip to the box around its mask (over the whole animation), with a small margin */
export function cropToMask(clipId: string) {
  S().updateClip(clipId, (x) => {
    if (!x.mask) return;
    const b = boundsOf(allOutlines(x.mask).flat());
    const pad = 0.02;
    const l = Math.max(0, b.x0 - pad), r = Math.max(0, 1 - b.x1 - pad), t = Math.max(0, b.y0 - pad), btm = Math.max(0, 1 - b.y1 - pad);
    if (l + r > 0.98 || t + btm > 0.98) return;
    x.crop = { left: l * 100, right: r * 100, top: t * 100, bottom: btm * 100 };
  });
}
