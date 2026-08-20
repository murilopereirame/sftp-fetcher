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
 * The absolute path for a path under the download root, or null when the value
 * is empty or would leave the root. A ".." can then never delete outside.
 */
function safeFull(relative: string): string | null {
  const clean = relative.replace(/^\/+|\/+$/g, "");
  if (clean === "") return null;

  const full = path.resolve(config.localRoot, clean);
  const root = path.resolve(config.localRoot);
  if (full === root) return null;
  if (!full.startsWith(root + path.sep)) return null;
  return full;
}

/**
 * Delete a file or a folder under the download root. The path is relative to
 * the root, the way the history keeps it. A ".." cannot leave the root, so a
 * bad value deletes nothing. Returns true when something was deleted.
 */
export async function removeLocal(relative: string): Promise<boolean> {
  const full = safeFull(relative);
  if (full === null) return false;

  try {
    await stat(full);
  } catch {
    // Radarr may have moved the file into the library already. Nothing to do.
    return false;
  }

  await rm(full, { recursive: true, force: true });
  return true;
}

/** The video file extensions. A folder with none left is fully imported. */
const VIDEO_EXTENSIONS = new Set([
  ".mkv", ".mp4", ".avi", ".m4v", ".ts", ".m2ts", ".mov",
  ".wmv", ".mpg", ".mpeg", ".flv", ".webm",
]);

function isVideo(name: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/** Every file under a folder, with its size. Subfolders are walked too. */
async function walkSizes(dir: string, out: { full: string; bytes: number }[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkSizes(full, out);
    } else if (entry.isFile()) {
      const info = await stat(full);
      out.push({ full, bytes: info.size });
    }
  }
}

/** What removeImported did, for the log line and the history. */
export interface ImportCleanup {
  /**
   *   "file"  one file was deleted (a single-file torrent, or one episode).
   *   "tree"  the whole staged folder was deleted (nothing left to import).
   *   "kept"  the file could not be matched, so the folder was left as it is.
   *   "gone"  the staged copy was already gone.
   */
  action: "file" | "tree" | "kept" | "gone";
  /** The path that was removed, relative to the root. */
  removed: string | null;
}

/**
 * Clean up after an import. `relative` is the staged path this program made.
 *
 * A single file is deleted, the way this program always did. A folder is a
 * season pack: Radarr and Sonarr import one file at a time and send one webhook
 * each, so the whole folder must NOT go on the first import, or the episodes
 * that still wait are lost. Only the one imported file is deleted here. The
 * `size` is the link: the import copies the file byte for byte, so exactly one
 * staged file has that size. If none or two share it, nothing is deleted, so a
 * wrong episode is never lost. The folder itself goes only once no video file
 * is left, which takes the samples and the subtitles with it.
 *
 * (An old Radarr or Sonarr sends no size. Then a pack file cannot be matched,
 * so the folder is kept until every video is gone. The disk is not freed, but
 * nothing is lost.)
 */
export async function removeImported(
  relative: string,
  size: number | undefined,
): Promise<ImportCleanup> {
  const full = safeFull(relative);
  if (full === null) return { action: "kept", removed: null };

  let info;
  try {
    info = await stat(full);
  } catch {
    return { action: "gone", removed: null };
  }

  if (info.isFile()) {
    await rm(full, { force: true });
    return { action: "file", removed: relative };
  }
  if (!info.isDirectory()) return { action: "kept", removed: null };

  const files: { full: string; bytes: number }[] = [];
  await walkSizes(full, files);

  let removedFull: string | null = null;
  if (size !== undefined && size > 0) {
    const matches = files.filter((f) => f.bytes === size);
    const first = matches[0];
    if (matches.length === 1 && first !== undefined) {
      await rm(first.full, { force: true });
      removedFull = first.full;
    }
  }

  // Nothing left to import? Then the whole folder can go.
  const videoLeft = files.some((f) => f.full !== removedFull && isVideo(f.full));
  if (!videoLeft) {
    await rm(full, { recursive: true, force: true });
    return { action: "tree", removed: relative };
  }

  if (removedFull === null) return { action: "kept", removed: null };
  return { action: "file", removed: path.relative(config.localRoot, removedFull) };
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
