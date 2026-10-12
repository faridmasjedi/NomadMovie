import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeEnv, findClaude, getConfig, keyFor, modelFor, PROVIDERS, urlFor, type Provider } from "./config.ts";

/** which provider / key / model a request goes to (the saved settings, or values being tested) */
interface Target {
  provider: Provider;
  key: string;
  model: string;
  url: string;
}

const savedTarget = (): Target => {
  const p = getConfig().provider;
  return { provider: p, key: keyFor(p), model: modelFor(p), url: urlFor(p) };
};

let client: { key: string; c: Anthropic } | null = null;
const anthropic = (key: string) => {
  if (!client || client.key !== key) client = { key, c: new Anthropic(key ? { apiKey: key } : {}) };
  return client.c;
};

const anthropicEnvAuth = () => !!(process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE);

/** whether the chosen provider has what it needs (it may still fail, e.g. a wrong key) */
export function aiAvailable(t = savedTarget()) {
  switch (t.provider) {
    case "claude-code": return !!findClaude();
    case "anthropic": return !!t.key || anthropicEnvAuth();
    case "ollama": return true;
    case "custom": return !!t.url && !!t.model;
    default: return !!t.key;
  }
}

const SYSTEM_PROMPT = `You are the built-in AI editor of "NomadMovie", a multi-track video editor and motion-graphics tool (similar to Filmora / After Effects).
The user talks to you in any language and you edit their project by returning a list of actions that the app executes in order.

## Coordinate system and timing
- Canvas is project.width x project.height pixels. x/y of a clip is the CENTER of the clip in canvas pixels ((width/2, height/2) is the middle of the frame).
- All times are in seconds. "start" is the position on the timeline. Keyframe "t" values are RELATIVE to the clip's start.
- Tracks: video tracks are listed top-to-bottom; the first video track in the list renders on top. Audio tracks only hold audio.
- If you don't pass trackId when adding a visual element, the app picks a free video track automatically (creating one if needed). Layers added later in the same response end up above earlier ones when tracks are created automatically.

## Response format
Return JSON: {"reply": string, "actions": [{"op": string, "args": string}]}
- "reply": a short, friendly answer in the user's language describing what you did (or answering their question). Keep it under 80 words.
- "args" is a JSON-encoded object string with the op's arguments.
- Any "add_*" action may include "ref": "<name>"; later actions can refer to the created clip with clipId "$<name>".
- If the request is only a question, return an empty actions array.
- Only reference clip ids, media ids and track ids that exist in the context (or refs you created).

## Operations
add_text {text, start, duration, x?, y?, size?, color?, font?, bold?, italic?, align?, strokeColor?, strokeWidth?, shadow?, background?, letterSpacing?, animIn?, animOut?, animInDur?, animOutDur?, trackId?, ref?}
add_shape {shape: rect|circle|triangle|star|line|arrow|heart, start, duration, x?, y?, width?, height?, fill?, gradient? (second color, vertical gradient), stroke?, strokeWidth?, radius?, opacity?, trackId?, ref?}
add_solid {color, start, duration, trackId?, ref?}  — full-frame color background (placed on the lowest video track that is free)
add_svg {svg, start, duration, x?, y?, scale?, trackId?, ref?} — a self-contained SVG graphic (sticker, icon, logo, illustration, lower-third). Must have width/height/viewBox attributes. No external resources, no scripts. Use it when shapes/text are not enough.
add_media {mediaId, start?, trackId?, ref?} — put an imported file on the timeline (start defaults to the end of the timeline).
update_clip {clipId, patch} — deep-merges patch into the clip. Patchable: name, start, duration, speed, blend (source-over|multiply|screen|overlay|lighten|darken|color-dodge|difference|...), fit (contain|cover|stretch),
   transform {x,y,scale,scaleX,scaleY,rotation(deg),opacity(0-1),flipH,flipV},
   filters {brightness(100=normal),contrast(100),saturation(100),hue(deg),blur(px),grayscale(0-100),sepia(0-100),invert(0-100),vignette(0-100),temperature(-100..100),tint(-100..100)},
   text {content,font,size,color,bold,italic,align,strokeColor,strokeWidth,shadow,shadowColor,background,letterSpacing,lineHeight},
   shape {type,width,height,fill,stroke,strokeWidth,radius,gradient},
   color (solid clips), audio {volume(1=100%, max 3),muted,fadeIn,fadeOut,pan(-1..1),eqLow,eqMid,eqHigh(dB -24..24),denoise,voiceEnhance,compressor,reverb(0-1),echo(0-1)},
   crop {top,right,bottom,left (percent)}, chroma {enabled,color,threshold,smoothness}
set_keyframes {clipId, prop: x|y|scale|scaleX|scaleY|rotation|opacity|blur|volume, keyframes: [{t, v, ease: linear|easeIn|easeOut|easeInOut|backOut|bounce|elastic|hold}]} — replaces that property's keyframes. scale/scaleX/scaleY/volume are multipliers (1 = normal), opacity 0..1, rotation in degrees, blur px. Keyframed x/y override transform.x/y.
set_animation {clipId, animIn?, animOut?, animInDur?, animOutDur?} — preset entrance/exit animations (see catalog). Good for quick text animation; use set_keyframes for custom motion.
set_transition {clipId, in?: {type, duration}, out?: {type, duration}} — "in" is the transition on the cut at the clip's START: it blends from the previous clip on the same track (if adjacent) into this clip, centered on the cut. "out" only applies when no clip follows. Use catalog transition ids.
add_effect {clipId, type, amount(0-100), params?: {p1?, p2?, p3?, color1?, color2?}}  /  clear_effects {clipId} — effect ids from the catalog (GPU effects have parameters p1..p3 and colors; omit params to use defaults)
add_effect_layer {effects: [{type, amount, params?}], start, duration, look?} — an adjustment layer that applies effects/look to everything below it (good for global color grades or overlays like light leaks, film grain, rain)
apply_motion {clipId, preset: zoomIn|zoomOut|punchIn|kenBurns|panLeft|panRight|panUp|panDown, start (clip-local s), duration, amount (zoom factor e.g. 1.3), focusX?, focusY? (project px)} — camera-style zoom/pan inside a clip
apply_look {clipId, look} — color-grade preset from the catalog
split {time, clipId?} — split at a timeline time (all clips under the playhead if clipId omitted)
trim {clipId, start?, end?} — new timeline in/out points
move_clip {clipId, start, trackId?}
delete_clips {clipIds, ripple?}
set_speed {clipId, speed}
add_marker {time, label}
add_track {kind: video|audio, ref?}
set_project {width?, height?, fps?, background?, name?}
seek {time}
remove_silence {clipId} — cut silent parts out of an audio/video clip
auto_duck {clipId} — lower this (music) clip's volume while other clips have speech
normalize {clipId} — loudness normalization
beats_to_markers {clipId} — detect music beats and add markers (then you can't see them; tell the user to look at the timeline)
detect_scenes {clipId, split?} — find scene cuts in a video clip (optionally split there)
add_motion {clipId, type, speed?, amount? (0-100), delay? (s)} — a motion preset that loops by itself for the whole clip (catalog.motionPresets: float, sway, wiggle, bounce, pulse, heartbeat, spin, swing, jelly, orbit, shake, blink, drift). Great for quick character / sticker / logo animation without keyframes.  /  clear_motion {clipId}
set_anchor {clipId, x, y} — the point (0..1 of the clip's picture; 0,0 = top-left) it rotates and scales around, e.g. a shoulder for an arm, the stem base for a plant. Set it before sway / swing / spin. Illustration parts fill the whole artboard: their "drawnArea" [left, top, right, bottom] (0..1) shows where the part really is — place anchors relative to it (e.g. an arm reaching right: x = left, y = middle of drawnArea).
set_parent {clipId, parentId|null} — the clip follows the parent's position, rotation and scale (e.g. hand → arm → body). The clip doesn't move when attached.
split_layers {clipId} — split an SVG illustration (clips with illustration:true, or imported .svg) into one clip per part so parts can be animated separately; the new clips get the part names and are parented to the bottom layer. Afterwards, reference the new clips by name in a later request.

## Motion design guidance
- When asked to "make an animation / intro / title / lower third / logo reveal", design a polished, layered composition: background (solid or gradient shape), decorative shapes, main text, and timed keyframes with eased motion (overshoot with backOut, staggered starts of ~0.1–0.25s, holds, exits). Typical intro is 4–8 seconds.
- Keep text inside the safe area (10% margin). Default font is "Inter"; for Persian/Arabic text use "Vazirmatn" or "Lalezar".
- Prefer set_keyframes for anything custom; combine opacity + y + scale for nice entrances.
- When the user has selected a clip and says "this", they mean the selected clip(s).
- If you received a frame image, use it to judge color, composition, and content (e.g. for color correction use filters: brightness, contrast, saturation, temperature, tint, vignette).`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: { op: { type: "string" }, args: { type: "string" } },
        required: ["op", "args"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "actions"],
  additionalProperties: false,
};

interface AssistBody {
  prompt: string;
  context: unknown;
  history?: { role: "user" | "assistant"; text: string }[];
  image?: string; // data:image/jpeg;base64,...
  effort?: "low" | "medium" | "high";
}

type Effort = "low" | "medium" | "high";

/** provider-neutral conversation turn */
interface Turn {
  role: "user" | "assistant";
  text: string;
  image?: string; // data URL
}

function callJSON(system: string, turns: Turn[], schema: object, effort: Effort = "medium", t = savedTarget()) {
  const name = PROVIDERS[t.provider].label;
  if (!aiAvailable(t)) {
    if (t.provider === "claude-code") throw new Error("To use your Claude subscription, open Settings (⚙) → Claude subscription and click “Set up”. Or pick another AI there.");
    if (t.provider === "custom") throw new Error("Set the address and model of your AI service in Settings.");
    throw new Error(`No API key for ${name}. Open Settings (⚙) and add one.`);
  }
  if (t.provider === "claude-code") return callClaudeCode(system, turns, schema, effort, t.model);
  if (t.provider === "anthropic") return callAnthropic(system, turns, schema, effort, t);
  return callOpenAICompatible(system, turns, schema, t);
}

async function callAnthropic(system: string, turns: Turn[], schema: object, effort: Effort, t: Target) {
  const messages: Anthropic.Beta.BetaMessageParam[] = turns.map((x) => {
    const m = x.image && /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(x.image);
    if (!m) return { role: x.role, content: x.text };
    return {
      role: x.role,
      content: [
        { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg", data: m[2] } },
        { type: "text", text: x.text },
      ],
    };
  });
  let response;
  try {
    response = await anthropic(t.key).beta.messages.create({
      model: t.model,
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system,
      output_config: { effort, format: { type: "json_schema", schema: schema as Record<string, unknown> } },
      messages,
    }, { timeout: 5 * 60_000 });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error("Anthropic rejected the API key. Check it in Settings.");
    if (e instanceof Anthropic.NotFoundError) throw new Error(`Anthropic has no model called "${t.model}". Pick another model in Settings.`);
    throw e;
  }
  if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("The response was too long; try a smaller request.");
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  return JSON.parse(text);
}

/** pulls the JSON object out of a reply that may be wrapped in prose or code fences */
function parseJsonReply(text: string) {
  const s = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(s);
  } catch {
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
    throw new Error(`The AI did not return valid JSON: ${s.slice(0, 200)}`);
  }
}

/**
 * OpenAI, Gemini, OpenRouter, Ollama, LM Studio and any other service with an OpenAI-style
 * /chat/completions endpoint. Asks for strict JSON-schema output and steps down to plain JSON mode
 * (or none) for services that don't support it.
 */
async function callOpenAICompatible(system: string, turns: Turn[], schema: object, t: Target) {
  const name = PROVIDERS[t.provider].label;
  const messages = [
    { role: "system", content: `${system}\n\nAlways answer with one JSON object that matches this JSON schema, and nothing else:\n${JSON.stringify(schema)}` },
    ...turns.map((x) => (x.image
      ? { role: x.role, content: [{ type: "text", text: x.text }, { type: "image_url", image_url: { url: x.image } }] }
      : { role: x.role, content: x.text })),
  ];
  const formats: (object | undefined)[] = [
    { type: "json_schema", json_schema: { name: "response", strict: true, schema } },
    { type: "json_object" },
    undefined,
  ];
  let lastError = "";
  for (const response_format of formats) {
    let res: Response;
    try {
      res = await fetch(`${t.url}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(t.key ? { Authorization: `Bearer ${t.key}` } : {}),
          ...(t.provider === "openrouter" ? { "HTTP-Referer": "https://github.com/faridmasjedi/NomadMovie", "X-Title": "NomadMovie" } : {}),
        },
        body: JSON.stringify({ model: t.model, messages, ...(response_format ? { response_format } : {}) }),
        signal: AbortSignal.timeout(5 * 60_000),
      });
    } catch (e) {
      const hint = t.provider === "ollama" ? " Is Ollama (or LM Studio) running?" : "";
      throw new Error(`Could not reach ${name} at ${t.url}.${hint} (${e instanceof Error ? e.message : e})`);
    }
    const body = await res.text();
    if (res.status === 401 || res.status === 403) throw new Error(`${name} rejected the API key. Check it in Settings.`);
    if (res.status === 404 && /model/i.test(body)) throw new Error(`${name} has no model called "${t.model}". Pick another model in Settings.`);
    if (!res.ok) {
      lastError = `${name} error ${res.status}: ${body.slice(0, 300)}`;
      // structured output not supported → try the next, simpler format
      if (res.status === 400 || res.status === 422) continue;
      throw new Error(lastError);
    }
    const j = JSON.parse(body);
    const text = j.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new Error(`${name} returned an empty answer.`);
    return parseJsonReply(text);
  }
  throw new Error(lastError);
}

/** the models a provider offers (for the model picker in Settings) */
export async function listModels(o: { provider: Provider; key?: string; url?: string }): Promise<string[]> {
  const p = o.provider;
  const key = o.key || keyFor(p), url = (o.url || urlFor(p)).replace(/\/+$/, "");
  if (p === "claude-code") return ["default", "opus", "sonnet", "haiku"];
  if (p === "anthropic") {
    const page = await anthropic(key).models.list({ limit: 100 });
    return page.data.map((m) => m.id);
  }
  const res = await fetch(`${url}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return ((j.data ?? j.models ?? []) as { id?: string; name?: string }[])
    .map((m) => (m.id ?? m.name ?? "").replace(/^models\//, ""))
    .filter(Boolean)
    .sort();
}

/** a tiny real request, to check a connection from Settings before saving */
export async function testProvider(o: { provider: Provider; key?: string; model?: string; url?: string }) {
  const p = o.provider;
  const t: Target = {
    provider: p,
    key: o.key || keyFor(p),
    model: o.model || modelFor(p),
    url: (o.url || urlFor(p)).replace(/\/+$/, ""),
  };
  const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
  await callJSON('This is a connection test. Answer with {"ok": true}.', [{ role: "user", text: "Connection test." }], schema, "low", t);
  return { ok: true };
}

/**
 * Runs the request through the local Claude Code CLI (`claude -p`), which uses the
 * user's own claude.ai subscription login (Pro / Max) instead of an API key.
 */
async function callClaudeCode(system: string, turns: Turn[], schema: object, effort: Effort, model: string) {
  const bin = findClaude();
  if (!bin) throw new Error("To use your Claude subscription, open Settings (⚙) → Claude subscription and click “Set up”. Or pick another AI there.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomad-ai-"));
  try {
    // history + current request flattened into one prompt; images are saved and read with the Read tool
    let prompt = "";
    const history = turns.slice(0, -1);
    if (history.length) {
      prompt += "<conversation_so_far>\n";
      for (const t of history) prompt += `<${t.role}>${t.text}</${t.role}>\n`;
      prompt += "</conversation_so_far>\n\n";
    }
    const last = turns[turns.length - 1];
    let images = 0;
    const m = last.image && /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(last.image);
    if (m) {
      const file = path.join(dir, `frame.${m[1] === "jpeg" ? "jpg" : m[1]}`);
      fs.writeFileSync(file, Buffer.from(m[2], "base64"));
      prompt += `The current video frame is attached as an image file: ${file} — read it first with the Read tool.\n\n`;
      images++;
    }
    prompt += last.text;

    const args = [
      "-p",
      "--output-format", "json",
      "--no-session-persistence",
      "--system-prompt", system,
      "--json-schema", JSON.stringify(schema),
      "--effort", effort,
      "--tools", images ? "Read" : "",
      ...(images ? ["--allowedTools", "Read", "--add-dir", dir] : []),
      ...(model && model !== "default" ? ["--model", model] : []),
    ];
    const out = await new Promise<string>((resolve, reject) => {
      const p = spawn(bin, args, { cwd: dir, env: claudeEnv(), stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => p.kill("SIGTERM"), 6 * 60_000);
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
      p.on("error", reject);
      p.on("close", (code) => {
        clearTimeout(timer);
        if (stdout.trim()) resolve(stdout);
        else reject(new Error(`Claude Code exited with ${code}: ${stderr.trim().slice(-600) || "no output"}`));
      });
      p.stdin.end(prompt);
    });
    let res: { is_error?: boolean; result?: string; structured_output?: unknown; subtype?: string };
    try {
      res = JSON.parse(out);
    } catch {
      throw new Error(`Unexpected Claude Code output: ${out.slice(0, 300)}`);
    }
    if (res.is_error) {
      const msg = String(res.result ?? res.subtype ?? "unknown error");
      if (/log ?in|auth|credential|401/i.test(msg)) throw new Error(`You're not signed in to Claude. Open Settings (⚙) → Claude subscription → “Sign in with Claude”. (${msg})`);
      throw new Error(`Claude Code: ${msg}`);
    }
    if (res.structured_output) return res.structured_output;
    return JSON.parse(res.result ?? "{}");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export async function aiAssist(body: AssistBody) {
  const turns: Turn[] = (body.history ?? []).slice(-12).map((h) => ({ role: h.role, text: h.text }));
  turns.push({
    role: "user",
    image: body.image,
    text: `<project_context>\n${JSON.stringify(body.context)}\n</project_context>\n\n<request>\n${body.prompt}\n</request>`,
  });
  const out = await callJSON(SYSTEM_PROMPT, turns, RESPONSE_SCHEMA, body.effort);
  const actions = (out.actions ?? []).map((a: { op: string; args: string }) => {
    try {
      return { op: a.op, args: JSON.parse(a.args || "{}") };
    } catch {
      return { op: a.op, args: {}, error: "invalid args" };
    }
  });
  return { reply: out.reply ?? "", actions };
}

const SUBTITLE_SYSTEM = `You align a transcript/script to detected speech segments to produce subtitles.
You get speech segments (start/end seconds, detected from audio energy) and the script text.
Split the script into short readable captions (max ~42 characters, max 2 lines, natural phrase breaks), keep the original language and wording exactly,
and assign each caption a start/end inside the speech segments, distributing time proportionally to text length. Captions must not overlap and must be in order.
If no script is given but a rough transcript is given, clean punctuation only.`;

const SUBTITLE_SCHEMA = {
  type: "object",
  properties: {
    captions: {
      type: "array",
      items: {
        type: "object",
        properties: { start: { type: "number" }, end: { type: "number" }, text: { type: "string" } },
        required: ["start", "end", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["captions"],
  additionalProperties: false,
};

export async function aiSubtitles(body: { segments: { start: number; end: number }[]; script: string }) {
  return callJSON(
    SUBTITLE_SYSTEM,
    [{ role: "user", text: `<segments>${JSON.stringify(body.segments)}</segments>\n<script>\n${body.script}\n</script>` }],
    SUBTITLE_SCHEMA,
    "low",
  );
}
