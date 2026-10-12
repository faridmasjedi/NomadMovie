import type { GLTransitionSource } from "./gl";

type Uniform = number | boolean | number[];

// More transitions: original takes on popular paid transition packs (RGB split, light sweeps, ink, liquid and
// brush wipes, zoom punch, TV power-off…). Same GLSL format as gl-transitions: `vec4 transition(vec2 uv)`
// with getFromColor / getToColor, progress (0..1) and ratio (width / height).

const ease = `float easeIO(float t){ return t < 0.5 ? 4.0*t*t*t : 1.0 - pow(-2.0*t + 2.0, 3.0) / 2.0; }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x), mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p *= 2.0; a *= 0.5; } return v; }
bool inside(vec2 p){ return p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0; }
`;

export const EXTRA_TRANSITION_SOURCES: GLTransitionSource[] = [
  {
    name: "nomad_rgbsplit",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float f = sin(progress * 3.14159); vec2 o = vec2(f * 0.06, 0.0);
      float row = floor(uv.y * 24.0); o.x += (hash(vec2(row, floor(progress * 20.0))) - 0.5) * f * 0.08;
      vec4 a = getFromColor(uv); vec4 b = getToColor(uv); float m = step(0.5, progress);
      vec4 r = mix(getFromColor(uv + o), getToColor(uv + o), m); vec4 bl = mix(getFromColor(uv - o), getToColor(uv - o), m); vec4 g = mix(a, b, m);
      return vec4(r.r, g.g, bl.b, g.a); }`,
  },
  {
    name: "nomad_shake",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float f = sin(progress * 3.14159); float t = floor(progress * 40.0);
      vec2 o = (vec2(hash(vec2(t, 1.0)), hash(vec2(t, 2.0))) - 0.5) * f * 0.08; vec2 p = 0.5 + (uv - 0.5) / (1.0 + f * 0.12) + o;
      vec4 s = vec4(0.0); for (int i = 0; i < 8; i++) { vec2 q = p + o * (float(i) / 7.0 - 0.5) * 0.6; s += mix(getFromColor(q), getToColor(q), smoothstep(0.45, 0.55, progress)); }
      return s / 8.0; }`,
  },
  {
    name: "nomad_lightsweep",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float x = uv.x + uv.y * 0.4; float pos = mix(-0.4, 1.8, easeIO(progress));
      vec4 c = x < pos - 0.05 ? getToColor(uv) : getFromColor(uv); float band = exp(-pow((x - pos) / 0.12, 2.0));
      c.rgb = 1.0 - (1.0 - c.rgb) * (1.0 - vec3(1.0, 0.97, 0.9) * band); return c; }`,
  },
  {
    name: "nomad_anamorphicflash",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float f = pow(sin(progress * 3.14159), 2.0); vec4 c = mix(getFromColor(uv), getToColor(uv), smoothstep(0.42, 0.58, progress));
      float streak = exp(-pow((uv.y - 0.5) * 18.0 / (0.3 + f), 2.0)) * f; float core = exp(-length((uv - 0.5) * vec2(ratio, 1.0)) * 6.0) * f;
      c.rgb += vec3(0.35, 0.65, 1.0) * streak * 1.6 + vec3(1.0) * core * 1.2 + f * 0.25; return c; }`,
  },
  {
    name: "nomad_ink",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float n = fbm(uv * vec2(ratio, 1.0) * 3.0); float d = length((uv - 0.5) * vec2(ratio, 1.0)) * 0.9;
      float v = n * 0.55 + d * 0.45; float t = mix(-0.1, 1.1, progress); float m = smoothstep(t + 0.02, t - 0.02, v);
      float edge = smoothstep(0.06, 0.0, abs(v - t)) * (1.0 - m); vec4 c = mix(getFromColor(uv), getToColor(uv), m); c.rgb *= 1.0 - edge * 0.85; return c; }`,
  },
  {
    name: "nomad_liquidwipe",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float p = easeIO(progress); float wave = sin(uv.y * 9.0 + p * 8.0) * 0.05 + sin(uv.y * 23.0 - p * 5.0) * 0.02;
      float edge = mix(-0.15, 1.15, p) + wave; float m = smoothstep(edge + 0.01, edge - 0.01, uv.x);
      vec2 refr = vec2(smoothstep(0.08, 0.0, abs(uv.x - edge)) * 0.03, 0.0); return mix(getFromColor(uv + refr), getToColor(uv - refr), m); }`,
  },
  {
    name: "nomad_brushwipe",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float row = floor(uv.y * 7.0); float lag = hash(vec2(row, 3.0)) * 0.25; float p = clamp((progress * 1.35 - lag), 0.0, 1.0);
      float rough = fbm(vec2(uv.x * 4.0, uv.y * 40.0)) * 0.12; float bristle = vnoise(vec2(uv.x * 2.0, uv.y * 140.0)) * 0.05;
      float edge = mix(-0.2, 1.2, easeIO(p)); float m = step(uv.x + rough + bristle, edge); return mix(getFromColor(uv), getToColor(uv), m); }`,
  },
  {
    name: "nomad_chromazoom",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float f = sin(progress * 3.14159); float z = progress < 0.5 ? 1.0 + easeIO(progress * 2.0) * 0.6 : 1.6 - easeIO(progress * 2.0 - 1.0) * 0.6;
      vec2 d = (uv - 0.5) / z; float ca = f * 0.03; vec4 s = vec4(0.0);
      for (int i = 0; i < 10; i++) { float k = 1.0 - float(i) / 10.0 * f * 0.15; vec2 q = 0.5 + d * k;
        vec4 r = progress < 0.5 ? getFromColor(q + d * ca) : getToColor(q + d * ca); vec4 g = progress < 0.5 ? getFromColor(q) : getToColor(q); vec4 b = progress < 0.5 ? getFromColor(q - d * ca) : getToColor(q - d * ca);
        s += vec4(r.r, g.g, b.b, g.a); }
      return s / 10.0; }`,
  },
  {
    name: "nomad_stretch",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float p = easeIO(progress); float f = sin(progress * 3.14159);
      return uv.x < 1.0 - p ? getFromColor(clamp(vec2(0.5 + (uv.x + p - 0.5) * (1.0 + f), uv.y), 0.0, 1.0)) : getToColor(clamp(vec2(0.5 + (uv.x + p - 1.5) * (1.0 + f), uv.y), 0.0, 1.0)); }`,
  },
  {
    name: "nomad_rotate90",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float p = easeIO(progress); float ang = p * 1.5708; float f = sin(progress * 3.14159); vec4 s = vec4(0.0);
      for (int i = 0; i < 12; i++) { float a = ang + (float(i) / 11.0 - 0.5) * f * 0.25; vec2 d = (uv - 0.5) * vec2(ratio, 1.0); d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
        vec2 q = d / vec2(ratio, 1.0) / (1.0 + f * 0.6) + 0.5; s += progress < 0.5 ? getFromColor(fract(q)) : getToColor(fract(q)); }
      return s / 12.0; }`,
  },
  {
    name: "nomad_glowdissolve",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float f = sin(progress * 3.14159); float m = smoothstep(0.2, 0.8, progress); vec4 c = mix(getFromColor(uv), getToColor(uv), m); vec3 g = vec3(0.0);
      for (int i = 0; i < 24; i++) { float a = float(i) * 2.39996; float d = sqrt((float(i) + 0.5) / 24.0); vec2 o = vec2(cos(a), sin(a)) * d * 0.05 * f;
        vec4 s = mix(getFromColor(uv + o), getToColor(uv + o), m); g += max(s.rgb - 0.45, 0.0) * (1.0 - d * 0.5); }
      c.rgb += g / 24.0 * f * 2.5 + f * 0.06; return c; }`,
  },
  {
    name: "nomad_smoke",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float n = fbm(uv * 3.0 + vec2(progress * 1.5, -progress)); float m = smoothstep(progress * 1.4 - 0.3, progress * 1.4 - 0.1, 1.0 - n);
      float fog = (1.0 - abs(m - 0.5) * 2.0) * sin(progress * 3.14159); vec4 c = mix(getToColor(uv), getFromColor(uv + (n - 0.5) * 0.03 * fog), m); c.rgb = mix(c.rgb, vec3(0.92), fog * 0.6); return c; }`,
  },
  {
    name: "nomad_strips",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float i = floor(uv.x * 3.0); float p = easeIO(clamp(progress * 1.4 - i * 0.2, 0.0, 1.0)); float dir = mod(i, 2.0) == 0.0 ? 1.0 : -1.0;
      vec2 q = uv + vec2(0.0, (1.0 - p) * dir); return inside(q) && p > 0.0 && (dir > 0.0 ? uv.y < p : uv.y > 1.0 - p) ? getToColor(q) : getFromColor(uv + vec2(0.0, -p * dir * 0.3)); }`,
  },
  {
    name: "nomad_tvoff",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ if (progress < 0.5) { float p = progress * 2.0; float sy = mix(1.0, 0.004, smoothstep(0.0, 0.7, p)); float sx = mix(1.0, 0.0, smoothstep(0.7, 1.0, p));
        vec2 q = vec2((uv.x - 0.5) / max(sx, 0.001) + 0.5, (uv.y - 0.5) / sy + 0.5); vec4 c = inside(q) ? getFromColor(q) : vec4(0.0, 0.0, 0.0, 1.0);
        c.rgb += inside(q) ? vec3(smoothstep(0.3, 1.0, p)) : vec3(0.0); return c; }
      float p = progress * 2.0 - 1.0; vec4 c = getToColor(uv); return vec4(c.rgb * smoothstep(0.0, 0.6, p), c.a); }`,
  },
  {
    name: "nomad_bokeh",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float f = sin(progress * 3.14159); vec4 s = vec4(0.0);
      for (int i = 0; i < 16; i++) { float a = float(i) * 2.39996; float d = sqrt((float(i) + 0.5) / 16.0); vec2 o = vec2(cos(a), sin(a)) * d * f * 0.03; s += mix(getFromColor(uv + o), getToColor(uv + o), smoothstep(0.3, 0.7, progress)); }
      vec4 c = s / 16.0; vec2 asp = vec2(ratio, 1.0);
      for (int i = 0; i < 14; i++) { float fi = float(i); vec2 p = vec2(hash(vec2(fi, 1.0)), hash(vec2(fi, 2.0))); float r = 0.04 + hash(vec2(fi, 3.0)) * 0.06;
        float d = length((uv - p) * asp); c.rgb += vec3(1.0, 0.8, 0.55) * smoothstep(r, r * 0.85, d) * 0.25 * f; }
      return c; }`,
  },
  {
    name: "nomad_filmroll",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float p = easeIO(progress); float f = sin(progress * 3.14159); float y = uv.y + p * 1.06; vec4 s = vec4(0.0);
      for (int i = 0; i < 8; i++) { float yy = y + (float(i) / 7.0 - 0.5) * f * 0.05; float fy = fract(yy / 1.06) * 1.06;
        vec2 q = vec2(uv.x, fy); s += fy > 1.0 ? vec4(0.0, 0.0, 0.0, 1.0) : (yy < 1.06 ? getFromColor(q) : getToColor(q)); }
      return s / 8.0; }`,
  },
  {
    name: "nomad_pixelsort",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ float f = sin(progress * 3.14159); float col = floor(uv.x * 160.0); float len = f * (0.2 + hash(vec2(col, 1.0)) * 0.5);
      vec4 base = mix(getFromColor(uv), getToColor(uv), smoothstep(0.35, 0.65, progress)); vec4 best = base;
      for (int i = 1; i <= 16; i++) { vec2 q = uv + vec2(0.0, float(i) / 16.0 * len); vec4 s = mix(getFromColor(q), getToColor(q), smoothstep(0.35, 0.65, progress));
        if (dot(s.rgb, vec3(0.3, 0.59, 0.11)) > dot(best.rgb, vec3(0.3, 0.59, 0.11))) best = s; }
      return mix(base, best, f); }`,
  },
  {
    name: "nomad_zoompunch",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ vec4 s = vec4(0.0); float f = sin(progress * 3.14159);
      for (int i = 0; i < 16; i++) { float k = float(i) / 15.0 * f * 0.25;
        if (progress < 0.5) { float z = 1.0 + pow(progress * 2.0, 3.0) * 3.0; s += getFromColor(0.5 + (uv - 0.5) / (z * (1.0 + k))); }
        else { float z = 4.0 - 3.0 * easeIO(progress * 2.0 - 1.0); s += getToColor(0.5 + (uv - 0.5) / (z * (1.0 + k))); } }
      return s / 16.0; }`,
  },
  {
    name: "nomad_diamond",
    defaultParams: {},
    glsl: `${ease} vec4 transition(vec2 uv){ vec2 d = abs(uv - 0.5) * vec2(ratio, 1.0); float r = easeIO(progress) * (ratio + 1.0) * 0.55;
      float m = smoothstep(r + 0.005, r - 0.005, d.x + d.y); return mix(getFromColor(uv), getToColor(uv), m); }`,
  },
];

/** [id, label, category, shader name, params] — appended after the original transitions */
export const EXTRA_TRANSITIONS: [string, string, string, string, Record<string, Uniform>?][] = [
  ["glowDissolve", "Glow Dissolve", "Basic", "nomad_glowdissolve"],
  ["stretchPush", "Stretch Push", "Slide & Push", "nomad_stretch"],
  ["filmRoll", "Film Roll", "Slide & Push", "nomad_filmroll"],
  ["liquidWipe", "Liquid Wipe", "Wipe", "nomad_liquidwipe"],
  ["brushWipe", "Brush Stroke", "Wipe", "nomad_brushwipe"],
  ["zoomPunch", "Zoom Punch", "Zoom & Warp", "nomad_zoompunch"],
  ["chromaZoom", "Chromatic Zoom", "Zoom & Warp", "nomad_chromazoom"],
  ["cameraShake", "Camera Shake", "Speed Blur", "nomad_shake"],
  ["seamlessRotate", "Seamless Rotate", "Speed Blur", "nomad_rotate90"],
  ["smokeReveal", "Smoke Reveal", "Distortion", "nomad_smoke"],
  ["diamondReveal", "Diamond", "Shapes", "nomad_diamond"],
  ["panelSlide", "Panel Slide", "Split & Doors", "nomad_strips"],
  ["rgbSplit", "RGB Split", "Glitch", "nomad_rgbsplit"],
  ["pixelSortT", "Pixel Sort", "Glitch", "nomad_pixelsort"],
  ["tvPowerOff", "TV Power Off", "Glitch", "nomad_tvoff"],
  ["lightSweepT", "Light Sweep", "Light & Burn", "nomad_lightsweep"],
  ["anamorphicFlash", "Anamorphic Flash", "Light & Burn", "nomad_anamorphicflash"],
  ["bokehDissolve", "Bokeh Dissolve", "Light & Burn", "nomad_bokeh"],
  ["inkBleed", "Ink Bleed", "Stylized", "nomad_ink"],
];
