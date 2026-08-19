/**
 * File permissions after a download.
 *
 * Radarr imports a film by moving or copying the file, as its own user. Two
 * things can stop it:
 *
 *   - The owner is wrong. If this program runs as root and Radarr runs as
 *     another user, Radarr cannot touch the file. `chown` fixes the owner.
 *   - The mode is wrong. If the two share a group but the file is not
 *     group-writable, the move fails. `chmod` fixes the mode.
 *
 * Both are off by default and are set in the web panel. The preferences live
 * in the database (see Settings in store.ts). This walks the finished file,
 * and every file and folder under it, and applies the ones that are on.
 *
 * A chown needs root. If it cannot, the error is logged once and the file is
 * left as it is; the download itself is already safe on disk.
 */
import { chmod, chown, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { errorText, log } from "./log.js";
import type { Settings } from "./store.js";

/** True when at least one of chown or chmod would do something. */
function active(s: Settings): boolean {
  const chown = s.chown && (s.uid !== null || s.gid !== null);
  const chmod = s.chmod && (s.fileMode !== null || s.dirMode !== null);
  return chown || chmod;
}

/** Apply the settings to `target` and everything under it. */
export async function applyPermissions(
  target: string,
  s: Settings,
): Promise<void> {
  if (!active(s)) return;

  try {
    await walk(target, s);
  } catch (error) {
    log(`Could not set the permissions of '${target}': ${errorText(error)}`);
  }
}

async function walk(target: string, s: Settings): Promise<void> {
  const info = await stat(target);
  const isDir = info.isDirectory();

  // chown takes -1 for "no change", so a null UID or GID is left as it is.
  if (s.chown && (s.uid !== null || s.gid !== null)) {
    await chown(target, s.uid ?? -1, s.gid ?? -1);
  }

  if (s.chmod) {
    const mode = isDir ? s.dirMode : s.fileMode;
    if (mode !== null) await chmod(target, mode);
  }

  if (isDir) {
    const entries = await readdir(target, { withFileTypes: true });
    for (const entry of entries) {
      await walk(path.join(target, entry.name), s);
    }
  }
}
