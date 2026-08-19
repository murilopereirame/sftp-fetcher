/**
 * The available files.
 *
 * This lists the files that this program has put in the local download root.
 * The web panel shows them, so you can see what Radarr can import.
 *
 * The half-done downloads live in ".incomplete". That folder is skipped.
 */
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export interface LocalFile {
  /** The path under the download root. */
  path: string;
  bytes: number;
  /** The last change time, in milliseconds. */
  modifiedAt: number;
}

/** The temporary folder for one job. The part files wait here between tries. */
export function incompleteDir(hash: string): string {
  return path.join(config.localRoot, ".incomplete", hash);
}

/** Remove the part files of one job. Used when the job ends. */
export async function removeIncomplete(hash: string): Promise<void> {
  await rm(incompleteDir(hash), { recursive: true, force: true });
}

/**
 * Delete a file or a folder under the download root. The path is relative to
 * the root, the way the history keeps it. A ".." cannot leave the root, so a
 * bad value deletes nothing. Returns true when something was deleted.
 */
export async function removeLocal(relative: string): Promise<boolean> {
  const clean = relative.replace(/^\/+|\/+$/g, "");
  if (clean === "") return false;

  const full = path.resolve(config.localRoot, clean);
  const root = path.resolve(config.localRoot);
  if (full !== root && !full.startsWith(root + path.sep)) return false;
  if (full === root) return false;

  try {
    await stat(full);
  } catch {
    // Radarr may have moved the file into the library already. Nothing to do.
    return false;
  }

  await rm(full, { recursive: true, force: true });
  return true;
}

/** All files under the download root, newest first. */
export async function listFiles(root = config.localRoot): Promise<LocalFile[]> {
  const files: LocalFile[] = [];
  await walk(root, root, files);
  files.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return files;
}

/** Walk one folder and all its subfolders. Add every file to the list. */
async function walk(root: string, dir: string, out: LocalFile[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // The folder may not exist yet. An empty list is fine.
    return;
  }

  for (const entry of entries) {
    // Skip the folder for the downloads that are still running.
    if (entry.name === ".incomplete") continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, full, out);
    } else if (entry.isFile()) {
      const info = await stat(full);
      out.push({
        path: path.relative(root, full),
        bytes: info.size,
        modifiedAt: info.mtimeMs,
      });
    }
  }
}
