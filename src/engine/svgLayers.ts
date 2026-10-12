import type { Clip, MediaItem } from "../types";
import { useStore } from "../store";
import { makeTrack, uid } from "../factory";
import { contentSize } from "./render";
import { setParent } from "./rig";
import { getSvgImage } from "./media";

/*
 * Splits an SVG illustration into layers — one clip per top-level group (head, arm, background…) — so
 * each part can be animated on its own. Every layer keeps the whole artboard, so the parts line up
 * exactly; they are parented to the bottom layer, so moving that one moves the whole illustration.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const NON_GRAPHIC = new Set(["defs", "style", "title", "desc", "metadata", "script", "sodipodi:namedview"]);
const MAX_LAYERS = 40;

/** the SVG markup of a clip (AI-made graphics or an imported .svg file), or null */
export async function svgSource(c: Clip, m?: MediaItem): Promise<string | null> {
  if (c.svg) return c.svg;
  if (!m?.blob || m.lottie) return null;
  if (!/\.svg$/i.test(m.name) && m.blob.type !== "image/svg+xml") return null;
  return m.blob.text();
}

export const canSplit = (c: Clip, m?: MediaItem) => c.kind === "image" && (!!c.svg || (!!m && !m.lottie && (/\.svg$/i.test(m.name) || m.blob?.type === "image/svg+xml")));

const layerName = (el: Element, i: number) =>
  el.getAttribute("inkscape:label") || el.getAttribute("data-name") || el.getAttribute("id") || `${el.tagName === "g" ? "Group" : el.tagName} ${i + 1}`;

/** the illustration's parts, bottom to top, each as a standalone SVG of the full artboard */
export function splitSvg(text: string): { name: string; svg: string }[] {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg" || doc.querySelector("parsererror")) throw new Error("This doesn't look like a valid SVG file");
  // a fixed size: an SVG without width/height would render at 300×150
  const vb = root.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  const w = parseFloat(root.getAttribute("width") ?? "") || (vb && vb[2]) || 1000;
  const h = parseFloat(root.getAttribute("height") ?? "") || (vb && vb[3]) || 1000;
  root.setAttribute("width", String(w));
  root.setAttribute("height", String(h));
  if (!vb) root.setAttribute("viewBox", `0 0 ${w} ${h}`);

  const shared = [...root.children].filter((el) => NON_GRAPHIC.has(el.tagName)).map((el) => el.outerHTML).join("");
  let parts = [...root.children].filter((el) => !NON_GRAPHIC.has(el.tagName));
  let wrap = (s: string) => s;
  // one big group around everything: use what's inside it (keeping its transform and style)
  while (parts.length === 1 && parts[0].tagName === "g" && parts[0].children.length > 1) {
    const g = parts[0];
    const attrs = [...g.attributes].filter((a) => a.name !== "id").map((a) => `${a.name}="${a.value.replace(/"/g, "&quot;")}"`).join(" ");
    const outer = wrap;
    wrap = (s) => outer(`<g ${attrs}>${s}</g>`);
    parts = [...g.children].filter((el) => !NON_GRAPHIC.has(el.tagName));
  }
  if (parts.length < 2) throw new Error("This illustration has only one part. Group its parts (head, arm…) in your drawing app to animate them separately.");
  if (parts.length > MAX_LAYERS) {
    // too many loose shapes: keep the first ones separate and put the rest together on top
    const rest = parts.slice(MAX_LAYERS - 1);
    const merged = doc.createElementNS(SVG_NS, "g");
    merged.setAttribute("id", "Other parts");
    for (const el of rest) merged.appendChild(el.cloneNode(true));
    parts = [...parts.slice(0, MAX_LAYERS - 1), merged];
  }
  const open = root.outerHTML.slice(0, root.outerHTML.indexOf(">") + 1);
  return parts.map((el, i) => ({ name: layerName(el, i), svg: `${open}${shared}${wrap(el.outerHTML)}</svg>` }));
}

/** replaces an illustration clip with one clip per part, stacked on new tracks above it */
export async function splitIntoLayers(clipId: string) {
  const st = useStore.getState();
  const c = st.project.clips.find((x) => x.id === clipId);
  const m = c?.mediaId ? st.media[c.mediaId] : undefined;
  if (!c) return 0;
  const text = await svgSource(c, m);
  if (!text) throw new Error("Only SVG illustrations can be split into layers");
  const layers = splitSvg(text);
  // the layers render at their own size: scale them to the size the illustration has now
  const [cw] = contentSize(c, m, st.project.width, st.project.height);
  const nat = new DOMParser().parseFromString(layers[0].svg, "image/svg+xml").documentElement;
  const k = cw / (parseFloat(nat.getAttribute("width") ?? "") || cw);
  const t = st.currentTime;
  const ids: string[] = [];
  st.commit((p) => {
    const orig = p.clips.find((x) => x.id === clipId)!;
    const ti = p.tracks.findIndex((x) => x.id === orig.trackId);
    p.clips = p.clips.filter((x) => x.id !== clipId);
    let base: Clip | null = null;
    layers.forEach((l, i) => {
      let trackId = orig.trackId;
      if (i > 0) {
        const tr = makeTrack("video", l.name.slice(0, 24));
        p.tracks.splice(ti, 0, tr); // above the previous layer
        trackId = tr.id;
      }
      const lc: Clip = {
        ...structuredClone(orig),
        id: uid("clip"),
        trackId,
        name: l.name,
        svg: l.svg,
        mediaId: undefined,
        crop: { top: 0, right: 0, bottom: 0, left: 0 },
        mask: undefined,
        parentId: undefined,
        transform: { ...orig.transform, scale: orig.transform.scale * k },
      };
      if (base) {
        // upper layers follow the bottom one: drop motion they'd otherwise get twice (position, scale, rotation),
        // keep what isn't inherited (opacity, blur, fades)
        const keep: Clip["keyframes"] = {};
        if (lc.keyframes.opacity) keep.opacity = lc.keyframes.opacity;
        if (lc.keyframes.blur) keep.blur = lc.keyframes.blur;
        lc.keyframes = keep;
        lc.behaviors = undefined;
        const fades = new Set(["fade", "blur", "none"]);
        if (!fades.has(lc.animIn)) lc.animIn = "none";
        if (!fades.has(lc.animOut)) lc.animOut = "none";
      }
      p.clips.push(lc);
      ids.push(lc.id);
      if (!base) base = lc;
      else setParent(lc, base.id, p, t);
    });
    // anything that was attached to the illustration now follows its bottom layer
    for (const x of p.clips) if (x.parentId === clipId) x.parentId = base!.id;
  });
  useStore.getState().select([ids[ids.length - 1]]);
  return layers.length;
}

const boxes = new Map<string, [number, number, number, number] | null>();

/** where an illustration layer is actually drawn inside its artboard (0..1: left, top, right, bottom) */
export function partBox(svg: string): [number, number, number, number] | null {
  if (boxes.has(svg)) return boxes.get(svg)!;
  const img = getSvgImage(svg);
  if (!img.complete || !img.naturalWidth) return null;
  const N = 128;
  const cv = document.createElement("canvas");
  cv.width = cv.height = N;
  const g = cv.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data;
  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (d[(y * N + x) * 4 + 3] > 8) {
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const r = (v: number) => Math.round((v / N) * 100) / 100;
  const box: [number, number, number, number] | null = x1 < 0 ? null : [r(x0), r(y0), r(x1 + 1), r(y1 + 1)];
  boxes.set(svg, box);
  return box;
}
