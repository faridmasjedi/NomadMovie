import type { MediaItem, Project } from "../types";
import { importFile } from "./media";

const DB = "nova-editor";
let dbp: Promise<IDBDatabase> | null = null;

function db() {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("kv");
      r.result.createObjectStore("media");
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((res, rej) => {
    const r = fn(d.transaction(store, mode).objectStore(store));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export const saveProject = (p: Project) => tx("kv", "readwrite", (s) => s.put(p, "project"));
export const loadProject = () => tx<Project | undefined>("kv", "readonly", (s) => s.get("project"));

export async function saveMedia(m: MediaItem) {
  if (!m.blob) return;
  await tx("media", "readwrite", (s) => s.put({ id: m.id, name: m.name, blob: m.blob }, m.id));
}
export const deleteMedia = (id: string) => tx("media", "readwrite", (s) => s.delete(id));

export async function loadAllMedia(onItem: (m: MediaItem) => void) {
  const all = await tx<{ id: string; name: string; blob: Blob }[]>("media", "readonly", (s) => s.getAll());
  for (const rec of all) {
    try {
      const m = await importFile(rec.blob, rec.id, rec.name);
      if (m) onItem(m);
    } catch (e) {
      console.warn("restore failed", rec.name, e);
    }
  }
}

export async function clearAll() {
  await tx("kv", "readwrite", (s) => s.clear());
  await tx("media", "readwrite", (s) => s.clear());
}
