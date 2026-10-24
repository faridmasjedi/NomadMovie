import { useEffect, useState } from "react";
import { useStore } from "./store";
import { TopBar } from "./components/TopBar";
import { LeftPanel, importFiles } from "./components/LeftPanel";
import { Preview } from "./components/Preview";
import { Inspector } from "./components/Inspector";
import { Timeline } from "./components/Timeline";
import { loadHealth } from "./health";
import { loadAllMedia, loadProject, saveProject } from "./engine/persist";
import { seek, toggle, pause } from "./engine/playback";
import { uid } from "./factory";
import { FONTS } from "./engine/presets";
import { markDirty } from "./components/Preview";
import { ContextMenuHost } from "./components/ContextMenu";
import { UpdateBanner } from "./components/UpdateBanner";

export default function App() {
  const toast = useStore((s) => s.toast);
  const busy = useStore((s) => s.busy);
  const [tlH, setTlH] = useState(() => Number(localStorage.getItem("nomad-tl-h")) || 300);

  // restore last session + autosave
  useEffect(() => {
    loadHealth();
    // canvas text only uses fonts that are already loaded
    Promise.all(FONTS.flatMap((f) => [document.fonts.load(`400 40px "${f}"`), document.fonts.load(`800 40px "${f}"`)]))
      .catch(() => {})
      .then(markDirty);
    let saveTimer: ReturnType<typeof setTimeout>;
    let unsub = () => {};
    (async () => {
      try {
        const p = await loadProject();
        if (p) useStore.getState().setProject(p);
        useStore.getState().setBusy("Restoring media…");
        await loadAllMedia((m) => useStore.getState().addMedia(m));
      } catch (e) {
        console.warn(e);
      } finally {
        useStore.getState().setBusy(null);
      }
      unsub = useStore.subscribe((s, prev) => {
        if (s.project === prev.project) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveProject(useStore.getState().project).catch(() => {}), 800);
      });
    })();
    return () => unsub();
  }, []);

  // toast auto-hide
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => useStore.setState({ toast: null }), toast.action ? 8000 : toast.kind === "error" ? 5000 : 2800);
    return () => clearTimeout(t);
  }, [toast]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.closest("input, textarea, select, [contenteditable]") && !(tgt as HTMLInputElement).type?.match(/range|checkbox/)) return;
      const s = useStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (k === " ") {
        e.preventDefault();
        toggle();
      } else if (mod && k === "z") {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        s.redo();
      } else if (mod && k === "c") s.copy();
      else if (mod && k === "x") {
        s.copy();
        s.deleteClips(s.selected);
      } else if (mod && k === "v") s.paste();
      else if (mod && k === "d") {
        e.preventDefault();
        s.duplicate(s.selected);
      } else if (mod && k === "a") {
        e.preventDefault();
        s.select(s.project.clips.map((c) => c.id));
      } else if (k === "delete" || k === "backspace") s.deleteClips(s.selected, e.shiftKey);
      else if (k === "s" && !mod) s.splitAt(s.currentTime);
      else if (k === "m" && !mod) s.commit((p) => void p.markers.push({ id: uid("mk"), time: s.currentTime, label: "", color: "#ff4d6d" }));
      else if (k === "n" && !mod) s.set({ snapping: !s.snapping });
      else if (k === "arrowleft" || k === "arrowright") {
        e.preventDefault();
        if (s.playing) pause();
        const step = e.shiftKey ? 1 : 1 / s.project.fps;
        seek(s.currentTime + (k === "arrowleft" ? -step : step));
      } else if (k === "home") seek(0);
      else if (k === "end") seek(s.project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0));
      else if (k === "=" || k === "+") s.setZoom(s.zoom * 1.25);
      else if (k === "-") s.setZoom(s.zoom / 1.25);
      else if (k === "escape") s.select([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY, h0 = tlH;
    const mv = (ev: PointerEvent) => {
      const h = Math.min(window.innerHeight - 220, Math.max(140, h0 - (ev.clientY - y0)));
      setTlH(h);
      localStorage.setItem("nomad-tl-h", String(h));
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
      className="app"
      dir="ltr"
      style={{ ["--tl-h" as string]: `${tlH}px` }}
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (e.dataTransfer.files.length && !(e.target as HTMLElement).closest(".dropzone")) {
          e.preventDefault();
          importFiles(e.dataTransfer.files);
        }
      }}
    >
      <TopBar />
      <div className="main">
        <LeftPanel />
        <Preview />
        <div className="panel right">
          <Inspector />
        </div>
      </div>
      <div className="resizer" onPointerDown={startResize} />
      <Timeline />
      <ContextMenuHost />
      <UpdateBanner />
      {toast && (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          {toast.msg}
          {toast.action && <button className="ghost toast-action" onClick={() => (toast.action!.run(), useStore.setState({ toast: null }))}>{toast.action.label}</button>}
        </div>
      )}
      {busy && <div className="busy"><span className="spin" />{busy}</div>}
    </div>
  );
}
