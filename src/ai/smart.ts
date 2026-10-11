import { useStore, getClip } from "../store";
import { detectBeats, detectScenes, normalizeGain, soundSegments } from "../engine/analysis";
import { uid, makeClip, defaultText } from "../factory";
import type { Clip, Keyframe } from "../types";
import { audioEngine, encodeWav } from "../engine/audio";
import { getVideo, importFile } from "../engine/media";
import { saveMedia } from "../engine/persist";
import { applyMotion } from "../engine/motion";

const S = () => useStore.getState();

export function removeSilence(clipId: string) {
  const c = getClip(clipId);
  if (!c) throw new Error("Clip not found");
  const segs = soundSegments(c);
  if (!segs.length) throw new Error("No sound found in this clip");
  const kept = segs.reduce((s, r) => s + (r.end - r.start), 0);
  const removed = c.duration - kept;
  if (removed < 0.2) return 0;
  S().commit((p) => {
    const orig = p.clips.find((x) => x.id === clipId)!;
    p.clips = p.clips.filter((x) => x.id !== clipId);
    let cursor = orig.start;
    for (const r of segs) {
      const part: Clip = structuredClone(orig);
      part.id = uid("clip");
      part.start = cursor;
      part.duration = r.end - r.start;
      part.offset = orig.offset + r.start * orig.speed;
      part.keyframes = {};
      p.clips.push(part);
      cursor += part.duration;
    }
    // ripple later clips on the same track
    for (const x of p.clips) if (x.trackId === orig.trackId && x.start >= orig.start + orig.duration - 1e-3) x.start -= removed;
  });
  return removed;
}

export function normalizeClip(clipId: string) {
  const c = getClip(clipId);
  if (!c) throw new Error("Clip not found");
  const g = normalizeGain(c);
  S().updateClip(clipId, (x) => void (x.audio.volume = Math.round(g * 100) / 100));
  return g;
}

/** lower `clipId` (music) while any other sound clip has speech */
export function autoDuck(clipId: string, duckTo = 0.22) {
  const { project } = S();
  const music = getClip(clipId);
  if (!music) throw new Error("Clip not found");
  const others = project.clips.filter(
    (c) => c.id !== clipId && (c.kind === "audio" || c.kind === "video") && c.start < music.start + music.duration && c.start + c.duration > music.start,
  );
  const speech: { start: number; end: number }[] = [];
  for (const o of others) for (const r of soundSegments(o)) speech.push({ start: o.start + r.start - music.start, end: o.start + r.end - music.start });
  speech.sort((a, b) => a.start - b.start);
  if (!speech.length) throw new Error("No speech found overlapping this music");
  const merged: typeof speech = [];
  for (const s of speech) {
    const l = merged[merged.length - 1];
    if (l && s.start - l.end < 0.8) l.end = Math.max(l.end, s.end);
    else merged.push({ ...s });
  }
  const ramp = 0.35;
  const kfs: Keyframe[] = [{ t: 0, v: 1, ease: "linear" }];
  for (const r of merged) {
    const a = Math.max(0, r.start - ramp), b = Math.min(music.duration, r.end + ramp);
    kfs.push({ t: a, v: 1, ease: "easeInOut" }, { t: Math.max(a + 0.01, r.start), v: duckTo, ease: "linear" }, { t: Math.max(r.start + 0.02, r.end), v: duckTo, ease: "easeInOut" }, { t: b, v: 1, ease: "linear" });
  }
  kfs.sort((a, b) => a.t - b.t);
  S().updateClip(clipId, (x) => void (x.keyframes.volume = kfs));
  return merged.length;
}

export function beatsToMarkers(clipId: string) {
  const c = getClip(clipId);
  if (!c) throw new Error("Clip not found");
  const beats = detectBeats(c);
  S().commit((p) => {
    for (const b of beats) p.markers.push({ id: uid("mk"), time: c.start + b, label: "", color: "#ffb703" });
  });
  return beats.length;
}

export async function scenesForClip(clipId: string, split: boolean) {
  const c = getClip(clipId);
  const m = c?.mediaId ? S().media[c.mediaId] : undefined;
  if (!c || !m || c.kind !== "video") throw new Error("Select a video clip");
  S().setBusy("Analyzing scenes…");
  try {
    const cuts = await detectScenes(c, m, (p) => S().setBusy(`Analyzing scenes ${Math.round(p * 100)}%`));
    if (split) {
      let id = clipId;
      for (const t of cuts) {
        S().splitAt(c.start + t, [id]);
        id = S().selected[0] ?? id;
      }
    } else {
      S().commit((p) => {
        for (const t of cuts) p.markers.push({ id: uid("mk"), time: c.start + t, label: "Scene", color: "#06d6a0" });
      });
    }
    return cuts.length;
  } finally {
    S().setBusy(null);
  }
}

/** creates subtitle text clips on a fresh top video track */
export function addCaptions(captions: { start: number; end: number; text: string }[], offset = 0) {
  const st = S();
  const trackId = st.addTrack("video");
  const p = S().project;
  S().commit((pp) => {
    pp.tracks.find((t) => t.id === trackId)!.name = "Captions";
    for (const cap of captions) {
      const dur = Math.max(0.3, cap.end - cap.start);
      const text = { ...defaultText(cap.text), size: Math.round(p.height * 0.045), background: "rgba(0,0,0,0.55)", shadow: 0 };
      const clip = makeClip(p, "text", trackId, offset + cap.start, dur, { name: cap.text.slice(0, 24), text });
      clip.transform.y = p.height * 0.86;
      pp.clips.push(clip);
    }
  });
  return trackId;
}

/** WAV of the clip's own audio (for speech-to-text) */
export async function clipWav(clipId: string) {
  const c = getClip(clipId)!;
  const { project, media } = S();
  const solo = {
    ...project,
    tracks: project.tracks.map((t) => ({ ...t, muted: false })),
    clips: [{ ...c, start: 0, audio: { ...c.audio, muted: false } }],
  };
  const buf = await audioEngine.mixdown(solo, media, 0, c.duration, 16000);
  return encodeWav(buf);
}

export function captionsToSrt(clips: Clip[]) {
  const ts = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return clips
    .filter((c) => c.kind === "text")
    .sort((a, b) => a.start - b.start)
    .map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.start + c.duration)}\n${c.text!.content}\n`)
    .join("\n");
}

/** inserts a 2-second still of the current frame at the playhead (ripples the track) */
export async function freezeFrame(clipId: string, seconds = 2) {
  const st = S();
  const c = getClip(clipId);
  const m = c?.mediaId ? st.media[c.mediaId] : undefined;
  if (!c || !m || c.kind !== "video") throw new Error("Select a video clip");
  const t = st.currentTime;
  if (t <= c.start || t >= c.start + c.duration) throw new Error("Move the playhead over the clip first");
  const v = getVideo(c.id, m.url);
  const target = c.offset + (t - c.start) * c.speed;
  if (Math.abs(v.currentTime - target) > 0.01) {
    await new Promise<void>((r) => {
      v.addEventListener("seeked", () => r(), { once: true });
      v.currentTime = target;
    });
  }
  const cv = document.createElement("canvas");
  cv.width = v.videoWidth;
  cv.height = v.videoHeight;
  cv.getContext("2d")!.drawImage(v, 0, 0);
  const blob = await new Promise<Blob>((r) => cv.toBlob((b) => r(b!), "image/png"));
  const item = await importFile(new File([blob], `${m.name.replace(/\.\w+$/, "")} freeze ${t.toFixed(2)}s.png`, { type: "image/png" }));
  if (!item) throw new Error("Could not capture the frame");
  st.addMedia(item);
  saveMedia(item).catch(() => {});
  st.splitAt(t, [c.id]);
  S().commit((p) => {
    for (const x of p.clips) if (x.trackId === c.trackId && x.start >= t - 1e-3) x.start += seconds;
    const still = makeClip(p, "image", c.trackId, t, seconds, {
      mediaId: item.id, name: "Freeze frame", transform: structuredClone(c.transform), filters: structuredClone(c.filters),
      fit: c.fit, crop: structuredClone(c.crop), effects: structuredClone(c.effects),
    });
    p.clips.push(still);
  });
}

/** puts images one after another with a cross dissolve and a gentle Ken Burns move */
export function photoSlideshow(mediaIds: string[], seconds = 3, transition = "fade") {
  const st = S();
  const items = mediaIds.map((id) => st.media[id]).filter((m) => m?.kind === "image");
  if (!items.length) throw new Error("No photos selected");
  const start = st.project.clips.filter((c) => c.kind !== "audio").reduce((mx, c) => Math.max(mx, c.start + c.duration), 0);
  const trackId = st.ensureTrackFor("video", start, items.length * seconds);
  S().commit((p) => {
    items.forEach((m, i) => {
      const c = makeClip(p, "image", trackId, start + i * seconds, seconds, { mediaId: m.id, name: m.name, fit: "cover" });
      if (i > 0) c.transitionIn = { type: transition, duration: Math.min(1, seconds / 3) };
      applyMotion(c, p, { preset: i % 2 ? "zoomOut" : "zoomIn", start: 0, duration: seconds, amount: 1.12, focusX: p.width / 2, focusY: p.height / 2, ease: "linear" });
      p.clips.push(c);
    });
  });
  return items.length;
}
