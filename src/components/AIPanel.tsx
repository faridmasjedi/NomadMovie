import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { useStore } from "../store";
import { buildContext, runActions } from "../ai/actions";
import { addCaptions, captionsToSrt, clipWav, removeSilence } from "../ai/smart";
import { soundSegments } from "../engine/analysis";
import { canvasToJpeg } from "../engine/media";
import { previewCanvas } from "./Preview";
import { download } from "../engine/exporter";
import { health } from "../health";

interface Msg {
  role: "user" | "assistant";
  text: string;
  log?: string[];
}
const useChat = create<{ msgs: Msg[]; add: (m: Msg) => void; clear: () => void }>((set) => ({
  msgs: [],
  add: (m) => set((s) => ({ msgs: [...s.msgs, m] })),
  clear: () => set({ msgs: [] }),
}));

const QUICK: [string, string][] = [
  ["🎬 Intro", 'Make a cinematic, eye-catching 6-second intro titled "My Channel": dark gradient background, animated decorative shapes and a smooth text reveal.'],
  ["📛 Lower third", 'Add a modern lower third in the bottom-left for "Alex Morgan — Director" starting at the playhead, with animated in and out.'],
  ["🎨 Color grade", "Look at this frame and give the selected clip a professional color grade (brightness, contrast, saturation, temperature)."],
  ["✨ Kinetic text", 'Create the text "Hello World" in the center with an energetic keyframed animation (pop, slight rotation, bounce).'],
  ["🔔 Subscribe button", "Create a red SVG subscribe button with a bell icon and show it in the bottom-right corner for 4 seconds with a pop animation."],
  ["📱 Make it a Reel", "Change the project to vertical 9:16 and set all video clips to fill (cover)."],
  ["✂ Quick edit", "Remove the silences from the speech clips and add short fade transitions between clips."],
  ["🎵 Music", "Auto-duck the music under the speech and give it 2-second fade in and fade out."],
];

export function AIPanel() {
  const { msgs, add, clear } = useChat();
  const [input, setInput] = useState("");
  const [sendFrame, setSendFrame] = useState(false);
  const [loading, setLoading] = useState(false);
  const [effort, setEffort] = useState<"low" | "medium" | "high">("medium");
  const h = health();
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs.length, loading]);

  const send = async (text: string, withFrame = sendFrame) => {
    if (!text.trim() || loading) return;
    const history = useChat.getState().msgs.map((m) => ({ role: m.role, text: m.text }));
    add({ role: "user", text });
    setInput("");
    setLoading(true);
    try {
      const image = withFrame && previewCanvas ? canvasToJpeg(previewCanvas, 1024) : undefined;
      const res = await fetch("/api/ai/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, context: buildContext(), history, image, effort }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Server error");
      const log = await runActions(data.actions ?? []);
      add({ role: "assistant", text: data.reply || "Done.", log: [`${data.actions?.length ?? 0} actions applied`, ...log] });
    } catch (e) {
      add({ role: "assistant", text: `❌ ${e instanceof Error ? e.message : e}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="panel-title">
        🤖 AI assistant
        <span className="spacer" />
        {msgs.length > 0 && <button className="ghost" style={{ fontSize: 11 }} onClick={clear}>New chat</button>}
      </div>
      {!h.ai && (
        <div className="ai-card" style={{ borderColor: "var(--warn)", marginBottom: 10 }}>
          <div className="hint">
            {h.provider === "claude-code" && h.claudeCode.found
              ? <>Sign in to your Claude account to use your subscription — or pick another AI.</>
              : <>Connect an AI to edit by chatting: your Claude subscription, an API key (Claude, ChatGPT, Gemini, OpenRouter), or a free local model.</>}
            <div style={{ margin: "8px 0" }}>
              <button className="primary" onClick={() => useStore.getState().set({ settingsOpen: true })}>Connect an AI</button>
            </div>
            {" "}The local smart tools (silence removal, beats, scenes…) work without AI.
          </div>
        </div>
      )}
      <div className="chat">
        {msgs.length === 0 && (
          <div className="hint" style={{ lineHeight: 1.9 }}>
            Describe what you want in plain language — the assistant edits your project directly. Try:
          </div>
        )}
        {msgs.length === 0 && (
          <div className="chips">
            {QUICK.map(([l, p]) => (
              <span key={l} className="chip" onClick={() => send(p, l.includes("Color grade"))}>{l}</span>
            ))}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role}`} dir="auto">
            {m.text}
            {m.log && <div className="log">{m.log.join(" · ")}</div>}
          </div>
        ))}
        {loading && (
          <div className="msg assistant" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="spin" style={{ borderColor: "var(--bg4)", borderTopColor: "var(--accent)" }} /> Designing and editing…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div style={{ position: "sticky", bottom: -10, background: "var(--bg1)", paddingTop: 8, paddingBottom: 10, marginTop: 8 }}>
        <textarea
          rows={3}
          dir="auto"
          placeholder='e.g. Add an animated "Big Sale" title with spinning stars at 3 seconds…'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <div className="row" style={{ marginTop: 6 }}>
          <label className="toggle" title="Also send the current preview frame so the AI can see it (color, composition)">
            <input type="checkbox" checked={sendFrame} onChange={(e) => setSendFrame(e.target.checked)} />
            <span className="knob" />
            <span>Send frame</span>
          </label>
          <select value={effort} onChange={(e) => setEffort(e.target.value as typeof effort)} title="How hard the model thinks">
            <option value="low">Fast</option>
            <option value="medium">Balanced</option>
            <option value="high">Thorough</option>
          </select>
          <span className="spacer" />
          <button className="primary" disabled={loading || !input.trim()} onClick={() => send(input)}>Send ↵</button>
        </div>
      </div>
      <SmartTools />
    </>
  );
}

function SmartTools() {
  const [script, setScript] = useState("");
  const [lang, setLang] = useState("en");
  const [working, setWorking] = useState(false);
  const h = health();
  const s = useStore.getState;

  const speechClip = () => {
    const st = s();
    const sel = st.project.clips.find((c) => st.selected.includes(c.id) && (c.kind === "audio" || c.kind === "video"));
    if (!sel) throw new Error("Select an audio/video clip that contains speech");
    return sel;
  };
  const wrap = (fn: () => Promise<string | void>) => async () => {
    setWorking(true);
    try {
      const msg = await fn();
      if (msg) s().notify(msg, "ok");
    } catch (e) {
      s().notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setWorking(false);
      s().setBusy(null);
    }
  };

  const whisper = wrap(async () => {
    const c = speechClip();
    s().setBusy("Transcribing (Whisper)…");
    const wav = await clipWav(c.id);
    const res = await fetch(`/api/transcribe?lang=${lang}`, { method: "POST", body: wav });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    addCaptions(data.segments, c.start);
    return `${data.segments.length} captions created`;
  });

  const align = wrap(async () => {
    const c = speechClip();
    if (!script.trim()) throw new Error("Paste the script first");
    const segments = soundSegments(c, { minSilence: 0.25, pad: 0.05 }).map((r) => ({ start: +r.start.toFixed(2), end: +r.end.toFixed(2) }));
    if (!segments.length) throw new Error("No speech found in this clip");
    s().setBusy("Aligning captions with AI…");
    const res = await fetch("/api/ai/subtitles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ segments, script }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    addCaptions(data.captions, c.start);
    return `${data.captions.length} captions created`;
  });

  const exportSrt = () => {
    const st = s();
    const tr = st.project.tracks.find((t) => t.name === "Captions") ?? st.project.tracks.find((t) => st.project.clips.some((c) => c.trackId === t.id && c.kind === "text"));
    if (!tr) return st.notify("No caption track found", "error");
    download(new Blob([captionsToSrt(st.project.clips.filter((c) => c.trackId === tr.id))], { type: "text/plain" }), "subtitles.srt");
  };

  const cutOnBeats = wrap(async () => {
    const st = s();
    const sel = st.project.clips.find((c) => st.selected.includes(c.id) && c.kind !== "audio");
    if (!sel) throw new Error("Select a visual clip");
    const marks = st.project.markers.map((m) => m.time).filter((t) => t > sel.start && t < sel.start + sel.duration).sort((a, b) => a - b);
    if (!marks.length) throw new Error('No markers on this clip — run "Beats → markers" on the music first');
    let id = sel.id;
    for (const t of marks) {
      s().splitAt(t, [id]);
      id = s().selected[0] ?? id;
    }
    return `${marks.length} cuts on the beat`;
  });

  const silenceAll = wrap(async () => {
    const st = s();
    const ids = st.project.clips.filter((c) => (st.selected.length ? st.selected.includes(c.id) : true) && (c.kind === "audio" || c.kind === "video") && st.media[c.mediaId!]?.hasAudio).map((c) => c.id);
    let total = 0;
    for (const id of ids) {
      try {
        total += removeSilence(id);
      } catch {
        /* no audio in clip */
      }
    }
    return `Removed ${total.toFixed(1)}s of silence`;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
      <div className="ai-card">
        <h4>💬 Auto subtitles</h4>
        <div className="hint">Select the clip with speech on the timeline.</div>
        {h.whisper ? (
          <div className="row">
            <select value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="en">English</option>
              <option value="fa">Persian</option>
              <option value="ar">Arabic</option>
              <option value="">Auto-detect</option>
            </select>
            <button className="primary" disabled={working} onClick={whisper}>Transcribe & create captions</button>
          </div>
        ) : (
          <div className="hint">
            For automatic speech-to-text install <span className="kbd">pip install openai-whisper</span>. Meanwhile, paste the script and the AI will time it to the speech:
          </div>
        )}
        <textarea rows={3} dir="auto" placeholder="Paste the spoken script here…" value={script} onChange={(e) => setScript(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <div className="row">
          <button disabled={working || !h.ai} onClick={align}>Sync script to speech (AI)</button>
          <button className="ghost" onClick={exportSrt}>Export SRT</button>
        </div>
      </div>
      <div className="ai-card">
        <h4>⚡ Smart editing</h4>
        <div className="grid2">
          <button disabled={working} onClick={silenceAll}>✂ Remove all silences</button>
          <button disabled={working} onClick={cutOnBeats}>🥁 Cut on beats</button>
        </div>
        <div className="hint">More tools (ducking, normalize, scene detection) are in the Inspector's Audio tab.</div>
      </div>
    </div>
  );
}
