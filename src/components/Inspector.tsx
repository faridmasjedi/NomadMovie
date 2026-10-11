import { useState } from "react";
import { useStore } from "../store";
import type { AnimPreset, AnimProp, Clip, Easing, TransitionType } from "../types";
import { ANIM_PRESETS, TRANSITIONS, PROP_LABEL, currentPropValue, setKeyframe } from "../engine/animate";
import { EFFECTS, FONTS, LOOKS, SHAPES } from "../engine/presets";
import { Color, Field, Section, Select, Slider, Toggle, Icon, I } from "./ui";
import { autoDuck, normalizeClip, removeSilence, beatsToMarkers, scenesForClip } from "../ai/smart";
import { makeClip, defaultFilters, fmtTime } from "../factory";

type Tab = "basic" | "anim" | "color" | "fx" | "audio" | "speed";

export function Inspector() {
  const selected = useStore((s) => s.selected);
  const clip = useStore((s) => (s.selected.length === 1 ? s.project.clips.find((c) => c.id === s.selected[0]) : undefined));
  const [tab, setTab] = useState<Tab>("basic");

  if (!clip) return <ProjectSettings multi={selected.length} />;

  const visual = clip.kind !== "audio";
  const sound = clip.kind === "audio" || clip.kind === "video";
  const tabs: [Tab, string, boolean][] = [
    ["basic", "Basic", true],
    ["anim", "Animation", visual],
    ["color", "Color", visual && clip.kind !== "text"],
    ["fx", "Effects", visual],
    ["audio", "Audio", sound],
    ["speed", "Speed", clip.kind === "video" || clip.kind === "audio"],
  ];
  const active = tabs.find((t) => t[0] === tab && t[2]) ? tab : "basic";

  return (
    <>
      <div className="inspector-tabs">
        {tabs.filter((t) => t[2]).map(([id, label]) => (
          <button key={id} className={active === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="panel-body">
        {active === "basic" && <BasicTab c={clip} />}
        {active === "anim" && <AnimTab c={clip} />}
        {active === "color" && <ColorTab c={clip} />}
        {active === "fx" && <FxTab c={clip} />}
        {active === "audio" && <AudioTab c={clip} />}
        {active === "speed" && <SpeedTab c={clip} />}
      </div>
    </>
  );
}

const upd = (c: Clip, key: string, fn: (c: Clip) => void) => useStore.getState().updateClip(c.id, fn, `${c.id}-${key}`);

/** keyframe toggle button shown next to animatable sliders */
function KfButton({ c, prop }: { c: Clip; prop: AnimProp }) {
  const t = useStore((s) => s.currentTime);
  const local = t - c.start;
  const list = c.keyframes[prop] ?? [];
  const here = list.find((f) => Math.abs(f.t - local) < 1 / 60);
  return (
    <button
      className={`kf-btn ${here ? "on" : list.length ? "has" : ""}`}
      title={here ? "Remove keyframe here" : "Add keyframe at playhead"}
      onClick={() =>
        useStore.getState().updateClip(c.id, (x) => {
          if (here) {
            x.keyframes[prop] = list.filter((f) => f !== here).map((f) => ({ ...f }));
            if (!x.keyframes[prop]!.length) delete x.keyframes[prop];
          } else if (local >= 0 && local <= c.duration) setKeyframe(x, prop, local, currentPropValue(c, prop, local));
        })
      }
    >
      <Icon d={I.diamond} size={12} />
    </button>
  );
}

/** slider for animatable props: edits keyframe at playhead if the prop is animated */
function AnimSlider({ c, prop, label, min, max, step = 1, base, setBase, unit }: {
  c: Clip; prop: AnimProp; label: string; min: number; max: number; step?: number; base: number; setBase: (x: Clip, v: number) => void; unit?: string;
}) {
  const t = useStore((s) => s.currentTime);
  const local = Math.min(c.duration, Math.max(0, t - c.start));
  const animated = !!c.keyframes[prop]?.length;
  const value = animated ? currentPropValue(c, prop, local) : base;
  return (
    <Slider
      label={label} min={min} max={max} step={step} unit={unit} value={value}
      onChange={(v) => upd(c, prop, (x) => (animated ? setKeyframe(x, prop, local, v) : setBase(x, v)))}
      keyframe={<KfButton c={c} prop={prop} />}
    />
  );
}

function BasicTab({ c }: { c: Clip }) {
  const p = useStore((s) => s.project);
  return (
    <>
      <Field label="Name">
        <input value={c.name} onChange={(e) => upd(c, "name", (x) => void (x.name = e.target.value))} />
      </Field>
      <Field label="Time">
        <span className="hint" style={{ direction: "ltr" }}>{fmtTime(c.start, p.fps)} → {fmtTime(c.start + c.duration, p.fps)}</span>
      </Field>
      <Slider label="Duration (s)" min={0.1} max={Math.max(30, c.duration * 2)} step={0.05} value={c.duration}
        onChange={(v) => upd(c, "dur", (x) => void (x.duration = Math.max(0.05, v)))} />

      {c.kind === "text" && c.text && <TextSection c={c} />}
      {c.kind === "shape" && c.shape && <ShapeSection c={c} />}
      {c.kind === "solid" && (
        <Field label="Color"><Color value={c.color ?? "#000"} onChange={(v) => upd(c, "color", (x) => void (x.color = v))} /></Field>
      )}

      {c.kind !== "audio" && (
        <Section title="Transform">
          <AnimSlider c={c} prop="x" label="X" min={-p.width} max={p.width * 2} base={c.transform.x} setBase={(x, v) => (x.transform.x = v)} />
          <AnimSlider c={c} prop="y" label="Y" min={-p.height} max={p.height * 2} base={c.transform.y} setBase={(x, v) => (x.transform.y = v)} />
          <AnimSlider c={c} prop="scale" label="Scale" min={0.01} max={5} step={0.01} base={c.transform.scale} setBase={(x, v) => (x.transform.scale = v)} />
          <AnimSlider c={c} prop="rotation" label="Rotation" min={-360} max={360} base={c.transform.rotation} setBase={(x, v) => (x.transform.rotation = v)} unit="°" />
          <AnimSlider c={c} prop="opacity" label="Opacity" min={0} max={1} step={0.01} base={c.transform.opacity} setBase={(x, v) => (x.transform.opacity = v)} />
          <div className="row" style={{ gap: 6 }}>
            <button onClick={() => upd(c, "flipH", (x) => void (x.transform.flipH = !x.transform.flipH))}>↔ Flip H</button>
            <button onClick={() => upd(c, "flipV", (x) => void (x.transform.flipV = !x.transform.flipV))}>↕ Flip V</button>
            <button onClick={() => upd(c, "center", (x) => { x.transform.x = p.width / 2; x.transform.y = p.height / 2; })}>Center</button>
          </div>
          {(c.kind === "video" || c.kind === "image") && !c.svg && (
            <Field label="Fit mode">
              <Select value={c.fit} options={[["contain", "Fit"], ["cover", "Fill"], ["stretch", "Stretch"]]} onChange={(v) => upd(c, "fit", (x) => void (x.fit = v))} />
            </Field>
          )}
          <Field label="Blend">
            <Select
              value={c.blend as string}
              options={[["source-over", "Normal"], ["multiply", "Multiply"], ["screen", "Screen"], ["overlay", "Overlay"], ["lighten", "Lighten"], ["darken", "Darken"], ["color-dodge", "Color Dodge"], ["color-burn", "Color Burn"], ["hard-light", "Hard Light"], ["soft-light", "Soft Light"], ["difference", "Difference"], ["exclusion", "Exclusion"], ["hue", "Hue"], ["saturation", "Saturation"], ["color", "Color"], ["luminosity", "Luminosity"], ["lighter", "Add"]]}
              onChange={(v) => upd(c, "blend", (x) => void (x.blend = v as GlobalCompositeOperation))}
            />
          </Field>
        </Section>
      )}

      {(c.kind === "video" || c.kind === "image") && !c.svg && (
        <Section title="Crop" defaultOpen={false}>
          {(["top", "bottom", "left", "right"] as const).map((k) => (
            <Slider key={k} label={{ top: "Top", bottom: "Bottom", left: "Left", right: "Right" }[k]} min={0} max={49} value={c.crop[k]} unit="%"
              onChange={(v) => upd(c, `crop${k}`, (x) => void (x.crop[k] = v))} />
          ))}
        </Section>
      )}

      {(c.kind === "video" || c.kind === "image") && (
        <Section title="Chroma key (green screen)" defaultOpen={c.chroma.enabled}>
          <Toggle label="Enabled" value={c.chroma.enabled} onChange={(v) => upd(c, "chroma", (x) => void (x.chroma.enabled = v))} />
          <Field label="Key color"><Color value={c.chroma.color} onChange={(v) => upd(c, "chromac", (x) => void (x.chroma.color = v))} /></Field>
          <Slider label="Threshold" min={0} max={100} value={c.chroma.threshold} onChange={(v) => upd(c, "chromat", (x) => void (x.chroma.threshold = v))} />
          <Slider label="Softness" min={0} max={100} value={c.chroma.smoothness} onChange={(v) => upd(c, "chromas", (x) => void (x.chroma.smoothness = v))} />
        </Section>
      )}
    </>
  );
}

function TextSection({ c }: { c: Clip }) {
  const t = c.text!;
  const set = (k: string, fn: (x: Clip) => void) => upd(c, `text-${k}`, fn);
  return (
    <Section title="Text">
      <textarea rows={3} value={t.content} dir="auto" onChange={(e) => set("content", (x) => { x.text!.content = e.target.value; x.name = e.target.value.slice(0, 30); })} />
      <Field label="Font">
        <Select value={t.font} options={FONTS.map((f) => [f, f])} onChange={(v) => set("font", (x) => void (x.text!.font = v))} />
      </Field>
      <Slider label="Size" min={8} max={400} value={t.size} onChange={(v) => set("size", (x) => void (x.text!.size = v))} />
      <Field label="Color"><Color value={t.color} onChange={(v) => set("color", (x) => void (x.text!.color = v))} /></Field>
      <div className="row" style={{ gap: 4 }}>
        <button className={t.bold ? "active" : ""} onClick={() => set("bold", (x) => void (x.text!.bold = !t.bold))}><b>B</b></button>
        <button className={t.italic ? "active" : ""} onClick={() => set("italic", (x) => void (x.text!.italic = !t.italic))}><i>I</i></button>
        {(["right", "center", "left"] as const).map((a) => (
          <button key={a} className={t.align === a ? "active" : ""} onClick={() => set("align", (x) => void (x.text!.align = a))}>
            {{ left: "⇤", center: "≡", right: "⇥" }[a]}
          </button>
        ))}
      </div>
      <Slider label="Letter spacing" min={-10} max={60} value={t.letterSpacing} onChange={(v) => set("ls", (x) => void (x.text!.letterSpacing = v))} />
      <Slider label="Line height" min={0.8} max={3} step={0.05} value={t.lineHeight} onChange={(v) => set("lh", (x) => void (x.text!.lineHeight = v))} />
      <Slider label="Stroke width" min={0} max={30} value={t.strokeWidth} onChange={(v) => set("sw", (x) => void (x.text!.strokeWidth = v))} />
      <Field label="Stroke color"><Color value={t.strokeColor} onChange={(v) => set("sc", (x) => void (x.text!.strokeColor = v))} /></Field>
      <Slider label="Shadow" min={0} max={80} value={t.shadow} onChange={(v) => set("sh", (x) => void (x.text!.shadow = v))} />
      <Field label="Shadow color"><Color value={t.shadowColor} onChange={(v) => set("shc", (x) => void (x.text!.shadowColor = v))} /></Field>
      <Field label="Background">
        <Color value={t.background} onChange={(v) => set("bg", (x) => void (x.text!.background = v))} />
        <button className="ghost icon" title="No background" onClick={() => set("bg0", (x) => void (x.text!.background = ""))}>×</button>
      </Field>
    </Section>
  );
}

function ShapeSection({ c }: { c: Clip }) {
  const s = c.shape!;
  const set = (k: string, fn: (x: Clip) => void) => upd(c, `shape-${k}`, fn);
  return (
    <Section title="Shape">
      <Field label="Type">
        <Select value={s.type} options={SHAPES.map((x) => [x.type, x.label])} onChange={(v) => set("type", (x) => void (x.shape!.type = v))} />
      </Field>
      <Slider label="Width" min={2} max={4000} value={s.width} onChange={(v) => set("w", (x) => void (x.shape!.width = v))} />
      <Slider label="Height" min={2} max={4000} value={s.height} onChange={(v) => set("h", (x) => void (x.shape!.height = v))} />
      <Field label="Color"><Color value={s.fill} onChange={(v) => set("fill", (x) => void (x.shape!.fill = v))} /></Field>
      <Field label="Gradient">
        <Color value={s.gradient} onChange={(v) => set("grad", (x) => void (x.shape!.gradient = v))} />
        <button className="ghost icon" onClick={() => set("grad0", (x) => void (x.shape!.gradient = ""))}>×</button>
      </Field>
      {s.type === "rect" && <Slider label="Corner radius" min={0} max={500} value={s.radius} onChange={(v) => set("r", (x) => void (x.shape!.radius = v))} />}
      <Slider label="Stroke" min={0} max={60} value={s.strokeWidth} onChange={(v) => set("sw", (x) => void (x.shape!.strokeWidth = v))} />
      <Field label="Stroke color"><Color value={s.stroke} onChange={(v) => set("st", (x) => void (x.shape!.stroke = v))} /></Field>
    </Section>
  );
}

const EASINGS: [Easing, string][] = [["linear", "Linear"], ["easeIn", "Ease in"], ["easeOut", "Ease out"], ["easeInOut", "Smooth"], ["backOut", "Back"], ["bounce", "Bounce"], ["elastic", "Elastic"], ["hold", "Hold"]];

function AnimTab({ c }: { c: Clip }) {
  const t = useStore((s) => s.currentTime);
  const props = (Object.keys(c.keyframes) as AnimProp[]).filter((k) => c.keyframes[k]?.length);
  return (
    <>
      <Section title="In animation">
        <Field label="Type">
          <Select value={c.animIn} options={ANIM_PRESETS as [AnimPreset, string][]} onChange={(v) => upd(c, "ai", (x) => void (x.animIn = v))} />
        </Field>
        <Slider label="Duration" min={0.1} max={Math.max(0.2, c.duration)} step={0.05} value={c.animInDur} onChange={(v) => upd(c, "aid", (x) => void (x.animInDur = v))} />
      </Section>
      <Section title="Out animation">
        <Field label="Type">
          <Select value={c.animOut} options={ANIM_PRESETS as [AnimPreset, string][]} onChange={(v) => upd(c, "ao", (x) => void (x.animOut = v))} />
        </Field>
        <Slider label="Duration" min={0.1} max={Math.max(0.2, c.duration)} step={0.05} value={c.animOutDur} onChange={(v) => upd(c, "aod", (x) => void (x.animOutDur = v))} />
      </Section>
      <Section title="Transition">
        {(["in", "out"] as const).map((side) => {
          const tr = side === "in" ? c.transitionIn : c.transitionOut;
          return (
            <div key={side} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <Field label={side === "in" ? "In" : "Out"}>
                <Select value={tr.type} options={TRANSITIONS as [TransitionType, string][]}
                  onChange={(v) => upd(c, `tr${side}`, (x) => void (side === "in" ? (x.transitionIn.type = v) : (x.transitionOut.type = v)))} />
              </Field>
              {tr.type !== "none" && (
                <Slider label="Duration" min={0.1} max={3} step={0.05} value={tr.duration}
                  onChange={(v) => upd(c, `trd${side}`, (x) => void (side === "in" ? (x.transitionIn.duration = v) : (x.transitionOut.duration = v)))} />
              )}
            </div>
          );
        })}
      </Section>
      <Section title="Keyframes">
        <div className="hint">Move the playhead and click ◆ next to a property, or drag directly in the preview (once a property has keyframes, dragging creates keyframes).</div>
        <AnimSlider c={c} prop="blur" label="Blur" min={0} max={60} base={0} setBase={(x, v) => setKeyframe(x, "blur", Math.max(0, t - c.start), v)} />
        <AnimSlider c={c} prop="scaleX" label="Scale X" min={0} max={4} step={0.01} base={1} setBase={(x, v) => (x.transform.scaleX = v)} />
        <AnimSlider c={c} prop="scaleY" label="Scale Y" min={0} max={4} step={0.01} base={1} setBase={(x, v) => (x.transform.scaleY = v)} />
        {props.length === 0 && <div className="hint">No keyframes yet.</div>}
        {props.map((prop) => (
          <div key={prop} className="kf-list">
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <b style={{ fontSize: 12 }}>{PROP_LABEL[prop]}</b>
              <span className="spacer" />
              <button className="ghost" style={{ fontSize: 11 }} onClick={() => upd(c, `kfclear${prop}`, (x) => void delete x.keyframes[prop])}>Clear all</button>
            </div>
            {c.keyframes[prop]!.map((f, i) => (
              <div key={i} className="kf-item">
                <span className="t" style={{ cursor: "pointer" }} onClick={() => useStore.getState().setTime(c.start + f.t)}>{f.t.toFixed(2)}s</span>
                <input type="number" step={0.01} value={Math.round(f.v * 100) / 100} style={{ width: 70 }}
                  onChange={(e) => upd(c, `kfv${prop}${i}`, (x) => void (x.keyframes[prop]![i].v = Number(e.target.value)))} />
                <select value={f.ease} onChange={(e) => upd(c, `kfe${prop}${i}`, (x) => void (x.keyframes[prop]![i].ease = e.target.value as Easing))}>
                  {EASINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button className="ghost icon" onClick={() => upd(c, `kfd${prop}${i}`, (x) => {
                  x.keyframes[prop]!.splice(i, 1);
                  if (!x.keyframes[prop]!.length) delete x.keyframes[prop];
                })}>×</button>
              </div>
            ))}
          </div>
        ))}
      </Section>
    </>
  );
}

function ColorTab({ c }: { c: Clip }) {
  const f = c.filters;
  const set = (k: keyof typeof f, v: number) => upd(c, `f-${k}`, (x) => void (x.filters[k] = v));
  return (
    <>
      <Section title="Looks">
        <div className="grid3">
          {LOOKS.map((l) => (
            <div key={l.id} className="tile" style={{ padding: 6 }}
              onClick={() => upd(c, `look${Date.now()}`, (x) => void (x.filters = { ...defaultFilters(), ...l.f }))}>
              <div className="swatch" style={{ background: "linear-gradient(135deg,#f4a261,#2a9d8f 60%,#264653)", filter: lookCss(l.f) }} />
              <span>{l.label}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Color adjust">
        <Slider label="Brightness" min={0} max={200} value={f.brightness} onChange={(v) => set("brightness", v)} onReset={() => set("brightness", 100)} />
        <Slider label="Contrast" min={0} max={200} value={f.contrast} onChange={(v) => set("contrast", v)} onReset={() => set("contrast", 100)} />
        <Slider label="Saturation" min={0} max={300} value={f.saturation} onChange={(v) => set("saturation", v)} onReset={() => set("saturation", 100)} />
        <Slider label="Temperature" min={-100} max={100} value={f.temperature} onChange={(v) => set("temperature", v)} onReset={() => set("temperature", 0)} />
        <Slider label="Tint" min={-100} max={100} value={f.tint} onChange={(v) => set("tint", v)} onReset={() => set("tint", 0)} />
        <Slider label="Hue" min={-180} max={180} value={f.hue} unit="°" onChange={(v) => set("hue", v)} onReset={() => set("hue", 0)} />
        <Slider label="Vignette" min={0} max={100} value={f.vignette} onChange={(v) => set("vignette", v)} onReset={() => set("vignette", 0)} />
        <Slider label="Blur" min={0} max={40} step={0.1} value={f.blur} onChange={(v) => set("blur", v)} onReset={() => set("blur", 0)} />
        <Slider label="Grayscale" min={0} max={100} value={f.grayscale} onChange={(v) => set("grayscale", v)} onReset={() => set("grayscale", 0)} />
        <Slider label="Sepia" min={0} max={100} value={f.sepia} onChange={(v) => set("sepia", v)} onReset={() => set("sepia", 0)} />
        <Slider label="Invert" min={0} max={100} value={f.invert} onChange={(v) => set("invert", v)} onReset={() => set("invert", 0)} />
        <button onClick={() => upd(c, `freset${Date.now()}`, (x) => void (x.filters = defaultFilters()))}>Reset all</button>
      </Section>
    </>
  );
}

export const lookCss = (f: Partial<ReturnType<typeof defaultFilters>>) =>
  [
    f.brightness !== undefined && `brightness(${f.brightness}%)`,
    f.contrast !== undefined && `contrast(${f.contrast}%)`,
    f.saturation !== undefined && `saturate(${f.saturation}%)`,
    f.hue && `hue-rotate(${f.hue}deg)`,
    f.grayscale && `grayscale(${f.grayscale}%)`,
    f.sepia && `sepia(${f.sepia}%)`,
    f.invert && `invert(${f.invert}%)`,
    f.temperature && (f.temperature > 0 ? `sepia(${f.temperature * 0.4}%)` : `hue-rotate(${f.temperature * 0.2}deg)`),
  ].filter(Boolean).join(" ") || "none";

function FxTab({ c }: { c: Clip }) {
  return (
    <>
      <Section title="Active effects">
        {c.effects.length === 0 && <div className="hint">No effects yet. Add one below or from the Effects panel.</div>}
        {c.effects.map((e, i) => (
          <div key={e.type} className="row">
            <Slider label={EFFECTS.find((x) => x.type === e.type)?.label ?? e.type} min={0} max={100} value={e.amount}
              onChange={(v) => upd(c, `fx${e.type}`, (x) => void (x.effects[i].amount = v))} />
            <button className="ghost icon" onClick={() => upd(c, `fxd${Date.now()}`, (x) => void x.effects.splice(i, 1))}>×</button>
          </div>
        ))}
      </Section>
      <Section title="Add effect">
        <div className="grid3">
          {EFFECTS.map((e) => (
            <div key={e.type} className="tile" onClick={() => upd(c, `fxa${Date.now()}`, (x) => {
              x.effects = x.effects.filter((y) => y.type !== e.type);
              x.effects.push({ type: e.type, amount: e.amount });
            })}>{e.label}</div>
          ))}
        </div>
      </Section>
    </>
  );
}

function AudioTab({ c }: { c: Clip }) {
  const a = c.audio;
  const s = useStore.getState();
  const m = useStore((st) => (c.mediaId ? st.media[c.mediaId] : undefined));
  const set = <K extends keyof typeof a>(k: K, v: (typeof a)[K]) => upd(c, `a-${k}`, (x) => void (x.audio[k] = v));
  const run = (label: string, fn: () => unknown) => {
    try {
      const r = fn();
      s.notify(`${label}${r !== undefined ? `: ${typeof r === "number" ? Math.round(r * 100) / 100 : r}` : ""}`, "ok");
    } catch (e) {
      s.notify(e instanceof Error ? e.message : String(e), "error");
    }
  };
  if (!m?.hasAudio) return <div className="empty">This clip has no audio.</div>;
  return (
    <>
      <Section title="Volume & fades">
        <AnimSlider c={c} prop="volume" label="Volume (keyframe)" min={0} max={3} step={0.01} base={1} setBase={(x, v) => setKeyframe(x, "volume", Math.max(0, s.currentTime - c.start), v)} />
        <Slider label="Volume" min={0} max={3} step={0.01} value={a.volume} onChange={(v) => set("volume", v)} onReset={() => set("volume", 1)} unit="×" />
        <Slider label="Fade in" min={0} max={Math.min(10, c.duration)} step={0.05} value={a.fadeIn} onChange={(v) => set("fadeIn", v)} />
        <Slider label="Fade out" min={0} max={Math.min(10, c.duration)} step={0.05} value={a.fadeOut} onChange={(v) => set("fadeOut", v)} />
        <Slider label="Pan (L/R)" min={-1} max={1} step={0.01} value={a.pan} onChange={(v) => set("pan", v)} onReset={() => set("pan", 0)} />
        <Toggle label="Mute" value={a.muted} onChange={(v) => set("muted", v)} />
      </Section>
      <Section title="Equalizer">
        <Slider label="Low" min={-24} max={24} value={a.eqLow} unit="dB" onChange={(v) => set("eqLow", v)} onReset={() => set("eqLow", 0)} />
        <Slider label="Mid" min={-24} max={24} value={a.eqMid} unit="dB" onChange={(v) => set("eqMid", v)} onReset={() => set("eqMid", 0)} />
        <Slider label="High" min={-24} max={24} value={a.eqHigh} unit="dB" onChange={(v) => set("eqHigh", v)} onReset={() => set("eqHigh", 0)} />
        <div className="chips">
          {[["Warm voice", [4, -1, -2]], ["Radio", [-12, 6, -10]], ["Crisp", [-2, 1, 5]], ["Bass boost", [9, 0, 1]], ["Telephone", [-24, 8, -24]], ["Flat", [0, 0, 0]]].map(([l, v]) => (
            <span key={l as string} className="chip" onClick={() => upd(c, `eq${Date.now()}`, (x) => {
              [x.audio.eqLow, x.audio.eqMid, x.audio.eqHigh] = v as number[];
            })}>{l as string}</span>
          ))}
        </div>
      </Section>
      <Section title="Audio processing">
        <Toggle label="Noise & hum reduction" value={a.denoise} onChange={(v) => set("denoise", v)} />
        <Toggle label="Voice enhance" value={a.voiceEnhance} onChange={(v) => set("voiceEnhance", v)} />
        <Toggle label="Compressor" value={a.compressor} onChange={(v) => set("compressor", v)} />
        <Slider label="Reverb" min={0} max={1} step={0.01} value={a.reverb} onChange={(v) => set("reverb", v)} />
        <Slider label="Echo" min={0} max={1} step={0.01} value={a.echo} onChange={(v) => set("echo", v)} />
      </Section>
      <Section title="Smart audio tools">
        <div className="grid2">
          <button onClick={() => run("Silence removed (seconds)", () => removeSilence(c.id))}>✂ Remove silences</button>
          <button onClick={() => run("Normalized; gain", () => normalizeClip(c.id))}>📶 Normalize loudness</button>
          <button onClick={() => run("Ducked under speech sections", () => autoDuck(c.id))}>🎚 Auto-duck</button>
          <button onClick={() => run("Beats found", () => beatsToMarkers(c.id))}>🥁 Beats → markers</button>
          {c.kind === "video" && (
            <button onClick={() => {
              const st = useStore.getState();
              const trackId = st.ensureTrackFor("audio", c.start, c.duration);
              const ac = makeClip(st.project, "audio", trackId, c.start, c.duration, {
                mediaId: c.mediaId, name: `${c.name} (audio)`, offset: c.offset, speed: c.speed, audio: { ...c.audio },
              });
              ac.keyframes = c.keyframes.volume ? { volume: structuredClone(c.keyframes.volume) } : {};
              st.addClip(ac);
              st.updateClip(c.id, (x) => void (x.audio.muted = true));
              st.notify("Audio detached from video", "ok");
            }}>🔊 Detach audio</button>
          )}
          {c.kind === "video" && <button onClick={() => scenesForClip(c.id, false).then((n) => s.notify(`${n} scenes found`, "ok")).catch((e) => s.notify(e.message, "error"))}>🎞 Detect scenes</button>}
        </div>
        <div className="hint">Ducking: run it on a music clip to automatically lower it wherever there is speech.</div>
      </Section>
    </>
  );
}

function SpeedTab({ c }: { c: Clip }) {
  const m = useStore((st) => (c.mediaId ? st.media[c.mediaId] : undefined));
  const setSpeed = (sp: number) =>
    upd(c, "speed", (x) => {
      const maxDur = m ? (m.duration - x.offset) / sp : Infinity;
      x.duration = Math.min(maxDur, (x.duration * x.speed) / sp);
      x.speed = sp;
    });
  return (
    <Section title="Speed">
      <Slider label="Speed" min={0.1} max={8} step={0.05} value={c.speed} unit="×" onChange={setSpeed} onReset={() => setSpeed(1)} />
      <div className="chips">
        {[0.25, 0.5, 0.75, 1, 1.5, 2, 4, 8].map((v) => (
          <span key={v} className="chip" onClick={() => setSpeed(v)}>×{v}</span>
        ))}
      </div>
      <div className="hint">Clip duration changes with speed. Use ×0.5 or lower for slow motion.</div>
    </Section>
  );
}

function ProjectSettings({ multi }: { multi: number }) {
  const p = useStore((s) => s.project);
  const commit = useStore((s) => s.commit);
  return (
    <div className="panel-body">
      <div className="panel-title">{multi > 1 ? `${multi} clips selected` : "Project settings"}</div>
      {multi > 1 && <div className="hint" style={{ marginBottom: 12 }}>You can move or delete them together.</div>}
      <Field label="Name"><input value={p.name} onChange={(e) => commit((x) => void (x.name = e.target.value), "pname")} /></Field>
      <div style={{ height: 6 }} />
      <Field label="Width"><input type="number" value={p.width} onChange={(e) => commit((x) => void (x.width = Math.max(16, Number(e.target.value))), "pw")} /></Field>
      <div style={{ height: 6 }} />
      <Field label="Height"><input type="number" value={p.height} onChange={(e) => commit((x) => void (x.height = Math.max(16, Number(e.target.value))), "ph")} /></Field>
      <div style={{ height: 6 }} />
      <Field label="Frame rate">
        <Select value={String(p.fps)} options={["24", "25", "30", "50", "60"].map((f) => [f, `${f} fps`])} onChange={(v) => commit((x) => void (x.fps = Number(v)))} />
      </Field>
      <div style={{ height: 6 }} />
      <Field label="Background"><Color value={p.background} onChange={(v) => commit((x) => void (x.background = v), "pbg")} /></Field>
      <div className="section" style={{ marginTop: 16, paddingTop: 10 }}>
        <div className="panel-title" style={{ fontSize: 13 }}>Keyboard shortcuts</div>
        <div className="hint" style={{ lineHeight: 2 }}>
          <span className="kbd">Space</span> play/pause · <span className="kbd">S</span> split · <span className="kbd">Del</span> delete ·{" "}
          <span className="kbd">Shift+Del</span> ripple delete · <span className="kbd">Ctrl+Z</span> undo · <span className="kbd">Ctrl+Shift+Z</span> redo ·{" "}
          <span className="kbd">Ctrl+C/V</span> copy/paste · <span className="kbd">Ctrl+D</span> duplicate · <span className="kbd">← →</span> frame step ·{" "}
          <span className="kbd">Shift+← →</span> 1 second · <span className="kbd">M</span> marker · <span className="kbd">+/-</span> zoom · <span className="kbd">Ctrl+Wheel</span> timeline zoom
        </div>
      </div>
    </div>
  );
}
