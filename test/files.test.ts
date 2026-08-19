import "./setup.js";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { listFiles } from "../src/files.js";
import { testRoot } from "./setup.js";

const root = path.join(testRoot, "files-test");

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
