import { useStore } from "../store";
import { projectDuration } from "../factory";
import { audioEngine } from "./audio";
import { allVideos } from "./media";

const S = () => useStore.getState();

export async function play() {
  const s = S();
  const end = projectDuration(s.project);
  if (end <= 0) return;
  if (s.currentTime >= end - 0.05) s.setTime(0);
  await audioEngine.play(s.project, s.media, S().currentTime);
  s.setPlaying(true);
}

export function pause() {
  audioEngine.stop();
  for (const v of allVideos().values()) v.pause();
  S().setPlaying(false);
}

export const toggle = () => (S().playing ? pause() : play());

export function seek(t: number) {
  const s = S();
  s.setTime(Math.max(0, t));
  if (s.playing) audioEngine.play(s.project, s.media, S().currentTime);
}

/** called every animation frame while playing; returns timeline time */
export function tick(): number {
  const s = S();
  const end = projectDuration(s.project);
  let t = audioEngine.time();
  if (t >= end) {
    if (s.loop && end > 0) {
      t = 0;
      audioEngine.play(s.project, s.media, 0);
    } else {
      pause();
      t = end;
    }
  }
  s.setTime(t);
  return t;
}

// reschedule audio when the project changes during playback (volume, cuts, etc.)
let timer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe((st, prev) => {
  if (!st.playing) return;
  if (st.project !== prev.project || st.media !== prev.media) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const s = S();
      if (s.playing) audioEngine.play(s.project, s.media, audioEngine.time());
    }, 120);
  }
});
