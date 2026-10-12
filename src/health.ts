import { create } from "zustand";

interface Health {
  ai: boolean;
  provider: string;
  providerLabel: string;
  model: string;
  claudeCode: { found: boolean; loggedIn: boolean; account?: string };
  ffmpeg: boolean;
  whisper: boolean;
  server: boolean;
}

const useHealth = create<Health>(() => ({
  ai: false,
  provider: "claude-code",
  providerLabel: "",
  model: "",
  claudeCode: { found: false, loggedIn: false },
  ffmpeg: false,
  whisper: false,
  server: false,
}));

export async function loadHealth() {
  try {
    const r = await fetch("/api/health");
    useHealth.setState({ ...(await r.json()), server: true });
  } catch {
    useHealth.setState({ server: false });
  }
}

/** hook */
export const health = () => useHealth();
export const getHealth = () => useHealth.getState();
