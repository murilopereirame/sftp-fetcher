import "./setup.js";
import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { applyPermissions } from "../src/permissions.js";
import type { Settings } from "../src/store.js";
import { testRoot } from "./setup.js";

const root = path.join(testRoot, "perm-test");

const off: Settings = {
  chown: false,
  uid: null,
  gid: null,
  chmod: false,
  fileMode: null,
  dirMode: null,
};

test("chmod sets the mode of the folder and the files under it", async () => {
  const dir = path.join(root, "movie");
  const file = path.join(dir, "film.mkv");
  await mkdir(dir, { recursive: true });
  await writeFile(file, "data");

  await applyPermissions(dir, {
    ...off,
    chmod: true,
    fileMode: 0o640,
    dirMode: 0o750,
  });

  assert.equal((await stat(file)).mode & 0o777, 0o640);
  assert.equal((await stat(dir)).mode & 0o777, 0o750);
});

test("nothing changes when both chown and chmod are off", async () => {
  const file = path.join(root, "left-alone.mkv");
  await writeFile(file, "data");
  const before = (await stat(file)).mode & 0o777;

  // chmod is off, so the mode value is ignored.
  await applyPermissions(file, { ...off, fileMode: 0o600 });

  assert.equal((await stat(file)).mode & 0o777, before);
});
