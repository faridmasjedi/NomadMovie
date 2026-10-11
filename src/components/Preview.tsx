import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { renderFrame, lastBounds, hitTest } from "../engine/render";
import { setFrameReadyListener } from "../engine/media";
import { audioEngine } from "../engine/audio";
import { setKeyframe, valueAt } from "../engine/animate";
import { fmtTime, projectDuration } from "../factory";
import { pause, seek, tick, toggle } from "../engine/playback";
import { snapshotPng, download } from "../engine/exporter";
import { Icon, I } from "./ui";

let dirty = true;
export const markDirty = () => (dirty = true);
/** the live preview canvas (used by AI vision) */
export let previewCanvas: HTMLCanvasElement | null = null;

export function Preview() {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fit, setFit] = useState({ w: 640, h: 360 });
  const project = useStore((s) => s.project);
  const playing = useStore((s) => s.playing);
  const quality = useStore((s) => s.previewQuality);
  const selected = useStore((s) => s.selected);
  const loop = useStore((s) => s.loop);
  const pick = useStore((s) => s.pick);
  const [, force] = useState(0);
  const meterRef = useRef<HTMLDivElement>(null);
  const tcRef = useRef<HTMLSpanElement>(null);

  // fit canvas into stage
  useLayoutEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(() => {
      const pad = 24;
      const W = el.clientWidth - pad, H = el.clientHeight - pad;
      const k = Math.min(W / project.width, H / project.height);
      setFit({ w: Math.max(50, project.width * k), h: Math.max(50, project.height * k) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  // render loop
  useEffect(() => {
    previewCanvas = canvasRef.current;
    setFrameReadyListener(markDirty);
    const unsub = useStore.subscribe(() => (dirty = true));
    let raf = 0;
    let frame = 0;
    const loopFn = () => {
      raf = requestAnimationFrame(loopFn);
      const s = useStore.getState();
      const c = canvasRef.current;
      if (!c || s.busy?.startsWith("Exporting")) return;
      let t = s.currentTime;
      if (s.playing) {
        t = tick();
        dirty = true;
      }
      if (tcRef.current) tcRef.current.textContent = `${fmtTime(t, s.project.fps)} / ${fmtTime(projectDuration(s.project), s.project.fps)}`;
      if (meterRef.current && (s.playing || frame++ % 10 === 0)) {
        const [l, r] = s.playing ? audioEngine.levels() : [0, 0];
        const bars = meterRef.current.querySelectorAll("i");
        (bars[0] as HTMLElement).style.width = `${Math.min(100, l * 260)}%`;
        (bars[1] as HTMLElement).style.width = `${Math.min(100, r * 260)}%`;
      }
      if (!dirty) return;
      dirty = false;
      const q = s.previewQuality;
      const w = Math.round(s.project.width * q), h = Math.round(s.project.height * q);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      renderFrame(c.getContext("2d")!, s.project, s.media, t, { playing: s.playing, scale: q });
      force((n) => (n + 1) % 1e6); // refresh selection overlay
    };
    loopFn();
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, []);

  const k = fit.w / project.width;
  const selId = selected.length === 1 ? selected[0] : null;
  const b = selId ? lastBounds.get(selId) : undefined;

  /** stage interactions: select + move / scale / rotate */
  const onPointerDown = (e: React.PointerEvent, mode: "move" | "scale" | "rotate" | "sx" | "sy" = "move") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const rect = canvasRef.current!.getBoundingClientRect();
    const toProj = (ev: { clientX: number; clientY: number }) => ({ x: (ev.clientX - rect.left) / k, y: (ev.clientY - rect.top) / k });
    const st = useStore.getState();
    if (st.pick) {
      const pt = toProj(e);
      st.pick.cb(Math.round(pt.x), Math.round(pt.y));
      st.set({ pick: null });
      return;
    }
    let id = selId;
    if (mode === "move") {
      const pt = toProj(e);
      id = hitTest(st.project, pt.x, pt.y);
      st.select(id ? [id] : []);
      if (!id) return;
    }
    const clip = useStore.getState().project.clips.find((c) => c.id === id);
    const bounds = id ? lastBounds.get(id) : undefined;
    const track = st.project.tracks.find((t) => t.id === clip?.trackId);
    if (!clip || !bounds || track?.locked) return;
    if (st.playing) pause();
    const start = toProj(e);
    const orig = structuredClone(clip.transform);
    const local = st.currentTime - clip.start;
    const animated = (p: "x" | "y" | "rotation" | "scale") => !!clip.keyframes[p]?.length;
    const kfBase = { x: bounds.x, y: bounds.y };
    const kfScale0 = valueAt(clip.keyframes.scale, local, 1);
    const d0 = Math.hypot(start.x - bounds.x, start.y - bounds.y) || 1;
    const a0 = Math.atan2(start.y - bounds.y, start.x - bounds.x);
    const key = `stage-${mode}-${clip.id}-${Date.now()}`;
    const move = (ev: PointerEvent) => {
      const p = toProj(ev);
      useStore.getState().updateClip(clip.id, (c) => {
        if (mode === "move") {
          let nx = kfBase.x + (p.x - start.x), ny = kfBase.y + (p.y - start.y);
          // snap to center
          const W = useStore.getState().project.width, H = useStore.getState().project.height;
          if (Math.abs(nx - W / 2) < 12 / k) nx = W / 2;
          if (Math.abs(ny - H / 2) < 12 / k) ny = H / 2;
          if (animated("x")) setKeyframe(c, "x", local, nx);
          else c.transform.x = orig.x + (nx - kfBase.x);
          if (animated("y")) setKeyframe(c, "y", local, ny);
          else c.transform.y = orig.y + (ny - kfBase.y);
        } else if (mode === "sx" || mode === "sy") {
          // stretch along the clip's own (rotated) axis
          const r = (-bounds.rotation * Math.PI) / 180;
          const lx = (q: { x: number; y: number }) => {
            const dx = q.x - bounds.x, dy = q.y - bounds.y;
            return mode === "sx" ? Math.abs(dx * Math.cos(r) - dy * Math.sin(r)) : Math.abs(dx * Math.sin(r) + dy * Math.cos(r));
          };
          const f = lx(p) / Math.max(1, lx(start));
          if (mode === "sx") c.transform.scaleX = Math.max(0.01, Math.round(orig.scaleX * f * 1000) / 1000);
          else c.transform.scaleY = Math.max(0.01, Math.round(orig.scaleY * f * 1000) / 1000);
        } else if (mode === "scale") {
          const f = Math.hypot(p.x - bounds.x, p.y - bounds.y) / d0;
          if (animated("scale")) setKeyframe(c, "scale", local, Math.max(0.01, kfScale0 * f));
          else c.transform.scale = Math.max(0.01, Math.round(orig.scale * f * 1000) / 1000);
        } else {
          let deg = orig.rotation + ((Math.atan2(p.y - bounds.y, p.x - bounds.x) - a0) * 180) / Math.PI;
          if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
          if (animated("rotation")) setKeyframe(c, "rotation", local, deg - orig.rotation);
          else c.transform.rotation = Math.round(deg * 10) / 10;
        }
      }, key);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const snapshot = async () => {
    const s = useStore.getState();
    download(await snapshotPng(s.project, s.media, s.currentTime), `frame-${s.currentTime.toFixed(2)}.png`);
  };

  const fps = project.fps;
  return (
    <div className="preview-wrap">
      <div className="stage" ref={stageRef} onPointerDown={(e) => onPointerDown(e)}>
        <div style={{ position: "relative", width: fit.w, height: fit.h }}>
          <canvas ref={canvasRef} className="view" style={{ width: fit.w, height: fit.h, display: "block", cursor: pick ? "crosshair" : undefined }} />
          {pick && (
            <div className="pick-banner">
              🎯 {pick.label} <button className="ghost" onClick={(e) => { e.stopPropagation(); useStore.getState().set({ pick: null }); }}>Cancel</button>
            </div>
          )}
          {b && !playing && !pick && (
            <div
              className="sel-box"
              style={{
                left: (b.x - (b.w * Math.abs(b.sx)) / 2) * k,
                top: (b.y - (b.h * Math.abs(b.sy)) / 2) * k,
                width: b.w * Math.abs(b.sx) * k,
                height: b.h * Math.abs(b.sy) * k,
                transform: `rotate(${b.rotation}deg)`,
              }}
            >
              <div className="h tl" onPointerDown={(e) => onPointerDown(e, "scale")} />
              <div className="h br" onPointerDown={(e) => onPointerDown(e, "scale")} />
              <div className="h rot" onPointerDown={(e) => onPointerDown(e, "rotate")} />
              <div className="h side l" title="Stretch width" onPointerDown={(e) => onPointerDown(e, "sx")} />
              <div className="h side r" title="Stretch width" onPointerDown={(e) => onPointerDown(e, "sx")} />
              <div className="h side t" title="Stretch height" onPointerDown={(e) => onPointerDown(e, "sy")} />
              <div className="h side b" title="Stretch height" onPointerDown={(e) => onPointerDown(e, "sy")} />
            </div>
          )}
        </div>
      </div>
      <div className="transport">
        <button className="ghost icon" title="Go to start (Home)" onClick={() => seek(0)}><Icon d={I.back} /></button>
        <button className="ghost icon" title="Previous frame (←)" onClick={() => seek(useStore.getState().currentTime - 1 / fps)}>‹</button>
        <button className="primary icon" style={{ width: 36, justifyContent: "center" }} title="Play/pause (Space)" onClick={toggle}>
          <Icon d={playing ? I.pause : I.play} />
        </button>
        <button className="ghost icon" title="Next frame (→)" onClick={() => seek(useStore.getState().currentTime + 1 / fps)}>›</button>
        <button className="ghost icon" title="Go to end (End)" onClick={() => seek(projectDuration(useStore.getState().project))}><Icon d={I.fwd} /></button>
        <button className={`ghost icon ${loop ? "active" : ""}`} title="Loop" onClick={() => useStore.getState().set({ loop: !loop })}><Icon d={I.loop} /></button>
        <span className="timecode" ref={tcRef} />
        <span className="spacer" />
        <div className="meter" ref={meterRef} title="Audio level"><div><i /></div><div><i /></div></div>
        <input
          type="range" min={0} max={2} step={0.01} value={project.masterVolume} style={{ width: 70 }} title="Master volume"
          onChange={(e) => {
            const v = Number(e.target.value);
            audioEngine.setMaster(v);
            useStore.getState().commit((p) => void (p.masterVolume = v), "master");
          }}
        />
        <select value={quality} title="Preview quality" onChange={(e) => useStore.getState().set({ previewQuality: Number(e.target.value) })}>
          <option value={1}>Full</option>
          <option value={0.5}>1/2</option>
          <option value={0.25}>1/4</option>
        </select>
        <button className="ghost icon" title="Save frame as PNG" onClick={snapshot}><Icon d={I.camera} /></button>
        <button className="ghost icon" title="Fullscreen" onClick={() => stageRef.current?.requestFullscreen()}><Icon d={I.full} /></button>
      </div>
    </div>
  );
}
