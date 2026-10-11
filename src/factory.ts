import type {
  AudioProps, Clip, ClipKind, Filters, MediaItem, Project, ShapeProps, TextProps, Track, TrackKind, Transform,
} from "./types";

export const uid = (p = "id") => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

export const defaultFilters = (): Filters => ({
  brightness: 100, contrast: 100, saturation: 100, hue: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0,
  vignette: 0, temperature: 0, tint: 0,
});

export const defaultAudio = (): AudioProps => ({
  volume: 1, muted: false, fadeIn: 0, fadeOut: 0, pan: 0, eqLow: 0, eqMid: 0, eqHigh: 0,
  denoise: false, voiceEnhance: false, compressor: false, reverb: 0, echo: 0,
});

export const defaultTransform = (p: Pick<Project, "width" | "height">): Transform => ({
  x: p.width / 2, y: p.height / 2, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, opacity: 1, flipH: false, flipV: false,
});

export const defaultText = (content = "Your text here"): TextProps => ({
  content, font: "Inter", size: 96, color: "#ffffff", bold: true, italic: false, align: "center",
  strokeColor: "#000000", strokeWidth: 0, shadow: 12, shadowColor: "rgba(0,0,0,0.6)", background: "",
  letterSpacing: 0, lineHeight: 1.3,
});

export const defaultShape = (type: ShapeProps["type"] = "rect"): ShapeProps => ({
  type, width: 400, height: 400, fill: "#7c5cff", stroke: "#ffffff", strokeWidth: 0, radius: 24, gradient: "",
});

export function makeClip(project: Project, kind: ClipKind, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip {
  return {
    id: uid("clip"),
    trackId,
    kind,
    name: extra.name ?? kind,
    start,
    duration,
    offset: 0,
    speed: 1,
    transform: defaultTransform(project),
    keyframes: {},
    filters: defaultFilters(),
    blend: "source-over",
    effects: [],
    chroma: { enabled: false, color: "#00ff00", threshold: 40, smoothness: 10 },
    transitionIn: { type: "none", duration: 0.5 },
    transitionOut: { type: "none", duration: 0.5 },
    animIn: "none",
    animOut: "none",
    animInDur: 0.6,
    animOutDur: 0.6,
    audio: defaultAudio(),
    crop: { top: 0, right: 0, bottom: 0, left: 0 },
    fit: "contain",
    ...extra,
  };
}

export function clipFromMedia(project: Project, media: MediaItem, trackId: string, start: number): Clip {
  const kind: ClipKind = media.kind;
  const duration = media.kind === "image" ? 5 : media.duration;
  return makeClip(project, kind, trackId, start, duration, { mediaId: media.id, name: media.name });
}

export const makeTrack = (kind: TrackKind, name: string): Track => ({
  id: uid("trk"), kind, name, muted: false, hidden: false, locked: false, volume: 1,
});

export function newProject(): Project {
  return {
    name: "Untitled project",
    width: 1920,
    height: 1080,
    fps: 30,
    background: "#000000",
    tracks: [
      makeTrack("video", "Video 3"),
      makeTrack("video", "Video 2"),
      makeTrack("video", "Video 1"),
      makeTrack("audio", "Audio 1"),
      makeTrack("audio", "Audio 2"),
    ],
    clips: [],
    markers: [],
    masterVolume: 1,
  };
}

export const projectDuration = (p: Project) => p.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);

export const isVisual = (c: Clip) => c.kind !== "audio";
export const hasSound = (c: Clip, media?: MediaItem) =>
  (c.kind === "audio" || c.kind === "video") && !!media?.hasAudio;

export const fmtTime = (s: number, fps = 30) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s % 1) * fps);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
};
