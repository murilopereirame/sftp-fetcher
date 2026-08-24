import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ArrQueueSource } from "../src/arr.js";
import { Store } from "../src/store.js";
import { Worker } from "../src/worker.js";

/** A fake *arr client. `hashes` is what queueHashes() answers; null means
 *  "the check failed", the same as the real client on a network error. */
class FakeArr implements ArrQueueSource {
  calls = 0;

  constructor(
    public active: boolean,
    private readonly hashes: Set<string> | null,
  ) {}

  async queueHashes(): Promise<Set<string> | null> {
    this.calls += 1;
    return this.hashes;
  }
}

/** A well-aged job: past the grace period, so it is eligible to be checked. */
const OLD = Date.now() - 5 * 60_000;

async function newStore(): Promise<Store> {
  const store = new Store();
  await store.load();
  return store;
}

test("checkArrQueues does nothing when neither *arr is configured", async () => {
  const store = await newStore();
  await store.add({ hash: "cq-a1", title: "A", addedAt: OLD, source: "Radarr" });

  const radarr = new FakeArr(false, new Set());
  const sonarr = new FakeArr(false, new Set());
  const worker = new Worker(store, undefined, radarr, sonarr);

  await worker.checkArrQueues();

  assert.equal(radarr.calls, 0);
  assert.equal(sonarr.calls, 0);
  assert.equal(store.jobs().find((j) => j.hash === "cq-a1")?.flaggedAt, null);
});

test("checkArrQueues flags a Radarr job missing from Radarr's queue", async () => {
  const store = await newStore();
  await store.add({ hash: "cq-b2", title: "B", addedAt: OLD, source: "Radarr" });

  const radarr = new FakeArr(true, new Set(["zzzz"]));
  const sonarr = new FakeArr(false, new Set());
  const worker = new Worker(store, undefined, radarr, sonarr);

  await worker.checkArrQueues();

  const job = store.jobs().find((j) => j.hash === "cq-b2");
  assert.notEqual(job?.flaggedAt, null);
});

test("checkArrQueues leaves a Radarr job alone when it is in Radarr's queue", async () => {
  const store = await newStore();
  await store.add({ hash: "cq-c3", title: "C", addedAt: OLD, source: "Radarr" });

  const radarr = new FakeArr(true, new Set(["cq-c3"]));
  const worker = new Worker(store, undefined, radarr, new FakeArr(false, new Set()));

  await worker.checkArrQueues();

  assert.equal(store.jobs().find((j) => j.hash === "cq-c3")?.flaggedAt, null);
});

test("checkArrQueues checks a Sonarr job against Sonarr's queue, not Radarr's", async () => {
  const store = await newStore();
  await store.add({ hash: "cq-d4", title: "D", addedAt: OLD, source: "Sonarr" });

  // Radarr says it is missing; Sonarr (the right app for this job) says it
  // is there. The job must come out unflagged: Sonarr's answer is the one
  // that counts.
  const radarr = new FakeArr(true, new Set());
  const sonarr = new FakeArr(true, new Set(["cq-d4"]));
  const worker = new Worker(store, undefined, radarr, sonarr);

  await worker.checkArrQueues();

  assert.equal(store.jobs().find((j) => j.hash === "cq-d4")?.flaggedAt, null);
  assert.equal(radarr.calls, 1, "Radarr's queue is still fetched (Sonarr jobs may be mixed with Radarr ones)");
});

test("checkArrQueues clears an existing flag once the job reappears", async () => {
  const store = await newStore();
  await store.add({ hash: "cq-e5", title: "E", addedAt: OLD, source: "Radarr" });
  await store.setFlag("cq-e5", Date.now() - 60_000);

  const radarr = new FakeArr(true, new Set(["cq-e5"]));
  const worker = new Worker(store, undefined, radarr, new FakeArr(false, new Set()));

  await worker.checkArrQueues();

  assert.equal(store.jobs().find((j) => j.hash === "cq-e5")?.flaggedAt, null);
});

test("checkArrQueues never flags on a failed check", async () => {
  const store = await newStore();
  await store.add({ hash: "cq-f6", title: "F", addedAt: OLD, source: "Radarr" });

  // The client is active, but the call itself failed (network error, bad
  // JSON, a non-200 status): queueHashes answers null, not an empty set.
  const radarr = new FakeArr(true, null);
  const worker = new Worker(store, undefined, radarr, new FakeArr(false, new Set()));

  await worker.checkArrQueues();

  assert.equal(store.jobs().find((j) => j.hash === "cq-f6")?.flaggedAt, null);
});

test("checkArrQueues skips a job younger than the grace period", async () => {
  const store = await newStore();
  await store.add({ hash: "cq-g7", title: "G", addedAt: Date.now(), source: "Radarr" });

  const radarr = new FakeArr(true, new Set()); // would flag it, if checked
  const worker = new Worker(store, undefined, radarr, new FakeArr(false, new Set()));

  await worker.checkArrQueues();

  assert.equal(store.jobs().find((j) => j.hash === "cq-g7")?.flaggedAt, null);
});

test("checkArrQueues skips a job with no known source", async () => {
  const store = await newStore();
  await store.add({ hash: "cq-h8", title: "H", addedAt: OLD }); // no source

  const radarr = new FakeArr(true, new Set()); // would flag it, if checked
  const worker = new Worker(store, undefined, radarr, new FakeArr(false, new Set()));

  await worker.checkArrQueues();

  assert.equal(store.jobs().find((j) => j.hash === "cq-h8")?.flaggedAt, null);
});

test("checkArrQueues does not re-check within ARR_CHECK_INTERVAL, on the same worker", async () => {
  const store = await newStore();
  await store.add({ hash: "cq-i9", title: "I", addedAt: OLD, source: "Radarr" });

  const radarr = new FakeArr(true, new Set());
  const worker = new Worker(store, undefined, radarr, new FakeArr(false, new Set()));

  await worker.checkArrQueues();
  await worker.checkArrQueues();

  assert.equal(radarr.calls, 1, "the second call is inside the throttle window");
});
