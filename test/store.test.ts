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
