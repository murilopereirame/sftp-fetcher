/**
 * The available files.
 *
 * This lists the files that this program has put in the local download root.
 * The web panel shows them, so you can see what Radarr can import.
 *
 * The half-done downloads live in ".incomplete". That folder is skipped.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export interface LocalFile {
  /** The path under the download root. */
  path: string;
  bytes: number;
  /** The last change time, in milliseconds. */
  modifiedAt: number;
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
