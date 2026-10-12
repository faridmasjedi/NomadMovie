import { useEffect, useState } from "react";
import { health, loadHealth } from "../health";
import { useStore } from "../store";
import { Field } from "./ui";

type ProviderId = "claude-code" | "anthropic" | "openai" | "gemini" | "openrouter" | "ollama" | "custom";

interface ProviderState {
  label: string;
  defaultModel: string;
  needsKey: boolean;
  keyUrl?: string;
  env?: string;
  key: string; // masked
  hasKey: boolean;
  envKey: boolean;
  model: string;
  url: string;
}

interface Settings {
  provider: ProviderId;
  cliModel: string;
  providers: Record<ProviderId, ProviderState>;
}

/** the choices, in the order shown, with a one-line pitch each */
const CHOICES: [ProviderId, string, string][] = [
  ["claude-code", "Claude subscription", "Use your Claude Pro / Max plan through Claude Code. No key, no extra cost."],
  ["anthropic", "Claude API key", "Pay as you go at console.anthropic.com."],
  ["openai", "ChatGPT / OpenAI", "An OpenAI API key from platform.openai.com."],
  ["gemini", "Google Gemini", "A Gemini API key from Google AI Studio — has a free tier."],
  ["openrouter", "OpenRouter", "One key for hundreds of models (Claude, GPT, Llama, DeepSeek…)."],
  ["ollama", "Local AI", "Free and private: a model running on this computer with Ollama or LM Studio."],
  ["custom", "Other service", "Any OpenAI-compatible endpoint (Groq, Mistral, DeepSeek, Together, your own server…)."],
];

const CLAUDE_MODELS: [string, string][] = [["default", "Default for my plan"], ["opus", "Opus (most capable)"], ["sonnet", "Sonnet (faster)"], ["haiku", "Haiku (fastest)"]];

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [sel, setSel] = useState<ProviderId>("claude-code");
  // per-provider form values (typed key, model, address)
  const [form, setForm] = useState<Partial<Record<ProviderId, { key: string; model: string; url: string }>>>({});
  const [models, setModels] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [test, setTest] = useState<{ state: "idle" | "running" | "ok" | "fail"; msg?: string }>({ state: "idle" });
  const [saving, setSaving] = useState(false);
  const h = health();

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then((d: Settings) => {
      setS(d);
      setSel(d.provider);
    });
    loadHealth();
  }, []);

  const info = s?.providers[sel];
  const f = (s && (form[sel] ?? { key: "", model: sel === "claude-code" ? s.cliModel : info!.model, url: info!.url })) || { key: "", model: "", url: "" };
  const setF = (patch: Partial<typeof f>) => {
    setForm({ ...form, [sel]: { ...f, ...patch } });
    setTest({ state: "idle" });
  };
  const body = () => ({ provider: sel, key: f.key || info?.key, model: f.model, url: f.url });

  const loadModels = async () => {
    const r = await fetch("/api/settings/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
    const j = await r.json();
    if (j.models) setModels({ ...models, [sel]: j.models });
  };
  // fetch the model list as soon as the provider can answer
  useEffect(() => {
    if (!info || sel === "claude-code" || models[sel]) return;
    if (info.needsKey && !info.hasKey && !info.envKey && f.key.length < 8) return;
    if (sel === "custom" && !f.url) return;
    loadModels().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, info?.hasKey, f.key.length > 8, f.url]);

  const runTest = async () => {
    setTest({ state: "running" });
    try {
      const r = await fetch("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
      const j = await r.json();
      setTest(j.ok ? { state: "ok", msg: "Connected — the AI answered." } : { state: "fail", msg: j.error });
    } catch (e) {
      setTest({ state: "fail", msg: e instanceof Error ? e.message : String(e) });
    }
  };

  const save = async () => {
    if (!s) return;
    setSaving(true);
    await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
    await loadHealth();
    setSaving(false);
    useStore.getState().notify(`AI set to ${CHOICES.find((c) => c[0] === sel)![1]}`, "ok");
    onClose();
  };

  const removeKey = async () => {
    await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: sel, clearKey: true }) });
    const d = await (await fetch("/api/settings")).json();
    setS(d);
    setF({ key: "" });
  };

  const cc = h.claudeCode;
  const stop = (e: React.KeyboardEvent) => e.stopPropagation();

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        {!s || !info ? (
          <div className="hint">Loading…</div>
        ) : (
          <>
            <div className="panel-title" style={{ margin: "0 0 4px", fontSize: 13 }}>AI assistant</div>
            <div className="hint" style={{ marginBottom: 10 }}>Pick the AI that edits your project from chat. Keys stay on this computer and are only sent to the service you pick.</div>
            <div className="ai-choices">
              {CHOICES.map(([id, label, pitch]) => {
                const p = s.providers[id];
                const ready = id === "claude-code" ? cc.found : !p.needsKey || p.hasKey || p.envKey;
                return (
                  <button key={id} className={`ai-choice ${sel === id ? "on" : ""}`} onClick={() => { setSel(id); setTest({ state: "idle" }); }}>
                    <b>{label}{s.provider === id && <span className="tag">in use</span>}{s.provider !== id && ready && id !== "ollama" && id !== "custom" && <span className="tag ok">ready</span>}</b>
                    <span>{pitch}</span>
                  </button>
                );
              })}
            </div>

            <div className="ai-detail">
              {sel === "claude-code" && (
                <div className="hint" style={{ marginBottom: 8 }}>
                  {!cc.found ? (
                    <span style={{ color: "var(--warn)" }}>
                      Claude Code isn't installed. Install it with <span className="kbd">npm i -g @anthropic-ai/claude-code</span>, then run <span className="kbd">claude</span> once to sign in.
                    </span>
                  ) : cc.loggedIn ? (
                    <span style={{ color: "var(--ok)" }}>✓ Claude Code is signed in{cc.account ? ` (${cc.account})` : ""}</span>
                  ) : (
                    <span>Claude Code found. If it isn't signed in yet, run <span className="kbd">claude</span> in a terminal and log in.</span>
                  )}
                </div>
              )}

              {info.needsKey && (
                <Field label="API key">
                  <input
                    type="password" autoComplete="off" spellCheck={false}
                    placeholder={info.hasKey ? info.key : info.envKey ? `Using ${info.env} from the environment` : "Paste your key"}
                    value={f.key} onChange={(e) => setF({ key: e.target.value })} onKeyDown={stop}
                  />
                  {info.hasKey && <button className="ghost icon" title="Remove the saved key" onClick={removeKey}>×</button>}
                </Field>
              )}
              {info.keyUrl && (
                <div className="hint" style={{ margin: "-2px 0 8px" }}>
                  No key yet? <a href={info.keyUrl} target="_blank" rel="noreferrer">Get one here ↗</a>
                </div>
              )}

              {(sel === "ollama" || sel === "custom") && (
                <>
                  <Field label="Address">
                    <input value={f.url} placeholder={sel === "custom" ? "https://api.example.com/v1" : "http://localhost:11434/v1"} onChange={(e) => setF({ url: e.target.value })} onKeyDown={stop} />
                  </Field>
                  {sel === "ollama" && (
                    <div className="hint" style={{ margin: "-2px 0 8px" }}>
                      Ollama: <span className="kbd">http://localhost:11434/v1</span> · LM Studio: <span className="kbd">http://localhost:1234/v1</span>. Get Ollama at <a href="https://ollama.com" target="_blank" rel="noreferrer">ollama.com ↗</a>
                    </div>
                  )}
                  {sel === "custom" && (
                    <Field label="API key">
                      <input type="password" autoComplete="off" placeholder={info.hasKey ? info.key : "Optional"} value={f.key} onChange={(e) => setF({ key: e.target.value })} onKeyDown={stop} />
                    </Field>
                  )}
                </>
              )}

              <Field label="Model">
                {sel === "claude-code" ? (
                  <select value={f.model} onChange={(e) => setF({ model: e.target.value })}>
                    {CLAUDE_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : (
                  <>
                    <input list={`models-${sel}`} value={f.model} placeholder={info.defaultModel || "model name"} onChange={(e) => setF({ model: e.target.value })} onKeyDown={stop} />
                    <datalist id={`models-${sel}`}>{(models[sel] ?? []).map((m) => <option key={m} value={m} />)}</datalist>
                    <button className="ghost icon" title="Load the list of models" onClick={() => loadModels().catch(() => setTest({ state: "fail", msg: "Could not load the model list — check the key or address." }))}>↻</button>
                  </>
                )}
              </Field>
              {sel !== "claude-code" && !!models[sel]?.length && <div className="hint" style={{ margin: "-2px 0 8px" }}>{models[sel]!.length} models available — click the field to choose.</div>}

              <div className="row" style={{ gap: 8, alignItems: "center" }}>
                <button onClick={runTest} disabled={test.state === "running"}>{test.state === "running" ? "Testing…" : "Test connection"}</button>
                {test.state === "ok" && <span className="hint" style={{ color: "var(--ok)" }}>✓ {test.msg}</span>}
                {test.state === "fail" && <span className="hint" style={{ color: "var(--warn)" }}>✗ {test.msg}</span>}
              </div>
            </div>

            <div className="panel-title" style={{ margin: "14px 0 4px", fontSize: 13 }}>Tools</div>
            <div className="hint" style={{ lineHeight: 1.9 }}>
              ffmpeg: {h.ffmpeg ? <span style={{ color: "var(--ok)" }}>✓ available</span> : <span style={{ color: "var(--warn)" }}>missing</span>}
              {"  ·  "}Whisper (auto subtitles): {h.whisper ? <span style={{ color: "var(--ok)" }}>✓ available</span> : <>not installed — <span className="kbd">pip install openai-whisper</span></>}
            </div>
            <div className="actions">
              <button className="primary" disabled={saving} onClick={save}>Use {CHOICES.find((c) => c[0] === sel)![1]}</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
