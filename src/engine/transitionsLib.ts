import glTransitions from "gl-transitions/gl-transitions.json";
import type { GLTransitionSource } from "./gl";

type Uniform = number | boolean | number[];

export interface TransitionDef {
  id: string;
  label: string;
  category: string;
  source: GLTransitionSource;
  params?: Record<string, Uniform>;
}

export const TRANSITION_CATEGORIES = [
  "Basic", "Slide & Push", "Wipe", "Zoom & Warp", "Speed Blur", "3D", "Distortion", "Shapes", "Split & Doors", "Glitch", "Light & Burn", "Stylized",
] as const;

const SRC = glTransitions as unknown as (GLTransitionSource & { license: string; paramsTypes: Record<string, string> })[];
const byName = new Map(SRC.map((t) => [t.name, t]));

/* custom transitions in the same GLSL format */
const CUSTOM: GLTransitionSource[] = [
  {
    name: "nova_flash",
    defaultParams: {},
    glsl: `vec4 transition(vec2 uv){ float f = 1.0 - abs(progress - 0.5) * 2.0; vec4 c = mix(getFromColor(uv), getToColor(uv), smoothstep(0.4, 0.6, progress)); return mix(c, vec4(1.0), pow(f, 2.0)); }`,
  },
  {
    name: "nova_whip",
    defaultParams: { direction: [1, 0] },
    glsl: `uniform vec2 direction; // = vec2(1.0, 0.0)
      vec4 transition(vec2 uv){ float e = progress < 0.5 ? 2.0*progress*progress : 1.0 - pow(-2.0*progress + 2.0, 2.0) / 2.0; float blur = sin(progress * 3.14159) * 0.08;
      vec4 s = vec4(0.0); for (int i = 0; i < 16; i++) { float t = float(i) / 15.0 - 0.5; vec2 p = uv + direction * (e + t * blur);
        s += (p.x >= 0.0 && p.x <= 1.0 && p.y >= 0.0 && p.y <= 1.0) ? getFromColor(p) : getToColor(fract(p)); } return s / 16.0; }`,
  },
  {
    name: "nova_lightleak",
    defaultParams: {},
    glsl: `vec4 transition(vec2 uv){ float f = sin(progress * 3.14159); vec4 c = mix(getFromColor(uv), getToColor(uv), smoothstep(0.3, 0.7, progress));
      vec3 leak = vec3(1.0, 0.55, 0.2) * exp(-length((uv - vec2(0.1 + progress * 0.8, 0.7)) * vec2(1.0, 1.5)) * 2.2) + vec3(1.0, 0.25, 0.45) * exp(-length(uv - vec2(0.9 - progress * 0.6, 0.2)) * 3.0);
      c.rgb = 1.0 - (1.0 - c.rgb) * (1.0 - leak * f * 1.5); return c; }`,
  },
  {
    name: "nova_blurdissolve",
    defaultParams: {},
    glsl: `vec4 transition(vec2 uv){ float b = sin(progress * 3.14159) * 0.012; vec4 a = vec4(0.0); vec4 c = vec4(0.0);
      for (int x = -3; x <= 3; x++) for (int y = -3; y <= 3; y++) { vec2 o = vec2(float(x), float(y)) * b; a += getFromColor(uv + o); c += getToColor(uv + o); }
      return mix(a, c, smoothstep(0.0, 1.0, progress)) / 49.0; }`,
  },
  {
    name: "nova_zoomblur",
    defaultParams: {},
    glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159) * 0.35; vec4 a = vec4(0.0); vec4 c = vec4(0.0);
      for (int i = 0; i < 20; i++) { float t = float(i) / 19.0; vec2 p = 0.5 + (uv - 0.5) * (1.0 - s * t); a += getFromColor(0.5 + (p - 0.5) / (1.0 + progress)); c += getToColor(0.5 + (p - 0.5) * (2.0 - progress)); }
      return mix(a, c, step(0.5, progress)) / 20.0; }`,
  },
  {
    name: "nova_spinblur",
    defaultParams: {},
    glsl: `vec4 transition(vec2 uv){ float s = sin(progress * 3.14159) * 0.6; vec4 a = vec4(0.0); vec4 c = vec4(0.0); vec2 d = uv - 0.5;
      for (int i = 0; i < 20; i++) { float ang = (float(i) / 19.0 - 0.5) * s + progress * 3.14159; mat2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)); vec2 p = 0.5 + r * d; a += getFromColor(p); c += getToColor(p); }
      return mix(a, c, smoothstep(0.4, 0.6, progress)) / 20.0; }`,
  },
];
for (const c of CUSTOM) byName.set(c.name, c as never);

/** [id, label, category, gl-transition name, params] */
const TABLE: [string, string, string, string, Record<string, Uniform>?][] = [
  // Basic
  ["fade", "Cross Dissolve", "Basic", "fade"],
  ["dissolve", "Dissolve (Noise)", "Basic", "dissolve"],
  ["dipBlack", "Dip to Black", "Basic", "fadecolor", { color: [0, 0, 0] }],
  ["dipWhite", "Dip to White", "Basic", "fadecolor", { color: [1, 1, 1] }],
  ["fadeGray", "Fade Grayscale", "Basic", "fadegrayscale"],
  ["blurDissolve", "Blur Dissolve", "Basic", "nova_blurdissolve"],
  ["luminanceMelt", "Luminance Melt", "Basic", "luminance_melt"],
  ["multiplyBlend", "Multiply Blend", "Basic", "multiply_blend"],
  ["colorPhase", "Color Phase", "Basic", "colorphase"],
  ["hsvFade", "HSV Fade", "Basic", "HSVfade"],
  ["colourDistance", "Color Distance", "Basic", "ColourDistance"],
  ["staticFade", "Static Fade", "Basic", "StaticFade"],
  // Slide & Push
  ["pushLeft", "Push Left", "Slide & Push", "Directional", { direction: [1, 0] }],
  ["pushRight", "Push Right", "Slide & Push", "Directional", { direction: [-1, 0] }],
  ["pushUp", "Push Up", "Slide & Push", "Directional", { direction: [0, -1] }],
  ["pushDown", "Push Down", "Slide & Push", "Directional", { direction: [0, 1] }],
  ["slideEase", "Smooth Slide", "Slide & Push", "directional-easing"],
  ["slideScaled", "Slide Scaled", "Slide & Push", "DirectionalScaled"],
  ["slides", "Slides", "Slide & Push", "Slides"],
  ["swap", "Swap", "Slide & Push", "swap"],
  ["xAxis", "Slide X-Axis", "Slide & Push", "x_axis_translation"],
  ["coordFromIn", "Coordinate Slide", "Slide & Push", "coord-from-in"],
  ["bounce", "Bounce", "Slide & Push", "Bounce"],
  ["leftRight", "Left Right", "Slide & Push", "LeftRight"],
  ["topBottom", "Top Bottom", "Slide & Push", "TopBottom"],
  ["rolls", "Roll", "Slide & Push", "Rolls"],
  // Wipe
  ["wipeLeft", "Wipe Left", "Wipe", "wipeLeft"],
  ["wipeRight", "Wipe Right", "Wipe", "wipeRight"],
  ["wipeUp", "Wipe Up", "Wipe", "wipeUp"],
  ["wipeDown", "Wipe Down", "Wipe", "wipeDown"],
  ["directionalWipe", "Soft Diagonal Wipe", "Wipe", "directionalwipe"],
  ["radialWipe", "Clock Wipe", "Wipe", "Radial"],
  ["angular", "Angular Wipe", "Wipe", "angular"],
  ["pinwheel", "Pinwheel", "Wipe", "pinwheel"],
  ["windowBlinds", "Blinds", "Wipe", "windowblinds"],
  ["windowSlice", "Window Slice", "Wipe", "windowslice"],
  ["squaresWire", "Squares Wire", "Wipe", "squareswire"],
  ["randomSquares", "Random Squares", "Wipe", "randomsquares"],
  ["checkerboard", "Checkerboard", "Wipe", "chessboard"],
  ["blockDissolve", "Block Dissolve", "Wipe", "BlockDissolve"],
  ["staticWipe", "Static Wipe", "Wipe", "static_wipe"],
  ["edge", "Edge Wipe", "Wipe", "EdgeTransition"],
  ["zoomLeftWipe", "Zoom Left Wipe", "Wipe", "ZoomLeftWipe"],
  ["zoomRightWipe", "Zoom Right Wipe", "Wipe", "ZoomRigthWipe"],
  // Zoom & Warp
  ["zoomIn", "Zoom In", "Zoom & Warp", "SimpleZoom"],
  ["zoomOut", "Zoom Out", "Zoom & Warp", "SimpleZoomOut"],
  ["zoomInOut", "Zoom In-Out", "Zoom & Warp", "zoomInOut"],
  ["dreamyZoom", "Dreamy Zoom", "Zoom & Warp", "DreamyZoom"],
  ["zoomCircles", "Zoom Circles", "Zoom & Warp", "ZoomInCircles"],
  ["crossWarp", "Warp", "Zoom & Warp", "crosswarp"],
  ["directionalWarp", "Directional Warp", "Zoom & Warp", "directionalwarp"],
  ["scaleIn", "Scale In", "Zoom & Warp", "scale-in"],
  ["rotateScale", "Rotate & Scale", "Zoom & Warp", "rotate_scale_fade"],
  ["rotateVanish", "Rotate & Vanish", "Zoom & Warp", "RotateScaleVanish"],
  ["squeeze", "Squeeze", "Zoom & Warp", "squeeze"],
  ["flyeye", "Fly Eye", "Zoom & Warp", "flyeye"],
  // Speed Blur
  ["whipLeft", "Whip Pan Left", "Speed Blur", "nova_whip", { direction: [1, 0] }],
  ["whipRight", "Whip Pan Right", "Speed Blur", "nova_whip", { direction: [-1, 0] }],
  ["whipUp", "Whip Pan Up", "Speed Blur", "nova_whip", { direction: [0, -1] }],
  ["whipDown", "Whip Pan Down", "Speed Blur", "nova_whip", { direction: [0, 1] }],
  ["crossZoom", "Speed Zoom", "Speed Blur", "CrossZoom"],
  ["zoomBlur", "Zoom Blur", "Speed Blur", "nova_zoomblur"],
  ["spinBlur", "Spin Blur", "Speed Blur", "nova_spinblur"],
  ["linearBlur", "Linear Blur", "Speed Blur", "LinearBlur"],
  ["tangentBlur", "Tangent Motion Blur", "Speed Blur", "tangentMotionBlur"],
  ["defocus", "Defocus", "Speed Blur", "DefocusBlur"],
  ["wind", "Wind", "Speed Blur", "wind"],
  // 3D
  ["cube", "Cube", "3D", "cube"],
  ["flip", "Flip", "3D", "SimpleFlip"],
  ["gridFlip", "Grid Flip", "3D", "GridFlip"],
  ["bookFlip", "Book Flip", "3D", "BookFlip"],
  ["pageCurl", "Page Curl", "3D", "InvertedPageCurl"],
  ["doorway", "Doorway", "3D", "doorway"],
  ["box", "Box", "3D", "Box"],
  ["fold", "Fold", "3D", "Fold"],
  ["revolve", "Revolve", "3D", "Revolve_Left"],
  ["rotate", "Rotate", "3D", "rotateTransition"],
  ["stereo", "Stereo Viewer", "3D", "StereoViewer"],
  ["tilesWave", "Tiles Wave", "3D", "TilesWave"],
  // Distortion
  ["ripple", "Ripple", "Distortion", "ripple"],
  ["waterDrop", "Water Drop", "Distortion", "WaterDrop"],
  ["swirl", "Swirl", "Distortion", "Swirl"],
  ["morph", "Morph", "Distortion", "morph"],
  ["perlin", "Perlin Noise", "Distortion", "perlin"],
  ["butterfly", "Butterfly Wave", "Distortion", "ButterflyWaveScrawler"],
  ["undulating", "Undulating Burn", "Distortion", "undulatingBurnOut"],
  ["kaleidoscope", "Kaleidoscope", "Distortion", "kaleidoscope"],
  ["powerKaleido", "Power Kaleido", "Distortion", "powerKaleido"],
  ["polar", "Polar", "Distortion", "polar_function"],
  ["crazyParametric", "Parametric", "Distortion", "CrazyParametricFun"],
  ["dreamy", "Dreamy", "Distortion", "Dreamy"],
  // Shapes
  ["circleOpen", "Iris Open", "Shapes", "circleopen"],
  ["circle", "Circle", "Shapes", "circle"],
  ["circleCrop", "Circle Crop", "Shapes", "CircleCrop"],
  ["heart", "Heart", "Shapes", "heart"],
  ["star", "Star", "Shapes", "StarWipe"],
  ["rectangle", "Rectangle", "Shapes", "Rectangle"],
  ["rectangleCrop", "Rectangle Crop", "Shapes", "RectangleCrop"],
  ["diamond", "Polka Dots", "Shapes", "PolkaDotsCurtain"],
  ["leaf", "Leaf", "Shapes", "cannabisleaf"],
  ["hexagons", "Hexagons", "Shapes", "hexagonalize"],
  ["puzzle", "Puzzle", "Shapes", "PuzzleRight"],
  ["crosshatch", "Crosshatch", "Shapes", "crosshatch"],
  ["bowTieH", "Bow Tie Horizontal", "Shapes", "BowTieHorizontal"],
  ["bowTieV", "Bow Tie Vertical", "Shapes", "BowTieVertical"],
  // Split & Doors
  ["horizontalOpen", "Doors Open (H)", "Split & Doors", "HorizontalOpen"],
  ["horizontalClose", "Doors Close (H)", "Split & Doors", "HorizontalClose"],
  ["verticalOpen", "Doors Open (V)", "Split & Doors", "VerticalOpen"],
  ["verticalClose", "Doors Close (V)", "Split & Doors", "VerticalClose"],
  ["splitInH", "Split In (H)", "Split & Doors", "splitSlideInHorizontal"],
  ["splitInV", "Split In (V)", "Split & Doors", "splitSlideInVertical"],
  ["splitOutH", "Split Out (H)", "Split & Doors", "splitSlideOutHorizontal"],
  ["splitOutV", "Split Out (V)", "Split & Doors", "splitSlideOutVertical"],
  ["splitInOutH", "Split Through (H)", "Split & Doors", "splitSlideInOutHorizontal"],
  ["splitInOutV", "Split Through (V)", "Split & Doors", "splitSlideInOutVertical"],
  // Glitch
  ["glitchDisplace", "Glitch Displace", "Glitch", "GlitchDisplace"],
  ["glitchMemories", "Glitch Memories", "Glitch", "GlitchMemories"],
  ["glitchParametric", "Glitch Blocks", "Glitch", "parametric_glitch"],
  ["datamosh", "Datamosh Strip", "Glitch", "StripDatamoshGlitch"],
  ["tvStatic", "TV Static", "Glitch", "TVStatic"],
  ["lostSignal", "Lost Signal", "Glitch", "old_tv_lost_signal"],
  ["doomScreen", "Melt Screen", "Glitch", "DoomScreenTransition"],
  ["flicker", "Flicker", "Glitch", "Drop_Zone_Flicker"],
  ["randomNoise", "Random Noise", "Glitch", "randomNoisex"],
  // Light & Burn
  ["flash", "Flash", "Light & Burn", "nova_flash"],
  ["lightLeak", "Light Leak", "Light & Burn", "nova_lightleak"],
  ["overexposure", "Overexposure", "Light & Burn", "Overexposure"],
  ["filmBurn", "Film Burn", "Light & Burn", "FilmBurn"],
  ["burn", "Burn", "Light & Burn", "burn"],
  ["burnOut", "Burn Out", "Light & Burn", "burn0"],
  // Stylized
  ["pixelize", "Pixelize", "Stylized", "pixelize"],
  ["mosaic", "Mosaic", "Stylized", "mosaic_transition"],
  ["mosaicTiles", "Mosaic Tiles", "Stylized", "Mosaic"],
  ["advancedMosaic", "Advanced Mosaic", "Stylized", "AdvancedMosaic"],
  ["fragment", "Fragments", "Stylized", "fragment"],
  ["bowTieParam", "Bow Tie", "Stylized", "BowTieWithParameter"],
];

export const TRANSITION_DEFS: TransitionDef[] = TABLE.flatMap(([id, label, category, name, params]) => {
  const source = byName.get(name);
  return source ? [{ id, label, category, source, params }] : [];
});

/** projects saved before the GPU transitions used these names */
const LEGACY: Record<string, string> = {
  fadeBlack: "dipBlack", fadeWhite: "dipWhite", slideLeft: "pushLeft", slideRight: "pushRight", slideUp: "pushUp", slideDown: "pushDown",
  circle: "circleOpen", blurIn: "blurDissolve", spin: "rotateScale",
};

export const transitionDef = (id: string) => TRANSITION_DEFS.find((t) => t.id === (LEGACY[id] ?? id));

/** licenses of the bundled transition shaders (MIT / BSD), shown in About */
export const TRANSITION_CREDITS = "Transitions include shaders from the gl-transitions collection (https://gl-transitions.com), MIT / BSD licensed.";
