import { memo, useEffect, useRef, useState } from "react";
import { useStore, overlaps } from "../store";
import type { Clip, MediaItem, Track } from "../types";
import { clipFromMedia, projectDuration, uid } from "../factory";
import { seek, pause } from "../engine/playback";
import { Icon, I } from "./ui";
import { AudioLine, TransitionBadges, addEffectLayer, applyFxToClip, effectLabel, hasFx, readFx, showClipMenu } from "./timelineParts";

const TRACK_H = { video: 74, audio: 64 };
const KIND_COLOR: Record<Clip["kind"], string> = {
  video: "var(--video)", audio: "var(--audio)", image: "#5468c9", text: "var(--text-clip)", shape: "var(--shape)", solid: "#56607a",
  adjustment: "linear-gradient(135deg, #6a3df0, #c4569f)",
};
const KIND_ICON: Record<Clip["kind"], string> = { video: "🎬", audio: "🎵", image: "🖼", text: "T", shape: "◆", solid: "■", adjustment: "✨" };

export function Timeline() {
  const project = useStore((s) => s.project);
  const media = useStore((s) => s.media);
  const zoom = useStore((s) => s.zoom);
  const selected = useStore((s) => s.selected);
  const snapping = useStore((s) => s.snapping);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  const [snapX, setSnapX] = useState<number | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const st = useStore.getState;

  const dur = projectDuration(project);
  const [viewW, setViewW] = useState(1000);
  useEffect(() => {
    const ro = new ResizeObserver(() => setViewW(scrollRef.current?.clientWidth ?? 1000));
    ro.observe(scrollRef.current!);
    return () => ro.disconnect();
  }, []);
  const totalW = Math.max(viewW, (dur + 30) * zoom);

  // keep playhead visible while playing
  useEffect(
    () =>
      useStore.subscribe((s) => {
        const el = scrollRef.current;
        if (!el || !s.playing) return;
        const x = s.currentTime * s.zoom;
        if (x > el.scrollLeft + el.clientWidth - 60 || x < el.scrollLeft) el.scrollLeft = x - 80;
      }),
    [],
  );

  const xToTime = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return Math.max(0, (clientX - r.left + el.scrollLeft) / zoom);
  };

  const snapPoints = (exclude: string[]) => {
    const s = st();
    const pts = [0, s.currentTime, ...s.project.markers.map((m) => m.time)];
    for (const c of s.project.clips) if (!exclude.includes(c.id)) pts.push(c.start, c.start + c.duration);
    return pts;
  };
  const snap = (t: number, exclude: string[], extraEdge?: number): { t: number; at: number | null } => {
    if (!st().snapping) return { t, at: null };
    const thr = 8 / zoom;
    let best: { t: number; at: number | null; d: number } = { t, at: null, d: thr };
    for (const p of snapPoints(exclude)) {
      if (Math.abs(p - t) < best.d) best = { t: p, at: p, d: Math.abs(p - t) };
      if (extraEdge !== undefined && Math.abs(p - (t + extraEdge)) < best.d) best = { t: p - extraEdge, at: p, d: Math.abs(p - t - extraEdge) };
    }
    return { t: best.t, at: best.at };
  };

  /* ------------- scrubbing on ruler ------------- */
  const onRulerDown = (e: React.PointerEvent) => {
    if (st().playing) pause();
    const mv = (ev: PointerEvent | React.PointerEvent) => seek(xToTime(ev.clientX));
    mv(e);
    const up = () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  /* ------------- clip drag / trim ------------- */
  const onClipDown = (e: React.PointerEvent, c: Clip, mode: "move" | "l" | "r") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = st();
    const track = s.project.tracks.find((t) => t.id === c.trackId);
    if (track?.locked) return;
    const multi = e.shiftKey || e.metaKey || e.ctrlKey;
    if (multi) s.select(s.selected.includes(c.id) ? s.selected.filter((x) => x !== c.id) : [...s.selected, c.id]);
    else if (!s.selected.includes(c.id)) s.select([c.id]);
    const ids = multi ? [] : st().selected.includes(c.id) ? st().selected : [c.id];
    if (!ids.length) return;
    const x0 = e.clientX, y0 = e.clientY;
    const origs = new Map(st().project.clips.filter((x) => ids.includes(x.id)).map((x) => [x.id, structuredClone(x)]));
    const m = c.mediaId ? s.media[c.mediaId] : undefined;
    const key = `tl-${mode}-${c.id}-${Date.now()}`;
    let moved = false;
    const lanes = [...document.querySelectorAll<HTMLElement>(".tl-lane")];

    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - x0) / zoom;
      if (!moved && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
      moved = true;
      const o = origs.get(c.id)!;
      if (mode === "move") {
        let start = Math.max(0, o.start + dx);
        const sn = snap(start, ids, o.duration);
        start = Math.max(0, sn.t);
        setSnapX(sn.at);
        const delta = start - o.start;
        // vertical: find lane under pointer (only for single clip)
        let targetTrack = o.trackId;
        if (ids.length === 1) {
          const lane = lanes.find((l) => {
            const r = l.getBoundingClientRect();
            return ev.clientY >= r.top && ev.clientY < r.bottom;
          });
          const tid = lane?.dataset.track;
          const tk = st().project.tracks.find((t) => t.id === tid);
          const want = c.kind === "audio" ? "audio" : "video";
          if (tk && tk.kind === want && !tk.locked) targetTrack = tk.id;
        }
        const p = st().project;
        const valid = [...origs.values()].every((oc) =>
          !overlaps(p, ids.length === 1 ? targetTrack : oc.trackId, Math.max(0, oc.start + delta), oc.duration, ids),
        );
        if (!valid) return;
        st().commit((pp) => {
          for (const cl of pp.clips) {
            const oc = origs.get(cl.id);
            if (!oc) continue;
            cl.start = Math.max(0, oc.start + delta);
            if (ids.length === 1) cl.trackId = targetTrack;
          }
        }, key);
      } else if (mode === "l") {
        let start = snap(o.start + dx, ids).t;
        setSnapX(snap(o.start + dx, ids).at);
        const minStart = m && c.kind !== "image" ? o.start - o.offset / o.speed : -Infinity;
        start = Math.max(0, minStart, Math.min(start, o.start + o.duration - 0.05));
        // avoid overlap with previous clip
        const prev = st().project.clips.filter((x) => x.trackId === o.trackId && x.id !== c.id && x.start + x.duration <= o.start + 1e-3);
        const prevEnd = Math.max(0, ...prev.map((x) => x.start + x.duration));
        start = Math.max(start, prevEnd);
        st().updateClip(c.id, (cl) => {
          cl.start = start;
          cl.duration = o.duration + (o.start - start);
          cl.offset = Math.max(0, o.offset + (start - o.start) * o.speed);
        }, key);
      } else {
        let end = snap(o.start + o.duration + dx, ids).t;
        setSnapX(snap(o.start + o.duration + dx, ids).at);
        const maxEnd = m && c.kind !== "image" ? o.start + (m.duration - o.offset) / o.speed : Infinity;
        const next = st().project.clips.filter((x) => x.trackId === o.trackId && x.id !== c.id && x.start >= o.start + o.duration - 1e-3);
        const nextStart = Math.min(Infinity, ...next.map((x) => x.start));
        end = Math.min(end, maxEnd, nextStart);
        end = Math.max(end, o.start + 0.05);
        st().updateClip(c.id, (cl) => void (cl.duration = end - cl.start), key);
      }
    };
    const up = () => {
      setSnapX(null);
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  };

  /* ------------- drop media from library ------------- */
  const onDrop = (e: React.DragEvent, track: Track) => {
    e.preventDefault();
    setDropTrack(null);
    const fx = readFx(e);
    if (fx) {
      // dropped on an empty spot of a lane
      if (fx.kind === "effect" || fx.kind === "look") addEffectLayer(fx, snap(xToTime(e.clientX), []).t, track.id);
      else st().notify("Drop transitions and animations onto a clip", "info");
      return;
    }
    const id = e.dataTransfer.getData("nova/media");
    const m = st().media[id];
    if (!m) return;
    const t = snap(xToTime(e.clientX), []).t;
    addMediaAt(m, t, track.id);
  };

  const addMediaAt = (m: MediaItem, t: number, preferTrack?: string) => {
    const s = st();
    const kind = m.kind === "audio" ? "audio" : "video";
    const dur = m.kind === "image" ? 5 : m.duration;
    const trackId = s.ensureTrackFor(kind, t, dur, preferTrack);
    s.addClip(clipFromMedia(st().project, m, trackId, t));
  };

  const tracks = project.tracks;
  return (
    <div className="timeline">
      <TimelineToolbar />
      <div className="tl-body">
        <div className="tl-heads" ref={headsRef}>
          <div className="tl-ruler-spacer" />
          {tracks.map((t) => (
            <TrackHead key={t.id} t={t} />
          ))}
          <div style={{ height: 40 }} />
        </div>
        <div
          className="tl-scroll"
          ref={scrollRef}
          onScroll={(e) => headsRef.current && (headsRef.current.scrollTop = e.currentTarget.scrollTop)}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              const el = scrollRef.current!;
              const tAt = xToTime(e.clientX);
              const nz = Math.min(600, Math.max(4, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
              st().setZoom(nz);
              requestAnimationFrame(() => (el.scrollLeft = tAt * nz - (e.clientX - el.getBoundingClientRect().left)));
            }
          }}
          onPointerDown={(e) => {
            if ((e.target as HTMLElement).classList.contains("tl-lane") || e.target === scrollRef.current) {
              st().select([]);
              if (st().playing) pause();
              seek(xToTime(e.clientX));
            }
          }}
        >
          <div style={{ width: totalW, position: "relative", minHeight: "100%" }}>
            <Ruler width={totalW} zoom={zoom} onDown={onRulerDown} fps={project.fps} />
            {project.markers.map((mk) => (
              <div
                key={mk.id}
                className="marker"
                title={`${mk.label || "Marker"} — double-click to delete`}
                style={{ left: mk.time * zoom, background: mk.color }}
                onClick={() => seek(mk.time)}
                onDoubleClick={() => st().commit((p) => void (p.markers = p.markers.filter((x) => x.id !== mk.id)))}
              />
            ))}
            {tracks.map((t) => (
              <div
                key={t.id}
                data-track={t.id}
                className={`tl-lane ${dropTrack === t.id ? "drop" : ""}`}
                style={{ height: TRACK_H[t.kind], opacity: t.hidden || t.muted ? 0.55 : 1, background: t.locked ? "repeating-linear-gradient(45deg, transparent 0 8px, rgba(255,255,255,0.02) 8px 16px)" : undefined }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDropTrack(t.id);
                }}
                onDragLeave={() => setDropTrack(null)}
                onDrop={(e) => onDrop(e, t)}
              >
                {project.clips
                  .filter((c) => c.trackId === t.id)
                  .map((c) => (
                    <ClipView key={c.id} c={c} zoom={zoom} sel={selected.includes(c.id)} m={c.mediaId ? media[c.mediaId] : undefined} onDown={onClipDown} h={TRACK_H[t.kind] - 6} />
                  ))}
                {t.kind === "video" && <TransitionBadges p={project} trackId={t.id} zoom={zoom} />}
              </div>
            ))}
            <div style={{ height: 40 }} />
            {snapX !== null && <div className="snap-line" style={{ left: snapX * zoom }} />}
            <Playhead zoom={zoom} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Playhead({ zoom }: { zoom: number }) {
  const t = useStore((s) => s.currentTime);
  return <div className="playhead" style={{ left: t * zoom }} />;
}

function TimelineToolbar() {
  const s = useStore();
  const sel = s.selected;
  const fit = () => {
    const el = document.querySelector(".tl-scroll") as HTMLElement;
    const d = projectDuration(s.project);
    if (el && d > 0) s.setZoom((el.clientWidth - 40) / d);
  };
  return (
    <div className="tl-toolbar">
      <button className="ghost icon" title="Undo (Ctrl+Z)" disabled={!s.past.length} onClick={s.undo}><Icon d={I.undo} /></button>
      <button className="ghost icon" title="Redo (Ctrl+Shift+Z)" disabled={!s.future.length} onClick={s.redo}><Icon d={I.redo} /></button>
      <span style={{ width: 8 }} />
      <button className="ghost icon" title="Split at playhead (S)" onClick={() => s.splitAt(s.currentTime)}><Icon d={I.split} /></button>
      <button className="ghost icon" title="Delete (Del)" disabled={!sel.length} onClick={() => s.deleteClips(sel)}><Icon d={I.trash} /></button>
      <button className="ghost icon" title="Ripple delete (Shift+Delete)" disabled={!sel.length} onClick={() => s.deleteClips(sel, true)}><Icon d={I.ripple} /></button>
      <button className="ghost icon" title="Duplicate (Ctrl+D)" disabled={!sel.length} onClick={() => s.duplicate(sel)}><Icon d={I.copy} /></button>
      <button className="ghost icon" title="Add marker (M)" onClick={() => s.commit((p) => void p.markers.push({ id: uid("mk"), time: s.currentTime, label: "", color: "#ff4d6d" }))}><Icon d={I.marker} /></button>
      <button className={`ghost icon ${s.snapping ? "active" : ""}`} title="Snapping (N)" onClick={() => s.set({ snapping: !s.snapping })}><Icon d={I.magnet} /></button>
      <span className="spacer" />
      <button className="ghost" onClick={() => s.addTrack("video")}>+ Video track</button>
      <button className="ghost" onClick={() => s.addTrack("audio")}>+ Audio track</button>
      <span style={{ width: 8 }} />
      <button className="ghost icon" title="Zoom out (-)" onClick={() => s.setZoom(s.zoom / 1.3)}><Icon d={I.zoomOut} /></button>
      <input type="range" min={4} max={600} value={s.zoom} style={{ width: 90 }} onChange={(e) => s.setZoom(Number(e.target.value))} />
      <button className="ghost icon" title="Zoom in (+)" onClick={() => s.setZoom(s.zoom * 1.3)}><Icon d={I.zoomIn} /></button>
      <button className="ghost" title="Fit to view" onClick={fit}>⇔</button>
    </div>
  );
}

function TrackHead({ t }: { t: Track }) {
  const s = useStore.getState();
  return (
    <div className="tl-head" style={{ height: TRACK_H[t.kind] }}>
      <span style={{ color: t.kind === "video" ? "var(--video)" : "var(--audio)" }}>{t.kind === "video" ? "▣" : "♪"}</span>
      <input
        className="nm"
        value={t.name}
        style={{ background: "transparent", border: "none", padding: 0, fontSize: 11.5 }}
        onChange={(e) => s.updateTrack(t.id, { name: e.target.value })}
      />
      {t.kind === "video" ? (
        <button className={t.hidden ? "off" : ""} title="Show/hide" onClick={() => s.updateTrack(t.id, { hidden: !t.hidden })}><Icon d={t.hidden ? I.eyeOff : I.eye} size={14} /></button>
      ) : null}
      <button className={t.muted ? "off" : ""} title="Mute" onClick={() => s.updateTrack(t.id, { muted: !t.muted })}><Icon d={t.muted ? I.mute : I.vol} size={14} /></button>
      <button className={t.locked ? "off" : ""} title="Lock" onClick={() => s.updateTrack(t.id, { locked: !t.locked })}><Icon d={t.locked ? I.lock : I.unlock} size={14} /></button>
      <button title="Delete track" onClick={() => confirm(`Delete track "${t.name}" and its clips?`) && s.removeTrack(t.id)}>×</button>
    </div>
  );
}

function Ruler({ width, zoom, onDown, fps }: { width: number; zoom: number; onDown: (e: React.PointerEvent) => void; fps: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.min(width, 32000);
    c.width = w * dpr;
    c.height = 26 * dpr;
    c.style.width = `${w}px`;
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, 26);
    const steps = [1 / fps, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const major = steps.find((s) => s * zoom >= 70) ?? 600;
    const minor = steps.slice().reverse().find((s) => s < major && s * zoom >= 10) ?? major / 2;
    g.strokeStyle = "#3a3f4e";
    g.fillStyle = "#9097a8";
    g.font = "10px Inter, sans-serif";
    for (let t = 0; t * zoom < w; t += minor) {
      const x = Math.round(t * zoom) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      g.beginPath();
      g.moveTo(x, isMajor ? 12 : 19);
      g.lineTo(x, 26);
      g.stroke();
      if (isMajor) {
        const m = Math.floor(t / 60), s = t % 60;
        g.fillText(major < 1 ? `${m}:${s.toFixed(2).padStart(5, "0")}` : `${m}:${String(Math.floor(s)).padStart(2, "0")}`, x + 3, 10);
      }
    }
  }, [width, zoom, fps]);
  return (
    <div className="tl-ruler" onPointerDown={onDown}>
      <canvas ref={ref} style={{ height: 26, display: "block" }} />
    </div>
  );
}

const ClipView = memo(function ClipView({
  c, zoom, sel, m, onDown, h,
}: {
  c: Clip; zoom: number; sel: boolean; m?: MediaItem; h: number;
  onDown: (e: React.PointerEvent, c: Clip, mode: "move" | "l" | "r") => void;
}) {
  const [drop, setDrop] = useState<null | "l" | "m" | "r">(null);
  const w = Math.max(4, c.duration * zoom);
  const kfTimes = Array.from(new Set([
    ...Object.entries(c.keyframes).filter(([k]) => k !== "volume").flatMap(([, k]) => k!.map((f) => f.t)),
    ...(c.mask?.keys.length && c.mask.keys.length <= 60 ? c.mask.keys.map((k) => k.t) : []),
  ]));
  const label = c.kind === "text" ? c.text?.content.split("\n")[0] : c.name;
  const sound = (c.kind === "audio" || c.kind === "video") && !!m?.hasAudio;
  const relOf = (e: React.DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return (e.clientX - r.left) / Math.max(1, r.width);
  };
  return (
    <div
      className={`clip ${sel ? "sel" : ""} ${drop ? `drop-${drop}` : ""}`}
      style={{ left: c.start * zoom, width: w, background: KIND_COLOR[c.kind] }}
      onPointerDown={(e) => onDown(e, c, "move")}
      onContextMenu={(e) => showClipMenu(e, c, m)}
      onDragOver={(e) => {
        if (!hasFx(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const rel = relOf(e);
        setDrop(rel < 0.4 ? "l" : rel > 0.6 ? "r" : "m");
      }}
      onDragLeave={() => setDrop(null)}
      onDrop={(e) => {
        const fx = readFx(e);
        setDrop(null);
        if (!fx) return;
        e.preventDefault();
        e.stopPropagation();
        applyFxToClip(c.id, fx, relOf(e));
      }}
      title={`${c.name} — ${c.duration.toFixed(2)}s · right-click for options`}
    >
      {m?.thumb && (c.kind === "video" || c.kind === "image") && <div className="strip" style={{ backgroundImage: `url(${m.thumb})` }} />}
      {m?.peaks && sound && <Wave c={c} m={m} w={w} />}
      <div className="label">
        {KIND_ICON[c.kind]} {label}
        {c.speed !== 1 ? `  ×${c.speed}` : ""}
        {c.audio.muted && sound ? "  🔇" : ""}
      </div>
      <div className="fx-badges">
        {c.effects.map((e) => (
          <span
            key={e.type}
            className={`fx-chip ${e.enabled === false ? "off" : ""}`}
            title="Click to edit this effect"
            onPointerDown={(ev) => {
              ev.stopPropagation();
              useStore.getState().focusClip(c.id, "fx", e.type);
            }}
          >
            ✨ {effectLabel(e.type)}
          </span>
        ))}
        {(c.animIn !== "none" || c.animOut !== "none") && (
          <span className="fx-chip" onPointerDown={(ev) => { ev.stopPropagation(); useStore.getState().focusClip(c.id, "anim", "animIn"); }}>ANIM</span>
        )}
        {(c.keyframes.scale || c.keyframes.x) && (
          <span className="fx-chip" onPointerDown={(ev) => { ev.stopPropagation(); useStore.getState().focusClip(c.id, "anim", "motion"); }}>🎥 Motion</span>
        )}
      </div>
      {kfTimes.map((t) => (
        <div key={t} className="kf" style={{ left: t * zoom - 3.5 }} />
      ))}
      {sound && <AudioLine c={c} w={w} h={h} zoom={zoom} top={c.kind === "audio" ? 18 : Math.round(h * 0.45)} />}
      <div className="trim l" onPointerDown={(e) => onDown(e, c, "l")} />
      <div className="trim r" onPointerDown={(e) => onDown(e, c, "r")} />
    </div>
  );
});

function Wave({ c, m, w }: { c: Clip; m: MediaItem; w: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !m.peaks) return;
    const cw = Math.min(4000, Math.ceil(w));
    const ch = 36;
    cv.width = cw;
    cv.height = ch;
    const g = cv.getContext("2d")!;
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = c.audio.muted ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.75)";
    const pps = m.peaksPerSec ?? 50;
    const vol = Math.min(2, c.audio.volume);
    for (let x = 0; x < cw; x++) {
      const src = c.offset + ((x / cw) * c.duration) * c.speed;
      const v = (m.peaks[Math.floor(src * pps)] ?? 0) * vol;
      const h = Math.max(1, Math.min(ch, Math.sqrt(v) * ch));
      g.fillRect(x, ch - h, 1, h);
    }
  }, [c.offset, c.duration, c.speed, c.audio.volume, c.audio.muted, m.peaks, w]);
  return <canvas ref={ref} className="wave" style={{ height: c.kind === "audio" ? "72%" : "50%" }} />;
}
