# Website demos

Records the animated demos on the website (one GIF per feature) by driving the editor in Chrome.

```bash
tools/demos/prepare-media.sh      # once: downloads Tears of Steel and cuts the demo clips (macOS)
PORT=5180 npm run dev             # in another terminal
npm run demos                     # all demos → tools/demos/work/site-media
node tools/demos/demos.mjs text   # or just some of them
```

Then copy `tools/demos/work/site-media/*` to `media/` on the `gh-pages` branch. The AI demos use whatever AI is
connected in the app's Settings. Recordings never show your Claude account: it's replaced by `you@example.com`.

Demo footage: Tears of Steel (CC BY 3.0) © Blender Foundation | mango.blender.org
