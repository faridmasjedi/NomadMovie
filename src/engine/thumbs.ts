import { runEffect, runTransition } from "./gl";
import { effectDef, hexToRgb } from "./effectsLib";
import type { TransitionDef } from "./transitionsLib";

export const THUMB_W = 160, THUMB_H = 90;

function scene(kind: "a" | "b") {
  const c = document.createElement("canvas");
  c.width = THUMB_W;
  c.height = THUMB_H;
  const g = c.getContext("2d")!;
  if (kind === "a") {
    // sunset over mountains
    const sky = g.createLinearGradient(0, 0, 0, THUMB_H);
    sky.addColorStop(0, "#2a1b5e");
    sky.addColorStop(0.55, "#ff7a59");
    sky.addColorStop(1, "#ffd27a");
    g.fillStyle = sky;
    g.fillRect(0, 0, THUMB_W, THUMB_H);
    g.fillStyle = "#fff3c4";
    g.beginPath();
    g.arc(110, 52, 14, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#3b2350";
    g.beginPath();
    g.moveTo(0, 90); g.lineTo(0, 62); g.lineTo(35, 40); g.lineTo(62, 64); g.lineTo(92, 46); g.lineTo(130, 70); g.lineTo(160, 55); g.lineTo(160, 90);
    g.fill();
  } else {
    // ocean & palm
    const sky = g.createLinearGradient(0, 0, 0, THUMB_H);
    sky.addColorStop(0, "#5fd3ff");
    sky.addColorStop(0.6, "#bff1ff");
    sky.addColorStop(0.6, "#118ab2");
    sky.addColorStop(1, "#06566f");
    g.fillStyle = sky;
    g.fillRect(0, 0, THUMB_W, THUMB_H);
    g.fillStyle = "#f2d388";
    g.fillRect(0, 76, THUMB_W, 14);
    g.strokeStyle = "#6b4a2b";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(42, 80);
    g.quadraticCurveTo(36, 50, 48, 24);
    g.stroke();
    g.fillStyle = "#1f9d55";
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(48, 24, 22, 6, (i / 5) * Math.PI * 2, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

let A: HTMLCanvasElement | null = null, B: HTMLCanvasElement | null = null;
const samples = () => (A && B ? { A, B } : ((A = scene("a")), (B = scene("b")), { A, B }));

const cache = new Map<string, string>();

export function transitionThumb(t: TransitionDef, progress = 0.5, target?: HTMLCanvasElement) {
  const { A, B } = samples();
  const out = runTransition(t.source, A, B, THUMB_W, THUMB_H, progress, t.params);
  if (!out) return null;
  if (target) {
    const g = target.getContext("2d")!;
    g.clearRect(0, 0, target.width, target.height);
    g.drawImage(out, 0, 0, target.width, target.height);
    return null;
  }
  const key = `t:${t.id}`;
  if (!cache.has(key)) {
    const c = document.createElement("canvas");
    c.width = THUMB_W;
    c.height = THUMB_H;
    c.getContext("2d")!.drawImage(out, 0, 0);
    cache.set(key, c.toDataURL("image/jpeg", 0.8));
  }
  return cache.get(key)!;
}

export function effectThumb(id: string, time = 1.3, target?: HTMLCanvasElement) {
  const def = effectDef(id);
  if (!def) return null;
  const { A } = samples();
  const out = runEffect(def, A, THUMB_W, THUMB_H, {
    time,
    amount: def.amount / 100,
    p1: def.params?.find((p) => p.key === "p1")?.def,
    p2: def.params?.find((p) => p.key === "p2")?.def,
    p3: def.params?.find((p) => p.key === "p3")?.def,
    color1: hexToRgb(def.colors?.find((c) => c.key === "color1")?.def ?? "#ff4d9a"),
    color2: hexToRgb(def.colors?.find((c) => c.key === "color2")?.def ?? "#2233ee"),
  });
  if (!out) return null;
  if (target) {
    const g = target.getContext("2d")!;
    g.clearRect(0, 0, target.width, target.height);
    g.drawImage(out, 0, 0, target.width, target.height);
    return null;
  }
  const key = `e:${id}`;
  if (!cache.has(key)) {
    const c = document.createElement("canvas");
    c.width = THUMB_W;
    c.height = THUMB_H;
    c.getContext("2d")!.drawImage(out, 0, 0);
    cache.set(key, c.toDataURL("image/jpeg", 0.8));
  }
  return cache.get(key)!;
}

export const sampleImage = () => samples().A.toDataURL("image/jpeg", 0.8);
