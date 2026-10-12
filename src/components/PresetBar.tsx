import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import type { Clip } from "../types";
import {
  PART_LABEL, applyToClips, changedParts, deletePreset, exportPresets, importPresets, loadPresets, partsFor, renamePreset, savePreset, usePresets,
  type ClipPreset, type PresetPart,
} from "../engine/userPresets";
import { download } from "../engine/exporter";

const fitsAny = (preset: ClipPreset, clips: Clip[]) => clips.some((c) => preset.parts.some((p) => partsFor(c.kind).includes(p)));

/** top of the Inspector: apply one of "My presets" to the selected clip(s), or save this clip's settings as a preset */
export function PresetBar({ clips }: { clips: Clip[] }) {
  const presets = usePresets((s) => s.presets);
  const loaded = usePresets((s) => s.loaded);
  const [saving, setSaving] = useState(false);
  const [managing, setManaging] = useState(false);
  useEffect(() => {
    if (!loaded) loadPresets();
  }, [loaded]);

  const apply = (id: string) => {
    const preset = presets.find((x) => x.id === id);
    if (!preset) return;
    const n = applyToClips(preset, clips.map((c) => c.id));
    useStore.getState().notify(n ? `Applied “${preset.name}”${clips.length > 1 ? ` to ${n} clips` : ""}` : `“${preset.name}” has nothing that fits this kind of clip`, n ? "ok" : "error");
  };

  const sorted = [...presets].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="preset-bar">
      <select value="" onChange={(e) => apply(e.target.value)} title="Apply one of your saved presets">
        <option value="">★ My presets{presets.length ? ` (${presets.length})` : ""}…</option>
        {sorted.map((x) => (
          <option key={x.id} value={x.id} disabled={!fitsAny(x, clips)} title={x.parts.map((p) => PART_LABEL[p]).join(", ")}>
            {x.name}
          </option>
        ))}
      </select>
      {clips.length === 1 && <button title="Save this clip's settings as a preset" onClick={() => setSaving(true)}>Save as preset</button>}
      <button className="ghost icon" title="Manage presets" onClick={() => setManaging(true)}>⋯</button>
      {saving && <SavePresetDialog clip={clips[0]} onClose={() => setSaving(false)} />}
      {managing && <ManagePresetsDialog onClose={() => setManaging(false)} />}
    </div>
  );
}

function SavePresetDialog({ clip, onClose }: { clip: Clip; onClose: () => void }) {
  const project = useStore((s) => s.project);
  const presets = usePresets((s) => s.presets);
  const available = partsFor(clip.kind);
  const [parts, setParts] = useState<PresetPart[]>(() => {
    const changed = changedParts(clip);
    return changed.length ? changed : available.filter((p) => p === "color" || p === "effects");
  });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const exists = presets.some((x) => x.name.toLowerCase() === name.trim().toLowerCase());

  const save = async () => {
    setBusy(true);
    try {
      const p = await savePreset(clip, name, parts, project);
      useStore.getState().notify(`Saved “${p.name}” — find it under ★ My presets`, "ok");
      onClose();
    } catch (e) {
      useStore.getState().notify(e instanceof Error ? e.message : String(e), "error");
      setBusy(false);
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Save as preset</h2>
        <input autoFocus placeholder="Name, e.g. My vlog look" value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter" && name.trim() && parts.length) save(); }} />
        {exists && <div className="hint" style={{ marginTop: 4 }}>A preset with this name exists — saving replaces it.</div>}
        <div className="panel-title" style={{ margin: "12px 0 6px", fontSize: 13 }}>What to include</div>
        <div className="preset-parts">
          {available.map((p) => (
            <label key={p} className="check">
              <input type="checkbox" checked={parts.includes(p)} onChange={(e) => setParts(e.target.checked ? [...parts, p] : parts.filter((x) => x !== p))} />
              {PART_LABEL[p]}
            </label>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>Ticked parts are the ones you changed on this clip. Applying the preset changes only these parts.</div>
        <div className="actions">
          <button className="primary" disabled={busy || !name.trim() || !parts.length} onClick={save}>Save preset</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function ManagePresetsDialog({ onClose }: { onClose: () => void }) {
  const presets = usePresets((s) => s.presets);
  const fileRef = useRef<HTMLInputElement>(null);
  const notify = useStore((s) => s.notify);
  const sorted = [...presets].sort((a, b) => a.name.localeCompare(b.name));

  const onImport = async (f: File) => {
    try {
      const n = await importPresets(await f.text());
      notify(`Imported ${n} preset${n === 1 ? "" : "s"}`, "ok");
    } catch (e) {
      notify(`Could not import: ${e instanceof Error ? e.message : e}`, "error");
    }
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>My presets</h2>
        {!presets.length && <div className="hint">No presets yet. Select a clip, set it up the way you like, and click <b>Save as preset</b>.</div>}
        <div className="preset-list">
          {sorted.map((x) => (
            <div key={x.id} className="preset-row">
              <input defaultValue={x.name} onBlur={(e) => e.target.value !== x.name && renamePreset(x.id, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <span className="hint" title={x.parts.map((p) => PART_LABEL[p]).join(", ")}>{x.parts.length} part{x.parts.length === 1 ? "" : "s"} · from {x.from}</span>
              <button className="ghost icon" title="Export this preset" onClick={() => download(exportPresets([x.id]), `${x.name}.nomadpreset.json`)}>⤓</button>
              <button className="ghost icon" title="Delete" onClick={() => confirm(`Delete “${x.name}”?`) && deletePreset(x.id)}>🗑</button>
            </div>
          ))}
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }} />
        <div className="actions">
          <button onClick={() => fileRef.current?.click()}>Import…</button>
          <button disabled={!presets.length} onClick={() => download(exportPresets(), "my-presets.nomadpreset.json")}>Export all</button>
          <span className="spacer" />
          <button className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
