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
  /** The path of the imported file that was removed, relative to the root. */
  removed: string | null;
  /** Any extra junk files removed alongside it, relative to the root. */
  extra: string[];
}

/** What the webhook says about the file it just imported. */
export interface ImportedFile {
  /** movieFile.size or episodeFile.size. */
  size?: number;
  /**
   * movieFile.relativePath (or .path) / episodeFile.relativePath (or .path).
   * Matched by file name. This is the strong match: two files never share a
   * name. Two episodes of the same show, on the other hand, often share the
   * exact same byte count (the same codec and bitrate target), so size alone
   * can fail to tell them apart. Name is tried first; size is the fallback
   * for an old Radarr or Sonarr that sends no path.
   */
  name?: string;
}

/** Preferences for the cleanup that runs after an import. See Settings. */
export interface CleanupOptions {
  /** Extra extensions (with the dot, e.g. ".nfo") removed with the import. */
  extraExtensions: string[];
  /** Delete the folder once nothing but the cleaned-up junk is left in it. */
  removeEmptyFolders: boolean;
}

/**
 * Two import webhooks for the same season pack can arrive within milliseconds
 * of each other. Without this, both could list the folder before either one
 * deletes anything, and each would then judge "is a video still left" from a
 * stale, shared snapshot. Cleanups run one at a time, so every call sees the
 * result of the one before it.
 */
let cleanupChain: Promise<unknown> = Promise.resolve();

function serialized<T>(task: () => Promise<T>): Promise<T> {
  const run = cleanupChain.then(task, task);
  cleanupChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Clean up after an import. `relative` is the staged path this program made.
 *
 * A single file is deleted, the way this program always did. A folder is a
 * season pack: Radarr and Sonarr import one file at a time and send one
 * webhook each, so the whole folder must NOT go on the first import, or the
 * episodes that still wait are lost. Only the one imported file is deleted
 * here, matched by name first (it cannot collide) and by size as a fallback
 * for an old Radarr or Sonarr that sends no path. If neither matches exactly
 * one staged file, nothing is deleted, so a wrong episode is never lost.
 *
 * `extraExtensions` removes junk (an .nfo, a sample, a subtitle) alongside
 * the imported file, on every import, not only the last one. The folder
 * itself goes once no video file is left in it, and only when
 * `removeEmptyFolders` is on; the samples and the subtitles go with it.
 */
export function removeImported(
  relative: string,
  imported: ImportedFile,
  options: CleanupOptions,
): Promise<ImportCleanup> {
  return serialized(() => removeImportedNow(relative, imported, options));
}

async function removeImportedNow(
  relative: string,
  imported: ImportedFile,
  options: CleanupOptions,
): Promise<ImportCleanup> {
  const full = safeFull(relative);
  if (full === null) return { action: "kept", removed: null, extra: [] };

  let info;
  try {
    info = await stat(full);
  } catch {
    return { action: "gone", removed: null, extra: [] };
  }

  if (info.isFile()) {
    await rm(full, { force: true });
    return { action: "file", removed: relative, extra: [] };
  }
  if (!info.isDirectory()) return { action: "kept", removed: null, extra: [] };

  const files: { full: string; bytes: number }[] = [];
  await walkSizes(full, files);

  let matchedFull: string | null = null;
  if (imported.name !== undefined && imported.name !== "") {
    const wanted = path.basename(imported.name).toLowerCase();
    const matches = files.filter((f) => path.basename(f.full).toLowerCase() === wanted);
    const first = matches[0];
    if (matches.length === 1 && first !== undefined) matchedFull = first.full;
  }
  if (matchedFull === null && imported.size !== undefined && imported.size > 0) {
    const matches = files.filter((f) => f.bytes === imported.size);
    const first = matches[0];
    if (matches.length === 1 && first !== undefined) matchedFull = first.full;
  }
  if (matchedFull !== null) await rm(matchedFull, { force: true });

  // Extra junk, by extension. Runs every time, so a pack is tidy as it goes.
  const extraFull: string[] = [];
  for (const f of files) {
    if (f.full === matchedFull) continue;
    if (!options.extraExtensions.includes(path.extname(f.full).toLowerCase())) continue;
    await rm(f.full, { force: true });
    extraFull.push(f.full);
  }

  if (matchedFull === null && extraFull.length === 0) {
    return { action: "kept", removed: null, extra: [] };
  }

  // Nothing left to import? Then the whole folder can go, if allowed to.
  const removedSet = new Set([matchedFull, ...extraFull]);
  const videoLeft = files.some((f) => !removedSet.has(f.full) && isVideo(f.full));
  if (!videoLeft && options.removeEmptyFolders) {
    await rm(full, { recursive: true, force: true });
    return { action: "tree", removed: relative, extra: [] };
  }

  const extra = extraFull.map((f) => path.relative(config.localRoot, f));
  if (matchedFull === null) {
    // Only junk matched. Report it as the removal, so the caller has something
    // to log; there is no imported file to point at.
    return { action: "file", removed: extra[0] ?? null, extra: extra.slice(1) };
  }
  return { action: "file", removed: path.relative(config.localRoot, matchedFull), extra };
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
