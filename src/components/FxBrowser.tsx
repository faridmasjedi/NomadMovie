import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { GL_EFFECTS, EFFECT_CATEGORIES } from "../engine/effectsLib";
import { TRANSITION_DEFS, TRANSITION_CATEGORIES } from "../engine/transitionsLib";
import { EFFECTS, LOOKS } from "../engine/presets";
import { ANIM_PRESETS } from "../engine/animate";
import { effectThumb, sampleImage, transitionThumb, THUMB_H, THUMB_W } from "../engine/thumbs";
import { FX_MIME, addEffectLayer, applyFxToClip, type FxPayload } from "./timelineParts";
import { lookCss } from "./Inspector";

interface Item {
  id: string;
  label: string;
  category: string;
  kind: FxPayload["kind"];
  thumb?: () => string | null;
  animate?: (canvas: HTMLCanvasElement, t: number) => void;
  css?: string;
  icon?: string;
}

/* canvas-based effects that have no GPU counterpart */
const CANVAS_FX: Record<string, string> = { shake: "Camera", zoomPulse: "Camera", flicker: "Light", letterbox: "Weather & Overlays" };

function effectItems(): Item[] {
  return [
    ...GL_EFFECTS.map<Item>((e) => ({
      id: e.id, label: e.label, category: e.category, kind: "effect",
      thumb: () => effectThumb(e.id),
      animate: (cv, t) => effectThumb(e.id, t, cv),
    })),
    ...EFFECTS.filter((e) => CANVAS_FX[e.type]).map<Item>((e) => ({ id: e.type, label: e.label, category: CANVAS_FX[e.type], kind: "effect", icon: "🎥" })),
  ];
}

function transitionItems(): Item[] {
  return TRANSITION_DEFS.map((t) => ({
    id: t.id, label: t.label, category: t.category, kind: "transition",
    thumb: () => transitionThumb(t),
    animate: (cv, time) => transitionThumb(t, (Math.sin(time * 2.2 - Math.PI / 2) + 1) / 2, cv),
  }));
}

const lookItems = (): Item[] => LOOKS.filter((l) => l.id !== "none").map((l) => ({ id: l.id, label: l.label, category: "Looks", kind: "look", css: lookCss(l.f) }));
const animItems = (): Item[] =>
  ANIM_PRESETS.filter(([id]) => id !== "none").map(([id, label]) => ({ id, label, category: "Animations", kind: "anim", icon: "✦" }));

export function FxBrowser({ mode }: { mode: "effects" | "transitions" }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const all = useMemo(
    () => (mode === "effects" ? [...lookItems(), ...effectItems()] : [...transitionItems(), ...animItems()]),
    [mode],
  );
  const cats = mode === "effects" ? ["All", "Looks", ...EFFECT_CATEGORIES] : ["All", ...TRANSITION_CATEGORIES, "Animations"];
  const items = all.filter((i) => (cat === "All" || i.category === cat) && (!q || i.label.toLowerCase().includes(q.toLowerCase())));
  const groups = cat === "All" && !q ? cats.slice(1).map((c) => [c, items.filter((i) => i.category === c)] as const).filter(([, l]) => l.length) : [[cat, items] as const];

  const apply = (it: Item) => {
    const s = useStore.getState();
    const targets = s.selected.filter((id) => s.project.clips.find((c) => c.id === id)?.kind !== "audio");
    if (!targets.length) {
      if (it.kind === "effect" || it.kind === "look") {
        addEffectLayer({ kind: it.kind, id: it.id }, s.currentTime);
        s.notify(`Added an effect layer with ${it.label} at the playhead`, "ok");
      } else s.notify("Select a clip first, or drag this onto a clip", "info");
      return;
    }
    for (const id of targets) applyFxToClip(id, { kind: it.kind, id: it.id }, it.kind === "transition" ? 0.5 : 0);
  };

  return (
    <>
      <div className="panel-title">
        {mode === "effects" ? "Effects & filters" : "Transitions & animations"}
        <span className="hint" style={{ fontWeight: 400 }}>{all.length}</span>
      </div>
      <input className="fx-search" placeholder={`Search ${mode}…`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <div className="chips" style={{ margin: "8px 0" }}>
        {cats.map((c) => (
          <span key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</span>
        ))}
      </div>
      <div className="hint" style={{ marginBottom: 8 }}>
        {mode === "effects"
          ? "Drag onto a clip, or onto an empty spot of a track to create an effect layer that affects everything below. Click a clip's ✨ chip to adjust."
          : "Drag onto the start or end of a clip, or onto the cut between two clips. Animations: drop on the left half for In, right half for Out."}
      </div>
      {mode === "effects" && (
        <button style={{ marginBottom: 10 }} onClick={() => addEffectLayer({ kind: "effect", id: "gaussianBlur" }, useStore.getState().currentTime)}>
          + Empty effect layer (with blur)
        </button>
      )}
      {groups.map(([g, list]) => (
        <div key={g}>
          {groups.length > 1 && <div className="fx-group">{g}</div>}
          <div className="grid2">
            {list.map((it) => (
              <Tile key={`${it.kind}:${it.id}`} it={it} onApply={() => apply(it)} />
            ))}
          </div>
        </div>
      ))}
      {!items.length && <div className="empty">Nothing matches “{q}”.</div>}
    </>
  );
}

let sample: string | null = null;

function Tile({ it, onApply }: { it: Item; onApply: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [hover, setHover] = useState(false);

  // render the thumbnail lazily when the tile scrolls into view
  useEffect(() => {
    if (!it.thumb && !it.css) return;
    const el = ref.current!;
    const io = new IntersectionObserver((ents) => {
      if (ents.some((e) => e.isIntersecting)) {
        io.disconnect();
        const run = () => setSrc(it.thumb ? it.thumb() : (sample ??= sampleImage()));
        "requestIdleCallback" in window ? requestIdleCallback(run) : setTimeout(run, 0);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [it]);

  // animate on hover
  useEffect(() => {
    if (!hover || !it.animate || !canvas.current) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      it.animate!(canvas.current!, (performance.now() - t0) / 1000 + 0.2);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [hover, it]);

  return (
    <div
      ref={ref}
      className="tile fx-tile"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(FX_MIME, JSON.stringify({ kind: it.kind, id: it.id }));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={onApply}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      title={`${it.label} — click to apply to the selected clip, or drag onto the timeline`}
    >
      <div className="swatch fx-thumb">
        {src && <img src={src} alt="" style={it.css ? { filter: it.css } : undefined} />}
        {!src && it.icon && <span style={{ fontSize: 22 }}>{it.icon}</span>}
        {it.animate && <canvas ref={canvas} width={THUMB_W} height={THUMB_H} style={{ opacity: hover ? 1 : 0 }} />}
      </div>
      <span>{it.label}</span>
    </div>
  );
}
