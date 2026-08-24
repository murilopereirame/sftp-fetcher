import "./setup.js";
import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { config } from "../src/config.js";
import { listFiles, removeImported, removeLocal } from "../src/files.js";
import { testRoot } from "./setup.js";

const noExtras = { extraExtensions: [], removeEmptyFolders: true };

const root = path.join(testRoot, "files-test");

async function present(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

test("it lists the files and skips the .incomplete folder", async () => {
  await mkdir(path.join(root, "movies", "Film.2024"), { recursive: true });
  await mkdir(path.join(root, ".incomplete", "aabb"), { recursive: true });

  await writeFile(path.join(root, "movies", "Film.2024", "film.mkv"), "12345");
  await writeFile(path.join(root, ".incomplete", "aabb", "part.mkv"), "half");

  const files = await listFiles(root);

  assert.equal(files.length, 1);
  assert.equal(files[0]?.path, path.join("movies", "Film.2024", "film.mkv"));
  assert.equal(files[0]?.bytes, 5);
});

test("it returns an empty list for a folder that is not there", async () => {
  const files = await listFiles(path.join(testRoot, "nothing-here"));
  assert.deepEqual(files, []);
});

test("removeLocal deletes a file under the download root", async () => {
  const relative = path.join("movies", "Delete.Me", "film.mkv");
  const full = path.join(config.localRoot, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "data");

  assert.equal(await removeLocal(relative), true);
  assert.equal(await present(full), false);
});

test("removeLocal returns false when the file is not there", async () => {
  assert.equal(await removeLocal(path.join("movies", "Gone.mkv")), false);
});

test("removeLocal refuses a path that leaves the root", async () => {
  const escape = path.join(config.localRoot, "..", "escape.txt");
  await writeFile(escape, "keep me");

  assert.equal(await removeLocal("../escape.txt"), false);
  assert.equal(await present(escape), true);
});

test("removeLocal refuses the empty path and the root itself", async () => {
  assert.equal(await removeLocal(""), false);
  assert.equal(await removeLocal("/"), false);
});

test("removeImported matches by name even when two episodes share a size", async () => {
  // Two episodes of the same show, encoded the same way, often end up with
  // the exact same byte count. Size alone cannot tell them apart; the file
  // name Radarr/Sonarr reports can.
  const dir = path.join("tv", "SameSize.S01");
  const full = path.join(config.localRoot, dir);
  await mkdir(full, { recursive: true });
  const ep1 = path.join(full, "SameSize.S01E01.mkv");
  const ep2 = path.join(full, "SameSize.S01E02.mkv");
  await writeFile(ep1, "x".repeat(50));
  await writeFile(ep2, "y".repeat(50));

  const result = await removeImported(
    dir,
    { size: 50, name: "SameSize.S01E01.mkv" },
    noExtras,
  );

  assert.equal(result.action, "file");
  assert.equal(result.removed, path.join(dir, "SameSize.S01E01.mkv"));
  await assert.rejects(stat(ep1), "episode 1 is deleted");
  assert.ok(await stat(ep2), "episode 2, same size, stays");
});

test("removeImported falls back to size when no name is sent", async () => {
  const dir = path.join("tv", "OldApp.S01");
  const full = path.join(config.localRoot, dir);
  await mkdir(full, { recursive: true });
  const ep1 = path.join(full, "OldApp.S01E01.mkv");
  await writeFile(ep1, "x".repeat(30));

  const result = await removeImported(dir, { size: 30 }, noExtras);

  assert.equal(result.action, "tree", "the folder goes once no video is left");
  await assert.rejects(stat(full));
});

test("removeImported deletes the configured extra extensions alongside the import", async () => {
  const dir = path.join("tv", "Junk.S01");
  const full = path.join(config.localRoot, dir);
  await mkdir(full, { recursive: true });
  const ep1 = path.join(full, "Junk.S01E01.mkv");
  const ep2 = path.join(full, "Junk.S01E02.mkv");
  const nfo = path.join(full, "junk.nfo");
  const txt = path.join(full, "junk.txt");
  await writeFile(ep1, "x".repeat(11));
  await writeFile(ep2, "y".repeat(22));
  await writeFile(nfo, "info");
  await writeFile(txt, "notes");

  const result = await removeImported(dir, { size: 11 }, {
    extraExtensions: [".nfo", ".txt"],
    removeEmptyFolders: true,
  });

  assert.equal(result.action, "file");
  assert.equal(result.removed, path.join(dir, "Junk.S01E01.mkv"));
  assert.deepEqual(
    result.extra.sort(),
    [path.join(dir, "junk.nfo"), path.join(dir, "junk.txt")].sort(),
  );
  await assert.rejects(stat(nfo), "the nfo is gone too");
  await assert.rejects(stat(txt), "the txt is gone too");
  assert.ok(await stat(ep2), "the other episode stays");
  assert.ok(await stat(full), "the folder stays: a video is still due");
});

test("removeImported keeps an empty season folder when removeEmptyFolders is off", async () => {
  const dir = path.join("tv", "KeepFolder.S01");
  const full = path.join(config.localRoot, dir);
  await mkdir(full, { recursive: true });
  const ep1 = path.join(full, "KeepFolder.S01E01.mkv");
  await writeFile(ep1, "x".repeat(9));

  const result = await removeImported(dir, { size: 9 }, {
    extraExtensions: [],
    removeEmptyFolders: false,
  });

  assert.equal(result.action, "file");
  await assert.rejects(stat(ep1), "the imported episode is still deleted");
  assert.ok(await stat(full), "but the now-empty folder is kept");
});

test("removeImported cleanups for the same folder do not race each other", async () => {
  const dir = path.join("tv", "Concurrent.S01");
  const full = path.join(config.localRoot, dir);
  await mkdir(full, { recursive: true });
  const ep1 = path.join(full, "Concurrent.S01E01.mkv");
  const ep2 = path.join(full, "Concurrent.S01E02.mkv");
  await writeFile(ep1, "x".repeat(15));
  await writeFile(ep2, "y".repeat(25));

  // Both import webhooks arrive back to back, before either cleanup finishes.
  const [r1, r2] = await Promise.all([
    removeImported(dir, { size: 15, name: "Concurrent.S01E01.mkv" }, noExtras),
    removeImported(dir, { size: 25, name: "Concurrent.S01E02.mkv" }, noExtras),
  ]);

  const actions = [r1.action, r2.action].sort();
  // Whichever cleanup runs last sees an empty folder and removes the tree.
  assert.deepEqual(actions, ["file", "tree"]);
  await assert.rejects(stat(full), "the folder is gone: both episodes landed");
});
