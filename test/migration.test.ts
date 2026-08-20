import "./setup.js";
import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { config } from "../src/config.js";
import { Store } from "../src/store.js";

async function present(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

test("it imports the old JSON files into the database once", async () => {
  const dir = config.stateDir;
  await mkdir(dir, { recursive: true });

  await writeFile(
    path.join(dir, "queue.json"),
    JSON.stringify([{ hash: "aaaa", title: "Queued Film", addedAt: 1000 }]),
  );
  await writeFile(path.join(dir, "done.json"), JSON.stringify(["bbbb"]));
  await writeFile(
    path.join(dir, "history.json"),
    JSON.stringify([
      {
        hash: "bbbb",
        title: "Done Film",
        status: "downloaded",
        at: 2000,
        path: "movies/Done.Film",
        bytes: 4096,
      },
      { hash: "aaaa", title: "Queued Film", status: "grabbed", at: 1500 },
    ]),
  );

  const store = new Store();
  await store.load();

  // The queue came across.
  assert.equal(store.jobs().length, 1);
  assert.equal(store.jobs()[0]?.hash, "aaaa");

  // The done hash came across, and took its path from the history event, so a
  // later import can still find the local file.
  assert.equal(store.knows("bbbb"), true);
  assert.equal(store.donePath("bbbb"), "movies/Done.Film");

  // The history came across. It reads newest first (by insert order).
  const history = store.history();
  assert.equal(history.length, 2);
  assert.equal(history[0]?.status, "grabbed");
  assert.equal(history[1]?.path, "movies/Done.Film");

  // The old files are renamed, kept as a backup, and not read again.
  assert.equal(await present(path.join(dir, "queue.json")), false);
  assert.equal(await present(path.join(dir, "queue.json.imported")), true);
  assert.equal(await present(path.join(dir, "history.json.imported")), true);
});

test("a second start does not import again", async () => {
  // The database and the marker are already there from the first test.
  const store = new Store();
  await store.load();

  // Still one job, not two, and the history did not double.
  assert.equal(store.jobs().length, 1);
  assert.equal(store.history().length, 2);
});
