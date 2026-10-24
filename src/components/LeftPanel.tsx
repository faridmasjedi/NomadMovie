import { useRef, useState } from "react";
import { useStore, type LeftTab } from "../store";
import type { Clip, MediaItem } from "../types";
import { importFile, ACCEPTED_FORMATS_HINT } from "../engine/media";
import { saveMedia, deleteMedia } from "../engine/persist";
import { clipFromMedia, defaultShape, defaultText, makeClip } from "../factory";
import { SHAPES, SOLID_COLORS, TEXT_STYLES } from "../engine/presets";
import { FxBrowser } from "./FxBrowser";
import { photoSlideshow } from "../ai/smart";
import { AIPanel } from "./AIPanel";

const TABS: [LeftTab, string, string][] = [
  ["media", "🎞", "Media"],
  ["text", "T", "Text"],
  ["elements", "◆", "Elements"],
  ["effects", "✨", "Effects"],
  ["transitions", "⇄", "Transitions"],
  ["audio", "🎙", "Audio"],
  ["ai", "🤖", "AI"],
];

export function LeftPanel() {
  const tab = useStore((s) => s.leftTab);
  return (
    <div className="panel left">
      <div className="tabs-v">
        {TABS.map(([id, ico, label]) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => useStore.getState().setLeftTab(id)}>
            <span className="ico">{ico}</span>
            {label}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === "media" && <MediaTab />}
        {tab === "text" && <TextTab />}
        {tab === "elements" && <ElementsTab />}
        {tab === "effects" && <FxBrowser mode="effects" />}
        {tab === "transitions" && <FxBrowser mode="transitions" />}
        {tab === "audio" && <AudioPanel />}
        {tab === "ai" && <AIPanel />}
      </div>
    </div>
  );
}

/** add a generated clip at the playhead on a free track */
export function addAtPlayhead(make: (start: number) => Clip) {
  const s = useStore.getState();
  const c = make(s.currentTime);
  c.trackId = s.ensureTrackFor(c.kind === "audio" ? "audio" : "video", c.start, c.duration);
  s.addClip(c);
  // with an In animation the new clip is still invisible at its first frame: show it fully played in
  if (!s.playing && c.animIn !== "none" && c.animInDur > 0) s.setTime(c.start + Math.min(c.animInDur, c.duration / 2));
  return c;
}

export async function importFiles(files: FileList | File[]) {
  const s = useStore.getState();
  for (const f of Array.from(files)) {
    s.setBusy(`Importing ${f.name}…`);
    try {
      const m = await importFile(f, undefined, undefined, (stage, p) =>
        s.setBusy(`${f.name}: ${stage}${p > 0 && p < 1 ? ` ${Math.round(p * 100)}%` : "…"}`),
      );
      if (!m) {
        s.notify(`${f.name}: unsupported format`, "error");
        continue;
      }
      s.addMedia(m);
      saveMedia(m).catch(() => {});
    } catch (e) {
      s.notify(`${f.name}: ${e instanceof Error ? e.message : e}`, "error");
    }
  }
  s.setBusy(null);
}

function MediaTab() {
  const media = useStore((s) => s.media);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<"all" | MediaItem["kind"]>("all");
  const items = Object.values(media).filter((m) => filter === "all" || m.kind === filter);
  const add = (m: MediaItem) => {
    const s = useStore.getState();
    const dur = m.kind === "image" ? 5 : m.duration;
    const end = s.project.clips
      .filter((c) => (m.kind === "audio" ? c.kind === "audio" : c.kind !== "audio"))
      .reduce((mx, c) => Math.max(mx, c.start + c.duration), 0);
    const start = m.kind === "audio" ? s.currentTime : end;
    const trackId = s.ensureTrackFor(m.kind === "audio" ? "audio" : "video", start, dur);
    s.addClip(clipFromMedia(useStore.getState().project, m, trackId, start));
  };
  return (
    <>
      <div className="panel-title">Media library</div>
      <div
        className={`dropzone ${over ? "over" : ""}`}
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          importFiles(e.dataTransfer.files);
        }}
      >
        <div style={{ fontSize: 26 }}>⬆</div>
        Drop video, audio or image files here
        <div className="hint">or click to browse — any video, audio or photo format</div>
        <div className="hint" style={{ fontSize: 10.5, marginTop: 4 }}>{ACCEPTED_FORMATS_HINT}</div>
        <input ref={input} type="file" multiple hidden onChange={(e) => { if (e.target.files) importFiles(e.target.files); e.target.value = ""; }} />
      </div>
      <div className="row" style={{ marginBottom: 10, gap: 6 }}>
        <button onClick={() => photoInput.current?.click()}>🖼 Import photos</button>
        <button
          disabled={!Object.values(media).some((m) => m.kind === "image")}
          title="Put all photos on the timeline with cross dissolves and a gentle Ken Burns move"
          onClick={() => {
            try {
              const n = photoSlideshow(Object.values(useStore.getState().media).filter((m) => m.kind === "image").map((m) => m.id));
              useStore.getState().notify(`Slideshow with ${n} photos added`, "ok");
            } catch (e) {
              useStore.getState().notify(e instanceof Error ? e.message : String(e), "error");
            }
          }}
        >
          🎞 Photo slideshow
        </button>
        <input ref={photoInput} type="file" multiple accept="image/*,.heic,.heif,.tif,.tiff,.psd,.cr2,.cr3,.nef,.arw,.dng,.orf,.rw2,.raf,.raw" hidden onChange={(e) => { if (e.target.files) importFiles(e.target.files); e.target.value = ""; }} />
      </div>
      <div className="chips" style={{ marginBottom: 10 }}>
        {(["all", "video", "audio", "image"] as const).map((k) => (
          <span key={k} className="chip" style={filter === k ? { borderColor: "var(--accent)", color: "var(--accent2)" } : undefined} onClick={() => setFilter(k)}>
            {{ all: "All", video: "Video", audio: "Audio", image: "Image" }[k]}
          </span>
        ))}
      </div>
      {items.length === 0 && <div className="empty">No media imported yet.</div>}
      <div className="grid2">
        {items.map((m) => (
          <div
            key={m.id}
            className="media-card"
            draggable
            onDragStart={(e) => e.dataTransfer.setData("nomad/media", m.id)}
            onDoubleClick={() => add(m)}
            title="Drag to the timeline or double-click"
          >
            <div className="thumb" style={m.thumb ? { backgroundImage: `url(${m.thumb})` } : undefined}>
              {!m.thumb && (m.kind === "audio" ? "🎵" : "🎞")}
            </div>
            <div className="meta">
              <span>{m.name}</span>
              {m.kind !== "image" && <span className="hint">{m.duration.toFixed(1)}s</span>}
            </div>
            <button className="add primary" onClick={() => add(m)}>+</button>
            <button className="del" onClick={() => {
              if (!confirm(`Delete "${m.name}" and its clips?`)) return;
              useStore.getState().removeMedia(m.id);
              deleteMedia(m.id).catch(() => {});
            }}>×</button>
          </div>
        ))}
      </div>
    </>
  );
}

function TextTab() {
  const add = (i: number) => {
    const st = TEXT_STYLES[i];
    addAtPlayhead((start) => {
      const p = useStore.getState().project;
      const text = { ...defaultText(st.label === "Caption" ? "Your subtitle here" : st.label), ...st.p };
      text.size = Math.round((text.size * p.height) / 1080);
      const c = makeClip(p, "text", "", start, 5, { name: st.label, text });
      if (st.label === "Caption") c.transform.y = p.height * 0.86;
      if (st.anim) {
        c.animIn = st.anim;
        c.animOut = "fade";
      }
      return c;
    });
  };
  return (
    <>
      <div className="panel-title">Text & titles</div>
      <div className="grid2">
        {TEXT_STYLES.map((s, i) => (
          <div key={i} className="tile" onClick={() => add(i)}>
            <div className="swatch" style={{ background: "#0d0e12" }}>
              <span style={{
                fontFamily: s.p.font, fontWeight: s.p.bold ? 800 : 400, fontStyle: s.p.italic ? "italic" : undefined,
                color: s.p.color === "rgba(0,0,0,0)" ? "transparent" : s.p.color, fontSize: 17, letterSpacing: (s.p.letterSpacing ?? 0) / 6,
                background: s.p.background || undefined, padding: s.p.background ? "0 6px" : undefined, borderRadius: 4,
                WebkitTextStroke: s.p.strokeWidth ? `1px ${s.p.strokeColor}` : undefined,
                textShadow: s.p.shadowColor && s.p.shadow ? `0 0 8px ${s.p.shadowColor}` : undefined,
              }}>
                {s.label === "Outline" ? "OUTLINE" : "Title"}
              </span>
            </div>
            <span>{s.label}</span>
          </div>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 12 }}>
        For pro text animation, open the AI tab and describe it — e.g. "a 5-second intro with my channel name".
      </div>
    </>
  );
}

function ElementsTab() {
  const addShape = (type: (typeof SHAPES)[number]["type"]) =>
    addAtPlayhead((start) => {
      const p = useStore.getState().project;
      const shape = defaultShape(type);
      if (type === "line") {
        shape.width = 600;
        shape.height = 8;
      }
      if (type === "arrow") shape.height = 200;
      return makeClip(p, "shape", "", start, 5, { name: type, shape, animIn: "pop", animOut: "fade" });
    });
  const addSolid = (color: string) =>
    addAtPlayhead((start) => makeClip(useStore.getState().project, "solid", "", start, 5, { name: "Solid color", color }));
  const addGradientBg = (a: string, b: string) =>
    addAtPlayhead((start) => {
      const p = useStore.getState().project;
      return makeClip(p, "shape", "", start, 5, { name: "Gradient", shape: { ...defaultShape("rect"), width: p.width, height: p.height, radius: 0, fill: a, gradient: b } });
    });
  return (
    <>
      <div className="panel-title">Shapes</div>
      <div className="grid3">
        {SHAPES.map((s) => (
          <div key={s.type} className="tile" onClick={() => addShape(s.type)}>
            <svg width="36" height="36" viewBox="-20 -20 40 40">
              <path d={shapeIcon(s.type)} fill="var(--accent2)" />
            </svg>
            {s.label}
          </div>
        ))}
      </div>
      <div className="panel-title" style={{ marginTop: 16 }}>Color backgrounds</div>
      <div className="grid3" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        {SOLID_COLORS.map((c) => (
          <div key={c} className="tile" style={{ padding: 4 }} onClick={() => addSolid(c)}>
            <div className="swatch" style={{ background: c, height: 30 }} />
          </div>
        ))}
      </div>
      <div className="panel-title" style={{ marginTop: 16 }}>Gradient</div>
      <div className="grid3">
        {[["#7c5cff", "#ff4d6d"], ["#0f2027", "#2c5364"], ["#f7971e", "#ffd200"], ["#00c6ff", "#0072ff"], ["#11998e", "#38ef7d"], ["#232526", "#414345"]].map(([a, b]) => (
          <div key={a} className="tile" style={{ padding: 4 }} onClick={() => addGradientBg(a, b)}>
            <div className="swatch" style={{ background: `linear-gradient(${a}, ${b})` }} />
          </div>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 12 }}>Ask the AI tab for custom stickers and graphics (SVG): "make a red like-button sticker".</div>
    </>
  );
}

function shapeIcon(t: string) {
  switch (t) {
    case "rect": return "M-14 -14h28v28h-28z";
    case "circle": return "M0 -15a15 15 0 1 1 0 30a15 15 0 1 1 0 -30z";
    case "triangle": return "M0 -15L15 13H-15z";
    case "star": return "M0 -16L4.5 -5L16 -5L7 2L10 14L0 7L-10 14L-7 2L-16 -5L-4.5 -5z";
    case "heart": return "M0 12C-20 -2 -12 -18 0 -8C12 -18 20 -2 0 12z";
    case "arrow": return "M-15 -4H3V-12L16 0L3 12V4H-15z";
    default: return "M-16 -2H16V2H-16z";
  }
}

function AudioPanel() {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const r = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const startAt = useStore.getState().currentTime;
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer.current);
        const blob = new Blob(chunks, { type: r.mimeType });
        const file = new File([blob], `voiceover-${new Date().toLocaleTimeString("en-GB").replace(/:/g, "-")}.webm`, { type: r.mimeType });
        const s = useStore.getState();
        const m = await importFile(file);
        if (!m) return;
        s.addMedia(m);
        saveMedia(m).catch(() => {});
        const trackId = s.ensureTrackFor("audio", startAt, m.duration);
        s.addClip(clipFromMedia(useStore.getState().project, m, trackId, startAt));
        s.notify("Recording added to the timeline", "ok");
      };
      r.start();
      setRec(r);
      setSecs(0);
      timer.current = setInterval(() => setSecs((x) => x + 1), 1000);
    } catch {
      useStore.getState().notify("Could not access the microphone", "error");
    }
  };
  const stop = () => {
    rec?.stop();
    setRec(null);
  };
  return (
    <>
      <div className="panel-title">Audio</div>
      <div className="ai-card" style={{ background: "var(--bg2)", borderColor: "var(--line)" }}>
        <h4>🎙 Record voice-over</h4>
        <div className="hint">Your recording is placed on an audio track at the playhead.</div>
        {rec ? (
          <button className="primary" style={{ background: "var(--danger)", borderColor: "var(--danger)" }} onClick={stop}>
            ⏹ Stop recording ({secs}s)
          </button>
        ) : (
          <button className="primary" onClick={start}>⏺ Start recording</button>
        )}
      </div>
      <div style={{ height: 12 }} />
      <div className="ai-card" style={{ background: "var(--bg2)", borderColor: "var(--line)" }}>
        <h4>🎚 Audio features</h4>
        <div className="hint" style={{ lineHeight: 1.9 }}>
          Select an audio or video clip, then open the Audio tab in the Inspector:
          <br />• Volume, fade in/out, pan and volume keyframes
          <br />• 3-band EQ with presets
          <br />• Noise reduction, voice enhance, compressor, reverb, echo
          <br />• Auto silence removal, loudness normalization, music auto-ducking
          <br />• Beat detection to markers for rhythmic editing
          <br />• Detach audio from video
          <br />• Audio-only export (WAV / MP3) from the Export button
        </div>
      </div>
      <div style={{ height: 12 }} />
      <div className="hint">Import music and sound effects from the Media tab.</div>
    </>
  );
}
