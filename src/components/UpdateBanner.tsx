import { useEffect, useState } from "react";
import { desktop, type UpdateInfo } from "../desktop";

/** desktop app: tells the user about a new version (and restarts into it when it was downloaded automatically) */
export function UpdateBanner() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem("nomad-update-later") ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => desktop?.onUpdate(setInfo), []);
  if (!info || (info.state === "available" && hidden === info.version)) return null;
  const later = () => {
    setHidden(info.version);
    setInfo(null);
    try {
      localStorage.setItem("nomad-update-later", info.version);
    } catch {
      /* not remembered */
    }
  };
  return (
    <div className="update-banner">
      <span>
        {info.state === "ready" ? <>NomadMovie <b>{info.version}</b> is ready to install.</> : <>NomadMovie <b>{info.version}</b> is available.</>}
      </span>
      {info.state === "ready"
        ? <button className="primary" onClick={() => desktop?.installUpdate()}>Restart to update</button>
        : <button className="primary" onClick={() => window.open(info.url, "_blank")}>Download</button>}
      <button className="ghost" onClick={later}>Later</button>
    </div>
  );
}
