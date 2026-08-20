import "./setup.js";
import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { config } from "../src/config.js";
import { listFiles, removeLocal } from "../src/files.js";
import { testRoot } from "./setup.js";

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
