import { useState, type ReactNode } from "react";

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="section">
      <div className="section-head" onClick={() => setOpen(!open)}>
        <span className={`chev ${open ? "open" : ""}`}>›</span>
        <span>{title}</span>
        <span className="spacer" />
        <span onClick={(e) => e.stopPropagation()}>{right}</span>
      </div>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

export function Slider({
  label, value, min, max, step = 1, onChange, unit = "", onReset, keyframe,
}: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string;
  onChange: (v: number) => void; onReset?: () => void; keyframe?: ReactNode;
}) {
  return (
    <div className="row slider-row">
      <label onDoubleClick={onReset} title={onReset ? "Double-click to reset" : undefined}>{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} onDoubleClick={onReset} />
      <input
        className="num"
        type="number"
        step={step}
        value={Math.round(value * 100) / 100}
        onChange={(e) => e.target.value !== "" && onChange(Number(e.target.value))}
      />
      {unit && <span className="unit">{unit}</span>}
      {keyframe}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <label>{label}</label>
      <div className="field">{children}</div>
    </div>
  );
}

export function Color({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return (
    <span className="color">
      <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
      <input className="txt" value={value} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span className="knob" />
      <span>{label}</span>
    </label>
  );
}

export function Select<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

export function Icon({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export const I = {
  play: "M7 4v16l13-8z",
  pause: "M8 4v16M16 4v16",
  undo: "M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  split: "M12 2v20M5 7l4 5-4 5M19 7l-4 5 4 5",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14",
  copy: "M8 8h12v12H8zM4 16V4h12",
  magnet: "M6 3v8a6 6 0 0 0 12 0V3h-4v8a2 2 0 0 1-4 0V3z",
  zoomIn: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M8 11h6M11 8v6",
  zoomOut: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M8 11h6",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  eyeOff: "M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3 3.6M6.6 6.6C3.8 8.4 2 12 2 12s4 7 10 7c1.7 0 3.2-.4 4.5-1",
  vol: "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14",
  mute: "M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4",
  unlock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2",
  plus: "M12 5v14M5 12h14",
  back: "M19 20 9 12l10-8zM5 4v16",
  fwd: "M5 4l10 8-10 8zM19 4v16",
  marker: "M12 2 4 8v14l8-5 8 5V8z",
  export: "M12 3v12M7 8l5-5 5 5M5 21h14",
  spark: "M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z",
  loop: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  camera: "M3 7h4l2-3h6l2 3h4v13H3zM12 10a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  diamond: "M12 2l10 10-10 10L2 12z",
  full: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  save: "M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7",
  folder: "M3 6h6l2 2h10v12H3z",
  ripple: "M3 12h4l3-8 4 16 3-8h4",
};
