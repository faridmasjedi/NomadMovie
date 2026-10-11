import { useState } from "react";
import { useStore } from "../store";
import type { Clip, MediaItem, Project } from "../types";
import { makeClip, defaultFilters } from "../factory";
import { clipGainAt } from "../engine/audio";
import { setKeyframe } from "../engine/animate";
import { EFFECTS, LOOKS } from "../engine/presets";
import { effectDef, GL_EFFECTS } from "../engine/effectsLib";
import { transitionDef, TRANSITION_DEFS } from "../engine/transitionsLib";
import { nextAdjacent, prevAdjacent, transOf } from "../engine/timeline";
import { applyMotion, clearMotion, type MotionPreset } from "../engine/motion";
import { autoDuck, beatsToMarkers, freezeFrame, normalizeClip, removeSilence, scenesForClip } from "../ai/smart";
import { openMenu, type MenuItem } from "./ContextMenu";

/* ------------------------------------------------------------------ */
/* drag & drop payloads from the Effects / Transitions panels          */
/* ------------------------------------------------------------------ */

export const FX_MIME = "nova/fx";
export interface FxPayload {
  kind: "effect" | "look" | "transition" | "anim";
  id: string;
}
export const readFx = (e: React.DragEvent): FxPayload | null => {
  try {
    const raw = e.dataTransfer.getData(FX_MIME);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};
export const hasFx = (e: React.DragEvent) => e.dataTransfer.types.includes(FX_MIME);

const S = () => useStore.getState();
const notify = (m: string, k: "ok" | "error" | "info" = "ok") => S().notify(m, k);

export function effectLabel(type: string) {
  return effectDef(type)?.label ?? EFFECTS.find((e) => e.type === type)?.label ?? type;
}

export function newEffect(id: string) {
  const g = effectDef(id);
  if (g) return { type: id, amount: g.amount, params: {} };
  const c = EFFECTS.find((e) => e.type === id);
  return { type: id, amount: c?.amount ?? 50 };
}

/** applies a dropped effect/look/transition/animation to a clip; `rel` = drop x within the clip (0..1) */
export function applyFxToClip(clipId: string, fx: FxPayload, rel: number) {
  const st = S();
  const c = st.project.clips.find((x) => x.id === clipId);
  if (!c) return;
  if (fx.kind === "effect") {
    if (c.kind === "audio") return notify("Effects apply to visual clips", "error");
    st.updateClip(c.id, (x) => {
      x.effects = x.effects.filter((e) => e.type !== fx.id);
      x.effects.push(newEffect(fx.id));
    });
    st.focusClip(c.id, "fx", fx.id);
    notify(`${effectLabel(fx.id)} added — adjust it in the Inspector`);
  } else if (fx.kind === "look") {
    const l = LOOKS.find((x) => x.id === fx.id);
    if (!l || c.kind === "audio") return;
    st.updateClip(c.id, (x) => void (x.filters = { ...defaultFilters(), ...l.f }));
    st.focusClip(c.id, "color");
  } else if (fx.kind === "anim") {
    st.updateClip(c.id, (x) => void (rel < 0.5 ? (x.animIn = fx.id as Clip["animIn"]) : (x.animOut = fx.id as Clip["animOut"])));
    st.focusClip(c.id, "anim", rel < 0.5 ? "animIn" : "animOut");
  } else if (fx.kind === "transition") {
    if (c.kind === "audio") return notify("Transitions apply to visual clips", "error");
    const tr = { type: fx.id, duration: Math.min(1, c.duration / 2) };
    const next = nextAdjacent(st.project, c);
    if (rel < 0.4) st.updateClip(c.id, (x) => void (x.transitionIn = { ...tr }));
    else if (rel > 0.6) {
      if (next) st.updateClip(next.id, (x) => void (x.transitionIn = { ...tr }));
      else st.updateClip(c.id, (x) => void (x.transitionOut = { ...tr }));
    } else st.updateClip(c.id, (x) => { x.transitionIn = { ...tr }; x.transitionOut = { ...tr }; });
    const target = rel > 0.6 && next ? next.id : c.id;
    st.focusClip(target, "anim", rel > 0.6 && !next ? "transitionOut" : "transitionIn");
    notify(`${transitionDef(fx.id)?.label ?? fx.id} added`);
  }
}

/** dropping an effect on an empty spot creates an effect layer that affects everything below */
export function addEffectLayer(fx: FxPayload, start: number, trackId?: string) {
  const st = S();
  const p = st.project;
  const dur = 5;
  const free = trackId && p.tracks.find((t) => t.id === trackId && t.kind === "video") &&
    !p.clips.some((x) => x.trackId === trackId && start < x.start + x.duration && start + dur > x.start);
  const tid = free ? trackId! : st.addTrack("video");
  const c = makeClip(S().project, "adjustment", tid, start, dur, { name: "Effect layer" });
  if (fx.kind === "effect") {
    c.effects = [newEffect(fx.id)];
    c.name = effectLabel(fx.id);
  } else if (fx.kind === "look") {
    const l = LOOKS.find((x) => x.id === fx.id);
    if (l) c.filters = { ...defaultFilters(), ...l.f };
    c.name = `Look: ${l?.label ?? fx.id}`;
  }
  st.addClip(c);
  st.focusClip(c.id, fx.kind === "look" ? "color" : "fx", fx.id);
}

/* ------------------------------------------------------------------ */
/* right-click menu                                                    */
/* ------------------------------------------------------------------ */

const run = (fn: () => unknown, ok?: (r: unknown) => string) => {
  try {
    const r = fn();
    if (r instanceof Promise) r.then((v) => ok && notify(ok(v))).catch((e) => notify(e.message ?? String(e), "error"));
    else if (ok) notify(ok(r));
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), "error");
  }
};

function setSpeed(c: Clip, m: MediaItem | undefined, sp: number) {
  S().updateClip(c.id, (x) => {
    const maxDur = m && x.kind !== "image" ? (m.duration - x.offset) / sp : Infinity;
    x.duration = Math.min(maxDur, (x.duration * x.speed) / sp);
    x.speed = sp;
  });
}

function motion(c: Clip, preset: MotionPreset, amount = 1.3) {
  const st = S();
  const local = Math.min(Math.max(0, st.currentTime - c.start), Math.max(0, c.duration - 0.5));
  st.updateClip(c.id, (x, p) =>
    applyMotion(x, p, { preset, start: preset === "kenBurns" || preset.startsWith("pan") ? 0 : local, duration: preset === "kenBurns" || preset.startsWith("pan") ? x.duration : Math.min(1, x.duration - local), amount, focusX: p.width / 2, focusY: p.height / 2, ease: "easeInOut" }),
  );
  st.focusClip(c.id, "anim", "motion");
}

export function showClipMenu(e: React.MouseEvent, c: Clip, m: MediaItem | undefined) {
  e.preventDefault();
  e.stopPropagation();
  const st = S();
  if (!st.selected.includes(c.id)) st.select([c.id]);
  const ids = S().selected;
  const visual = c.kind !== "audio";
  const sound = (c.kind === "audio" || c.kind === "video") && !!m?.hasAudio;
  const timed = c.kind === "video" || c.kind === "audio";
  const t = st.currentTime;
  const over = t > c.start && t < c.start + c.duration;
  const fadeOpts = (key: "fadeIn" | "fadeOut"): MenuItem[] =>
    [0, 0.5, 1, 2, 3].map((v) => ({ label: v ? `${v}s` : "None", checked: c.audio[key] === v, onClick: () => st.updateClip(c.id, (x) => void (x.audio[key] = Math.min(v, x.duration))) }));
  const quickTr = (side: "in" | "out"): MenuItem[] => [
    ...["fade", "dipBlack", "dipWhite", "pushLeft", "wipeLeft", "crossZoom", "whipLeft", "flash", "cube", "glitchDisplace"].map((id) => ({
      label: transitionDef(id)?.label ?? id,
      checked: (side === "in" ? c.transitionIn.type : c.transitionOut.type) === id,
      onClick: () => applyFxToClip(c.id, { kind: "transition", id }, side === "in" ? 0 : 1),
    })),
    "sep",
    { label: "None", onClick: () => st.updateClip(c.id, (x) => void (side === "in" ? (x.transitionIn.type = "none") : (x.transitionOut.type = "none"))) },
  ];

  const items: MenuItem[] = [
    { label: "Split at playhead", shortcut: "S", disabled: !over, onClick: () => st.splitAt(t, ids) },
    { label: "Copy", shortcut: "⌘C", onClick: () => st.copy() },
    { label: "Paste at playhead", shortcut: "⌘V", disabled: !st.clipboard.length, onClick: () => st.paste() },
    { label: "Duplicate", shortcut: "⌘D", onClick: () => st.duplicate(ids) },
    "sep",
    ...(timed
      ? ([{
          label: "Speed",
          submenu: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 8].map((v) => ({ label: `${v}×${v === 1 ? " (normal)" : ""}`, checked: Math.abs(c.speed - v) < 1e-3, onClick: () => setSpeed(c, m, v) })),
        }] as MenuItem[])
      : []),
    ...(sound
      ? ([
          {
            label: "Volume",
            submenu: [
              { label: c.audio.muted ? "Unmute" : "Mute", onClick: () => st.updateClip(c.id, (x) => void (x.audio.muted = !x.audio.muted)) },
              "sep",
              ...[0.25, 0.5, 0.75, 1, 1.5, 2].map((v) => ({ label: `${Math.round(v * 100)}%`, checked: Math.abs(c.audio.volume - v) < 1e-3, onClick: () => st.updateClip(c.id, (x) => void (x.audio.volume = v)) })),
            ],
          },
          { label: "Audio fade in", submenu: fadeOpts("fadeIn") },
          { label: "Audio fade out", submenu: fadeOpts("fadeOut") },
          {
            label: "Smart audio",
            submenu: [
              { label: "Remove silences", onClick: () => run(() => removeSilence(c.id), (r) => `Removed ${(r as number).toFixed(1)}s of silence`) },
              { label: "Normalize loudness", onClick: () => run(() => normalizeClip(c.id), () => "Loudness normalized") },
              { label: "Auto-duck under speech", onClick: () => run(() => autoDuck(c.id), () => "Music ducked under speech") },
              { label: "Beats → markers", onClick: () => run(() => beatsToMarkers(c.id), (n) => `${n} beats marked`) },
            ],
          },
        ] as MenuItem[])
      : []),
    ...(visual
      ? ([
          {
            label: "Zoom & pan",
            submenu: [
              { label: "Zoom in here (1s)", onClick: () => motion(c, "zoomIn") },
              { label: "Zoom out here (1s)", onClick: () => motion(c, "zoomOut") },
              { label: "Punch in & back", onClick: () => motion(c, "punchIn", 1.25) },
              { label: "Ken Burns (whole clip)", onClick: () => motion(c, "kenBurns", 1.2) },
              { label: "Pan left", onClick: () => motion(c, "panLeft", 1.2) },
              { label: "Pan right", onClick: () => motion(c, "panRight", 1.2) },
              "sep",
              { label: "More options…", onClick: () => st.focusClip(c.id, "anim", "motion") },
              { label: "Clear zoom & pan", onClick: () => st.updateClip(c.id, (x) => clearMotion(x)) },
            ],
          },
          { label: "Transition in", submenu: quickTr("in") },
          { label: "Transition out", submenu: quickTr("out") },
          ...(c.kind === "video" || c.kind === "image"
            ? ([{
                label: "Fit",
                submenu: (["contain", "cover", "stretch"] as const).map((f) => ({ label: { contain: "Fit", cover: "Fill (crop)", stretch: "Stretch" }[f], checked: c.fit === f, onClick: () => st.updateClip(c.id, (x) => void (x.fit = f)) })),
              }] as MenuItem[])
            : []),
          { label: "Reset position & size", onClick: () => st.updateClip(c.id, (x, p) => { x.transform = { ...x.transform, x: p.width / 2, y: p.height / 2, scale: 1, scaleX: 1, scaleY: 1, rotation: 0 }; clearMotion(x); }) },
          {
            label: "Effects",
            submenu: [
              ...c.effects.map((e) => ({ label: `Edit ${effectLabel(e.type)}…`, onClick: () => st.focusClip(c.id, "fx", e.type) })),
              ...(c.effects.length ? (["sep"] as MenuItem[]) : []),
              { label: "Add effect…", onClick: () => { st.setLeftTab("effects"); st.focusClip(c.id, "fx"); } },
              { label: "Remove all effects", disabled: !c.effects.length, onClick: () => st.updateClip(c.id, (x) => void (x.effects = [])) },
              { label: "Reset color", onClick: () => st.updateClip(c.id, (x) => void (x.filters = defaultFilters())) },
            ],
          },
        ] as MenuItem[])
      : []),
    ...(c.kind === "video"
      ? ([
          { label: "Freeze frame (2s)", disabled: !over, onClick: () => run(() => freezeFrame(c.id), () => "Freeze frame inserted") },
          { label: "Detect scenes", onClick: () => run(() => scenesForClip(c.id, false), (n) => `${n} scene cuts marked`) },
        ] as MenuItem[])
      : []),
    ...(c.kind === "video" && sound
      ? ([{ label: "Detach audio", onClick: () => detachAudio(c) }] as MenuItem[])
      : []),
    "sep",
    { label: "Rename…", onClick: () => { const n = prompt("Clip name", c.name); if (n) st.updateClip(c.id, (x) => void (x.name = n)); } },
    { label: "Properties", onClick: () => st.focusClip(c.id, "basic") },
    "sep",
    { label: "Delete", shortcut: "⌫", danger: true, onClick: () => st.deleteClips(ids) },
    { label: "Ripple delete", shortcut: "⇧⌫", danger: true, onClick: () => st.deleteClips(ids, true) },
  ];
  openMenu(e.clientX, e.clientY, items);
}

export function detachAudio(c: Clip) {
  const st = S();
  const trackId = st.ensureTrackFor("audio", c.start, c.duration);
  const ac = makeClip(st.project, "audio", trackId, c.start, c.duration, {
    mediaId: c.mediaId, name: `${c.name} (audio)`, offset: c.offset, speed: c.speed, audio: { ...c.audio },
  });
  ac.keyframes = c.keyframes.volume ? { volume: structuredClone(c.keyframes.volume) } : {};
  st.addClip(ac);
  st.updateClip(c.id, (x) => void (x.audio.muted = true));
  notify("Audio detached from video");
}

/* ------------------------------------------------------------------ */
/* volume line with fade handles and volume keyframes                  */
/* ------------------------------------------------------------------ */

const yOf = (g: number, top: number, bot: number) => top + (1 - Math.sqrt(Math.min(2, Math.max(0, g)) / 2)) * (bot - top);
const gOf = (y: number, top: number, bot: number) => 2 * Math.pow(1 - Math.min(1, Math.max(0, (y - top) / (bot - top))), 2);
const db = (g: number) => (g <= 0.0001 ? "-∞ dB" : `${(20 * Math.log10(g)).toFixed(1)} dB`);

export function AudioLine({ c, w, h, zoom, top }: { c: Clip; w: number; h: number; zoom: number; top: number }) {
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const bot = h - 3;
  const kfs = c.keyframes.volume ?? [];
  // the drawn curve: volume × keyframes × fades
  const n = Math.max(2, Math.min(400, Math.round(w / 3)));
  const pts: string[] = [];
  for (let i = 0; i <= n; i++) {
    const local = (i / n) * c.duration;
    pts.push(`${((local * zoom) | 0) + 0.5},${yOf(c.audio.muted ? 0 : clipGainAt(c, local), top, bot).toFixed(1)}`);
  }
  const fadeInX = c.audio.fadeIn * zoom, fadeOutX = w - c.audio.fadeOut * zoom;
  // grab areas stay clear of the clip's trim handles at both edges
  const hitPts = pts.filter((q) => {
    const x = Number(q.split(",")[0]);
    return x >= 9 && x <= w - 9;
  });
  const rect = (e: React.PointerEvent) => (e.currentTarget.closest(".clip") as HTMLElement).getBoundingClientRect();

  const drag = (e: React.PointerEvent, onMove: (x: number, y: number, shift: boolean) => string) => {
    e.stopPropagation();
    e.preventDefault();
    const r = rect(e);
    const mv = (ev: PointerEvent) => {
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      const text = onMove(x, y, ev.shiftKey);
      setTip({ x, y, text });
    };
    const up = () => {
      setTip(null);
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    S().select([c.id]);
  };

  const onLineDown = (e: React.PointerEvent) => {
    const r = rect(e);
    const x0 = e.clientX - r.left;
    const local0 = x0 / zoom;
    const g0 = clipGainAt(c, local0) || 1e-4;
    const v0 = c.audio.volume;
    const key = `vol-${c.id}-${Date.now()}`;
    drag(e, (_x, y) => {
      const g = gOf(y, top, bot);
      const nv = Math.min(3, Math.max(0, (v0 * g) / g0));
      S().updateClip(c.id, (cl) => void (cl.audio.volume = Math.round(nv * 1000) / 1000), key);
      return `Volume ${db(nv)}`;
    });
  };

  const onFadeDown = (e: React.PointerEvent, side: "fadeIn" | "fadeOut") => {
    const key = `fade-${c.id}-${Date.now()}`;
    drag(e, (x) => {
      const secs = side === "fadeIn" ? x / zoom : (w - x) / zoom;
      const v = Math.round(Math.min(c.duration / 2, Math.max(0, secs)) * 100) / 100;
      S().updateClip(c.id, (cl) => void (cl.audio[side] = v), key);
      return `${side === "fadeIn" ? "Fade in" : "Fade out"} ${v.toFixed(2)}s`;
    });
  };

  const onKfDown = (e: React.PointerEvent, i: number) => {
    const key = `kfv-${c.id}-${Date.now()}`;
    drag(e, (x, y) => {
      const g = gOf(y, top, bot);
      const v = Math.min(3, Math.max(0, g / (c.audio.volume || 1)));
      const t = Math.min(c.duration, Math.max(0, x / zoom));
      S().updateClip(c.id, (cl) => {
        const list = cl.keyframes.volume!;
        list[i] = { ...list[i], t, v };
        list.sort((a, b) => a.t - b.t);
      }, key);
      return `${db(v * c.audio.volume)} @ ${t.toFixed(2)}s`;
    });
  };

  const addKf = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = (e.currentTarget.closest(".clip") as HTMLElement).getBoundingClientRect();
    const t = (e.clientX - r.left) / zoom;
    const g = gOf(e.clientY - r.top, top, bot);
    S().updateClip(c.id, (cl) => setKeyframe(cl, "volume", t, Math.min(3, g / (cl.audio.volume || 1)), "linear"));
  };

  return (
    <>
      <svg className="aline" width={w} height={h} style={{ pointerEvents: "none" }}>
        {c.audio.fadeIn > 0 && <path d={`M0,${top} L${fadeInX},${top} L0,${bot} Z`} className="fade-area" />}
        {c.audio.fadeOut > 0 && <path d={`M${w},${top} L${fadeOutX},${top} L${w},${bot} Z`} className="fade-area" />}
        <polyline points={pts.join(" ")} className="vol-line" />
        <polyline
          points={hitPts.join(" ")}
          className="vol-hit"
          style={{ pointerEvents: "stroke" }}
          onPointerDown={onLineDown}
          onDoubleClick={addKf}
        >
          <title>Drag to change volume · double-click to add a keyframe</title>
        </polyline>
        {kfs.map((k, i) => (
          <circle
            key={i}
            cx={k.t * zoom}
            cy={yOf(c.audio.volume * k.v, top, bot)}
            r={4}
            className="vol-kf"
            style={{ pointerEvents: "all" }}
            onPointerDown={(e) => onKfDown(e, i)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              S().updateClip(c.id, (cl) => {
                cl.keyframes.volume!.splice(i, 1);
                if (!cl.keyframes.volume!.length) delete cl.keyframes.volume;
              });
            }}
          >
            <title>Drag to move · double-click to delete</title>
          </circle>
        ))}
        <rect x={Math.min(w / 2 - 10, Math.max(9, fadeInX - 5))} y={top - 5} width={10} height={10} rx={2} className="fade-handle" style={{ pointerEvents: "all" }} onPointerDown={(e) => onFadeDown(e, "fadeIn")}>
          <title>Drag to set the audio fade-in</title>
        </rect>
        <rect x={Math.max(w / 2, Math.min(w - 19, fadeOutX - 5))} y={top - 5} width={10} height={10} rx={2} className="fade-handle" style={{ pointerEvents: "all" }} onPointerDown={(e) => onFadeDown(e, "fadeOut")}>
          <title>Drag to set the audio fade-out</title>
        </rect>
      </svg>
      {tip && <div className="aline-tip" style={{ left: Math.min(w - 90, Math.max(0, tip.x + 8)), top: Math.max(0, tip.y - 22) }}>{tip.text}</div>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* transition badges drawn on the cuts                                 */
/* ------------------------------------------------------------------ */

export function TransitionBadges({ p, trackId, zoom }: { p: Project; trackId: string; zoom: number }) {
  const out: JSX.Element[] = [];
  for (const c of p.clips) {
    if (c.trackId !== trackId) continue;
    const tin = transOf(c.transitionIn);
    if (tin) {
      const prev = prevAdjacent(p, c);
      const d = prev ? Math.min(tin.duration, prev.duration, c.duration) : Math.min(tin.duration, c.duration);
      const x = (prev ? c.start - d / 2 : c.start) * zoom;
      out.push(<Badge key={`${c.id}-in`} c={c} side="transitionIn" x={x} w={d * zoom} label={tin.def.label} zoom={zoom} />);
    }
    const tout = transOf(c.transitionOut);
    const next = nextAdjacent(p, c);
    if (tout && !(next && transOf(next.transitionIn))) {
      const d = Math.min(tout.duration, c.duration);
      out.push(<Badge key={`${c.id}-out`} c={c} side="transitionOut" x={(c.start + c.duration - d) * zoom} w={d * zoom} label={tout.def.label} zoom={zoom} />);
    }
  }
  return <>{out}</>;
}

function Badge({ c, side, x, w, label, zoom }: { c: Clip; side: "transitionIn" | "transitionOut"; x: number; w: number; label: string; zoom: number }) {
  const resize = (e: React.PointerEvent, edge: "l" | "r") => {
    e.stopPropagation();
    const x0 = e.clientX;
    const d0 = c[side].duration;
    const key = `trd-${c.id}-${Date.now()}`;
    const mv = (ev: PointerEvent) => {
      const dx = ((ev.clientX - x0) / zoom) * (edge === "r" ? 1 : -1);
      const d = Math.max(0.1, Math.min(c.duration, d0 + dx * (side === "transitionIn" && x < c.start * zoom ? 2 : 1)));
      S().updateClip(c.id, (cl) => void (cl[side].duration = Math.round(d * 100) / 100), key);
    };
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      className="tr-badge"
      style={{ left: x, width: Math.max(14, w) }}
      title={`${label} · ${c[side].duration.toFixed(2)}s — click to edit, drag edges to change length, right-click to remove`}
      onPointerDown={(e) => {
        e.stopPropagation();
        S().focusClip(c.id, "anim", side);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.clientX, e.clientY, [
          { label: "Edit transition…", onClick: () => S().focusClip(c.id, "anim", side) },
          {
            label: "Duration",
            submenu: [0.25, 0.5, 0.75, 1, 1.5, 2, 3].map((v) => ({ label: `${v}s`, checked: Math.abs(c[side].duration - v) < 1e-3, onClick: () => S().updateClip(c.id, (cl) => void (cl[side].duration = v)) })),
          },
          {
            label: "Replace with",
            submenu: TRANSITION_DEFS.slice(0, 24).map((t) => ({ label: t.label, onClick: () => S().updateClip(c.id, (cl) => void (cl[side].type = t.id)) })),
          },
          "sep",
          { label: "Remove transition", danger: true, onClick: () => S().updateClip(c.id, (cl) => void (cl[side].type = "none")) },
        ]);
      }}
    >
      <div className="tr-edge l" onPointerDown={(e) => resize(e, "l")} />
      <span>⇄ {w > 50 ? label : ""}</span>
      <div className="tr-edge r" onPointerDown={(e) => resize(e, "r")} />
    </div>
  );
}

export const ALL_EFFECT_IDS = [...GL_EFFECTS.map((e) => e.id), ...EFFECTS.map((e) => e.type)];
