import type { Clip, MediaItem, Project } from "../types";
import { valueAt } from "./animate";

type Ctx = BaseAudioContext;

/** gain envelope of a clip at local time (volume × keyframes × fades) */
export function clipGainAt(c: Clip, local: number) {
  let g = c.audio.volume * valueAt(c.keyframes.volume, local, 1);
  if (c.audio.fadeIn > 0 && local < c.audio.fadeIn) g *= local / c.audio.fadeIn;
  const fromEnd = c.duration - local;
  if (c.audio.fadeOut > 0 && fromEnd < c.audio.fadeOut) g *= Math.max(0, fromEnd / c.audio.fadeOut);
  return g;
}

const impulseCache = new WeakMap<Ctx, AudioBuffer>();
function reverbImpulse(ctx: Ctx) {
  let b = impulseCache.get(ctx);
  if (!b) {
    const len = Math.floor(ctx.sampleRate * 2.2);
    b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    impulseCache.set(ctx, b);
  }
  return b;
}

/**
 * Schedules a clip into `ctx`. Timeline time `t0` is played at context time `when`.
 * Returns the source node (to stop it later) or null if nothing to play.
 */
export function scheduleClip(
  ctx: Ctx, c: Clip, buffer: AudioBuffer, t0: number, when: number, dest: AudioNode, trackVolume: number, until = Infinity,
): AudioBufferSourceNode | null {
  const end = Math.min(c.start + c.duration, until);
  if (end <= t0 || c.audio.muted) return null;
  const delay = Math.max(0, c.start - t0);
  const local0 = Math.max(0, t0 - c.start);
  const playDur = end - c.start - local0;
  if (playDur <= 0.001) return null;
  const srcOffset = c.offset + local0 * c.speed;
  if (srcOffset >= buffer.duration) return null;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = c.speed;

  // gain envelope as a value curve
  const gain = ctx.createGain();
  const rate = 60;
  const n = Math.max(2, Math.ceil(playDur * rate));
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = clipGainAt(c, local0 + (i / (n - 1)) * playDur) * trackVolume;
  const startAt = when + delay;
  gain.gain.setValueAtTime(curve[0], ctx.currentTime);
  gain.gain.setValueCurveAtTime(curve, Math.max(startAt, ctx.currentTime), playDur);

  let node: AudioNode = src;
  node.connect(gain);
  node = gain;

  const chain = (n2: AudioNode) => {
    node.connect(n2);
    node = n2;
  };
  const a = c.audio;
  if (a.denoise) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 90;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 9500;
    const notch = ctx.createBiquadFilter(); // mains hum
    notch.type = "notch";
    notch.frequency.value = 50;
    notch.Q.value = 10;
    chain(hp); chain(notch); chain(lp);
  }
  if (a.voiceEnhance) {
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 110;
    const mud = ctx.createBiquadFilter();
    mud.type = "peaking";
    mud.frequency.value = 300;
    mud.gain.value = -3;
    const pres = ctx.createBiquadFilter();
    pres.type = "peaking";
    pres.frequency.value = 3200;
    pres.Q.value = 0.9;
    pres.gain.value = 4;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.15;
    chain(hp); chain(mud); chain(pres); chain(comp);
  }
  if (a.eqLow || a.eqMid || a.eqHigh) {
    const lo = ctx.createBiquadFilter();
    lo.type = "lowshelf";
    lo.frequency.value = 220;
    lo.gain.value = a.eqLow;
    const mid = ctx.createBiquadFilter();
    mid.type = "peaking";
    mid.frequency.value = 1200;
    mid.Q.value = 0.8;
    mid.gain.value = a.eqMid;
    const hi = ctx.createBiquadFilter();
    hi.type = "highshelf";
    hi.frequency.value = 4500;
    hi.gain.value = a.eqHigh;
    chain(lo); chain(mid); chain(hi);
  }
  if (a.compressor) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    const makeup = ctx.createGain();
    makeup.gain.value = 1.6;
    chain(comp); chain(makeup);
  }
  if (a.pan) {
    const p = ctx.createStereoPanner();
    p.pan.value = a.pan;
    chain(p);
  }
  node.connect(dest);
  if (a.reverb > 0) {
    const conv = ctx.createConvolver();
    conv.buffer = reverbImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = a.reverb * 0.8;
    node.connect(conv).connect(wet).connect(dest);
  }
  if (a.echo > 0) {
    const delayN = ctx.createDelay(2);
    delayN.delayTime.value = 0.32;
    const fb = ctx.createGain();
    fb.gain.value = 0.25 + a.echo * 0.4;
    const wet = ctx.createGain();
    wet.gain.value = a.echo * 0.7;
    node.connect(delayN);
    delayN.connect(fb).connect(delayN);
    delayN.connect(wet).connect(dest);
  }

  src.start(startAt, srcOffset, playDur * c.speed);
  return src;
}

function soundClips(p: Project, media: Record<string, MediaItem>) {
  return p.clips.filter((c) => {
    if (c.kind !== "audio" && c.kind !== "video") return false;
    const m = c.mediaId ? media[c.mediaId] : undefined;
    const t = p.tracks.find((x) => x.id === c.trackId);
    return !!m?.hasAudio && !!t && !t.muted;
  });
}

class AudioEngine {
  ctx = new AudioContext({ latencyHint: "interactive" });
  master = this.ctx.createGain();
  analyserL = this.ctx.createAnalyser();
  analyserR = this.ctx.createAnalyser();
  recordDest = this.ctx.createMediaStreamDestination();
  buffers = new Map<string, AudioBuffer>();
  private sources: AudioBufferSourceNode[] = [];
  private bus: GainNode | null = null;
  /** context time at which timeline time `t0` played */
  private anchorCtx = 0;
  private anchorT = 0;
  running = false;

  constructor() {
    this.master.connect(this.ctx.destination);
    this.master.connect(this.recordDest);
    const split = this.ctx.createChannelSplitter(2);
    this.master.connect(split);
    this.analyserL.fftSize = 1024;
    this.analyserR.fftSize = 1024;
    split.connect(this.analyserL, 0);
    split.connect(this.analyserR, 1);
  }

  async decode(id: string, data: ArrayBuffer) {
    const buf = await this.ctx.decodeAudioData(data);
    this.buffers.set(id, buf);
    return buf;
  }

  async play(p: Project, media: Record<string, MediaItem>, t0: number) {
    if (this.ctx.state !== "running") await this.ctx.resume();
    this.stop();
    this.master.gain.value = p.masterVolume;
    const bus = this.ctx.createGain();
    bus.connect(this.master);
    this.bus = bus;
    const when = this.ctx.currentTime + 0.05;
    this.anchorCtx = when;
    this.anchorT = t0;
    for (const c of soundClips(p, media)) {
      const buf = this.buffers.get(c.mediaId!);
      if (!buf) continue;
      const tv = p.tracks.find((x) => x.id === c.trackId)?.volume ?? 1;
      const s = scheduleClip(this.ctx, c, buf, t0, when, bus, tv);
      if (s) this.sources.push(s);
    }
    this.running = true;
  }

  /** current timeline time derived from the audio clock (drift-free) */
  time() {
    return this.anchorT + Math.max(0, this.ctx.currentTime - this.anchorCtx);
  }

  stop() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* not started */
      }
    }
    this.sources = [];
    this.bus?.disconnect();
    this.bus = null;
    this.running = false;
  }

  setMaster(v: number) {
    this.master.gain.value = v;
  }

  levels(): [number, number] {
    const d = new Float32Array(this.analyserL.fftSize);
    const rms = (a: AnalyserNode) => {
      a.getFloatTimeDomainData(d);
      let s = 0;
      for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      return Math.sqrt(s / d.length);
    };
    return [rms(this.analyserL), rms(this.analyserR)];
  }

  /** offline mixdown of [from, to) */
  async mixdown(p: Project, media: Record<string, MediaItem>, from = 0, to?: number, sampleRate = 48000) {
    const end = to ?? p.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0);
    const len = Math.max(1, Math.ceil((end - from) * sampleRate));
    const off = new OfflineAudioContext(2, len, sampleRate);
    const master = off.createGain();
    master.gain.value = p.masterVolume;
    master.connect(off.destination);
    for (const c of soundClips(p, media)) {
      const buf = this.buffers.get(c.mediaId!);
      if (!buf) continue;
      const tv = p.tracks.find((x) => x.id === c.trackId)?.volume ?? 1;
      scheduleClip(off, c, buf, from, 0, master, tv, end);
    }
    return off.startRendering();
  }
}

export const audioEngine = new AudioEngine();

export function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, sr = buf.sampleRate, n = buf.length;
  const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const w = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF");
  data.setUint32(4, 36 + n * ch * 2, true);
  w(8, "WAVE");
  w(12, "fmt ");
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, sr, true);
  data.setUint32(28, sr * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  w(36, "data");
  data.setUint32(40, n * ch * 2, true);
  const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  return new Blob([data], { type: "audio/wav" });
}
