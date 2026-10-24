import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";

export type Provider = "claude-code" | "anthropic" | "openai" | "gemini" | "openrouter" | "ollama" | "custom";

export interface ProviderInfo {
  label: string;
  /** shown in the top bar */
  short: string;
  /** OpenAI-compatible endpoint (all providers except Claude) */
  baseUrl?: string;
  defaultModel: string;
  needsKey: boolean;
  /** where to get a key */
  keyUrl?: string;
  /** environment variable read when no key is saved */
  env?: string;
}

export const PROVIDERS: Record<Provider, ProviderInfo> = {
  "claude-code": { label: "Claude subscription (via Claude Code)", short: "Claude", defaultModel: "default", needsKey: false },
  anthropic: { label: "Anthropic (Claude) API", short: "Claude API", defaultModel: "claude-opus-5-5", needsKey: true, keyUrl: "https://console.anthropic.com/settings/keys", env: "ANTHROPIC_API_KEY" },
  openai: { label: "OpenAI (ChatGPT) API", short: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-5", needsKey: true, keyUrl: "https://platform.openai.com/api-keys", env: "OPENAI_API_KEY" },
  gemini: { label: "Google Gemini API", short: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", defaultModel: "gemini-2.5-flash", needsKey: true, keyUrl: "https://aistudio.google.com/apikey", env: "GEMINI_API_KEY" },
  openrouter: { label: "OpenRouter (hundreds of models)", short: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openrouter/auto", needsKey: true, keyUrl: "https://openrouter.ai/keys", env: "OPENROUTER_API_KEY" },
  ollama: { label: "Local model (Ollama / LM Studio)", short: "Local AI", baseUrl: "http://localhost:11434/v1", defaultModel: "llama3.1", needsKey: false },
  custom: { label: "Other OpenAI-compatible service", short: "Custom AI", baseUrl: "", defaultModel: "", needsKey: false },
};

export interface Config {
  provider: Provider;
  /** model alias for Claude Code ("default" | "opus" | "sonnet" | "haiku") */
  cliModel: string;
  keys: Partial<Record<Provider, string>>;
  models: Partial<Record<Provider, string>>;
  /** endpoint overrides (Ollama / LM Studio address, custom service) */
  urls: Partial<Record<Provider, string>>;
}

/** resolved lazily so the desktop app can point it at its userData folder before first use */
export const dataDir = () => process.env.NOMAD_DATA_DIR ?? path.join(os.homedir(), ".nomadmovie");
const configFile = () => path.join(dataDir(), "config.json");
/** settings saved under the app's earlier names (read once if there are no settings yet) */
const legacyConfigFiles = () => [path.join(os.homedir(), ".farid-editor", "config.json"), path.join(os.homedir(), ".nova-editor", "config.json")];

let cache: Config | null = null;

type Saved = Omit<Partial<Config>, "provider"> & { provider?: Provider | "api"; apiKey?: string; apiModel?: string };

export function getConfig(): Config {
  if (cache) return cache;
  let saved: Saved = {};
  for (const f of [configFile(), ...legacyConfigFiles()]) {
    try {
      saved = JSON.parse(fs.readFileSync(f, "utf8"));
      break;
    } catch {
      /* not there */
    }
  }
  // settings from before multi-provider support: provider "api" + one Anthropic key
  const keys = { ...saved.keys };
  const models = { ...saved.models };
  if (saved.apiKey && !keys.anthropic) keys.anthropic = saved.apiKey;
  if (saved.apiModel && !models.anthropic) models.anthropic = saved.apiModel;
  if (process.env.NOMAD_MODEL && !models.anthropic) models.anthropic = process.env.NOMAD_MODEL;
  const provider = saved.provider === "api" ? "anthropic" : saved.provider && saved.provider in PROVIDERS ? saved.provider : findClaude() ? "claude-code" : "anthropic";
  cache = { provider, cliModel: saved.cliModel ?? "default", keys, models, urls: { ...saved.urls } };
  return cache;
}

export function saveConfig(patch: Partial<Config>) {
  const cur = getConfig();
  cache = {
    ...cur,
    ...patch,
    keys: { ...cur.keys, ...patch.keys },
    models: { ...cur.models, ...patch.models },
    urls: { ...cur.urls, ...patch.urls },
  };
  for (const k of Object.keys(cache.keys) as Provider[]) if (!cache.keys[k]) delete cache.keys[k];
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cache, null, 2), { mode: 0o600 });
  return cache;
}

/** key for a provider: saved in settings, else from its environment variable */
export const keyFor = (p: Provider) => getConfig().keys[p] || (PROVIDERS[p].env ? process.env[PROVIDERS[p].env!] : "") || "";
export const modelFor = (p: Provider) => (p === "claude-code" ? getConfig().cliModel : getConfig().models[p] || PROVIDERS[p].defaultModel);
export const urlFor = (p: Provider) => (getConfig().urls[p] || PROVIDERS[p].baseUrl || "").replace(/\/+$/, "");

/* ---------------- Claude Code CLI discovery ---------------- */

let claudePath: string | null | undefined;

/** global npm bins of nvm-managed node versions (GUI apps don't inherit the shell PATH) */
function nvmBins(exe: string) {
  const root = path.join(os.homedir(), ".nvm", "versions", "node");
  try {
    return fs.readdirSync(root).sort().reverse().map((v) => path.join(root, v, "bin", exe));
  } catch {
    return [];
  }
}

let loginPath: string | undefined;

/**
 * The PATH of the user's login shell. Apps opened from Finder / the desktop start with a minimal PATH that doesn't
 * include nvm, Homebrew or ~/.local/bin, so without this we could pick up a different (or broken) `claude`, or
 * none at all, and a Node-based `claude` couldn't find `node`.
 */
function loginShellPath() {
  if (loginPath !== undefined) return loginPath;
  loginPath = "";
  if (process.platform === "win32") return loginPath;
  try {
    const shell = process.env.SHELL || os.userInfo().shell || "/bin/zsh";
    const out = execFileSync(shell, ["-ilc", 'printf "\n__NOMAD_PATH__%s" "$PATH"'], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] });
    loginPath = out.split("__NOMAD_PATH__").pop()?.trim() ?? "";
  } catch {
    /* no usable login shell: fall back to the usual locations */
  }
  return loginPath;
}

/** the user's PATH first (like in their terminal), then the app's own */
const searchPath = () => [...loginShellPath().split(path.delimiter), ...(process.env.PATH ?? "").split(path.delimiter)].filter(Boolean);

/** finds the `claude` the user's terminal would run, also when the app was opened from Finder / the desktop */
export function findClaude(): string | null {
  if (claudePath !== undefined) return claudePath;
  const exe = process.platform === "win32" ? "claude.cmd" : "claude";
  const candidates = [
    process.env.NOMAD_CLAUDE_PATH,
    ...searchPath().map((d) => path.join(d, exe)),
    path.join(os.homedir(), ".claude", "local", exe),
    path.join(os.homedir(), ".local", "bin", exe),
    ...nvmBins(exe),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ].filter(Boolean) as string[];
  claudePath = candidates.find((p) => fs.existsSync(p)) ?? null;
  return claudePath;
}

/** env for spawning claude: the user's PATH (so a Node-based claude finds `node`), and no API keys so it uses the user's claude.ai subscription login */
export function claudeEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const bin = findClaude();
  env.PATH = [...new Set([...(bin ? [path.dirname(bin)] : []), ...searchPath()])].join(path.delimiter);
  return env;
}

let statusCache: { at: number; value: { found: boolean; loggedIn: boolean; account?: string } } | null = null;

/** forget what we know about Claude Code (after installing it or signing in) */
export function resetClaudeCache() {
  claudePath = undefined;
  statusCache = null;
}

export function claudeStatus(): Promise<{ found: boolean; loggedIn: boolean; account?: string }> {
  if (statusCache && Date.now() - statusCache.at < 30_000) return Promise.resolve(statusCache.value);
  const bin = findClaude();
  if (!bin) return Promise.resolve({ found: false, loggedIn: false });
  return new Promise((resolve) => {
    execFile(bin, ["auth", "status"], { env: claudeEnv(), timeout: 15000 }, (err, stdout) => {
      let value = { found: true, loggedIn: false } as { found: boolean; loggedIn: boolean; account?: string };
      try {
        const j = JSON.parse(stdout);
        value = { found: true, loggedIn: !!j.loggedIn, account: j.email ?? j.account?.email ?? j.subscriptionType };
      } catch {
        value.loggedIn = !err;
      }
      statusCache = { at: Date.now(), value };
      resolve(value);
    });
  });
}
