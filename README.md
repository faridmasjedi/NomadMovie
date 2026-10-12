# Farid Editor

An AI-powered desktop video editor: a multi-track timeline like Filmora, keyframed motion graphics like After Effects, a full set of audio tools, and a Claude assistant that edits your project when you describe what you want.

![Farid Editor icon](build/icon.png)

## Run it

**Desktop app (macOS)**

```bash
npm install
npm run dist          # builds release/mac/Farid Editor.app and a .dmg
```

Open `release/mac/Farid Editor.app`, or drag it into Applications.

**During development**

```bash
npm run dev           # browser version at http://localhost:5173
npm run app           # build and launch the desktop app
```

## AI: use your own Claude subscription

By default Farid Editor runs AI requests through **Claude Code** (`claude -p`) on your computer, so it uses your Claude Pro or Max login and needs no API key.

1. Install Claude Code: `npm i -g @anthropic-ai/claude-code`
2. Run `claude` once and sign in with your Claude account.

To use an Anthropic API key instead, open **⚙ Settings → Anthropic API key**. Settings are saved in the app's data folder (or `~/.farid-editor/config.json` when running from source).

## Features

**Editing.** Multi-track video and audio timeline, drag and drop, split (S), trim, ripple delete, snapping, markers, copy/paste/duplicate, unlimited undo, track lock/hide/mute, timeline zoom, autosave of projects and media, and save/open of project files.

**Visuals and motion.** Text with 10 style presets, shapes and gradients, and keyframes for position, scale, rotation, opacity and blur with 8 easing curves. There are 14 in/out animation presets (typewriter, word-by-word, pop…), 15 transitions, 16 color looks plus manual color grading, and effects such as shake, glitch, RGB split, pixelate, mirror, film grain and letterbox. Also chroma key, blend modes, crop, speed ramps, and project sizes from 9:16 to 4K.

**Masks and cut-outs.** Keep only part of a clip by drawing a box, an ellipse, a freehand outline or a point-by-point shape on the preview. You can drag the points, feather or expand the edge, invert the mask, and animate it with keys. On an effect layer, a mask limits the effect to that area, for example to blur one face. "Select a subject with AI" outlines a person or object from a click. It uses EdgeTAM, a fast SAM 2 model that runs locally on the GPU via WebGPU; the model (~40 MB) downloads on first use. "Track forward/back" follows the subject through the clip and keys the outline. "Crop to mask" crops the frame to the masked area.

**Audio.** Volume with keyframes, fades, pan, 3-band EQ with presets, noise and hum reduction, voice enhancement, compressor, reverb and echo. You can record voice-overs, detach audio from video, remove silences automatically, normalize loudness, auto-duck music under speech, detect beats as markers, and watch a level meter.

**AI (Claude).** A chat assistant edits the project from plain language: intros, lower thirds, kinetic text, color grading, cuts, audio mixing. It can also:

- create SVG stickers and graphics
- look at the current frame for color and composition
- time a script to the speech for subtitles, with SRT export
- detect scenes and cut on the beat

**Export.** MP4 (H.264), WebM, MOV, GIF, MP3 and WAV, with a choice of resolution and quality and an option to export only the selected range.

## Why export is faster than real time

Export doesn't play the video back and record it. Instead:

1. Each frame is rendered directly.
2. Source videos are decoded in order with WebCodecs, instead of seeking a `<video>` element for every frame (about 60 ms per frame).
3. Frames are hardware-encoded to H.264.
4. Audio is mixed offline.
5. ffmpeg muxes video and audio by stream copy.

An 8-second 1080p timeline exports in about 4 seconds on a 2019 Intel Mac. Clips made only of text and graphics export much faster than that. If WebCodecs isn't available, Farid Editor falls back to real-time capture.

## Project layout

```
electron/main.ts         desktop shell (window, permissions, starts the local engine)
server/index.ts          local engine: Express, ffmpeg (bundled), Whisper, settings
server/ai.ts             Claude: subscription via Claude Code CLI, or the API with structured JSON output
server/config.ts         settings and Claude Code discovery
src/engine/render.ts     Canvas compositor (layers, filters, effects, chroma key, text, shapes)
src/engine/animate.ts    keyframes, easing, animation presets and transitions
src/engine/audio.ts      Web Audio engine (playback, effects, offline mixdown, WAV)
src/engine/decoder.ts    sequential MP4/MOV decoding (mp4box + WebCodecs) for fast export
src/engine/exporter.ts   fast WebCodecs export, with real-time capture as fallback
src/engine/analysis.ts   silence/speech, beat, scene and loudness analysis
src/engine/mask.ts       masks: outlines, interpolation between keys, feather/expand, compositing
src/ai/segment.ts        AI subject selection and tracking (EdgeTAM via transformers.js, local)
src/ai/actions.ts        runs the edit operations that Claude returns
src/components/          UI (timeline, preview, inspector, panels)
```

## Notes

- Fast decoding works for MP4/MOV sources. Other formats (WebM, MKV) still export correctly but more slowly.
- Automatic speech-to-text needs `pip install openai-whisper`. Without it, paste the script and the AI times it to the speech.
- The macOS build is unsigned. It opens normally when built on your own Mac. On another Mac, right-click the app and choose Open the first time.
