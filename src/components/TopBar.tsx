import { useRef, useState } from "react";
import { useStore } from "../store";
import { ASPECTS } from "../engine/presets";
import { health } from "../health";
import { ExportDialog } from "./ExportDialog";
import { SettingsDialog } from "./SettingsDialog";
import { Icon, I } from "./ui";
import { newProject } from "../factory";
import { clearAll } from "../engine/persist";
import { download } from "../engine/exporter";
import type { Project } from "../types";

export function TopBar() {
  const p = useStore((s) => s.project);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [exporting, setExporting] = useState(false);
  const [settings, setSettings] = useState(false);
  const h = health();
  const fileRef = useRef<HTMLInputElement>(null);
  const s = useStore.getState;

  const aspect = ASPECTS.find((a) => a.w === p.width && a.h === p.height);
  const setAspect = (i: number) => {
    const a = ASPECTS[i];
    s().commit((pp) => {
      const kx = a.w / pp.width, ky = a.h / pp.height;
      for (const c of pp.clips) {
        c.transform.x *= kx;
        c.transform.y *= ky;
        if (c.keyframes.x) c.keyframes.x.forEach((k) => (k.v *= kx));
        if (c.keyframes.y) c.keyframes.y.forEach((k) => (k.v *= ky));
      }
      pp.width = a.w;
      pp.height = a.h;
    });
  };

  return (
    <div className="topbar">
      <div className="logo"><span className="dot" />Nova</div>
      <input className="name" value={p.name} onChange={(e) => s().commit((x) => void (x.name = e.target.value), "pname")} />
      <button className="ghost icon" title="Undo" disabled={!canUndo} onClick={() => s().undo()}><Icon d={I.undo} /></button>
      <button className="ghost icon" title="Redo" disabled={!canRedo} onClick={() => s().redo()}><Icon d={I.redo} /></button>
      <select value={aspect ? ASPECTS.indexOf(aspect) : -1} onChange={(e) => setAspect(Number(e.target.value))} title="Project size">
        {!aspect && <option value={-1}>{p.width}×{p.height}</option>}
        {ASPECTS.map((a, i) => <option key={i} value={i}>{a.label}</option>)}
      </select>
      <span className="spacer" />
      <span className="status-pill">
        <b className={h.ai ? "on" : "off"} onClick={() => setSettings(true)} title={h.provider === "claude-code" ? "AI: your Claude subscription (Claude Code)" : "AI: Anthropic API key"}>
          ● AI {h.provider === "claude-code" ? "(Claude subscription)" : "(API key)"}
        </b>
        <b className={h.ffmpeg ? "on" : "off"}>● ffmpeg</b>
        <b className={h.whisper ? "on" : "off"}>● Whisper</b>
      </span>
      <button className="ghost" title="New project" onClick={async () => {
        if (!confirm("Discard the current project and its saved media?")) return;
        await clearAll();
        s().set({ media: {} });
        s().setProject(newProject());
      }}>New</button>
      <button className="ghost icon" title="Open project file (.nova.json)" onClick={() => fileRef.current?.click()}><Icon d={I.folder} /></button>
      <input ref={fileRef} type="file" accept=".json" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        try {
          const proj = JSON.parse(await f.text()) as Project;
          if (!proj.tracks || !proj.clips) throw new Error();
          s().setProject(proj);
          const missing = proj.clips.filter((c) => c.mediaId && !s().media[c.mediaId]).length;
          s().notify(missing ? `Project opened; media for ${missing} clips is missing — re-import it` : "Project opened", missing ? "error" : "ok");
        } catch {
          s().notify("Invalid project file", "error");
        }
        e.target.value = "";
      }} />
      <button className="ghost icon" title="Save project file" onClick={() => download(new Blob([JSON.stringify(s().project, null, 1)], { type: "application/json" }), `${p.name}.nova.json`)}>
        <Icon d={I.save} />
      </button>
      <button className="primary" onClick={() => setExporting(true)}><Icon d={I.export} /> Export</button>
      <button className="ghost icon" title="Settings" onClick={() => setSettings(true)}>⚙</button>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
    </div>
  );
}
