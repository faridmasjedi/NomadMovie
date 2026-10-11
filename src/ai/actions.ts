import { useStore } from "../store";
import { makeClip, defaultText, defaultShape, clipFromMedia, projectDuration } from "../factory";
import { LOOKS, FONTS, EFFECTS } from "../engine/presets";
import { ANIM_PRESETS, TRANSITIONS } from "../engine/animate";
import type { AnimProp, Clip, EffectType, Keyframe, ShapeType } from "../types";
import { autoDuck, beatsToMarkers, normalizeClip, removeSilence, scenesForClip } from "./smart";

export interface AIAction {
  op: string;
  args: Record<string, any>;
}

const S = () => useStore.getState();

/** compact description of the project sent to the model */
export function buildContext() {
  const { project: p, media, selected, currentTime } = S();
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    project: { name: p.name, width: p.width, height: p.height, fps: p.fps, background: p.background, duration: r(projectDuration(p)) },
    playhead: r(currentTime),
    selectedClipIds: selected,
    tracks: p.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, hidden: t.hidden, muted: t.muted })),
    clips: p.clips
      .slice()
      .sort((a, b) => a.start - b.start)
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        trackId: c.trackId,
        start: r(c.start),
        duration: r(c.duration),
        ...(c.mediaId ? { mediaId: c.mediaId, sourceIn: r(c.offset) } : {}),
        ...(c.speed !== 1 ? { speed: c.speed } : {}),
        ...(c.text ? { text: c.text.content, font: c.text.font, size: c.text.size, color: c.text.color } : {}),
        ...(c.shape ? { shape: c.shape.type, fill: c.shape.fill, w: c.shape.width, h: c.shape.height } : {}),
        ...(c.color ? { color: c.color } : {}),
        x: r(c.transform.x),
        y: r(c.transform.y),
        scale: r(c.transform.scale),
        opacity: c.transform.opacity,
        ...(Object.keys(c.keyframes).length ? { keyframedProps: Object.keys(c.keyframes) } : {}),
        ...(c.effects.length ? { effects: c.effects.map((e) => e.type) } : {}),
        ...(c.kind === "audio" || c.kind === "video" ? { volume: c.audio.volume } : {}),
      })),
    media: Object.values(media).map((m) => ({ id: m.id, name: m.name, kind: m.kind, duration: r(m.duration), width: m.width, height: m.height })),
    markers: p.markers.map((m) => ({ time: r(m.time), label: m.label })),
    catalog: {
      looks: LOOKS.map((l) => l.id),
      effects: EFFECTS.map((e) => e.type),
      transitions: TRANSITIONS.map((t) => t[0]),
      animPresets: ANIM_PRESETS.map((a) => a[0]),
      fonts: FONTS,
    },
  };
}

function deepMerge(target: any, patch: any) {
  for (const k of Object.keys(patch ?? {})) {
    const v = patch[k];
    if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object") deepMerge(target[k], v);
    else if (v !== undefined) target[k] = v;
  }
}

const num = (v: any, d: number) => (typeof v === "number" && isFinite(v) ? v : d);

/** executes model actions in order; returns log lines */
export async function runActions(actions: AIAction[]): Promise<string[]> {
  const refs: Record<string, string> = {};
  const log: string[] = [];
  // the whole AI response becomes a single undo step
  const pastBefore = S().past;
  const snapshot = S().project;
  const id = (v: any): string => (typeof v === "string" && v.startsWith("$") ? refs[v.slice(1)] ?? v : v);
  const clip = (cid: any): Clip => {
    const c = S().project.clips.find((x) => x.id === id(cid));
    if (!c) throw new Error(`Clip ${cid} not found`);
    return c;
  };
  /** puts the clip on a track; new visual layers stack above whatever is already visible at that time */
  const place = (c: Clip, a: Record<string, any>) => {
    const p = S().project;
    const kind = c.kind === "audio" ? "audio" : "video";
    const free = (tid: string) => !p.clips.some((x) => x.trackId === tid && c.start < x.start + x.duration - 1e-3 && c.start + c.duration > x.start + 1e-3);
    const pref = a.trackId ? p.tracks.find((t) => t.id === id(a.trackId) && t.kind === kind) : undefined;
    if (pref && free(pref.id)) c.trackId = pref.id;
    else if (kind === "audio") c.trackId = S().ensureTrackFor("audio", c.start, c.duration);
    else {
      const busyIdx = p.clips
        .filter((x) => x.kind !== "audio" && c.start < x.start + x.duration && c.start + c.duration > x.start)
        .map((x) => p.tracks.findIndex((t) => t.id === x.trackId));
      const top = busyIdx.length ? Math.min(...busyIdx) : Infinity;
      const cand = p.tracks
        .map((t, i) => ({ t, i }))
        .filter(({ t, i }) => t.kind === "video" && !t.locked && i < top && free(t.id))
        .pop();
      c.trackId = cand ? cand.t.id : S().addTrack("video");
    }
    S().addClip(c);
    if (a.ref) refs[a.ref] = c.id;
  };
  /** copies known props from args, keeping the default's type */
  const assign = (target: Record<string, any>, a: Record<string, any>, keys: readonly string[]) => {
    for (const k of keys) {
      const v = a[k];
      if (v === undefined || v === null) continue;
      if (typeof target[k] === typeof v) target[k] = v;
      else if (typeof target[k] === "number" && typeof v === "boolean") target[k] = v ? (k === "shadow" ? 16 : 1) : 0;
      else if (typeof target[k] === "string" && typeof v === "number") target[k] = String(v);
    }
  };

  for (const { op, args: a } of actions) {
    try {
      const p = S().project;
      switch (op) {
        case "add_text": {
          const text = { ...defaultText(String(a.text ?? "")), size: Math.round(p.height * 0.08) };
          assign(text, a, ["size", "color", "font", "bold", "italic", "align", "strokeColor", "strokeWidth", "shadow", "background", "letterSpacing"]);
          const c = makeClip(p, "text", "", num(a.start, S().currentTime), num(a.duration, 4), { name: String(a.text ?? "Text").slice(0, 30), text });
          c.transform.x = num(a.x, c.transform.x);
          c.transform.y = num(a.y, c.transform.y);
          if (a.animIn) c.animIn = a.animIn;
          if (a.animOut) c.animOut = a.animOut;
          if (a.animInDur) c.animInDur = a.animInDur;
          if (a.animOutDur) c.animOutDur = a.animOutDur;
          place(c, a);
          break;
        }
        case "add_shape": {
          const shape = defaultShape((a.shape ?? "rect") as ShapeType);
          assign(shape, a, ["width", "height", "fill", "gradient", "stroke", "strokeWidth", "radius"]);
          const c = makeClip(p, "shape", "", num(a.start, S().currentTime), num(a.duration, 4), { name: shape.type, shape });
          c.transform.x = num(a.x, c.transform.x);
          c.transform.y = num(a.y, c.transform.y);
          c.transform.opacity = num(a.opacity, 1);
          place(c, a);
          break;
        }
        case "add_solid": {
          const c = makeClip(p, "solid", "", num(a.start, 0), num(a.duration, 5), { name: "Color", color: a.color ?? "#000" });
          if (!a.trackId) {
            const vids = p.tracks.filter((t) => t.kind === "video");
            const bottom = [...vids].reverse().find((t) => !p.clips.some((x) => x.trackId === t.id && x.start < c.start + c.duration && x.start + x.duration > c.start));
            if (bottom) a.trackId = bottom.id;
            else {
              const nt = S().addTrack("video");
              S().commit((pp) => {
                const i = pp.tracks.findIndex((t) => t.id === nt);
                const [t] = pp.tracks.splice(i, 1);
                const lastVid = pp.tracks.map((x) => x.kind).lastIndexOf("video");
                pp.tracks.splice(lastVid + 1, 0, t);
              });
              a.trackId = nt;
            }
          }
          place(c, a);
          break;
        }
        case "add_svg": {
          const svg = String(a.svg ?? "");
          if (!svg.includes("<svg")) throw new Error("invalid SVG");
          const safe = svg.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/\son\w+="[^"]*"/gi, "");
          const c = makeClip(p, "image", "", num(a.start, S().currentTime), num(a.duration, 4), { name: "AI graphic", svg: safe });
          c.transform.x = num(a.x, c.transform.x);
          c.transform.y = num(a.y, c.transform.y);
          c.transform.scale = num(a.scale, 1);
          place(c, a);
          break;
        }
        case "add_media": {
          const m = S().media[a.mediaId];
          if (!m) throw new Error("media not found");
          const c = clipFromMedia(p, m, "", num(a.start, projectDuration(p)));
          place(c, a);
          break;
        }
        case "update_clip": {
          const c = clip(a.clipId);
          S().updateClip(c.id, (x) => {
            const patch = { ...(a.patch ?? {}) };
            delete patch.id;
            delete patch.keyframes;
            if (patch.trackId) patch.trackId = id(patch.trackId);
            deepMerge(x, patch);
          });
          break;
        }
        case "set_keyframes": {
          const c = clip(a.clipId);
          const prop = a.prop as AnimProp;
          const kfs: Keyframe[] = (a.keyframes ?? [])
            .map((k: any) => ({ t: num(k.t, 0), v: num(k.v, 0), ease: k.ease ?? "easeInOut" }))
            .sort((x: Keyframe, y: Keyframe) => x.t - y.t);
          S().updateClip(c.id, (x) => {
            if (kfs.length) x.keyframes[prop] = kfs;
            else delete x.keyframes[prop];
          });
          break;
        }
        case "set_animation": {
          const c = clip(a.clipId);
          S().updateClip(c.id, (x) => {
            if (a.animIn) x.animIn = a.animIn;
            if (a.animOut) x.animOut = a.animOut;
            if (a.animInDur) x.animInDur = a.animInDur;
            if (a.animOutDur) x.animOutDur = a.animOutDur;
          });
          break;
        }
        case "set_transition": {
          const c = clip(a.clipId);
          S().updateClip(c.id, (x) => {
            if (a.in) x.transitionIn = { type: a.in.type ?? "fade", duration: num(a.in.duration, 0.5) };
            if (a.out) x.transitionOut = { type: a.out.type ?? "fade", duration: num(a.out.duration, 0.5) };
          });
          break;
        }
        case "add_effect": {
          const c = clip(a.clipId);
          S().updateClip(c.id, (x) => {
            x.effects = x.effects.filter((e) => e.type !== a.type);
            x.effects.push({ type: a.type as EffectType, amount: num(a.amount, 50) });
          });
          break;
        }
        case "clear_effects":
          S().updateClip(clip(a.clipId).id, (x) => void (x.effects = []));
          break;
        case "apply_look": {
          const look = LOOKS.find((l) => l.id === a.look);
          if (!look) throw new Error("unknown look");
          S().updateClip(clip(a.clipId).id, (x) => {
            x.filters = { ...x.filters, brightness: 100, contrast: 100, saturation: 100, hue: 0, grayscale: 0, sepia: 0, invert: 0, vignette: 0, temperature: 0, tint: 0, ...look.f };
          });
          break;
        }
        case "split":
          S().splitAt(num(a.time, S().currentTime), a.clipId ? [id(a.clipId)] : undefined);
          break;
        case "trim": {
          const c = clip(a.clipId);
          S().updateClip(c.id, (x) => {
            const end = num(a.end, x.start + x.duration);
            if (a.start !== undefined && a.start > x.start) {
              x.offset += (a.start - x.start) * x.speed;
              x.start = a.start;
            }
            x.duration = Math.max(0.05, end - x.start);
          });
          break;
        }
        case "move_clip":
          S().updateClip(clip(a.clipId).id, (x) => {
            x.start = Math.max(0, num(a.start, x.start));
            if (a.trackId) x.trackId = id(a.trackId);
          });
          break;
        case "delete_clips":
          S().deleteClips((a.clipIds ?? []).map(id), !!a.ripple);
          break;
        case "set_speed":
          S().updateClip(clip(a.clipId).id, (x) => {
            const sp = Math.min(16, Math.max(0.1, num(a.speed, 1)));
            x.duration = (x.duration * x.speed) / sp;
            x.speed = sp;
          });
          break;
        case "add_marker":
          S().commit((pp) => void pp.markers.push({ id: crypto.randomUUID(), time: num(a.time, 0), label: a.label ?? "", color: "#ff4d6d" }));
          break;
        case "add_track": {
          const t = S().addTrack(a.kind === "audio" ? "audio" : "video");
          if (a.ref) refs[a.ref] = t;
          break;
        }
        case "set_project":
          S().commit((pp) => {
            for (const k of ["width", "height", "fps", "background", "name"] as const) if (a[k] !== undefined) (pp as any)[k] = a[k];
          });
          break;
        case "seek":
          S().setTime(num(a.time, 0));
          break;
        case "remove_silence": {
          const r = removeSilence(clip(a.clipId).id);
          log.push(`removed ${r.toFixed(1)}s of silence`);
          break;
        }
        case "auto_duck":
          autoDuck(clip(a.clipId).id);
          break;
        case "normalize":
          normalizeClip(clip(a.clipId).id);
          break;
        case "beats_to_markers":
          log.push(`${beatsToMarkers(clip(a.clipId).id)} beats found`);
          break;
        case "detect_scenes":
          log.push(`${await scenesForClip(clip(a.clipId).id, !!a.split)} scene cuts found`);
          break;
        default:
          log.push(`unknown operation: ${op}`);
      }
    } catch (e) {
      log.push(`⚠ ${op}: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (S().project !== snapshot) S().set({ past: [...pastBefore, { project: snapshot, at: Date.now() }], future: [] });
  return log;
}
