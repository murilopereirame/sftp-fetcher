import "./setup.js";
import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { config } from "../src/config.js";
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

test("an import event for an unknown torrent changes nothing", async () => {
  const before_ = store.jobs().length;
  await post("/radarr", { eventType: "Download", downloadId: "2222222222" });
  assert.equal(store.jobs().length, before_);
});

test("the remove endpoint takes a torrent out of the queue", async () => {
  const hash = "abcdef0123456789abcdef0123456789abcdef01";
  await post("/radarr", {
    eventType: "Grab",
    downloadId: hash,
    release: { releaseTitle: "Stale.Release" },
  });
  assert.ok(store.jobs().some((j) => j.hash === hash));

  const response = await post("/api/remove", { hash });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ok: boolean };
  assert.equal(body.ok, true);

  assert.equal(store.jobs().some((j) => j.hash === hash), false);
  assert.ok(
    store.history().some((h) => h.hash === hash && h.status === "removed"),
  );
});

test("removing a torrent that is not in the queue gives 404", async () => {
  const response = await post("/api/remove", { hash: "1234567890abcdef" });
  assert.equal(response.status, 404);
});

test("an import event deletes the staged local copy", async () => {
  const hash = "ccddeeff00112233445566778899aabbccddeeff";
  const relative = path.join("movies", "Imported.2024", "film.mkv");
  const full = path.join(config.localRoot, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "movie data");
  // The worker would have recorded this. Set it up by hand for the test.
  await store.markDone(hash, { path: relative });

  // Radarr sends the infohash in upper case in the import webhook.
  const response = await post("/radarr", {
    eventType: "Download",
    downloadId: hash.toUpperCase(),
    movie: { title: "Imported" },
  });
  assert.equal(response.status, 200);

  await assert.rejects(stat(full), "the staged file is deleted");
  assert.ok(
    store.history().some((h) => h.hash === hash && h.status === "imported"),
  );
});

test("a Sonarr grab puts the torrent in the queue with the series title", async () => {
  const hash = "99887766554433221100ffeeddccbbaa99887766";
  const response = await post("/sonarr", {
    eventType: "Grab",
    downloadId: hash,
    series: { title: "Show" },
  });

  assert.equal(response.status, 200);
  const job = store.jobs().find((item) => item.hash === hash.toLowerCase());
  assert.ok(job, "the job is in the queue");
  assert.equal(job.title, "Show");
});

test("a Sonarr import deletes the staged local copy", async () => {
  const hash = "aabbccddeeff00112233445566778899aabbccdd";
  const relative = path.join("tv", "Show.S01E01", "episode.mkv");
  const full = path.join(config.localRoot, relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, "episode data");
  await store.markDone(hash, { path: relative });

  const response = await post("/sonarr", {
    eventType: "Download",
    downloadId: hash.toUpperCase(),
    series: { title: "Show" },
  });
  assert.equal(response.status, 200);

  await assert.rejects(stat(full), "the staged file is deleted");
  assert.ok(
    store.history().some((h) => h.hash === hash && h.status === "imported"),
  );
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

test("the settings endpoint returns the modes as octal text", async () => {
  const response = await fetch(`${base}/api/settings`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    chown: boolean;
    chmod: boolean;
    fileMode: string | null;
    dirMode: string | null;
  };
  assert.equal(typeof body.chown, "boolean");
  assert.equal(body.fileMode, "664");
  assert.equal(body.dirMode, "775");
});

test("posting settings changes them", async () => {
  const response = await post("/api/settings", {
    chmod: true,
    fileMode: "600",
    uid: "1000",
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    ok: boolean;
    settings: { chmod: boolean; fileMode: string; uid: number };
  };
  assert.equal(body.ok, true);
  assert.equal(body.settings.chmod, true);
  assert.equal(body.settings.fileMode, "600");
  assert.equal(body.settings.uid, 1000);

  // The store kept it.
  assert.equal(store.settings().fileMode, 0o600);
});

test("a bad mode is refused with 400", async () => {
  const response = await post("/api/settings", { fileMode: "999" });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { ok: boolean };
  assert.equal(body.ok, false);
});

test("the health check still answers on its own path", async () => {
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "healthy");
});
