import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Store } from "../src/store.js";

test("it keeps a job and finds it again after a restart", async () => {
  const store = new Store();
  await store.load();

  await store.add({ hash: "aaaa", title: "Film A", addedAt: Date.now() });
  assert.equal(store.jobs().length, 1);
  assert.equal(store.knows("aaaa"), true);
  assert.equal(store.knows("bbbb"), false);

  // A new object reads the same files. This is the restart.
  const second = new Store();
  await second.load();
  assert.equal(second.jobs()[0]?.title, "Film A");
});

test("a finished job leaves the queue but stays known", async () => {
  const store = new Store();
  await store.load();

  await store.add({ hash: "cccc", title: "Film C", addedAt: Date.now() });
  await store.markDone("cccc");

  assert.equal(store.jobs().some((job) => job.hash === "cccc"), false);
  assert.equal(store.knows("cccc"), true);
});

test("remove takes the job out without the done mark", async () => {
  const store = new Store();
  await store.load();

  await store.add({ hash: "dddd", title: "Film D", addedAt: Date.now() });
  await store.remove("dddd");

  assert.equal(store.jobs().some((job) => job.hash === "dddd"), false);
  assert.equal(store.knows("dddd"), false);
});

test("markDone keeps the local path for a later import cleanup", async () => {
  const store = new Store();
  await store.load();

  await store.add({ hash: "ffff", title: "Film F", addedAt: Date.now() });
  await store.markDone("ffff", { path: "movies/Film.F", bytes: 2048 });

  assert.equal(store.jobs().some((job) => job.hash === "ffff"), false);
  assert.equal(store.knows("ffff"), true);
  assert.equal(store.donePath("ffff"), "movies/Film.F");
  assert.equal(store.donePath("nope"), null);
});

test("the settings have sensible defaults and survive a restart", async () => {
  const store = new Store();
  await store.load();

  const start = store.settings();
  assert.equal(start.chown, false);
  assert.equal(start.chmod, false);
  assert.equal(start.uid, null);
  assert.equal(start.fileMode, 0o664);
  assert.equal(start.dirMode, 0o775);

  const saved = store.saveSettings({ chmod: true, fileMode: 0o600, uid: 1000 });
  assert.equal(saved.chmod, true);
  assert.equal(saved.fileMode, 0o600);
  assert.equal(saved.uid, 1000);
  // A field that was not sent keeps its value.
  assert.equal(saved.dirMode, 0o775);

  const second = new Store();
  await second.load();
  assert.equal(second.settings().fileMode, 0o600);
  assert.equal(second.settings().uid, 1000);
});

test("the history keeps events and returns the newest first", async () => {
  const store = new Store();
  await store.load();

  await store.record({ hash: "eeee", title: "Film E", status: "grabbed", at: 1 });
  await store.record({
    hash: "eeee",
    title: "Film E",
    status: "downloaded",
    at: 2,
    path: "movies/Film.E",
    bytes: 1024,
  });

  const list = store.history();
  assert.equal(list[0]?.status, "downloaded");
  assert.equal(list[0]?.bytes, 1024);
  assert.equal(list[1]?.status, "grabbed");

  // A new object reads the same file. The history survives a restart.
  const second = new Store();
  await second.load();
  assert.equal(second.history().length, list.length);
  assert.equal(second.history()[0]?.path, "movies/Film.E");
});
