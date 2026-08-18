import "./setup.js";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { createServer } from "../src/server.js";
import { Store } from "../src/store.js";

const store = new Store();
const server = createServer(store);
let base = "";

before(async () => {
  await store.load();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

const post = (path: string, body: unknown): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("the health check answers", async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
});

test("a grab event puts the torrent in the queue", async () => {
  const hash = "AABBCCDDEEFF00112233445566778899AABBCCDD";
  const response = await post("/radarr", {
    eventType: "Grab",
    downloadId: hash,
    release: { releaseTitle: "Film.2024.1080p" },
  });

  assert.equal(response.status, 200);
  const job = store.jobs().find((item) => item.hash === hash.toLowerCase());
  assert.ok(job, "the job is in the queue");
  assert.equal(job.title, "Film.2024.1080p");
});

test("the same grab twice makes one job only", async () => {
  const hash = "1111111111111111111111111111111111111111";
  await post("/radarr", { eventType: "Grab", downloadId: hash });
  await post("/radarr", { eventType: "Grab", downloadId: hash });

  const found = store.jobs().filter((item) => item.hash === hash);
  assert.equal(found.length, 1);
});

test("the test event changes nothing", async () => {
  const before_ = store.jobs().length;
  const response = await post("/radarr", { eventType: "Test" });
  assert.equal(response.status, 200);
  assert.equal(store.jobs().length, before_);
});

test("an import event changes nothing", async () => {
  const before_ = store.jobs().length;
  await post("/radarr", { eventType: "Download", downloadId: "2222222222" });
  assert.equal(store.jobs().length, before_);
});

test("a grab without a downloadId changes nothing", async () => {
  const before_ = store.jobs().length;
  const response = await post("/radarr", { eventType: "Grab" });
  assert.equal(response.status, 200);
  assert.equal(store.jobs().length, before_);
});

test("bad JSON gives the status 400", async () => {
  const response = await post("/radarr", "this is not json");
  assert.equal(response.status, 400);
});

test("another path gives the status 404", async () => {
  const response = await post("/other", { eventType: "Grab" });
  assert.equal(response.status, 404);
});

test("the status endpoint shows the queue", async () => {
  const response = await fetch(`${base}/status`);
  assert.equal(response.status, 200);

  const body = (await response.json()) as { queue: unknown[]; download: unknown };
  assert.ok(Array.isArray(body.queue));
  assert.equal(body.download, null);
});

test("the root path serves the web panel", async () => {
  const response = await fetch(`${base}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  const text = await response.text();
  assert.match(text, /<title>sftp-fetcher<\/title>/);
});

test("the api status endpoint has raw numbers and counts", async () => {
  const response = await fetch(`${base}/api/status`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    queue: unknown[];
    download: unknown;
    counts: { queue: number; history: number };
  };
  assert.ok(Array.isArray(body.queue));
  assert.equal(typeof body.counts.queue, "number");
  assert.equal(typeof body.counts.history, "number");
});

test("the api history endpoint returns an array", async () => {
  const response = await fetch(`${base}/api/history`);
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(await response.json()));
});

test("the api files endpoint returns the root and a file list", async () => {
  const response = await fetch(`${base}/api/files`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { root: string; files: unknown[] };
  assert.equal(typeof body.root, "string");
  assert.ok(Array.isArray(body.files));
});

test("the api activity endpoint returns an array", async () => {
  const response = await fetch(`${base}/api/activity`);
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(await response.json()));
});

test("the health check still answers on its own path", async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "healthy");
});
