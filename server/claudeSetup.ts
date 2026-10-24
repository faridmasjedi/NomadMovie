import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { claudeEnv, findClaude, resetClaudeCache } from "./config.ts";

/*
 * Sets up the "Claude subscription" option from inside the app, so nobody needs a terminal:
 * installs Claude Code with Anthropic's official installer and runs its browser sign-in.
 */

export interface SetupState {
  step: "idle" | "installing" | "signing-in" | "done" | "error";
  /** sign-in page, in case the browser didn't open by itself */
  url?: string;
  /** the sign-in page may show a code to paste back */
  needsCode?: boolean;
  error?: string;
  log?: string;
}

let state: SetupState = { step: "idle" };
let proc: ChildProcessWithoutNullStreams | null = null;

export const setupState = () => state;

/** the last thing the tool printed, shown with an error so the reason is visible */
const lastLine = (log?: string) => {
  const l = (log ?? "").replace(/\x1b\[[0-9;]*m/g, "").trim().split("\n").pop()?.trim();
  return l ? ` (${l.slice(0, 200)})` : "";
};

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, onOutput: (all: string) => void) {
  return new Promise<number>((resolve, reject) => {
    const p = spawn(cmd, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    proc = p;
    let all = "";
    const add = (d: Buffer) => {
      all = (all + d.toString()).slice(-8000);
      onOutput(all);
    };
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    p.on("error", reject);
    p.on("close", (code) => {
      proc = null;
      resolve(code ?? 1);
    });
  });
}

/** installs Claude Code (official installer, into the user's home folder — no admin rights needed) */
export async function installClaude() {
  if (state.step === "installing" || state.step === "signing-in") return state;
  state = { step: "installing" };
  const win = process.platform === "win32";
  const [cmd, args] = win
    ? ["powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "irm https://claude.ai/install.ps1 | iex"]]
    : ["/bin/bash", ["-c", "curl -fsSL https://claude.ai/install.sh | bash"]];
  run(cmd, args as string[], { ...process.env }, (log) => (state = { ...state, log }))
    .then((code) => {
      resetClaudeCache();
      if (state.step !== "installing") return; // cancelled
      state = code === 0 && findClaude() ? { step: "idle" } : { step: "error", error: `Installing Claude Code failed.${lastLine(state.log)}`, log: state.log };
    })
    .catch((e) => (state = { step: "error", error: `Could not run the installer: ${e instanceof Error ? e.message : e}` }));
  return state;
}

/** starts the browser sign-in to the user's Claude account */
export async function startLogin() {
  const bin = findClaude();
  if (!bin) return (state = { step: "error", error: "Claude Code isn't installed yet." });
  if (state.step === "signing-in") return state;
  state = { step: "signing-in" };
  run(bin, ["auth", "login", "--claudeai"], claudeEnv(), (log) => {
    const url = /https:\/\/\S+oauth\S+/.exec(log)?.[0];
    state = { ...state, log, url: url ?? state.url, needsCode: /paste code/i.test(log) };
  })
    .then((code) => {
      resetClaudeCache();
      if (state.step !== "signing-in") return; // cancelled
      state = code === 0 ? { step: "done" } : { step: "error", error: `Sign-in didn't finish. Try again.${lastLine(state.log)}`, log: state.log };
    })
    .catch((e) => (state = { step: "error", error: `Could not start the sign-in: ${e instanceof Error ? e.message : e}` }));
  // give it a moment to print the sign-in link
  await new Promise((r) => setTimeout(r, 1500));
  return state;
}

/** the code shown on the sign-in page, when the browser couldn't hand it back automatically */
export function submitCode(code: string) {
  if (!proc || state.step !== "signing-in") return false;
  proc.stdin.write(`${code.trim()}\n`);
  return true;
}

export function cancelSetup() {
  state = { step: "idle" };
  proc?.kill();
  proc = null;
}
