// GPU effect library. Each shader defines `vec4 effect(vec2 uv)`; uniforms: amount (0..1), time (s),
// p1..p3 (effect parameters), color1/color2, resolution. See EFFECT_HEADER in gl.ts for helpers.

export interface EffectParam {
  key: "p1" | "p2" | "p3";
  label: string;
  min: number;
  max: number;
  step?: number;
  def: number;
}

export interface EffectDef {
  id: string;
  label: string;
  category: string;
  amount: number; // default 0..100
  params?: EffectParam[];
  colors?: { key: "color1" | "color2"; label: string; def: string }[];
  glsl: string;
}

export const EFFECT_CATEGORIES = ["Blur", "Distortion", "Glitch", "Retro", "Light", "Stylize", "Color", "Weather & Overlays", "Camera"] as const;

const keepAlpha = (expr: string) => `vec4 effect(vec2 uv){ vec4 c = src(uv); ${expr} }`;

export const GL_EFFECTS: EffectDef[] = [
  /* ------------------------------ Blur ------------------------------ */
  {
    id: "gaussianBlur", label: "Gaussian Blur", category: "Blur", amount: 40,
    glsl: `vec4 effect(vec2 uv){ vec2 px = amount * 24.0 / resolution; vec4 s = vec4(0.0); float w = 0.0;
      for (int x = -4; x <= 4; x++) for (int y = -4; y <= 4; y++) { float k = exp(-float(x*x+y*y)/10.0); s += src(uv + vec2(float(x), float(y)) * px * 0.5) * k; w += k; }
      return s / w; }`,
  },
  {
    id: "zoomBlur", label: "Zoom Blur", category: "Blur", amount: 40,
    params: [{ key: "p1", label: "Center X", min: 0, max: 1, step: 0.01, def: 0.5 }, { key: "p2", label: "Center Y", min: 0, max: 1, step: 0.01, def: 0.5 }],
    glsl: `vec4 effect(vec2 uv){ vec2 c = vec2(p1, 1.0 - p2); vec4 s = vec4(0.0);
      for (int i = 0; i < 24; i++) { float t = float(i) / 23.0; s += src(c + (uv - c) * (1.0 - amount * 0.25 * t)); }
      return s / 24.0; }`,
  },
  {
    id: "motionBlur", label: "Motion Blur", category: "Blur", amount: 40,
    params: [{ key: "p1", label: "Angle", min: 0, max: 180, def: 0 }],
    glsl: `vec4 effect(vec2 uv){ float a = radians(p1); vec2 d = vec2(cos(a), sin(a)) * amount * 0.06; vec4 s = vec4(0.0);
      for (int i = 0; i < 24; i++) { float t = float(i) / 23.0 - 0.5; s += src(uv + d * t); } return s / 24.0; }`,
  },
  {
    id: "spinBlur", label: "Spin Blur", category: "Blur", amount: 35,
    glsl: `vec4 effect(vec2 uv){ vec2 c = vec2(0.5); vec2 d = uv - c; vec4 s = vec4(0.0);
      for (int i = 0; i < 24; i++) { float a = (float(i)/23.0 - 0.5) * amount * 0.35; mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a)); s += src(c + r * d); }
      return s / 24.0; }`,
  },
  {
    id: "tiltShift", label: "Tilt-Shift", category: "Blur", amount: 60,
    params: [{ key: "p1", label: "Focus line", min: 0, max: 1, step: 0.01, def: 0.5 }, { key: "p2", label: "Focus width", min: 0.02, max: 0.6, step: 0.01, def: 0.18 }],
    glsl: `vec4 effect(vec2 uv){ float d = smoothstep(p2 * 0.5, p2 * 0.5 + 0.25, abs((1.0 - uv.y) - p1)); vec2 px = d * amount * 18.0 / resolution;
      vec4 s = vec4(0.0); float w = 0.0; for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) { float k = exp(-float(x*x+y*y)/6.0); s += src(uv + vec2(float(x), float(y)) * px) * k; w += k; }
      vec4 o = s / w; o.rgb = mix(o.rgb, o.rgb * 1.15, 0.3); return o; }`,
  },
  {
    id: "mosaic", label: "Mosaic", category: "Blur", amount: 40,
    glsl: `vec4 effect(vec2 uv){ float b = max(2.0, amount * 60.0); vec2 cell = b / resolution; return src((floor(uv / cell) + 0.5) * cell); }`,
  },
  {
    id: "censor", label: "Censor Box", category: "Blur", amount: 70,
    params: [{ key: "p1", label: "X", min: 0, max: 1, step: 0.01, def: 0.5 }, { key: "p2", label: "Y", min: 0, max: 1, step: 0.01, def: 0.4 }, { key: "p3", label: "Size", min: 0.05, max: 1, step: 0.01, def: 0.25 }],
    glsl: `vec4 effect(vec2 uv){ vec2 c = vec2(p1, 1.0 - p2); vec2 r = vec2(p3) * vec2(1.0, resolution.x / resolution.y) * 0.5;
      if (abs(uv.x - c.x) < r.x && abs(uv.y - c.y) < r.y) { float b = max(4.0, amount * 50.0); vec2 cell = b / resolution; return src((floor(uv / cell) + 0.5) * cell); }
      return src(uv); }`,
  },
  {
    id: "backgroundBlur", label: "Vignette Blur", category: "Blur", amount: 60,
    glsl: `vec4 effect(vec2 uv){ float d = smoothstep(0.25, 0.75, length((uv - 0.5) * vec2(1.0, 0.8))); vec2 px = d * amount * 20.0 / resolution;
      vec4 s = vec4(0.0); float w = 0.0; for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) { float k = exp(-float(x*x+y*y)/6.0); s += src(uv + vec2(float(x), float(y)) * px) * k; w += k; }
      return s / w; }`,
  },

  /* --------------------------- Distortion --------------------------- */
  {
    id: "wave", label: "Wave", category: "Distortion", amount: 40,
    params: [{ key: "p1", label: "Frequency", min: 1, max: 40, def: 12 }, { key: "p2", label: "Speed", min: 0, max: 10, step: 0.1, def: 2 }],
    glsl: `vec4 effect(vec2 uv){ uv.x += sin(uv.y * p1 + time * p2) * amount * 0.03; uv.y += cos(uv.x * p1 * 0.7 + time * p2) * amount * 0.015; return src(uv); }`,
  },
  {
    id: "ripple", label: "Water Ripple", category: "Distortion", amount: 40,
    params: [{ key: "p1", label: "Rings", min: 2, max: 60, def: 25 }, { key: "p2", label: "Speed", min: 0, max: 10, step: 0.1, def: 4 }],
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; float r = length(d * vec2(resolution.x / resolution.y, 1.0));
      uv += normalize(d + 1e-5) * sin(r * p1 - time * p2) * amount * 0.012; return src(uv); }`,
  },
  {
    id: "swirl", label: "Swirl", category: "Distortion", amount: 50,
    params: [{ key: "p1", label: "Radius", min: 0.1, max: 1, step: 0.01, def: 0.5 }],
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; float r = length(d); if (r < p1) { float a = (1.0 - r / p1); a = a * a * amount * 8.0; float s = sin(a), c = cos(a); d = vec2(d.x*c - d.y*s, d.x*s + d.y*c); } return src(0.5 + d); }`,
  },
  {
    id: "fisheye", label: "Fisheye / Bulge", category: "Distortion", amount: 50,
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; float r = length(d); float k = amount * 1.6; vec2 nd = d * (1.0 - k * 0.5 + k * r * r * 2.0) / (1.0 - k * 0.5 + k * 0.5); return src(0.5 + nd * (1.0 - k*0.25)); }`,
  },
  {
    id: "pinch", label: "Pinch", category: "Distortion", amount: 50,
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; float r = length(d) * 2.0; if (r < 1.0) d *= mix(1.0, pow(r, 0.5 + amount), amount); return src(0.5 + d); }`,
  },
  {
    id: "kaleidoscope", label: "Kaleidoscope", category: "Distortion", amount: 100,
    params: [{ key: "p1", label: "Segments", min: 2, max: 16, def: 6 }, { key: "p2", label: "Rotate speed", min: 0, max: 2, step: 0.05, def: 0.2 }],
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; float r = length(d); float a = atan(d.y, d.x) + time * p2; float seg = 6.2831853 / floor(p1);
      a = mod(a, seg); a = abs(a - seg * 0.5); vec2 k = 0.5 + r * vec2(cos(a), sin(a)); return mix(src(uv), src(k), amount); }`,
  },
  {
    id: "mirror4", label: "Mirror", category: "Distortion", amount: 100,
    params: [{ key: "p1", label: "Mode (0 H · 1 V · 2 Quad)", min: 0, max: 2, step: 1, def: 0 }],
    glsl: `vec4 effect(vec2 uv){ vec2 m = uv; if (p1 < 0.5 || p1 > 1.5) m.x = 0.5 - abs(uv.x - 0.5); if (p1 > 0.5) m.y = 0.5 + abs(uv.y - 0.5); return mix(src(uv), src(m), amount); }`,
  },
  {
    id: "tiles", label: "Tile / Repeat", category: "Distortion", amount: 100,
    params: [{ key: "p1", label: "Grid", min: 2, max: 8, step: 1, def: 3 }],
    glsl: `vec4 effect(vec2 uv){ return mix(src(uv), src(fract(uv * floor(p1))), amount); }`,
  },
  {
    id: "heatHaze", label: "Heat Haze", category: "Distortion", amount: 40,
    glsl: `vec4 effect(vec2 uv){ float n = noise(uv * 18.0 + vec2(0.0, time * 2.5)) - 0.5; float m = noise(uv * 25.0 - vec2(time * 1.5, 0.0)) - 0.5; return src(uv + vec2(n, m) * amount * 0.02); }`,
  },
  {
    id: "underwater", label: "Underwater", category: "Distortion", amount: 50,
    glsl: `vec4 effect(vec2 uv){ uv += vec2(sin(uv.y * 20.0 + time * 1.7), cos(uv.x * 18.0 + time * 1.3)) * amount * 0.008; vec4 c = src(uv);
      float caust = pow(noise(uv * 12.0 + time * 0.7) * noise(uv * 17.0 - time * 0.5), 1.5) * 0.6; c.rgb = mix(c.rgb, c.rgb * vec3(0.55, 0.85, 1.05) + caust, amount); return c; }`,
  },
  {
    id: "lensDistortion", label: "Barrel Lens", category: "Distortion", amount: 40,
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; float r2 = dot(d, d); vec2 u = 0.5 + d * (1.0 + amount * 1.2 * r2) / (1.0 + amount * 0.3);
      if (u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0) return vec4(0.0, 0.0, 0.0, src(uv).a); return src(u); }`,
  },

  /* ----------------------------- Glitch ----------------------------- */
  {
    id: "digitalGlitch", label: "Digital Glitch", category: "Glitch", amount: 50,
    glsl: `vec4 effect(vec2 uv){ float t = floor(time * 14.0); float on = step(1.0 - amount * 0.7, rand(vec2(t, 1.0)));
      float row = floor(uv.y * mix(8.0, 40.0, rand(vec2(t, 3.0)))); float shift = (rand(vec2(row, t)) - 0.5) * 0.15 * amount * on * step(0.6, rand(vec2(row, t + 7.0)));
      vec2 u = uv + vec2(shift, 0.0); float ca = amount * 0.012 * (on + 0.2);
      vec4 c = src(u); c.r = src(u + vec2(ca, 0.0)).r; c.b = src(u - vec2(ca, 0.0)).b;
      if (on > 0.5 && rand(vec2(floor(uv.x * 20.0), row + t)) > 0.97) c.rgb = 1.0 - c.rgb; return c; }`,
  },
  {
    id: "chromatic", label: "Chromatic Aberration", category: "Glitch", amount: 40,
    glsl: `vec4 effect(vec2 uv){ vec2 d = (uv - 0.5) * amount * 0.04; vec4 c = src(uv); return vec4(src(uv + d).r, c.g, src(uv - d).b, c.a); }`,
  },
  {
    id: "blockGlitch", label: "Block Glitch", category: "Glitch", amount: 50,
    glsl: `vec4 effect(vec2 uv){ float t = floor(time * 10.0); vec2 b = floor(uv * vec2(16.0, 9.0)); float r = rand(b + t);
      vec2 u = uv; if (r > 1.0 - amount * 0.35) u += (vec2(rand(b + t + 1.0), rand(b + t + 2.0)) - 0.5) * 0.12; vec4 c = src(u);
      if (r > 1.0 - amount * 0.08) c.rgb = vec3(c.g, c.b, c.r); return c; }`,
  },
  {
    id: "scanGlitch", label: "Scan Line Glitch", category: "Glitch", amount: 50,
    glsl: `vec4 effect(vec2 uv){ float band = smoothstep(0.0, 0.02, abs(uv.y - fract(time * 0.6))) ; float jitter = (rand(vec2(floor(uv.y * 300.0), floor(time * 30.0))) - 0.5) * 0.02 * amount;
      vec2 u = uv + vec2(jitter * (1.0 - band) * 6.0 + jitter * 0.3, 0.0); vec4 c = src(u); c.rgb *= 0.9 + 0.1 * sin(uv.y * resolution.y * 1.5); return c; }`,
  },
  {
    id: "tvStatic", label: "TV Static", category: "Glitch", amount: 35,
    glsl: keepAlpha(`float n = rand(uv * resolution + fract(time) * 100.0); c.rgb = mix(c.rgb, vec3(n), amount * 0.8); return c;`),
  },
  {
    id: "signalLoss", label: "Signal Loss", category: "Glitch", amount: 50,
    glsl: `vec4 effect(vec2 uv){ float t = floor(time * 8.0); float drop = step(1.0 - amount * 0.5, rand(vec2(t, 9.0)));
      vec2 u = uv; u.y = fract(u.y + drop * rand(vec2(t, 4.0)) * 0.3); vec4 c = src(u); float n = rand(uv * resolution + time);
      c.rgb = mix(c.rgb, vec3(n), drop * 0.6 + amount * 0.1); c.rgb *= 1.0 - drop * 0.3; return c; }`,
  },

  /* ------------------------------ Retro ------------------------------ */
  {
    id: "vhs", label: "VHS", category: "Retro", amount: 60,
    glsl: `vec4 effect(vec2 uv){ float wob = (noise(vec2(uv.y * 6.0, time * 4.0)) - 0.5) * 0.006 * amount; float track = smoothstep(0.96, 1.0, sin(uv.y * 3.0 + time * 1.2)) * 0.02 * amount;
      vec2 u = uv + vec2(wob + track, 0.0); vec4 c = src(u); vec3 bleed = vec3(src(u + vec2(0.004 * amount, 0.0)).r, c.g, src(u - vec2(0.004 * amount, 0.0)).b);
      vec3 col = mix(c.rgb, bleed, 0.8); col = mix(col, vec3(luma(col)), 0.15 * amount); col *= 0.92 + 0.08 * sin(uv.y * resolution.y * 1.2);
      col += (rand(uv * resolution + time) - 0.5) * 0.12 * amount; col = mix(col, col * vec3(1.05, 0.95, 1.08), amount); return vec4(col, c.a); }`,
  },
  {
    id: "oldFilm", label: "Old Film", category: "Retro", amount: 70,
    glsl: `vec4 effect(vec2 uv){ float t = floor(time * 18.0); vec2 u = uv + vec2(0.0, (rand(vec2(t, 2.0)) - 0.5) * 0.004 * amount); vec4 c = src(u);
      vec3 sep = vec3(dot(c.rgb, vec3(0.393, 0.769, 0.189)), dot(c.rgb, vec3(0.349, 0.686, 0.168)), dot(c.rgb, vec3(0.272, 0.534, 0.131)));
      vec3 col = mix(c.rgb, sep, amount); col *= 0.9 + 0.1 * rand(vec2(t, 5.0));
      float sx = rand(vec2(t, 11.0)); col -= amount * 0.35 * (1.0 - smoothstep(0.0, 0.0015, abs(uv.x - sx))) * step(0.5, rand(vec2(t, 12.0)));
      float dust = step(0.9985, rand(floor(uv * resolution / 3.0) + t)); col = mix(col, vec3(0.05), dust * amount);
      col += (rand(uv * resolution + t) - 0.5) * 0.1 * amount; float v = smoothstep(0.85, 0.3, length(uv - 0.5)); col *= mix(1.0, v, amount * 0.8); return vec4(col, c.a); }`,
  },
  {
    id: "film8mm", label: "8mm Film", category: "Retro", amount: 70,
    glsl: `vec4 effect(vec2 uv){ float t = floor(time * 16.0); vec2 u = uv + (vec2(rand(vec2(t, 1.0)), rand(vec2(t, 2.0))) - 0.5) * 0.006 * amount; vec4 c = src(u);
      vec3 col = pow(c.rgb, vec3(0.9)) * vec3(1.08, 1.0, 0.82); col = mix(c.rgb, col, amount); col += (rand(uv * resolution * 0.5 + t) - 0.5) * 0.14 * amount;
      vec2 e = abs(uv - 0.5) * 2.0; float frame = smoothstep(1.0, 0.86, max(e.x * 0.98, e.y)); col *= mix(1.0, frame * (0.85 + 0.15 * rand(vec2(t, 3.0))), amount); return vec4(col, c.a); }`,
  },
  {
    id: "crt", label: "CRT Monitor", category: "Retro", amount: 70,
    glsl: `vec4 effect(vec2 uv){ vec2 d = uv - 0.5; vec2 u = 0.5 + d * (1.0 + amount * 0.25 * dot(d, d)); if (u.x < 0.0 || u.x > 1.0 || u.y < 0.0 || u.y > 1.0) return vec4(0.0, 0.0, 0.0, 1.0);
      vec4 c = src(u); float m = mod(gl_FragCoord.x, 3.0); vec3 mask = m < 1.0 ? vec3(1.0, 0.7, 0.7) : m < 2.0 ? vec3(0.7, 1.0, 0.7) : vec3(0.7, 0.7, 1.0);
      vec3 col = c.rgb * mix(vec3(1.0), mask, amount * 0.7); col *= mix(1.0, 0.75 + 0.25 * sin(u.y * resolution.y * 3.14159), amount); col *= 1.0 + amount * 0.15; return vec4(col, c.a); }`,
  },
  {
    id: "dustScratches", label: "Dust & Scratches", category: "Retro", amount: 60,
    glsl: `vec4 effect(vec2 uv){ float t = floor(time * 20.0); vec4 c = src(uv); vec3 col = c.rgb;
      for (int i = 0; i < 3; i++) { float x = rand(vec2(t, float(i) * 7.0)); col *= 1.0 - amount * 0.5 * (1.0 - smoothstep(0.0, 0.001, abs(uv.x - x))) * step(0.4, rand(vec2(t, float(i)))); }
      float d = step(1.0 - 0.003 * amount, rand(floor(uv * resolution / 2.0) + t)); col = mix(col, vec3(rand(vec2(t, uv.x)) > 0.5 ? 0.95 : 0.05), d); return vec4(col, c.a); }`,
  },
  {
    id: "filmGrainGL", label: "Film Grain", category: "Retro", amount: 40,
    glsl: keepAlpha(`float g = rand(uv * resolution + fract(time * 24.0) * 37.0) - 0.5; float l = luma(c.rgb); c.rgb += g * amount * 0.35 * (1.0 - abs(l - 0.5)); return c;`),
  },

  /* ------------------------------ Light ------------------------------ */
  {
    id: "lightLeak", label: "Light Leak", category: "Light", amount: 60,
    params: [{ key: "p1", label: "Speed", min: 0, max: 3, step: 0.05, def: 0.6 }],
    colors: [{ key: "color1", label: "Color A", def: "#ff7a2f" }, { key: "color2", label: "Color B", def: "#ff2f6d" }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float t = time * p1;
      vec2 a = vec2(0.15 + 0.3 * sin(t * 0.7), 0.8 + 0.2 * cos(t * 0.5)); vec2 b = vec2(0.9 + 0.1 * sin(t * 0.9), 0.2 + 0.3 * sin(t * 0.6));
      float la = exp(-length((uv - a) * vec2(1.0, 1.4)) * 2.6); float lb = exp(-length((uv - b) * vec2(1.0, 1.4)) * 3.0);
      vec3 leak = color1 * la + color2 * lb; c.rgb = 1.0 - (1.0 - c.rgb) * (1.0 - leak * amount * 1.3); return c; }`,
  },
  {
    id: "bokeh", label: "Bokeh Lights", category: "Light", amount: 60,
    colors: [{ key: "color1", label: "Tint", def: "#ffd18a" }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 asp = vec2(resolution.x / resolution.y, 1.0); vec3 add = vec3(0.0);
      for (int i = 0; i < 18; i++) { float fi = float(i); vec2 p = vec2(rand(vec2(fi, 1.0)), fract(rand(vec2(fi, 2.0)) + time * (0.01 + 0.03 * rand(vec2(fi, 3.0)))));
        float r = 0.03 + 0.07 * rand(vec2(fi, 4.0)); float d = length((uv - p) * asp); float disc = smoothstep(r, r * 0.85, d) * (0.5 + 0.5 * smoothstep(r * 0.6, r, d));
        add += disc * mix(color1, vec3(rand(vec2(fi, 5.0)), rand(vec2(fi, 6.0)), 1.0), 0.35) * (0.25 + 0.3 * sin(time * 1.5 + fi)); }
      c.rgb = 1.0 - (1.0 - c.rgb) * (1.0 - add * amount); return c; }`,
  },
  {
    id: "lensFlare", label: "Lens Flare", category: "Light", amount: 60,
    params: [{ key: "p1", label: "Light X", min: 0, max: 1, step: 0.01, def: 0.25 }, { key: "p2", label: "Light Y", min: 0, max: 1, step: 0.01, def: 0.25 }],
    colors: [{ key: "color1", label: "Color", def: "#ffd9a0" }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 asp = vec2(resolution.x / resolution.y, 1.0); vec2 L = vec2(p1, 1.0 - p2); vec2 d = (uv - L) * asp;
      float core = 0.04 / (length(d) + 0.02); float rays = pow(max(0.0, sin(atan(d.y, d.x) * 6.0)), 18.0) * 0.4 / (length(d) * 8.0 + 0.5);
      vec3 f = color1 * (core * 0.6 + rays); vec2 axis = vec2(0.5) - L;
      for (int i = 1; i <= 4; i++) { vec2 g = L + axis * float(i) * 0.55; float r = 0.02 + 0.025 * float(i); f += vec3(0.5, 0.7, 1.0) * smoothstep(r, r * 0.6, length((uv - g) * asp)) * 0.18; }
      c.rgb += f * amount; return c; }`,
  },
  {
    id: "glow", label: "Glow / Bloom", category: "Light", amount: 50,
    params: [{ key: "p1", label: "Threshold", min: 0, max: 1, step: 0.01, def: 0.6 }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec3 s = vec3(0.0); float w = 0.0; vec2 px = 6.0 / resolution;
      for (int x = -4; x <= 4; x++) for (int y = -4; y <= 4; y++) { vec3 t = src(uv + vec2(float(x), float(y)) * px * 1.6).rgb; float k = exp(-float(x*x+y*y)/12.0); s += max(t - p1, 0.0) * k; w += k; }
      c.rgb += s / w * amount * 4.0; return c; }`,
  },
  {
    id: "godRays", label: "Light Rays", category: "Light", amount: 55,
    params: [{ key: "p1", label: "Source X", min: 0, max: 1, step: 0.01, def: 0.5 }, { key: "p2", label: "Source Y", min: 0, max: 1, step: 0.01, def: 0.15 }],
    glsl: `vec4 effect(vec2 uv){ vec2 L = vec2(p1, 1.0 - p2); vec2 d = (uv - L) / 40.0; vec2 u = uv; float il = 1.0; vec3 acc = vec3(0.0);
      for (int i = 0; i < 40; i++) { u -= d; vec3 s = src(u).rgb; acc += max(s - 0.55, 0.0) * il; il *= 0.97; }
      vec4 c = src(uv); c.rgb += acc / 40.0 * amount * 6.0; return c; }`,
  },
  {
    id: "strobe", label: "Flash / Strobe", category: "Light", amount: 50,
    params: [{ key: "p1", label: "Rate (Hz)", min: 0.5, max: 12, step: 0.5, def: 4 }],
    glsl: keepAlpha(`float f = pow(max(0.0, sin(time * p1 * 6.2831)), 12.0); c.rgb = mix(c.rgb, vec3(1.0), f * amount); return c;`),
  },
  {
    id: "neonGlowEdges", label: "Neon Edges", category: "Light", amount: 70,
    colors: [{ key: "color1", label: "Color", def: "#29f0ff" }],
    glsl: `vec4 effect(vec2 uv){ vec2 px = 1.5 / resolution; float gx = luma(src(uv + vec2(px.x, 0.0)).rgb) - luma(src(uv - vec2(px.x, 0.0)).rgb);
      float gy = luma(src(uv + vec2(0.0, px.y)).rgb) - luma(src(uv - vec2(0.0, px.y)).rgb); float e = clamp(length(vec2(gx, gy)) * 5.0, 0.0, 1.0);
      vec4 c = src(uv); vec3 neon = color1 * e * 1.6 + c.rgb * 0.15; c.rgb = mix(c.rgb, neon, amount); return c; }`,
  },

  /* ----------------------------- Stylize ----------------------------- */
  {
    id: "cartoon", label: "Cartoon", category: "Stylize", amount: 70,
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 px = 1.0 / resolution; float gx = luma(src(uv + vec2(px.x, 0.0)).rgb) - luma(src(uv - vec2(px.x, 0.0)).rgb);
      float gy = luma(src(uv + vec2(0.0, px.y)).rgb) - luma(src(uv - vec2(0.0, px.y)).rgb); float e = smoothstep(0.08, 0.2, length(vec2(gx, gy)));
      vec3 q = floor(c.rgb * 5.0 + 0.5) / 5.0; vec3 col = mix(q, vec3(0.0), e); return vec4(mix(c.rgb, col, amount), c.a); }`,
  },
  {
    id: "sketch", label: "Pencil Sketch", category: "Stylize", amount: 80,
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 px = 1.0 / resolution; float s = 0.0;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) { float k = (x == 0 && y == 0) ? 8.0 : -1.0; s += luma(src(uv + vec2(float(x), float(y)) * px).rgb) * k; }
      float v = 1.0 - clamp(abs(s) * 3.0, 0.0, 1.0); v *= 0.9 + 0.1 * rand(floor(uv * resolution / 2.0)); return vec4(mix(c.rgb, vec3(v), amount), c.a); }`,
  },
  {
    id: "emboss", label: "Emboss", category: "Stylize", amount: 80,
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 px = 1.5 / resolution; float e = luma(src(uv - px).rgb) - luma(src(uv + px).rgb); return vec4(mix(c.rgb, vec3(0.5 + e * 2.0), amount), c.a); }`,
  },
  {
    id: "halftone", label: "Halftone", category: "Stylize", amount: 80,
    params: [{ key: "p1", label: "Dot size", min: 3, max: 30, def: 8 }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 p = uv * resolution; float a = 0.785; mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a)); vec2 q = r * p / p1;
      vec2 cell = (floor(q) + 0.5); float l = luma(src(((transpose_(r)) * (cell * p1)) / resolution).rgb); float d = length(fract(q) - 0.5);
      float dot_ = smoothstep(0.5 * sqrt(1.0 - l) + 0.04, 0.5 * sqrt(1.0 - l) - 0.04, d); return vec4(mix(c.rgb, vec3(1.0 - dot_), amount), c.a); }
      `.replace("transpose_(r)", "mat2(cos(a), sin(a), -sin(a), cos(a))"),
  },
  {
    id: "posterize", label: "Posterize", category: "Stylize", amount: 70,
    params: [{ key: "p1", label: "Levels", min: 2, max: 12, step: 1, def: 4 }],
    glsl: keepAlpha(`vec3 q = floor(c.rgb * p1 + 0.5) / p1; c.rgb = mix(c.rgb, q, amount); return c;`),
  },
  {
    id: "oilPaint", label: "Oil Paint", category: "Stylize", amount: 80,
    glsl: `vec4 effect(vec2 uv){ vec2 px = 3.0 / resolution; vec3 m[4]; vec3 s2[4];
      for (int k = 0; k < 4; k++) { m[k] = vec3(0.0); s2[k] = vec3(0.0); }
      for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) { vec3 c = src(uv + vec2(float(x), float(y)) * px).rgb;
        if (x <= 0 && y <= 0) { m[0] += c; s2[0] += c*c; } if (x >= 0 && y <= 0) { m[1] += c; s2[1] += c*c; }
        if (x <= 0 && y >= 0) { m[2] += c; s2[2] += c*c; } if (x >= 0 && y >= 0) { m[3] += c; s2[3] += c*c; } }
      vec3 best = m[0] / 9.0; float bs = 1e9;
      for (int k = 0; k < 4; k++) { vec3 mm = m[k] / 9.0; vec3 v = abs(s2[k] / 9.0 - mm * mm); float sv = v.r + v.g + v.b; if (sv < bs) { bs = sv; best = mm; } }
      vec4 c = src(uv); return vec4(mix(c.rgb, best, amount), c.a); }`,
  },
  {
    id: "pixelArt", label: "Pixel Art", category: "Stylize", amount: 80,
    params: [{ key: "p1", label: "Pixel size", min: 2, max: 32, def: 8 }],
    glsl: `vec4 effect(vec2 uv){ vec2 cell = p1 / resolution; vec4 c = src((floor(uv / cell) + 0.5) * cell); vec3 q = floor(c.rgb * 6.0 + 0.5) / 6.0; return mix(src(uv), vec4(q, c.a), amount); }`,
  },
  {
    id: "sharpen", label: "Sharpen", category: "Stylize", amount: 40,
    glsl: `vec4 effect(vec2 uv){ vec2 px = 1.0 / resolution; vec4 c = src(uv); vec3 b = (src(uv + vec2(px.x, 0.0)).rgb + src(uv - vec2(px.x, 0.0)).rgb + src(uv + vec2(0.0, px.y)).rgb + src(uv - vec2(0.0, px.y)).rgb) * 0.25;
      c.rgb = clamp(c.rgb + (c.rgb - b) * amount * 3.0, 0.0, 1.0); return c; }`,
  },

  /* ------------------------------ Color ------------------------------ */
  {
    id: "duotone", label: "Duotone", category: "Color", amount: 100,
    colors: [{ key: "color1", label: "Shadows", def: "#2b1b7a" }, { key: "color2", label: "Highlights", def: "#ff8fb1" }],
    glsl: keepAlpha(`c.rgb = mix(c.rgb, mix(color1, color2, luma(c.rgb)), amount); return c;`),
  },
  {
    id: "colorPop", label: "Color Pop (Splash)", category: "Color", amount: 100,
    params: [{ key: "p1", label: "Keep hue", min: 0, max: 360, def: 0 }, { key: "p2", label: "Range", min: 5, max: 120, def: 30 }],
    glsl: `vec3 rgb2hsv(vec3 c){ vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0); vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g)); vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r)); float d = q.x - min(q.w, q.y); return vec3(abs(q.z + (q.w - q.y) / (6.0*d + 1e-10)), d / (q.x + 1e-10), q.x); }
      vec4 effect(vec2 uv){ vec4 c = src(uv); vec3 h = rgb2hsv(c.rgb); float dh = abs(h.x * 360.0 - p1); dh = min(dh, 360.0 - dh);
      float keep = smoothstep(p2, p2 * 0.6, dh) * smoothstep(0.1, 0.25, h.y); c.rgb = mix(c.rgb, mix(vec3(luma(c.rgb)), c.rgb, keep), amount); return c; }`,
  },
  {
    id: "thermal", label: "Thermal Camera", category: "Color", amount: 100,
    glsl: keepAlpha(`float l = luma(c.rgb); vec3 t = l < 0.33 ? mix(vec3(0.0, 0.0, 0.3), vec3(0.6, 0.0, 0.8), l * 3.0) : l < 0.66 ? mix(vec3(0.6, 0.0, 0.8), vec3(1.0, 0.4, 0.0), (l - 0.33) * 3.0) : mix(vec3(1.0, 0.4, 0.0), vec3(1.0, 1.0, 0.6), (l - 0.66) * 3.0);
      c.rgb = mix(c.rgb, t, amount); return c;`),
  },
  {
    id: "nightVision", label: "Night Vision", category: "Color", amount: 100,
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv + (rand(vec2(time, uv.y)) - 0.5) * 0.001); float l = luma(c.rgb) * 1.8; vec3 n = vec3(0.1, 1.0, 0.2) * l;
      n += (rand(uv * resolution + time) - 0.5) * 0.25; n *= 0.85 + 0.15 * sin(uv.y * resolution.y * 1.5); n *= smoothstep(0.75, 0.35, length((uv - 0.5) * vec2(resolution.x / resolution.y, 1.0)));
      return vec4(mix(c.rgb, n, amount), c.a); }`,
  },
  {
    id: "rainbow", label: "Hue Cycle", category: "Color", amount: 60,
    params: [{ key: "p1", label: "Speed", min: 0, max: 3, step: 0.05, def: 0.5 }],
    glsl: keepAlpha(`float a = time * p1 * 6.2831; vec3 k = vec3(0.57735); float ca = cos(a); vec3 r = c.rgb * ca + cross(k, c.rgb) * sin(a) + k * dot(k, c.rgb) * (1.0 - ca); c.rgb = mix(c.rgb, r, amount); return c;`),
  },
  {
    id: "bleachBypass", label: "Bleach Bypass", category: "Color", amount: 70,
    glsl: keepAlpha(`float l = luma(c.rgb); vec3 b = vec3(l); vec3 blend = mix(2.0 * c.rgb * b, 1.0 - 2.0 * (1.0 - c.rgb) * (1.0 - b), step(0.45, l)); c.rgb = mix(c.rgb, blend, amount); return c;`),
  },
  {
    id: "crossProcess", label: "Cross Process", category: "Color", amount: 70,
    glsl: keepAlpha(`vec3 x = vec3(smoothstep(0.05, 0.95, c.r), pow(c.g, 0.85), c.b * 0.75 + 0.12); c.rgb = mix(c.rgb, x, amount); return c;`),
  },

  /* ------------------------ Weather & Overlays ------------------------ */
  {
    id: "rain", label: "Rain", category: "Weather & Overlays", amount: 60,
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 p = uv * vec2(resolution.x / resolution.y, 1.0) * vec2(60.0, 6.0); p.y += time * 18.0; p.x += p.y * 0.08;
      vec2 cell = floor(p); float r = rand(cell); float drop = step(0.92, r) * smoothstep(0.0, 0.3, fract(p.y + r)) * smoothstep(1.0, 0.6, fract(p.y + r)) * smoothstep(0.12, 0.0, abs(fract(p.x) - 0.5));
      c.rgb = mix(c.rgb * (1.0 - amount * 0.15), vec3(0.85, 0.9, 1.0), drop * amount * 0.6); return c; }`,
  },
  {
    id: "snow", label: "Snow", category: "Weather & Overlays", amount: 70,
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 asp = vec2(resolution.x / resolution.y, 1.0); float s = 0.0;
      for (int l = 0; l < 3; l++) { float fl = float(l); vec2 p = uv * asp * (10.0 + fl * 8.0); p.y += time * (1.0 + fl * 0.6); p.x += sin(time * 0.7 + p.y * 0.3 + fl) * 0.5;
        vec2 cell = floor(p); vec2 f = fract(p) - 0.5 - (vec2(rand(cell), rand(cell + 3.0)) - 0.5) * 0.6; s += smoothstep(0.08 - fl * 0.015, 0.0, length(f)) * step(0.6, rand(cell + 7.0)); }
      c.rgb = mix(c.rgb, vec3(1.0), clamp(s, 0.0, 1.0) * amount); return c; }`,
  },
  {
    id: "fog", label: "Fog", category: "Weather & Overlays", amount: 50,
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); float f = noise(uv * 3.0 + vec2(time * 0.08, 0.0)) * 0.6 + noise(uv * 7.0 - vec2(time * 0.05, 0.0)) * 0.4;
      c.rgb = mix(c.rgb, vec3(0.86, 0.88, 0.9), f * amount * (0.6 + 0.4 * (1.0 - uv.y))); return c; }`,
  },
  {
    id: "fireflies", label: "Sparkles", category: "Weather & Overlays", amount: 70,
    colors: [{ key: "color1", label: "Color", def: "#ffe08a" }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 asp = vec2(resolution.x / resolution.y, 1.0); vec3 add = vec3(0.0);
      for (int i = 0; i < 30; i++) { float fi = float(i); vec2 p = vec2(rand(vec2(fi, 1.0)) + sin(time * 0.3 + fi) * 0.05, rand(vec2(fi, 2.0)) + cos(time * 0.25 + fi * 1.3) * 0.05);
        float tw = pow(0.5 + 0.5 * sin(time * (2.0 + rand(vec2(fi, 3.0)) * 4.0) + fi), 6.0); float d = length((uv - p) * asp);
        add += color1 * (0.0015 / (d * d + 0.0008)) * tw * 0.05; }
      c.rgb += add * amount; return c; }`,
  },
  {
    id: "frameBorder", label: "Rounded Frame", category: "Weather & Overlays", amount: 60,
    colors: [{ key: "color1", label: "Border color", def: "#ffffff" }],
    glsl: `vec4 effect(vec2 uv){ vec4 c = src(uv); vec2 p = (uv - 0.5) * resolution; vec2 b = resolution * 0.5 - amount * 60.0; float r = amount * 50.0;
      float d = length(max(abs(p) - b + r, 0.0)) - r; c.rgb = mix(c.rgb, color1, smoothstep(-1.0, 1.0, d)); return c; }`,
  },
  {
    id: "scanlines", label: "Scan Lines", category: "Weather & Overlays", amount: 40,
    glsl: keepAlpha(`c.rgb *= 1.0 - amount * 0.5 * step(0.5, fract(gl_FragCoord.y / 3.0)); return c;`),
  },

  /* ------------------------------ Camera ------------------------------ */
  {
    id: "handheld", label: "Handheld Camera", category: "Camera", amount: 40,
    glsl: `vec4 effect(vec2 uv){ vec2 o = vec2(noise(vec2(time * 0.9, 1.0)) - 0.5, noise(vec2(time * 0.8, 7.0)) - 0.5) * 0.03 * amount; float a = (noise(vec2(time * 0.6, 3.0)) - 0.5) * 0.03 * amount;
      vec2 d = (uv - 0.5) / (1.0 + amount * 0.04); d = mat2(cos(a), -sin(a), sin(a), cos(a)) * d; return src(0.5 + d + o); }`,
  },
  {
    id: "earthquake", label: "Earthquake", category: "Camera", amount: 50,
    glsl: `vec4 effect(vec2 uv){ float t = floor(time * 30.0); vec2 o = (vec2(rand(vec2(t, 1.0)), rand(vec2(t, 2.0))) - 0.5) * 0.05 * amount; vec2 d = (uv - 0.5) / (1.0 + amount * 0.06); return src(0.5 + d + o); }`,
  },
  {
    id: "dollyZoom", label: "Breathing Zoom", category: "Camera", amount: 40,
    params: [{ key: "p1", label: "Speed", min: 0.1, max: 4, step: 0.05, def: 0.8 }],
    glsl: `vec4 effect(vec2 uv){ float z = 1.0 + amount * 0.12 * (0.5 + 0.5 * sin(time * p1 * 3.1415)); return src(0.5 + (uv - 0.5) / z); }`,
  },
];

export const effectDef = (id: string) => GL_EFFECTS.find((e) => e.id === id);

export const hexToRgb = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
