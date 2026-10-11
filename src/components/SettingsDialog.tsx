import { useEffect, useState } from "react";
import { health, loadHealth } from "../health";
import { useStore } from "../store";
import { Field, Select } from "./ui";

interface Settings {
  provider: "claude-code" | "api";
  cliModel: string;
  apiKey: string;
  apiModel: string;
  hasApiKey: boolean;
  envKey: boolean;
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const h = health();

  useEffect(() => {
    fetch("/api/settings").then((r) => r.json()).then(setS);
    loadHealth();
  }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: s.provider, cliModel: s.cliModel, apiModel: s.apiModel, ...(key ? { apiKey: key } : {}) }),
    });
    await loadHealth();
    setSaving(false);
    useStore.getState().notify("Settings saved", "ok");
    onClose();
  };

  const cc = h.claudeCode;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        {!s ? (
          <div className="hint">Loading…</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="panel-title" style={{ margin: 0, fontSize: 13 }}>AI provider</div>
            <label className={`provider ${s.provider === "claude-code" ? "on" : ""}`}>
              <input type="radio" checked={s.provider === "claude-code"} onChange={() => setS({ ...s, provider: "claude-code" })} />
              <div>
                <b>My Claude subscription (Pro / Max)</b>
                <div className="hint">
                  Runs through Claude Code on this computer using your claude.ai login — no API key, no extra cost.
                </div>
                <div className="hint" style={{ marginTop: 4 }}>
                  {!cc.found ? (
                    <span style={{ color: "var(--warn)" }}>Claude Code not found. Install it with <span className="kbd">npm i -g @anthropic-ai/claude-code</span>, then run <span className="kbd">claude</span> once to sign in.</span>
                  ) : cc.loggedIn ? (
                    <span style={{ color: "var(--ok)" }}>✓ Signed in{cc.account ? ` (${cc.account})` : ""}</span>
                  ) : s.provider === "claude-code" ? (
                    <span style={{ color: "var(--warn)" }}>Claude Code found but not signed in — run <span className="kbd">claude</span> in a terminal and log in.</span>
                  ) : (
                    <span>Claude Code found.</span>
                  )}
                </div>
              </div>
            </label>
            {s.provider === "claude-code" && (
              <Field label="Model">
                <Select
                  value={s.cliModel}
                  options={[["default", "Default for my plan"], ["opus", "Opus (most capable)"], ["sonnet", "Sonnet (faster)"], ["haiku", "Haiku (fastest)"]]}
                  onChange={(v) => setS({ ...s, cliModel: v })}
                />
              </Field>
            )}
            <label className={`provider ${s.provider === "api" ? "on" : ""}`}>
              <input type="radio" checked={s.provider === "api"} onChange={() => setS({ ...s, provider: "api" })} />
              <div>
                <b>Anthropic API key</b>
                <div className="hint">Pay-as-you-go via console.anthropic.com.</div>
              </div>
            </label>
            {s.provider === "api" && (
              <>
                <Field label="API key">
                  <input
                    type="password"
                    placeholder={s.hasApiKey ? s.apiKey : s.envKey ? "Using ANTHROPIC_API_KEY from environment" : "sk-ant-…"}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </Field>
                <Field label="Model">
                  <input value={s.apiModel} onChange={(e) => setS({ ...s, apiModel: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
                </Field>
              </>
            )}
            <div className="panel-title" style={{ margin: "6px 0 0", fontSize: 13 }}>Tools</div>
            <div className="hint" style={{ lineHeight: 1.9 }}>
              ffmpeg: {h.ffmpeg ? <span style={{ color: "var(--ok)" }}>✓ available</span> : <span style={{ color: "var(--warn)" }}>missing</span>}
              {"  ·  "}Whisper (auto subtitles): {h.whisper ? <span style={{ color: "var(--ok)" }}>✓ available</span> : <>not installed — <span className="kbd">pip install openai-whisper</span></>}
            </div>
            <div className="actions">
              <button className="primary" disabled={saving} onClick={save}>Save</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
