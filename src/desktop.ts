// Desktop-only features, provided by the app's preload script (electron/preload.ts). Undefined in a browser.
export interface UpdateInfo {
  state: "available" | "ready";
  version: string;
  url?: string;
}

interface DesktopBridge {
  platform: "darwin" | "win32" | "linux";
  pathForFile: (file: File) => string;
  onUpdate: (cb: (info: UpdateInfo) => void) => () => void;
  installUpdate: () => Promise<void>;
  defaultSavePath: (name: string) => Promise<string>;
  chooseSavePath: (suggested: string, ext: string) => Promise<string | null>;
  showInFolder: (file: string) => Promise<void>;
}

export const desktop = (window as unknown as { nomadDesktop?: DesktopBridge }).nomadDesktop;

// lets the stylesheet fit the top bar around the window buttons (see html[data-desktop] in styles.css)
if (desktop) document.documentElement.dataset.desktop = desktop.platform;
