// After demos.mjs: builds the hero montage, a poster image for every GIF and the social-media preview, into
// tools/demos/work/site-media (copy that folder's files to media/ on the gh-pages branch).
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { OUT, WORK } from "./rec.mjs";

const SITE = path.join(WORK, "site-media");
fs.mkdirSync(SITE, { recursive: true });
const ff = (...args) => execFileSync(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const duration = (file) => {
  try {
    execFileSync(ffmpegPath, ["-hide_banner", "-i", file], { stdio: "pipe" });
  } catch (e) {
    const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(e.stderr));
    if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  }
  return 0;
};

// hero: short pieces of several demos (start second, negative = from the end; length)
const pieces = [["transitions", 14, 3.2], ["animate-parts", 16, 3], ["ai-cutout", -5, 3.5], ["effects", 18, 3], ["text", 15.5, 3.2]];
const inputs = [], filters = [];
for (const [name, start, len] of pieces) {
  const f = path.join(OUT, `${name}.gif`);
  if (!fs.existsSync(f)) continue;
  const ss = start < 0 ? Math.max(0, duration(f) + start) : start;
  filters.push(`[${inputs.length / 6}:v]fps=10,scale=880:-2,setsar=1[v${inputs.length / 6}]`);
  inputs.push("-ss", String(ss), "-t", String(len), "-i", f);
}
const n = inputs.length / 6;
if (n) {
  const labels = Array.from({ length: n }, (_, i) => `[v${i}]`).join("");
  ff(...inputs, "-filter_complex", `${filters.join(";")};${labels}concat=n=${n}:v=1:a=0,split[a][b];[a]palettegen=max_colors=200:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, "-loop", "0", path.join(OUT, "hero.gif"));
}

for (const f of fs.readdirSync(OUT).filter((f) => f.endsWith(".gif"))) {
  const src = path.join(OUT, f), name = f.replace(/\.gif$/, "");
  fs.copyFileSync(src, path.join(SITE, f));
  // poster: a frame from the middle, shown until the GIF has loaded
  ff("-ss", String(duration(src) * 0.55), "-i", src, "-frames:v", "1", "-update", "1", path.join(SITE, `${name}.png`));
}
if (fs.existsSync(path.join(OUT, "hero.gif"))) {
  ff("-ss", "7", "-i", path.join(OUT, "hero.gif"), "-frames:v", "1", "-vf", "scale=1200:-2,crop=1200:630:0:(ih-630)/2", "-update", "1", path.join(SITE, "og.png"));
}
const files = fs.readdirSync(SITE);
const mb = files.reduce((s, f) => s + fs.statSync(path.join(SITE, f)).size, 0) / 1e6;
console.log(`${files.length} files, ${mb.toFixed(1)} MB in ${SITE}`);
