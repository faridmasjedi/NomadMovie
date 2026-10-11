import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";

export type Provider = "claude-code" | "api";

export interface Config {
  provider: Provider;
  /** model alias for Claude Code ("default" | "opus" | "sonnet" | "haiku") */
  cliModel: string;
  apiKey: string;
  apiModel: string;
}

/** resolved lazily so the desktop app can point it at its userData folder before first use */
const dataDir = () => process.env.NOVA_DATA_DIR ?? path.join(os.homedir(), ".nova-editor");
const configFile = () => path.join(dataDir(), "config.json");

let cache: Config | null = null;

export function getConfig(): Config {
  if (cache) return cache;
  let saved: Partial<Config> = {};
  try {
    saved = JSON.parse(fs.readFileSync(configFile(), "utf8"));
  } catch {
    /* first run */
  }
  cache = {
    provider: saved.provider ?? (findClaude() ? "claude-code" : "api"),
    cliModel: saved.cliModel ?? "default",
    apiKey: saved.apiKey ?? "",
    apiModel: saved.apiModel ?? process.env.NOVA_MODEL ?? "claude-opus-5-5",
  };
  return cache;
}

export function saveConfig(patch: Partial<Config>) {
  cache = { ...getConfig(), ...patch };
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cache, null, 2), { mode: 0o600 });
  return cache;
}

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

/** finds the `claude` binary, also when launched from a GUI app that has a minimal PATH */
export function findClaude(): string | null {
  if (claudePath !== undefined) return claudePath;
  const exe = process.platform === "win32" ? "claude.cmd" : "claude";
  const candidates = [
    process.env.NOVA_CLAUDE_PATH,
    ...(process.env.PATH ?? "").split(path.delimiter).map((d) => path.join(d, exe)),
    path.join(os.homedir(), ".claude", "local", exe),
    path.join(os.homedir(), ".local", "bin", exe),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    ...nvmBins(exe),
  ].filter(Boolean) as string[];
  claudePath = candidates.find((p) => fs.existsSync(p)) ?? null;
  if (!claudePath && process.platform !== "win32") {
    // ask the user's login shell (covers nvm / custom PATH setups)
    try {
      const shell = process.env.SHELL || "/bin/zsh";
      const out = execFileSync(shell, ["-ilc", "command -v claude"], { encoding: "utf8", timeout: 8000 }).trim().split("\n").pop();
      if (out && fs.existsSync(out)) claudePath = out;
    } catch {
      /* not installed */
    }
  }
  return claudePath;
}

/** env for spawning claude: drop API keys so it uses the user's claude.ai subscription login */
export function claudeEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  const bin = findClaude();
  if (bin) env.PATH = `${path.dirname(bin)}${path.delimiter}${env.PATH ?? ""}`; // node for nvm installs
  return env;
}

let statusCache: { at: number; value: { found: boolean; loggedIn: boolean; account?: string } } | null = null;

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
