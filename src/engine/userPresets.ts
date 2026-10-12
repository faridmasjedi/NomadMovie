import { create } from "zustand";
import type { Clip, ClipKind, MediaItem, Project } from "../types";
import { defaultAudio, defaultFilters, uid } from "../factory";
import { useStore } from "../store";

/*
 * "My presets": a clip's settings saved under a name and applied to other clips in one click.
 * A preset holds only the parts the user chose (look, effects, animation…); applying it leaves everything else alone.
 */

export type PresetPart = "color" | "effects" | "transform" | "crop" | "mask" | "chroma" | "animation" | "audio" | "speed" | "textStyle" | "shapeStyle";

export const PART_LABEL: Record<PresetPart, string> = {
  color: "Color & filters",
  effects: "Effects",
  transform: "Size, position & rotation",
  crop: "Crop & fit",
  mask: "Mask",
  chroma: "Chroma key",
  animation: "Animations, keyframes & transitions",
  audio: "Audio (volume, EQ, voice tools)",
  speed: "Speed",
  textStyle: "Text style (font, color, outline…)",
  shapeStyle: "Shape style",
};

export interface PresetData {
  filters?: Clip["filters"];
  effects?: Clip["effects"];
  /** position as a fraction of the frame, so it fits any project size */
  transform?: Omit<Clip["transform"], "x" | "y"> & { fx: number; fy: number };
  blend?: Clip["blend"];
  crop?: Clip["crop"];
  fit?: Clip["fit"];
  mask?: Clip["mask"];
  chroma?: Clip["chroma"];
  anim?: Pick<Clip, "animIn" | "animOut" | "animInDur" | "animOutDur" | "transitionIn" | "transitionOut"> & { keyframes: Clip["keyframes"] };
  audio?: Clip["audio"] & { volumeKeys?: Clip["keyframes"]["volume"] };
  speed?: Pick<Clip, "speed" | "reverse">;
  textStyle?: Omit<NonNullable<Clip["text"]>, "content">;
  shapeStyle?: NonNullable<Clip["shape"]>;
}

export interface ClipPreset {
  id: string;
  name: string;
  created: number;
  /** kind of clip it was saved from (for the label) */
  from: ClipKind;
  parts: PresetPart[];
  data: PresetData;
}

const visual = (k: ClipKind) => k !== "audio";
const picture = (k: ClipKind) => k === "video" || k === "image";
const sound = (k: ClipKind) => k === "video" || k === "audio";

/** parts that make sense for a clip of this kind */
export function partsFor(kind: ClipKind): PresetPart[] {
  const out: PresetPart[] = [];
  if (visual(kind) && kind !== "text" && kind !== "shape") out.push("color");
  if (visual(kind)) out.push("effects", "transform", "animation");
  if (picture(kind)) out.push("crop", "chroma");
  if (visual(kind)) out.push("mask");
  if (sound(kind)) out.push("audio", "speed");
  if (kind === "text") out.push("textStyle");
  if (kind === "shape") out.push("shapeStyle");
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** parts of this clip that differ from a fresh clip — ticked by default when saving */
export function changedParts(c: Clip): PresetPart[] {
  return partsFor(c.kind).filter((p) => {
    switch (p) {
      case "color": return !same(c.filters, defaultFilters());
      case "effects": return c.effects.length > 0;
      case "transform": return c.transform.scale !== 1 || c.transform.scaleX !== 1 || c.transform.scaleY !== 1 || c.transform.rotation !== 0 || c.transform.opacity !== 1 || c.transform.flipH || c.transform.flipV || c.blend !== "source-over";
      case "crop": return c.crop.top + c.crop.right + c.crop.bottom + c.crop.left > 0 || c.fit !== "contain";
      case "mask": return !!c.mask;
      case "chroma": return c.chroma.enabled;
      case "animation": return c.animIn !== "none" || c.animOut !== "none" || c.transitionIn.type !== "none" || c.transitionOut.type !== "none" || Object.keys(c.keyframes).some((k) => k !== "volume");
      case "audio": return !same({ ...c.audio }, defaultAudio()) || !!c.keyframes.volume?.length;
      case "speed": return c.speed !== 1 || !!c.reverse;
      case "textStyle": return true;
      case "shapeStyle": return true;
    }
  });
}

/** copies the chosen parts of a clip into a preset */
export function capture(c: Clip, parts: PresetPart[], p: Project): PresetData {
  const d: PresetData = {};
  const copy = <T,>(v: T): T => structuredClone(v);
  for (const part of parts) {
    switch (part) {
      case "color": d.filters = copy(c.filters); break;
      case "effects": d.effects = copy(c.effects); break;
      case "transform": {
        const { x, y, ...rest } = c.transform;
        d.transform = { ...rest, fx: x / p.width, fy: y / p.height };
        d.blend = c.blend;
        break;
      }
      case "crop": d.crop = copy(c.crop); d.fit = c.fit; break;
      case "mask": if (c.mask) d.mask = copy(c.mask); break;
      case "chroma": d.chroma = copy(c.chroma); break;
      case "animation": {
        const keyframes = copy(c.keyframes);
        delete keyframes.volume;
        d.anim = { animIn: c.animIn, animOut: c.animOut, animInDur: c.animInDur, animOutDur: c.animOutDur, transitionIn: copy(c.transitionIn), transitionOut: copy(c.transitionOut), keyframes };
        break;
      }
      case "audio": d.audio = { ...copy(c.audio), volumeKeys: copy(c.keyframes.volume) }; break;
      case "speed": d.speed = { speed: c.speed, reverse: c.reverse }; break;
      case "textStyle": if (c.text) { const { content: _c, ...style } = c.text; d.textStyle = copy(style); } break;
      case "shapeStyle": if (c.shape) d.shapeStyle = copy(c.shape); break;
    }
  }
  return d;
}

/** applies a preset to a clip (only the parts that fit this kind of clip); returns the parts applied */
export function applyPreset(c: Clip, preset: ClipPreset, p: Project, media?: MediaItem): PresetPart[] {
  const d = structuredClone(preset.data);
  const fits = new Set(partsFor(c.kind));
  const done: PresetPart[] = [];
  for (const part of preset.parts) {
    if (!fits.has(part)) continue;
    switch (part) {
      case "color": if (!d.filters) continue; c.filters = d.filters; break;
      case "effects": if (!d.effects) continue; c.effects = d.effects; break;
      case "transform": {
        if (!d.transform) continue;
        const { fx, fy, ...rest } = d.transform;
        c.transform = { ...rest, x: fx * p.width, y: fy * p.height };
        if (d.blend) c.blend = d.blend;
        break;
      }
      case "crop": if (!d.crop) continue; c.crop = d.crop; if (d.fit) c.fit = d.fit; break;
      case "mask": if (!d.mask) continue; c.mask = d.mask; break;
      case "chroma": if (!d.chroma) continue; c.chroma = d.chroma; break;
      case "animation": {
        if (!d.anim) continue;
        const { keyframes, ...rest } = d.anim;
        Object.assign(c, rest);
        // keyframes past the end of a shorter clip are dropped
        const kept: Clip["keyframes"] = c.keyframes.volume ? { volume: c.keyframes.volume } : {};
        for (const [prop, list] of Object.entries(keyframes) as [keyof Clip["keyframes"], NonNullable<Clip["keyframes"]["x"]>][]) {
          const inside = list.filter((k) => k.t <= c.duration + 1e-3);
          if (inside.length) kept[prop] = inside;
        }
        c.keyframes = kept;
        break;
      }
      case "audio": {
        if (!d.audio) continue;
        const { volumeKeys, ...audio } = d.audio;
        c.audio = audio;
        if (volumeKeys?.length) c.keyframes.volume = volumeKeys.filter((k) => k.t <= c.duration + 1e-3);
        else delete c.keyframes.volume;
        break;
      }
      case "speed": {
        if (!d.speed) continue;
        // same rule as the Speed tab: the clip gets longer or shorter, but never past the end of its media
        const sp = Math.max(0.05, d.speed.speed);
        const maxDur = media && media.kind !== "image" ? (media.duration - c.offset) / sp : Infinity;
        c.duration = Math.max(0.05, Math.min(maxDur, (c.duration * c.speed) / sp));
        c.speed = sp;
        c.reverse = d.speed.reverse;
        break;
      }
      case "textStyle": if (!d.textStyle || !c.text) continue; c.text = { ...d.textStyle, content: c.text.content }; break;
      case "shapeStyle": if (!d.shapeStyle) continue; c.shape = d.shapeStyle; break;
    }
    done.push(part);
  }
  return done;
}

/** applies a preset to clips in one undo step; returns how many clips changed */
export function applyToClips(preset: ClipPreset, ids: string[]) {
  const st = useStore.getState();
  let n = 0;
  st.commit((p) => {
    for (const id of ids) {
      const c = p.clips.find((x) => x.id === id);
      if (c && applyPreset(c, preset, p, c.mediaId ? st.media[c.mediaId] : undefined).length) n++;
    }
  });
  return n;
}

/* ---------------- storage (in the app's data folder, shared by all projects) ---------------- */

interface PresetStore {
  presets: ClipPreset[];
  loaded: boolean;
}

export const usePresets = create<PresetStore>(() => ({ presets: [], loaded: false }));

export async function loadPresets() {
  try {
    const j = await (await fetch("/api/presets")).json();
    usePresets.setState({ presets: Array.isArray(j.presets) ? j.presets : [], loaded: true });
  } catch {
    usePresets.setState({ loaded: true });
  }
}

async function persist(presets: ClipPreset[]) {
  usePresets.setState({ presets });
  const r = await fetch("/api/presets", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ presets }) });
  if (!r.ok) throw new Error("Could not save your presets");
}

export function savePreset(c: Clip, name: string, parts: PresetPart[], p: Project) {
  const preset: ClipPreset = { id: uid("pre"), name: name.trim() || "My preset", created: Date.now(), from: c.kind, parts, data: capture(c, parts, p) };
  // saving under an existing name replaces that preset
  const rest = usePresets.getState().presets.filter((x) => x.name.toLowerCase() !== preset.name.toLowerCase());
  return persist([...rest, preset]).then(() => preset);
}

export const renamePreset = (id: string, name: string) =>
  persist(usePresets.getState().presets.map((x) => (x.id === id ? { ...x, name: name.trim() || x.name } : x)));

export const deletePreset = (id: string) => persist(usePresets.getState().presets.filter((x) => x.id !== id));

/** a .json file anyone can import */
export const exportPresets = (ids?: string[]) =>
  new Blob([JSON.stringify({ app: "NomadMovie", kind: "presets", version: 1, presets: usePresets.getState().presets.filter((x) => !ids || ids.includes(x.id)) }, null, 1)], { type: "application/json" });

/** imports presets from a file; presets with the same name are replaced. Returns how many were added. */
export async function importPresets(text: string) {
  const j = JSON.parse(text);
  const list: ClipPreset[] = Array.isArray(j?.presets) ? j.presets : [];
  const valid = list.filter((x) => x && typeof x.name === "string" && Array.isArray(x.parts) && x.data && typeof x.data === "object");
  if (!valid.length) throw new Error("No presets found in this file");
  const names = new Set(valid.map((x) => x.name.toLowerCase()));
  const kept = usePresets.getState().presets.filter((x) => !names.has(x.name.toLowerCase()));
  await persist([...kept, ...valid.map((x) => ({ ...x, id: uid("pre") }))]);
  return valid.length;
}
