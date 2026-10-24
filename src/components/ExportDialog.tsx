import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { projectDuration } from "../factory";
import { download, exportProject, type ExportFormat } from "../engine/exporter";
import { pause } from "../engine/playback";
import { getHealth } from "../health";
import { Field, Select } from "./ui";
import { desktop } from "../desktop";

/** writes the finished export to the location chosen in the desktop app's save dialog */
async function saveTo(file: string, blob: Blob) {
  const res = await fetch(`/api/save?path=${encodeURIComponent(file)}`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: blob });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Could not save the file");
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const p = useStore((s) => s.project);
  const ffmpeg = getHealth().ffmpeg;
  const [format, setFormat] = useState<ExportFormat>(ffmpeg ? "mp4" : "webm");
  const [scale, setScale] = useState(1);
  const [quality, setQuality] = useState<"low" | "medium" | "high">("high");
  const [range, setRange] = useState<"all" | "selection">("all");
  const [progress, setProgress] = useState<{ p: number; label: string } | null>(null);
  const signal = useRef({ cancelled: false });
  const dur = projectDuration(p);
  // desktop app: where the file goes. `chosen` = picked in the save dialog (the engine only writes there)
  const [target, setTarget] = useState<{ path: string; chosen: boolean } | null>(null);
  const fileName = `${p.name || "video"}.${format}`;
  useEffect(() => {
    if (!desktop) return;
    // a different format needs a new location (the file extension changes)
    if (target?.chosen && target.path.toLowerCase().endsWith(`.${format}`)) return;
    desktop.defaultSavePath(fileName).then((path) => setTarget({ path, chosen: false }));
  }, [format]);
  const choose = async () => {
    const path = await desktop!.chooseSavePath(target?.path ?? fileName, format);
    if (path) setTarget({ path, chosen: true });
    return path;
  };

  const run = async () => {
    // desktop app: confirm the location first, so a long render never ends in a dialog
    let file = target?.chosen ? target.path : null;
    if (desktop && !file) {
      file = await choose();
      if (!file) return;
    }
    pause();
    const s = useStore.getState();
    let from = 0, to = dur;
    if (range === "selection") {
      const sel = s.project.clips.filter((c) => s.selected.includes(c.id));
      if (sel.length) {
        from = Math.min(...sel.map((c) => c.start));
        to = Math.max(...sel.map((c) => c.start + c.duration));
      }
    }
    signal.current = { cancelled: false };
    const started = performance.now();
    s.setBusy("Exporting…");
    setProgress({ p: 0, label: "Preparing…" });
    try {
      const blob = await exportProject(s.project, s.media, {
        format, scale, fps: p.fps, quality, from, to, serverFfmpeg: ffmpeg, signal: signal.current,
        onProgress: (x, label) => setProgress({ p: x, label }),
      });
      const ext = blob.type.includes("mp4") && format === "webm" ? "mp4" : format;
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      if (file) {
        setProgress({ p: 1, label: "Saving…" });
        await saveTo(file, blob);
        const reveal = navigator.platform.startsWith("Mac") ? "Show in Finder" : "Show in folder";
        s.notify(`Exported in ${secs}s ✓  ${file.split(/[\\/]/).pop()}`, "ok", { label: reveal, run: () => desktop!.showInFolder(file!) });
      } else {
        download(blob, `${p.name || "video"}.${ext}`);
        s.notify(`Export finished in ${secs}s ✓`, "ok");
      }
      onClose();
    } catch (e) {
      s.notify(e instanceof Error ? e.message : String(e), "error");
      setProgress(null);
    } finally {
      useStore.getState().setBusy(null);
    }
  };

  const formats: [ExportFormat, string][] = [
    ["mp4", "MP4 (H.264)"], ["webm", "WebM (VP9)"], ["mov", "MOV"], ["gif", "Animated GIF"], ["mp3", "MP3 (audio only)"], ["wav", "WAV (audio only)"],
  ];
  const needsFfmpeg = !["webm", "wav"].includes(format) && !ffmpeg;
  return (
    <div className="modal-back" onClick={() => !progress && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Export</h2>
        {progress ? (
          <>
            <div>{progress.label}</div>
            <div className="progress"><i style={{ width: `${Math.round(progress.p * 100)}%` }} /></div>
            <div className="hint">{Math.round(progress.p * 100)}%</div>
            <div className="actions">
              <button onClick={() => (signal.current.cancelled = true)}>Cancel</button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Field label="Format"><Select value={format} options={formats} onChange={setFormat} /></Field>
            {!["mp3", "wav"].includes(format) && (
              <>
                <Field label="Resolution">
                  <Select
                    value={String(scale)}
                    options={[["2", `${p.width * 2}×${p.height * 2}`], ["1", `${p.width}×${p.height} (original)`], ["0.6667", `${Math.round(p.width * 0.6667)}×${Math.round(p.height * 0.6667)}`], ["0.5", `${p.width / 2}×${p.height / 2}`]]}
                    onChange={(v) => setScale(Number(v))}
                  />
                </Field>
                <Field label="Quality">
                  <Select value={quality} options={[["high", "High"], ["medium", "Medium"], ["low", "Small file"]]} onChange={setQuality} />
                </Field>
              </>
            )}
            {desktop && (
              <Field label="Save to">
                <span className="save-path" title={target?.path}><bdi>{target ? target.path.replace(/^\/(Users|home)\/[^/]+/, "~") : "…"}</bdi></span>
                <button onClick={choose}>Change…</button>
              </Field>
            )}
            <Field label="Range">
              <Select value={range} options={[["all", `Whole project (${dur.toFixed(1)}s)`], ["selection", "Selected clips only"]]} onChange={setRange} />
            </Field>
            {needsFfmpeg && <div className="hint" style={{ color: "var(--warn)" }}>This format needs ffmpeg, which was not found.</div>}
            <div className="actions">
              <button className="primary" disabled={needsFfmpeg || dur <= 0} onClick={run}>Render</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
