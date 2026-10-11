import { create } from "zustand";
import type { Clip, MediaItem, Project, Track, TrackKind } from "./types";
import { makeTrack, newProject, uid } from "./factory";

export type LeftTab = "media" | "text" | "elements" | "effects" | "transitions" | "audio" | "ai";

interface HistoryEntry {
  project: Project;
  key?: string;
  at: number;
}

interface State {
  project: Project;
  media: Record<string, MediaItem>;
  selected: string[];
  currentTime: number;
  playing: boolean;
  zoom: number; // px per second
  snapping: boolean;
  leftTab: LeftTab;
  past: HistoryEntry[];
  future: Project[];
  clipboard: Clip[];
  toast: { msg: string; kind: "info" | "error" | "ok"; id: number } | null;
  busy: string | null;
  loop: boolean;
  previewQuality: number; // 0.25..1
  /** asks the Inspector to show a specific part of a clip (e.g. an effect clicked on the timeline) */
  focus: { clipId: string; tab: string; key?: string; at: number } | null;
  /** when set, the next click on the preview reports a point in project coordinates */
  pick: { label: string; cb: (x: number, y: number) => void } | null;

  commit: (fn: (p: Project) => void, mergeKey?: string) => void;
  setProject: (p: Project) => void;
  undo: () => void;
  redo: () => void;

  addMedia: (m: MediaItem) => void;
  updateMedia: (id: string, patch: Partial<MediaItem>) => void;
  removeMedia: (id: string) => void;

  addClip: (c: Clip) => void;
  updateClip: (id: string, fn: (c: Clip, p: Project) => void, mergeKey?: string) => void;
  deleteClips: (ids: string[], ripple?: boolean) => void;
  splitAt: (time: number, ids?: string[]) => void;
  duplicate: (ids: string[]) => void;
  copy: () => void;
  paste: () => void;

  addTrack: (kind: TrackKind) => string;
  updateTrack: (id: string, patch: Partial<Track>) => void;
  removeTrack: (id: string) => void;
  ensureTrackFor: (kind: TrackKind, start: number, duration: number, preferred?: string) => string;

  select: (ids: string[], additive?: boolean) => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  setZoom: (z: number) => void;
  setLeftTab: (t: LeftTab) => void;
  notify: (msg: string, kind?: "info" | "error" | "ok") => void;
  setBusy: (b: string | null) => void;
  set: (patch: Partial<State>) => void;
  focusClip: (clipId: string, tab: string, key?: string) => void;
}

const MAX_HISTORY = 120;

export const overlaps = (p: Project, trackId: string, start: number, duration: number, ignore: string[] = []) =>
  p.clips.some(
    (c) => c.trackId === trackId && !ignore.includes(c.id) && start < c.start + c.duration - 1e-3 && start + duration > c.start + 1e-3,
  );

export const useStore = create<State>((set, get) => ({
  project: newProject(),
  media: {},
  selected: [],
  currentTime: 0,
  playing: false,
  zoom: 80,
  snapping: true,
  leftTab: "media",
  past: [],
  future: [],
  clipboard: [],
  toast: null,
  busy: null,
  loop: false,
  previewQuality: 1,
  focus: null,
  pick: null,

  commit: (fn, mergeKey) => {
    const { project, past } = get();
    const next = structuredClone(project);
    fn(next);
    const now = Date.now();
    const last = past[past.length - 1];
    let newPast = past;
    if (!(mergeKey && last && last.key === mergeKey && now - last.at < 1500)) {
      newPast = [...past, { project, key: mergeKey, at: now }].slice(-MAX_HISTORY);
    } else {
      newPast = [...past.slice(0, -1), { ...last, at: now }];
    }
    set({ project: next, past: newPast, future: [] });
  },

  setProject: (p) => set({ project: p, past: [], future: [], selected: [] }),

  undo: () => {
    const { past, project, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ project: prev.project, past: past.slice(0, -1), future: [project, ...future] });
  },
  redo: () => {
    const { past, project, future } = get();
    const next = future[0];
    if (!next) return;
    set({ project: next, future: future.slice(1), past: [...past, { project, at: 0 }] });
  },

  addMedia: (m) => set((s) => ({ media: { ...s.media, [m.id]: m } })),
  updateMedia: (id, patch) => set((s) => ({ media: { ...s.media, [id]: { ...s.media[id], ...patch } } })),
  removeMedia: (id) => {
    get().commit((p) => {
      p.clips = p.clips.filter((c) => c.mediaId !== id);
    });
    set((s) => {
      const m = { ...s.media };
      delete m[id];
      return { media: m };
    });
  },

  addClip: (c) => {
    get().commit((p) => {
      p.clips.push(c);
    });
    set({ selected: [c.id] });
  },

  updateClip: (id, fn, mergeKey) =>
    get().commit((p) => {
      const c = p.clips.find((x) => x.id === id);
      if (c) fn(c, p);
    }, mergeKey),

  deleteClips: (ids, ripple = false) => {
    if (!ids.length) return;
    get().commit((p) => {
      const removed = p.clips.filter((c) => ids.includes(c.id));
      p.clips = p.clips.filter((c) => !ids.includes(c.id));
      if (ripple) {
        for (const r of removed.sort((a, b) => b.start - a.start)) {
          for (const c of p.clips) {
            if (c.trackId === r.trackId && c.start >= r.start + r.duration - 1e-3) c.start -= r.duration;
          }
        }
      }
    });
    set({ selected: [] });
  },

  splitAt: (time, ids) => {
    const { project, selected } = get();
    const targets = (ids ?? (selected.length ? selected : project.clips.map((c) => c.id))).filter((id) => {
      const c = project.clips.find((x) => x.id === id);
      return c && time > c.start + 0.02 && time < c.start + c.duration - 0.02;
    });
    if (!targets.length) return;
    const newIds: string[] = [];
    get().commit((p) => {
      for (const id of targets) {
        const c = p.clips.find((x) => x.id === id)!;
        const local = time - c.start;
        const right: Clip = structuredClone(c);
        right.id = uid("clip");
        right.start = time;
        right.duration = c.duration - local;
        right.offset = c.offset + local * c.speed;
        right.transitionIn = { type: "none", duration: 0.5 };
        right.animIn = "none";
        right.audio.fadeIn = 0;
        // split keyframes
        for (const k of Object.keys(c.keyframes) as (keyof Clip["keyframes"])[]) {
          const kfs = c.keyframes[k]!;
          right.keyframes[k] = kfs.filter((f) => f.t >= local).map((f) => ({ ...f, t: f.t - local }));
          c.keyframes[k] = kfs.filter((f) => f.t <= local);
        }
        c.duration = local;
        c.transitionOut = { type: "none", duration: 0.5 };
        c.animOut = "none";
        c.audio.fadeOut = 0;
        p.clips.push(right);
        newIds.push(right.id);
      }
    });
    set({ selected: newIds });
  },

  duplicate: (ids) => {
    const newIds: string[] = [];
    get().commit((p) => {
      for (const id of ids) {
        const c = p.clips.find((x) => x.id === id);
        if (!c) continue;
        const d = structuredClone(c);
        d.id = uid("clip");
        d.start = c.start + c.duration;
        let guard = 0;
        while (overlaps(p, d.trackId, d.start, d.duration) && guard++ < 50) {
          const blocker = p.clips.find((x) => x.trackId === d.trackId && d.start < x.start + x.duration && d.start + d.duration > x.start)!;
          d.start = blocker.start + blocker.duration;
        }
        p.clips.push(d);
        newIds.push(d.id);
      }
    });
    set({ selected: newIds });
  },

  copy: () => {
    const { project, selected } = get();
    set({ clipboard: structuredClone(project.clips.filter((c) => selected.includes(c.id))) });
  },
  paste: () => {
    const { clipboard, currentTime } = get();
    if (!clipboard.length) return;
    const minStart = Math.min(...clipboard.map((c) => c.start));
    const ids: string[] = [];
    get().commit((p) => {
      for (const c of clipboard) {
        const d = structuredClone(c);
        d.id = uid("clip");
        d.start = currentTime + (c.start - minStart);
        if (overlaps(p, d.trackId, d.start, d.duration)) {
          const kind = p.tracks.find((t) => t.id === d.trackId)?.kind ?? "video";
          const free = p.tracks.find((t) => t.kind === kind && !overlaps(p, t.id, d.start, d.duration));
          if (free) d.trackId = free.id;
          else {
            const t = makeTrack(kind, `${kind === "video" ? "Video" : "Audio"} ${p.tracks.length + 1}`);
            if (kind === "video") p.tracks.unshift(t);
            else p.tracks.push(t);
            d.trackId = t.id;
          }
        }
        p.clips.push(d);
        ids.push(d.id);
      }
    });
    set({ selected: ids });
  },

  addTrack: (kind) => {
    const t = makeTrack(kind, `${kind === "video" ? "Video" : "Audio"} ${get().project.tracks.filter((x) => x.kind === kind).length + 1}`);
    get().commit((p) => {
      if (kind === "video") p.tracks.unshift(t);
      else p.tracks.push(t);
    });
    return t.id;
  },
  updateTrack: (id, patch) =>
    get().commit((p) => {
      const t = p.tracks.find((x) => x.id === id);
      if (t) Object.assign(t, patch);
    }),
  removeTrack: (id) =>
    get().commit((p) => {
      p.tracks = p.tracks.filter((t) => t.id !== id);
      p.clips = p.clips.filter((c) => c.trackId !== id);
    }),

  /** returns a track of `kind` that is free in [start, start+duration), creating one if needed */
  ensureTrackFor: (kind, start, duration, preferred) => {
    const p = get().project;
    if (preferred) {
      const t = p.tracks.find((x) => x.id === preferred && x.kind === kind);
      if (t && !overlaps(p, t.id, start, duration)) return t.id;
    }
    const tracks = kind === "video" ? [...p.tracks].reverse() : p.tracks;
    const free = tracks.find((t) => t.kind === kind && !t.locked && !overlaps(p, t.id, start, duration));
    if (free) return free.id;
    return get().addTrack(kind);
  },

  select: (ids, additive) =>
    set((s) => ({ selected: additive ? Array.from(new Set([...s.selected, ...ids])) : ids })),
  setTime: (t) => set({ currentTime: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (z) => set({ zoom: Math.min(600, Math.max(4, z)) }),
  setLeftTab: (leftTab) => set({ leftTab }),
  notify: (msg, kind = "info") => set({ toast: { msg, kind, id: Date.now() } }),
  setBusy: (busy) => set({ busy }),
  set: (patch) => set(patch),
  focusClip: (clipId, tab, key) => set({ selected: [clipId], focus: { clipId, tab, key, at: Date.now() } }),
}));

export const getClip = (id: string) => useStore.getState().project.clips.find((c) => c.id === id);
