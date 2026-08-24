import "./setup.js";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { ArrClient } from "../src/arr.js";

// A tiny stand-in for the Radarr/Sonarr API: one endpoint, /api/v3/queue.
let lastApiKey: string | null = null;
let queueBody: unknown = { records: [] };
let queueStatus = 200;

const fakeArr = http.createServer((request, response) => {
  lastApiKey = request.headers["x-api-key"] as string | undefined ?? null;
  if (request.url?.startsWith("/api/v3/queue")) {
    response.writeHead(queueStatus, { "Content-Type": "application/json" });
    response.end(typeof queueBody === "string" ? queueBody : JSON.stringify(queueBody));
    return;
  }
  response.writeHead(404);
  response.end();
});

let base = "";

before(async () => {
  await new Promise<void>((resolve) => fakeArr.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(fakeArr.address() as AddressInfo).port}`;
});

after(() => fakeArr.close());

test("active is false with no URL or no API key", () => {
  assert.equal(new ArrClient("Radarr", { url: "", apiKey: "" }).active, false);
  assert.equal(new ArrClient("Radarr", { url: base, apiKey: "" }).active, false);
  assert.equal(new ArrClient("Radarr", { url: "", apiKey: "key" }).active, false);
  assert.equal(new ArrClient("Radarr", { url: base, apiKey: "key" }).active, true);
});

test("queueHashes is null when the client is not active, with no request sent", async () => {
  lastApiKey = null;
  const client = new ArrClient("Radarr", { url: "", apiKey: "" });
  assert.equal(await client.queueHashes(), null);
  assert.equal(lastApiKey, null);
});

test("queueHashes reads the downloadId of every record, lower-cased, and sends the API key", async () => {
  queueStatus = 200;
  queueBody = {
    records: [
      { downloadId: "AABBCCDD00112233" },
      { downloadId: "eeff00112233aabb" },
      { notADownloadId: "ignored" },
    ],
  };
  const client = new ArrClient("Radarr", { url: base, apiKey: "test-key" });

  const hashes = await client.queueHashes();

  assert.ok(hashes !== null);
  assert.deepEqual(
    [...hashes].sort(),
    ["aabbccdd00112233", "eeff00112233aabb"],
  );
  assert.equal(lastApiKey, "test-key");
});

test("queueHashes is an empty set, not null, when the queue is empty", async () => {
  queueStatus = 200;
  queueBody = { records: [] };
  const client = new ArrClient("Radarr", { url: base, apiKey: "test-key" });

  const hashes = await client.queueHashes();

  assert.ok(hashes !== null);
  assert.equal(hashes.size, 0);
});

test("queueHashes is null on a non-200 status", async () => {
  queueStatus = 500;
  queueBody = "server error";
  const client = new ArrClient("Radarr", { url: base, apiKey: "test-key" });

  assert.equal(await client.queueHashes(), null);

  queueStatus = 200;
  queueBody = { records: [] };
});

test("queueHashes is null on bad JSON", async () => {
  queueStatus = 200;
  queueBody = "this is not json";
  const client = new ArrClient("Radarr", { url: base, apiKey: "test-key" });

  assert.equal(await client.queueHashes(), null);

  queueBody = { records: [] };
});

test("queueHashes is null when the server cannot be reached", async () => {
  const client = new ArrClient("Sonarr", { url: "http://127.0.0.1:1", apiKey: "test-key" });
  assert.equal(await client.queueHashes(), null);
});
