import type { EffectDef } from "./effectsLib";

// More GPU effects: original takes on looks that usually come in paid packs and plug-ins
// (deep glow, anamorphic flares, film emulation, cut-out outlines and shadows, RGB shake…).
// Same format as GL_EFFECTS: `vec4 effect(vec2 uv)` with amount 0..1, time, p1..p3, color1/color2, resolution.

export const EXTRA_EFFECTS: EffectDef[] = [
  /* ------------------------------ Light ------------------------------ */
  {
    id: "deepGlow", label: "Deep Glow", category: "Light", amount: 55,
    params: [{ key: "p1", label: "Threshold", min: 0, max: 1, step: 0.01, def: 0.6 }, { key: "p2", label: "Radius", min: 0.2, max: 3, step: 0.05, def: 1 }],
    colors: [{ key: "color1", label: "Tint", def: "#ffffff" }],
    // three blur radii added together: a tight core plus a wide, soft falloff
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec3 acc = vec3(0.0);
      for (int r = 0; r < 3; r++) { float rad = (4.0 + float(r) * float(r) * 10.0) * p2; vec3 s = vec3(0.0); float w = 0.0;
        for (int i = 0; i < 16; i++) { float a = float(i) * 2.39996; float d = sqrt((float(i) + 0.5) / 16.0);
          vec2 o = vec2(cos(a), sin(a)) * d * rad / resolution; vec3 t = src(uv + o).rgb; float k = 1.0 - d * 0.6; s += max(t - p1, 0.0) * k; w += k; }
        acc += s / w / (1.0 + float(r) * 0.5); }
      c.rgb += acc * color1 * amount * 1.6; c.a = max(c.a, clamp(luma(acc) * amount * 1.5, 0.0, 1.0)); return c; }`,
  },
  {
    id: "anamorphic", label: "Anamorphic Streaks", category: "Light", amount: 55,
    params: [{ key: "p1", label: "Threshold", min: 0, max: 1, step: 0.01, def: 0.6 }, { key: "p2", label: "Length", min: 0.1, max: 1.5, step: 0.05, def: 0.6 }],
    colors: [{ key: "color1", label: "Streak color", def: "#4da6ff" }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec3 s = vec3(0.0);
      for (int i = -24; i <= 24; i++) { float t = float(i) / 24.0; vec3 v = src(uv + vec2(t * p2 * 0.5, 0.0)).rgb; s += max(v - p1, 0.0) * (1.0 - abs(t)); }
      s /= 12.0; c.rgb += luma(s) * color1 * amount * 4.0 + s * amount * 0.6; return c; }`,
  },
  {
    id: "sunFlare", label: "Sun Flare", category: "Light", amount: 60,
    params: [{ key: "p1", label: "Sun X", min: 0, max: 1, step: 0.01, def: 0.25 }, { key: "p2", label: "Sun Y", min: 0, max: 1, step: 0.01, def: 0.2 }],
    colors: [{ key: "color1", label: "Warmth", def: "#ffb45c" }],
    // glare, starburst, halo ring and ghosts mirrored through the frame center
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 asp = vec2(resolution.x / resolution.y, 1.0); vec2 L = vec2(p1, 1.0 - p2); vec2 d = (uv - L) * asp; float r = length(d);
      float glare = 0.08 / (r + 0.03); float ang = atan(d.y, d.x); float rays = pow(abs(sin(ang * 6.0 + 0.5)), 30.0) * 0.4 / (r * 6.0 + 0.3);
      float halo = exp(-pow((r - 0.35) * 22.0, 2.0)) * 0.25; vec3 col = color1 * (glare + rays) + vec3(0.6, 0.8, 1.0) * halo;
      vec2 axis = vec2(0.5) - L;
      for (int i = 1; i <= 4; i++) { float f = float(i) * 0.45; vec2 g = (uv - (L + axis * f * 1.6)) * asp; float gs = 0.02 + float(i) * 0.012;
        col += mix(color1, vec3(0.4, 0.7, 1.0), float(i) / 4.0) * smoothstep(gs, gs * 0.6, length(g)) * 0.12; }
      c.rgb = 1.0 - (1.0 - c.rgb) * (1.0 - clamp(col * amount, 0.0, 1.0)); return c; }`,
  },
  {
    id: "lightSweep", label: "Light Sweep (Shine)", category: "Light", amount: 70,
    params: [{ key: "p1", label: "Speed", min: 0.1, max: 3, step: 0.05, def: 0.6 }, { key: "p2", label: "Width", min: 0.02, max: 0.4, step: 0.01, def: 0.12 }],
    colors: [{ key: "color1", label: "Shine color", def: "#ffffff" }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float pos = fract(time * p1 * 0.5) * 2.4 - 0.7; float x = uv.x + uv.y * 0.35;
      float band = exp(-pow((x - pos) / p2, 2.0)); c.rgb += color1 * band * amount * c.a; return c; }`,
  },
  {
    id: "halation", label: "Film Halation", category: "Light", amount: 50,
    params: [{ key: "p1", label: "Threshold", min: 0, max: 1, step: 0.01, def: 0.65 }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec3 s = vec3(0.0); float w = 0.0; vec2 px = 3.0 / resolution;
      for (int x = -4; x <= 4; x++) for (int y = -4; y <= 4; y++) { float k = exp(-float(x*x+y*y)/10.0); s += max(src(uv + vec2(float(x), float(y)) * px * 2.0).rgb - p1, 0.0) * k; w += k; }
      float h = luma(s / w); c.rgb += vec3(1.0, 0.25, 0.08) * h * amount * 3.0; return c; }`,
  },

  /* ------------------------------ Color ------------------------------ */
  {
    id: "tealOrange", label: "Teal & Orange", category: "Color", amount: 60,
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float l = luma(c.rgb); vec3 shadows = vec3(0.0, 0.32, 0.38); vec3 highs = vec3(1.0, 0.62, 0.32);
      vec3 g = c.rgb + (shadows - 0.2) * (1.0 - l) * 0.35 + (highs - 0.6) * l * 0.35; g = mix(vec3(l), g, 1.15);
      g = g * g * (3.0 - 2.0 * g); c.rgb = mix(c.rgb, clamp(g, 0.0, 1.0), amount); return c; }`,
  },
  {
    id: "filmEmulation", label: "Film Emulation", category: "Color", amount: 70,
    params: [{ key: "p1", label: "Grain", min: 0, max: 1, step: 0.01, def: 0.35 }, { key: "p2", label: "Fade", min: 0, max: 1, step: 0.01, def: 0.3 }],
    // soft S-curve, warm highlights, cool shadows, lifted blacks and fine moving grain
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec3 g = c.rgb; float l = luma(g);
      g = mix(g, g * g * (3.0 - 2.0 * g), 0.6); g += vec3(0.04, 0.01, -0.03) * l - vec3(0.01, -0.005, -0.03) * (1.0 - l);
      g = mix(vec3(luma(g)), g, 0.88); g = g * (1.0 - p2 * 0.12) + p2 * 0.07;
      float n = rand(uv * resolution + fract(time * 24.0) * 91.7) - 0.5; g += n * p1 * 0.09;
      c.rgb = mix(c.rgb, clamp(g, 0.0, 1.0), amount); return c; }`,
  },
  {
    id: "vintageFade", label: "Vintage Fade", category: "Color", amount: 60,
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec3 g = c.rgb * vec3(0.95, 0.92, 0.82) + vec3(0.09, 0.07, 0.06);
      g = mix(vec3(luma(g)), g, 0.75); float v = 1.0 - pow(length(uv - 0.5) * 1.1, 2.5); g *= v; c.rgb = mix(c.rgb, g, amount); return c; }`,
  },
  {
    id: "splitToning", label: "Split Toning", category: "Color", amount: 50,
    colors: [{ key: "color1", label: "Shadows", def: "#1d4e89" }, { key: "color2", label: "Highlights", def: "#ffb347" }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float l = luma(c.rgb); vec3 tone = mix(color1, color2, smoothstep(0.15, 0.85, l));
      vec3 g = c.rgb + (tone - 0.5) * 0.45; c.rgb = mix(c.rgb, clamp(g, 0.0, 1.0), amount); return c; }`,
  },
  {
    id: "noirFilm", label: "Black & White Film", category: "Color", amount: 80,
    params: [{ key: "p1", label: "Contrast", min: 0.5, max: 2, step: 0.05, def: 1.3 }, { key: "p2", label: "Grain", min: 0, max: 1, step: 0.01, def: 0.4 }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float l = dot(c.rgb, vec3(0.35, 0.5, 0.15)); l = clamp((l - 0.5) * p1 + 0.5, 0.0, 1.0);
      l += (rand(uv * resolution + fract(time * 24.0) * 37.0) - 0.5) * p2 * 0.12; l *= 1.0 - pow(length(uv - 0.5) * 1.2, 3.0) * 0.6;
      c.rgb = mix(c.rgb, vec3(l), amount); return c; }`,
  },

  /* ------------------------------ Stylize (cut-outs) ------------------------------ */
  {
    id: "outlineStroke", label: "Outline / Stroke", category: "Stylize", amount: 100,
    params: [{ key: "p1", label: "Width", min: 1, max: 40, def: 8 }],
    colors: [{ key: "color1", label: "Color", def: "#ffffff" }],
    // draws a solid stroke around anything with transparency — e.g. a masked or AI cut-out person (sticker look)
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float m = 0.0;
      for (int i = 0; i < 24; i++) { float a = float(i) * 0.2618; for (int r = 1; r <= 3; r++) { vec2 o = vec2(cos(a), sin(a)) * p1 * float(r) / 3.0 / resolution; m = max(m, src(uv + o).a); } }
      vec4 stroke = vec4(color1, m * amount); return vec4(mix(stroke.rgb, c.rgb, c.a), c.a + stroke.a * (1.0 - c.a)); }`,
  },
  {
    id: "dropShadow", label: "Drop Shadow", category: "Stylize", amount: 70,
    params: [{ key: "p1", label: "Angle", min: 0, max: 360, def: 135 }, { key: "p2", label: "Distance", min: 0, max: 80, def: 18 }, { key: "p3", label: "Softness", min: 0, max: 40, def: 14 }],
    colors: [{ key: "color1", label: "Color", def: "#000000" }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float a = radians(p1); vec2 off = vec2(cos(a), -sin(a)) * p2 / resolution * vec2(-1.0, 1.0);
      float s = 0.0; float w = 0.0;
      for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) { float k = exp(-float(x*x+y*y)/6.0); s += src(uv + off + vec2(float(x), float(y)) * (p3 / 3.0 + 0.5) / resolution).a * k; w += k; }
      float sh = s / w * amount; return vec4(mix(color1, c.rgb, c.a), c.a + sh * (1.0 - c.a)); }`,
  },
  {
    id: "outerGlow", label: "Outer Glow (Neon Cut-out)", category: "Stylize", amount: 80,
    params: [{ key: "p1", label: "Size", min: 2, max: 60, def: 20 }],
    colors: [{ key: "color1", label: "Glow color", def: "#00e5ff" }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float s = 0.0; float w = 0.0;
      for (int i = 0; i < 32; i++) { float a = float(i) * 2.39996; float d = sqrt((float(i) + 0.5) / 32.0); vec2 o = vec2(cos(a), sin(a)) * d * p1 / resolution;
        float k = 1.0 - d; s += src(uv + o).a * k; w += k; }
      float g = clamp(s / w * 1.6, 0.0, 1.0) * amount; return vec4(mix(color1, c.rgb, c.a), c.a + g * (1.0 - c.a)); }`,
  },
  {
    id: "crystallize", label: "Crystallize", category: "Stylize", amount: 60,
    params: [{ key: "p1", label: "Cell size", min: 6, max: 120, def: 30 }],
    glsl: `vec4 effect(vec2 uv){ vec2 p = uv * resolution / p1; vec2 ip = floor(p); float best = 9.0; vec2 cell = ip;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) { vec2 g = ip + vec2(float(x), float(y)); vec2 pt = g + vec2(rand(g), rand(g + 7.1)); float d = length(pt - p); if (d < best) { best = d; cell = pt; } }
      vec4 c = src(uv); return mix(c, src(cell * p1 / resolution), amount); }`,
  },
  {
    id: "frostedGlass", label: "Frosted Glass", category: "Stylize", amount: 50,
    glsl: `vec4 effect(vec2 uv){ vec2 j = (vec2(rand(uv * 731.0), rand(uv * 113.0 + 3.0)) - 0.5) * amount * 24.0 / resolution; vec4 c = src(uv + j);
      c.rgb = mix(c.rgb, c.rgb * 0.9 + 0.1, amount * 0.5); return c; }`,
  },
  {
    id: "prism", label: "Prism Ghost", category: "Stylize", amount: 45,
    glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * amount * 0.06; vec4 c = src(uv);
      vec3 g = vec3(src(uv + d).r, src(uv).g, src(uv - d).b); vec3 ghost = src(uv + d * 4.0).rgb * vec3(1.0, 0.4, 0.9) + src(uv - d * 4.0).rgb * vec3(0.3, 0.8, 1.0);
      c.rgb = mix(g, max(g, ghost * 0.6), amount); return c; }`,
  },

  /* ------------------------------ Glitch ------------------------------ */
  {
    id: "rgbShake", label: "RGB Shake", category: "Glitch", amount: 55,
    params: [{ key: "p1", label: "Speed", min: 1, max: 30, def: 12 }],
    glsl: `vec4 effect(vec2 uv){ float t = floor(time * p1); vec2 o1 = (vec2(rand(vec2(t, 1.0)), rand(vec2(t, 2.0))) - 0.5) * amount * 0.04; vec2 o2 = (vec2(rand(vec2(t, 3.0)), rand(vec2(t, 4.0))) - 0.5) * amount * 0.04;
      vec2 shake = (vec2(rand(vec2(t, 5.0)), rand(vec2(t, 6.0))) - 0.5) * amount * 0.02; vec4 g = src(uv + shake);
      return vec4(src(uv + shake + o1).r, g.g, src(uv + shake + o2).b, g.a); }`,
  },
  {
    id: "vhsTracking", label: "VHS Tracking", category: "Glitch", amount: 55,
    glsl: `vec4 effect(vec2 uv){ float band = fract(time * 0.25); float d = uv.y - (1.0 - band); float inBand = exp(-d * d * 900.0);
      vec2 u = uv; u.x += inBand * amount * 0.05 * (rand(vec2(floor(uv.y * 200.0), floor(time * 30.0))) - 0.3) + sin(uv.y * 60.0 + time * 4.0) * 0.0015 * amount;
      vec4 c = src(u); c.r = src(u + vec2(0.003 * amount, 0.0)).r; c.rgb += inBand * amount * 0.35 * rand(uv * resolution + time);
      c.rgb = mix(c.rgb, c.rgb * vec3(1.02, 0.98, 1.05), amount); return c; }`,
  },
  {
    id: "pixelSort", label: "Pixel Sort", category: "Glitch", amount: 50,
    params: [{ key: "p1", label: "Threshold", min: 0, max: 1, step: 0.01, def: 0.55 }],
    // smears bright pixels downward in streaks — the look of sorted pixel columns
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float len = amount * 0.25 * (0.4 + rand(vec2(floor(uv.x * resolution.x / 2.0), 3.0)));
      vec4 best = c; for (int i = 1; i <= 24; i++) { vec4 s = src(uv + vec2(0.0, float(i) / 24.0 * len)); if (luma(s.rgb) > p1 && luma(s.rgb) > luma(best.rgb)) best = s; }
      return luma(c.rgb) < luma(best.rgb) ? mix(c, best, 0.85) : c; }`,
  },
  {
    id: "sliceGlitch", label: "Slice Glitch", category: "Glitch", amount: 50,
    params: [{ key: "p1", label: "Slices", min: 4, max: 60, def: 18 }],
    glsl: `vec4 effect(vec2 uv){ float t = floor(time * 10.0); float row = floor(uv.y * p1); float r = rand(vec2(row, t));
      float on = step(1.0 - amount * 0.6, r); vec2 u = uv + vec2((rand(vec2(row, t + 1.0)) - 0.5) * 0.2 * on, 0.0);
      vec4 c = src(u); c.rgb = mix(c.rgb, c.gbr, on * 0.4); return c; }`,
  },

  /* ------------------------------ Distortion ------------------------------ */
  {
    id: "shockwave", label: "Shockwave", category: "Distortion", amount: 60,
    params: [{ key: "p1", label: "Center X", min: 0, max: 1, step: 0.01, def: 0.5 }, { key: "p2", label: "Center Y", min: 0, max: 1, step: 0.01, def: 0.5 }, { key: "p3", label: "Speed", min: 0.1, max: 3, step: 0.05, def: 0.8 }],
    glsl: `vec4 effect(vec2 uv){ vec2 asp = vec2(resolution.x / resolution.y, 1.0); vec2 c0 = vec2(p1, 1.0 - p2); vec2 d = (uv - c0) * asp; float r = length(d);
      float wave = fract(time * p3 * 0.5) * 1.6; float x = r - wave; float ring = exp(-x * x * 120.0) * sin(x * 60.0);
      vec2 u = uv + normalize(d + 1e-5) / asp * ring * amount * 0.03; vec4 c = src(u); c.rgb += ring * amount * 0.15; return c; }`,
  },
  {
    id: "liquidWarp", label: "Liquid Warp", category: "Distortion", amount: 45,
    params: [{ key: "p1", label: "Scale", min: 1, max: 12, step: 0.1, def: 4 }],
    glsl: `vec4 effect(vec2 uv){ vec2 q = uv * p1; float t = time * 0.4; vec2 w = vec2(noise(q + vec2(t, 0.0)), noise(q + vec2(5.2, t))) - 0.5;
      w += (vec2(noise(q * 2.0 + w * 3.0 + t), noise(q * 2.0 - w * 3.0 + 1.7)) - 0.5) * 0.5; return src(uv + w * amount * 0.06); }`,
  },
  {
    id: "glassRefraction", label: "Glass Ripple", category: "Distortion", amount: 50,
    glsl: `vec4 effect(vec2 uv){ vec2 g = uv * resolution / 48.0; vec2 f = fract(g) - 0.5; vec2 n = f * (1.0 - length(f)) ;
      vec4 c = src(uv + n * amount * 0.02); c.rgb += (0.2 - length(f)) * amount * 0.1; return c; }`,
  },

  /* ------------------------------ Camera ------------------------------ */
  {
    id: "impactShake", label: "Impact Shake", category: "Camera", amount: 60,
    params: [{ key: "p1", label: "Every (s)", min: 0.2, max: 4, step: 0.05, def: 1 }],
    // a hard hit that settles quickly — repeat it on the beat with "Every"
    glsl: `vec4 effect(vec2 uv){ float t = mod(time, p1); float e = exp(-t * 9.0); float k = floor(time / p1);
      vec2 o = vec2(sin(t * 70.0 + k), cos(t * 63.0 + k * 1.7)) * e * amount * 0.04; float z = 1.0 + e * amount * 0.08;
      return src(0.5 + (uv - 0.5) / z + o); }`,
  },
  {
    id: "rackFocus", label: "Rack Focus", category: "Camera", amount: 70,
    params: [{ key: "p1", label: "Speed", min: 0.1, max: 3, step: 0.05, def: 0.5 }],
    glsl: `vec4 effect(vec2 uv){ float b = (0.5 + 0.5 * sin(time * p1 * 3.1415)) * amount * 14.0; vec4 s = vec4(0.0);
      for (int i = 0; i < 16; i++) { float a = float(i) * 2.39996; float d = sqrt((float(i) + 0.5) / 16.0); s += src(uv + vec2(cos(a), sin(a)) * d * b / resolution); }
      return s / 16.0; }`,
  },

  /* ------------------------------ Weather & Overlays ------------------------------ */
  {
    id: "dustMotes", label: "Floating Dust", category: "Weather & Overlays", amount: 55,
    colors: [{ key: "color1", label: "Color", def: "#fff1c9" }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 asp = vec2(resolution.x / resolution.y, 1.0); vec3 add = vec3(0.0);
      for (int i = 0; i < 40; i++) { float fi = float(i); vec2 p = vec2(rand(vec2(fi, 1.0)), rand(vec2(fi, 2.0)));
        p += vec2(sin(time * 0.3 + fi) * 0.03, time * (0.01 + rand(vec2(fi, 3.0)) * 0.02)); p = fract(p);
        float sz = 0.002 + rand(vec2(fi, 4.0)) * 0.004; float d = length((uv - p) * asp); add += color1 * smoothstep(sz, 0.0, d) * (0.4 + 0.6 * rand(vec2(fi, 5.0))); }
      c.rgb += add * amount; return c; }`,
  },
  {
    id: "confetti", label: "Confetti", category: "Weather & Overlays", amount: 70,
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 asp = vec2(resolution.x / resolution.y, 1.0);
      for (int i = 0; i < 60; i++) { float fi = float(i); float x = rand(vec2(fi, 1.0)) + sin(time * 1.5 + fi) * 0.02; float y = 1.0 - fract(rand(vec2(fi, 2.0)) + time * (0.12 + rand(vec2(fi, 3.0)) * 0.12));
        vec2 d = (uv - vec2(x, y)) * asp; float a = time * 3.0 + fi; d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d;
        float m = step(abs(d.x), 0.006) * step(abs(d.y), 0.0035 * abs(sin(time * 4.0 + fi)) + 0.001);
        vec3 col = 0.5 + 0.5 * cos(6.2831 * (rand(vec2(fi, 4.0)) + vec3(0.0, 0.33, 0.67))); c.rgb = mix(c.rgb, col, m * amount); }
      return c; }`,
  },
  {
    id: "recViewfinder", label: "Camera Viewfinder (REC)", category: "Weather & Overlays", amount: 100,
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 p = uv * resolution; vec2 m = resolution * 0.06; float L = resolution.y * 0.08; float t = 3.0;
      float corner = 0.0; vec2 q = min(p - m, resolution - m - p);
      if (q.x >= 0.0 && q.y >= 0.0) corner = (step(q.x, t) * step(q.y, L) + step(q.y, t) * step(q.x, L)) > 0.0 ? 1.0 : 0.0;
      vec2 cc = abs(p - resolution * 0.5); float crossM = (step(cc.x, 1.5) * step(cc.y, 18.0) + step(cc.y, 1.5) * step(cc.x, 18.0)) > 0.0 ? 1.0 : 0.0;
      float recDot = step(length(p - vec2(m.x + 30.0, resolution.y - m.y - 30.0)), 11.0) * step(0.5, fract(time));
      c.rgb = mix(c.rgb, vec3(1.0), max(corner, crossM * 0.8) * amount); c.rgb = mix(c.rgb, vec3(1.0, 0.1, 0.1), recDot * amount); return c; }`,
  },
];
