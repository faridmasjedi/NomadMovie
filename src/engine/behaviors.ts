import type { Behavior } from "../types";

/*
 * Motion presets ("behaviors"): ready-made motions that run on their own, without keyframes — like the
 * Wiggle / Loop presets people use in After Effects. Each one nudges the clip's frame state over time;
 * they rotate and scale around the clip's anchor point and add on top of keyframes and other behaviors.
 */

export interface MotionState {
  x: number;
  y: number;
  sx: number;
  sy: number;
  rotation: number;
  opacity: number;
}

export interface BehaviorDef {
  id: string;
  label: string;
  hint: string;
  speed: number; // default cycles per second
  amount: number; // default 0..100
  apply: (s: MotionState, t: number, speed: number, a: number, W: number, H: number) => void;
}

const TAU = Math.PI * 2;
/** smooth pseudo-random wave in -1..1 (sum of incommensurate sines) */
const wave = (t: number, seed: number) =>
  (Math.sin(t * 1.0 + seed) * 0.5 + Math.sin(t * 2.31 + seed * 1.7) * 0.3 + Math.sin(t * 4.13 + seed * 2.9) * 0.2);

export const BEHAVIORS: BehaviorDef[] = [
  { id: "float", label: "Float", hint: "Bobs gently up and down", speed: 0.5, amount: 40,
    apply: (s, t, f, a, _W, H) => void (s.y += Math.sin(TAU * f * t) * a * H * 0.04) },
  { id: "sway", label: "Sway", hint: "Rocks side to side — set the anchor at the bottom for plants, at the top for hanging things", speed: 0.4, amount: 40,
    apply: (s, t, f, a) => void (s.rotation += Math.sin(TAU * f * t) * a * 15) },
  { id: "wiggle", label: "Wiggle", hint: "Wanders randomly, like a hand-held or living thing", speed: 1, amount: 35,
    apply: (s, t, f, a, W, H) => {
      const k = TAU * f * t;
      s.x += wave(k, 1) * a * W * 0.02;
      s.y += wave(k, 7) * a * H * 0.02;
      s.rotation += wave(k, 13) * a * 4;
    } },
  { id: "bounce", label: "Bounce", hint: "Hops up and lands, again and again", speed: 1, amount: 45,
    apply: (s, t, f, a, _W, H) => {
      const ph = (f * t) % 1;
      const h = Math.sin(Math.PI * ph);
      s.y -= h * a * H * 0.08;
      // a little squash on landing
      const squash = Math.max(0, 1 - h * 6) * a * 0.12;
      s.sx *= 1 + squash;
      s.sy *= 1 - squash;
    } },
  { id: "pulse", label: "Pulse", hint: "Grows and shrinks smoothly", speed: 1, amount: 35,
    apply: (s, t, f, a) => {
      const k = 1 + Math.sin(TAU * f * t) * a * 0.12;
      s.sx *= k;
      s.sy *= k;
    } },
  { id: "heartbeat", label: "Heartbeat", hint: "A double beat, then rest", speed: 1, amount: 45,
    apply: (s, t, f, a) => {
      const ph = (f * t) % 1;
      const beat = Math.exp(-Math.pow((ph - 0.1) * 18, 2)) + 0.7 * Math.exp(-Math.pow((ph - 0.3) * 18, 2));
      const k = 1 + beat * a * 0.18;
      s.sx *= k;
      s.sy *= k;
    } },
  { id: "spin", label: "Spin", hint: "Turns around continuously (speed = turns per second)", speed: 0.25, amount: 100,
    apply: (s, t, f, a) => void (s.rotation += 360 * f * t * a) },
  { id: "swing", label: "Pendulum", hint: "Swings like a pendulum — put the anchor at the top", speed: 0.5, amount: 50,
    apply: (s, t, f, a) => void (s.rotation += Math.sin(TAU * f * t) * a * 35) },
  { id: "jelly", label: "Jelly", hint: "Wobbly squash and stretch", speed: 1.5, amount: 40,
    apply: (s, t, f, a) => {
      const w = Math.sin(TAU * f * t) * a * 0.1;
      s.sx *= 1 + w;
      s.sy *= 1 - w;
    } },
  { id: "orbit", label: "Orbit", hint: "Circles around its position", speed: 0.3, amount: 40,
    apply: (s, t, f, a, _W, H) => {
      const r = a * H * 0.06;
      s.x += Math.cos(TAU * f * t) * r;
      s.y += Math.sin(TAU * f * t) * r;
    } },
  { id: "shake", label: "Shake", hint: "Fast jitter — nervous, cold or excited", speed: 12, amount: 30,
    apply: (s, t, f, a, W, H) => {
      const k = Math.floor(t * f);
      const r = (n: number) => (Math.sin(k * 12.9898 + n * 78.233) * 43758.5453) % 1;
      s.x += r(1) * a * W * 0.008;
      s.y += r(2) * a * H * 0.008;
      s.rotation += r(3) * a * 2;
    } },
  { id: "blink", label: "Blink", hint: "Fades out and back in", speed: 0.5, amount: 60,
    apply: (s, t, f, a) => void (s.opacity *= 1 - a * (0.5 - 0.5 * Math.cos(TAU * f * t))) },
  { id: "drift", label: "Drift", hint: "Slowly moves across (negative amount = the other way)", speed: 0.05, amount: 50,
    apply: (s, t, f, a, W) => void (s.x += t * f * a * W) },
];

export const behaviorDef = (id: string) => BEHAVIORS.find((b) => b.id === id);

export const newBehavior = (id: string): Behavior => {
  const d = behaviorDef(id)!;
  return { type: id, speed: d.speed, amount: d.amount };
};

/** adds every behavior of a clip to its frame state at clip-local time `local` */
export function applyBehaviors(s: MotionState, list: Behavior[] | undefined, local: number, W: number, H: number) {
  if (!list?.length) return;
  for (const b of list) {
    const d = behaviorDef(b.type);
    if (d) d.apply(s, local + (b.delay ?? 0), b.speed, b.amount / 100, W, H);
  }
}
