// Small WebGL runtime for GPU effects (one input) and transitions (two inputs).
// Transitions use the GLSL format of the open gl-transitions collection.

type UniformValue = number | boolean | number[];

const VERT = `attribute vec2 pos; varying vec2 _uv; void main(){ _uv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }`;

let gl: WebGLRenderingContext | null = null;
let glCanvas: HTMLCanvasElement | null = null;
let quad: WebGLBuffer | null = null;
const textures: WebGLTexture[] = [];
const programs = new Map<string, { prog: WebGLProgram; uniforms: Map<string, { loc: WebGLUniformLocation; type: number; size: number }> } | null>();
let failed = false;

function init() {
  if (gl || failed) return gl;
  glCanvas = document.createElement("canvas");
  gl = glCanvas.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true });
  if (!gl) {
    failed = true;
    return null;
  }
  quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  for (let i = 0; i < 2; i++) {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    textures.push(t);
  }
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  return gl;
}

export const glSupported = () => !!init();

function compile(key: string, frag: string) {
  if (programs.has(key)) return programs.get(key)!;
  const g = init();
  if (!g) return null;
  const sh = (type: number, src: string) => {
    const s = g.createShader(type)!;
    g.shaderSource(s, src);
    g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) {
      console.warn(`[gl] ${key}:`, g.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = sh(g.VERTEX_SHADER, VERT), fs = sh(g.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return programs.set(key, null), null;
  const prog = g.createProgram()!;
  g.attachShader(prog, vs);
  g.attachShader(prog, fs);
  g.bindAttribLocation(prog, 0, "pos");
  g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) {
    console.warn(`[gl] link ${key}:`, g.getProgramInfoLog(prog));
    return programs.set(key, null), null;
  }
  const uniforms = new Map<string, { loc: WebGLUniformLocation; type: number; size: number }>();
  const n = g.getProgramParameter(prog, g.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = g.getActiveUniform(prog, i)!;
    const name = info.name.replace(/\[0\]$/, "");
    uniforms.set(name, { loc: g.getUniformLocation(prog, info.name)!, type: info.type, size: info.size });
  }
  const entry = { prog, uniforms };
  programs.set(key, entry);
  return entry;
}

function setUniform(g: WebGLRenderingContext, u: { loc: WebGLUniformLocation; type: number }, v: UniformValue) {
  const arr = Array.isArray(v) ? v : [typeof v === "boolean" ? (v ? 1 : 0) : v];
  switch (u.type) {
    case g.FLOAT: return g.uniform1f(u.loc, arr[0]);
    case g.FLOAT_VEC2: return g.uniform2f(u.loc, arr[0], arr[1]);
    case g.FLOAT_VEC3: return g.uniform3f(u.loc, arr[0], arr[1], arr[2]);
    case g.FLOAT_VEC4: return g.uniform4f(u.loc, arr[0], arr[1], arr[2], arr[3]);
    case g.INT: case g.BOOL: return g.uniform1i(u.loc, Math.round(arr[0]));
    case g.INT_VEC2: return g.uniform2i(u.loc, Math.round(arr[0]), Math.round(arr[1]));
  }
}

function run(key: string, frag: string, inputs: TexImageSource[], w: number, h: number, uniforms: Record<string, UniformValue>) {
  const g = init();
  const p = g && compile(key, frag);
  if (!g || !p || !glCanvas) return null;
  if (glCanvas.width !== w || glCanvas.height !== h) {
    glCanvas.width = w;
    glCanvas.height = h;
  }
  g.viewport(0, 0, w, h);
  g.useProgram(p.prog);
  inputs.forEach((img, i) => {
    g.activeTexture(g.TEXTURE0 + i);
    g.bindTexture(g.TEXTURE_2D, textures[i]);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
  });
  for (const [name, v] of Object.entries(uniforms)) {
    const u = p.uniforms.get(name);
    if (u) setUniform(g, u, v);
  }
  g.bindBuffer(g.ARRAY_BUFFER, quad);
  g.enableVertexAttribArray(0);
  g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
  g.clearColor(0, 0, 0, 0);
  g.clear(g.COLOR_BUFFER_BIT);
  g.drawArrays(g.TRIANGLES, 0, 6);
  return glCanvas;
}

/* ------------------------------ transitions ------------------------------ */

export interface GLTransitionSource {
  name: string;
  glsl: string;
  defaultParams: Record<string, UniformValue>;
}

const TRANSITION_HEADER = `precision highp float;
varying vec2 _uv;
uniform sampler2D from, to;
uniform float progress, ratio;
vec4 getFromColor(vec2 uv){ return texture2D(from, uv); }
vec4 getToColor(vec2 uv){ return texture2D(to, uv); }
`;

export function runTransition(
  t: GLTransitionSource, from: TexImageSource, to: TexImageSource, w: number, h: number, progress: number, params: Record<string, UniformValue> = {},
) {
  const frag = `${TRANSITION_HEADER}\n${t.glsl}\nvoid main(){ gl_FragColor = transition(_uv); }`;
  // texture units: from = 0, to = 1
  const g = init();
  const p = g && compile(`t:${t.name}`, frag);
  if (g && p) {
    g.useProgram(p.prog);
    const uf = p.uniforms.get("from"), ut = p.uniforms.get("to");
    if (uf) g.uniform1i(uf.loc, 0);
    if (ut) g.uniform1i(ut.loc, 1);
  }
  return run(`t:${t.name}`, frag, [from, to], w, h, { ...t.defaultParams, ...params, progress, ratio: w / h });
}

export const transitionCompiles = (t: GLTransitionSource) =>
  !!compile(`t:${t.name}`, `${TRANSITION_HEADER}\n${t.glsl}\nvoid main(){ gl_FragColor = transition(_uv); }`);

/* -------------------------------- effects -------------------------------- */

const EFFECT_HEADER = `precision highp float;
varying vec2 _uv;
uniform sampler2D tex;
uniform vec2 resolution;
uniform float time, amount, p1, p2, p3;
uniform vec3 color1, color2;
vec4 src(vec2 uv){ return texture2D(tex, uv); }
float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(rand(i), rand(i+vec2(1.0,0.0)), f.x), mix(rand(i+vec2(0.0,1.0)), rand(i+vec2(1.0,1.0)), f.x), f.y); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

export interface EffectShader {
  id: string;
  glsl: string; // defines vec4 effect(vec2 uv)
}

export function runEffect(e: EffectShader, input: TexImageSource, w: number, h: number, u: { time: number; amount: number; p1?: number; p2?: number; p3?: number; color1?: number[]; color2?: number[] }) {
  const frag = `${EFFECT_HEADER}\n${e.glsl}\nvoid main(){ gl_FragColor = effect(_uv); }`;
  return run(`e:${e.id}`, frag, [input], w, h, {
    resolution: [w, h], time: u.time, amount: u.amount, p1: u.p1 ?? 0, p2: u.p2 ?? 0, p3: u.p3 ?? 0,
    color1: u.color1 ?? [1, 0.3, 0.6], color2: u.color2 ?? [0.1, 0.2, 0.9],
  });
}
