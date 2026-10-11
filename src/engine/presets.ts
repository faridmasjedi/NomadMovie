import type { AnimPreset, EffectType, Filters, ShapeType, TextProps } from "../types";

export const LOOKS: { id: string; label: string; f: Partial<Filters> }[] = [
  { id: "none", label: "Original", f: {} },
  { id: "cinematic", label: "Cinematic", f: { contrast: 118, saturation: 85, temperature: -12, tint: 6, vignette: 35, brightness: 96 } },
  { id: "tealOrange", label: "Teal & orange", f: { contrast: 115, saturation: 120, temperature: 18, tint: -8, vignette: 20 } },
  { id: "vintage", label: "Vintage", f: { sepia: 45, contrast: 90, saturation: 80, brightness: 105, vignette: 45 } },
  { id: "bw", label: "B&W", f: { grayscale: 100, contrast: 125 } },
  { id: "noir", label: "Noir", f: { grayscale: 100, contrast: 160, brightness: 85, vignette: 60 } },
  { id: "warm", label: "Warm", f: { temperature: 35, saturation: 110 } },
  { id: "cool", label: "Cool", f: { temperature: -35, saturation: 95, brightness: 102 } },
  { id: "vivid", label: "Vivid", f: { saturation: 150, contrast: 112 } },
  { id: "faded", label: "Faded", f: { contrast: 80, saturation: 70, brightness: 110 } },
  { id: "dramatic", label: "Dramatic", f: { contrast: 140, saturation: 90, brightness: 90, vignette: 50 } },
  { id: "dreamy", label: "Dreamy", f: { brightness: 112, contrast: 88, saturation: 115, blur: 0.6, tint: 10 } },
  { id: "sunset", label: "Sunset", f: { temperature: 45, tint: 15, saturation: 125, contrast: 108 } },
  { id: "cyber", label: "Cyberpunk", f: { hue: -25, saturation: 150, contrast: 120, tint: 30, temperature: -20 } },
  { id: "matrix", label: "Matrix", f: { tint: -45, saturation: 80, contrast: 125, brightness: 92 } },
  { id: "invert", label: "Invert", f: { invert: 100 } },
];

export const EFFECTS: { type: EffectType; label: string; amount: number }[] = [
  { type: "shake", label: "Camera shake", amount: 40 },
  { type: "glitch", label: "Glitch", amount: 50 },
  { type: "rgbSplit", label: "RGB split", amount: 40 },
  { type: "pixelate", label: "Pixelate", amount: 40 },
  { type: "mirror", label: "Mirror", amount: 100 },
  { type: "zoomPulse", label: "Zoom pulse", amount: 50 },
  { type: "flicker", label: "Flicker", amount: 40 },
  { type: "filmGrain", label: "Film grain", amount: 40 },
  { type: "letterbox", label: "Letterbox", amount: 60 },
];

export const FONTS = ["Inter", "Montserrat", "Bebas Neue", "Playfair Display", "Roboto Mono", "Vazirmatn", "Lalezar", "Arial", "Georgia"];

export const TEXT_STYLES: { label: string; p: Partial<TextProps>; anim?: AnimPreset }[] = [
  { label: "Main title", p: { size: 140, font: "Inter", bold: true, color: "#ffffff", shadow: 20 }, anim: "pop" },
  { label: "Bold display", p: { size: 160, font: "Lalezar", bold: false, color: "#ffd84d", strokeColor: "#1b1b1b", strokeWidth: 8 }, anim: "bounce" },
  { label: "Subtitle text", p: { size: 64, font: "Inter", bold: false, color: "#e6e6e6", shadow: 8 }, anim: "fade" },
  { label: "Caption", p: { size: 56, font: "Inter", bold: true, color: "#ffffff", background: "rgba(0,0,0,0.55)", shadow: 0 } },
  { label: "Neon", p: { size: 120, font: "Montserrat", bold: true, color: "#fff", shadow: 40, shadowColor: "#ff2bd6" }, anim: "zoom" },
  { label: "Cinematic", p: { size: 110, font: "Bebas Neue", bold: false, color: "#f5f5f5", letterSpacing: 24, shadow: 0 }, anim: "blur" },
  { label: "Classic", p: { size: 100, font: "Playfair Display", bold: true, italic: true, color: "#f3e3c3" }, anim: "fade" },
  { label: "Typewriter", p: { size: 72, font: "Roboto Mono", bold: false, color: "#7CFFB2", shadow: 0 }, anim: "typewriter" },
  { label: "Label", p: { size: 60, font: "Inter", bold: true, color: "#111", background: "#ffd84d", shadow: 0 }, anim: "slideRight" },
  { label: "Outline", p: { size: 130, font: "Inter", bold: true, color: "rgba(0,0,0,0)", strokeColor: "#ffffff", strokeWidth: 4, shadow: 0 }, anim: "wordByWord" },
];

export const SHAPES: { type: ShapeType; label: string }[] = [
  { type: "rect", label: "Rectangle" },
  { type: "circle", label: "Circle" },
  { type: "triangle", label: "Triangle" },
  { type: "star", label: "Star" },
  { type: "heart", label: "Heart" },
  { type: "arrow", label: "Arrow" },
  { type: "line", label: "Line" },
];

export const SOLID_COLORS = ["#000000", "#ffffff", "#111827", "#7c5cff", "#ff4d6d", "#ffb703", "#06d6a0", "#118ab2", "#ff6b35", "#2b2d42"];

export const ASPECTS: { label: string; w: number; h: number }[] = [
  { label: "16:9 Landscape (1080p)", w: 1920, h: 1080 },
  { label: "16:9 (720p)", w: 1280, h: 720 },
  { label: "4K", w: 3840, h: 2160 },
  { label: "9:16 Stories/Reels", w: 1080, h: 1920 },
  { label: "1:1 Square", w: 1080, h: 1080 },
  { label: "4:5 Instagram", w: 1080, h: 1350 },
  { label: "21:9 Cinematic", w: 2560, h: 1080 },
];
