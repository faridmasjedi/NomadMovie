import fs from "node:fs";

/**
 * Removes a temporary file or folder without ever throwing. On Windows a file that was just sent or read can stay
 * locked for a moment (ENOTEMPTY / EBUSY / EPERM), so removal is retried in the background, and given up quietly
 * if it still fails: the OS temp folder is cleaned eventually anyway.
 */
export function removeQuietly(p: string) {
  fs.promises.rm(p, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {
    setTimeout(() => fs.promises.rm(p, { recursive: true, force: true }).catch(() => {}), 60_000).unref();
  });
}
