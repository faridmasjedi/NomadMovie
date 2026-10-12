export type MediaKind = "video" | "audio" | "image";

export interface MediaItem {
  id: string;
  name: string;
  kind: MediaKind;
  url: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  thumb?: string;
  /** peaks per second, used for waveforms (0..1) */
  peaks?: Float32Array;
  peaksPerSec?: number;
  blob?: Blob;
  /** a Lottie animation (played frame by frame); duration is one loop */
  lottie?: { fr: number; frames: number };
}

/** "adjustment" = effect layer: applies its filters/effects to everything below it */
export type ClipKind = "video" | "audio" | "image" | "text" | "shape" | "solid" | "adjustment";

export type Easing = "linear" | "easeIn" | "easeOut" | "easeInOut" | "backOut" | "bounce" | "elastic" | "hold";

export interface Keyframe {
  /** seconds, relative to clip start */
  t: number;
  v: number;
  ease: Easing;
}

export const ANIM_PROPS = ["x", "y", "scale", "scaleX", "scaleY", "rotation", "opacity", "blur", "volume"] as const;
export type AnimProp = (typeof ANIM_PROPS)[number];

export interface Transform {
  x: number;
  y: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  flipH: boolean;
  flipV: boolean;
}

export interface Filters {
  brightness: number; // 100 = normal
  contrast: number; // 100
  saturation: number; // 100
  hue: number; // deg
  blur: number; // px
  grayscale: number; // 0-100
  sepia: number; // 0-100
  invert: number; // 0-100
  vignette: number; // 0-100
  temperature: number; // -100..100
  tint: number; // -100..100
}

export type TransitionType = string; // id from TRANSITION_DEFS, or "none"

export interface Transition {
  type: TransitionType;
  duration: number;
}

export type AnimPreset =
  | "none" | "fade" | "slideUp" | "slideDown" | "slideLeft" | "slideRight" | "pop" | "zoom" | "bounce"
  | "spin" | "typewriter" | "blur" | "wordByWord" | "elastic";

export type EffectType = string; // canvas effect ("shake", "glitch"…) or GPU effect id from GL_EFFECTS

export interface Effect {
  type: EffectType;
  amount: number; // 0..100
  params?: { p1?: number; p2?: number; p3?: number; color1?: string; color2?: string };
  enabled?: boolean;
}

export interface TextProps {
  content: string;
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  strokeColor: string;
  strokeWidth: number;
  shadow: number;
  shadowColor: string;
  background: string; // "" = none
  letterSpacing: number;
  lineHeight: number;
}

export type ShapeType = "rect" | "circle" | "triangle" | "star" | "line" | "arrow" | "heart";

export interface ShapeProps {
  type: ShapeType;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  gradient: string; // "" or second color for linear gradient
}

export interface AudioProps {
  volume: number; // 1 = 100%
  muted: boolean;
  fadeIn: number;
  fadeOut: number;
  pan: number; // -1..1
  eqLow: number; // dB
  eqMid: number;
  eqHigh: number;
  denoise: boolean;
  voiceEnhance: boolean;
  compressor: boolean;
  reverb: number; // 0..1
  echo: number; // 0..1
}

export interface ChromaKey {
  enabled: boolean;
  color: string;
  threshold: number; // 0..100
  smoothness: number; // 0..100
}

/** a ready-made motion that runs on its own — no keyframes needed */
export interface Behavior {
  type: string; // id from BEHAVIORS
  /** cycles per second (or turns per second for spin) */
  speed: number;
  /** 0..100 */
  amount: number;
  /** start offset in seconds, so copies of a clip don't move in sync */
  delay?: number;
}

/** a mask shape at one moment of an animated mask */
export interface MaskKey {
  /** seconds, relative to clip start */
  t: number;
  /** flattened [x0, y0, x1, y1, …], 0..1 of the clip's uncropped picture */
  pts: number[];
}

/** keeps (or removes) only the area inside a closed outline */
export interface Mask {
  enabled: boolean;
  /** outline used when there are no keys */
  pts: number[];
  /** animated outline; every key has the same number of points */
  keys: MaskKey[];
  /** curved outline through the points (false = straight edges) */
  smooth: boolean;
  feather: number; // px
  expand: number; // px, negative shrinks
  invert: boolean;
  /** set by the AI selection: the outline was traced from this subject */
  ai?: boolean;
}

export interface Clip {
  id: string;
  trackId: string;
  kind: ClipKind;
  name: string;
  mediaId?: string;
  start: number;
  duration: number;
  offset: number;
  speed: number;
  reverse?: boolean;
  transform: Transform;
  keyframes: Partial<Record<AnimProp, Keyframe[]>>;
  filters: Filters;
  blend: GlobalCompositeOperation;
  effects: Effect[];
  chroma: ChromaKey;
  transitionIn: Transition;
  transitionOut: Transition;
  animIn: AnimPreset;
  animOut: AnimPreset;
  animInDur: number;
  animOutDur: number;
  text?: TextProps;
  shape?: ShapeProps;
  color?: string; // solid color clip
  audio: AudioProps;
  crop: { top: number; right: number; bottom: number; left: number }; // percent
  fit: "contain" | "cover" | "stretch";
  mask?: Mask;
  /** motion presets (float, sway, wiggle…) layered on top of the transform */
  behaviors?: Behavior[];
  /** the point the clip rotates and scales around, 0..1 of its picture (default: center) */
  anchor?: { x: number; y: number };
  /** follows another clip's position, rotation and scale (its own transform is relative to it) */
  parentId?: string;
  /** a static SVG image created by the AI, stored as markup */
  svg?: string;
}

export type TrackKind = "video" | "audio";

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  volume: number;
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
}

export interface Project {
  name: string;
  width: number;
  height: number;
  fps: number;
  background: string;
  tracks: Track[];
  clips: Clip[];
  markers: Marker[];
  masterVolume: number;
}
