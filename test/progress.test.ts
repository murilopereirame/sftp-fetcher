import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { bytes, duration, line, percent, type Progress } from "../src/progress.js";

test("it writes the byte counts in a short form", () => {
  assert.equal(bytes(0), "0 B");
  assert.equal(bytes(512), "512 B");
  assert.equal(bytes(1024), "1.0 KiB");
  assert.equal(bytes(1024 * 1024 * 1.5), "1.5 MiB");
  assert.equal(bytes(1024 ** 3 * 2), "2.0 GiB");
});

test("it writes the times in a short form", () => {
  assert.equal(duration(45), "45s");
  assert.equal(duration(90), "1m 30s");
  assert.equal(duration(3700), "1h 1m");
  assert.equal(duration(null), "unknown");
  assert.equal(duration(Infinity), "unknown");
});

test("the percent is zero if the total size is zero", () => {
  const value = { bytesDone: 0, bytesTotal: 0 } as Progress;
  assert.equal(percent(value), 0);
});

test("the log line holds the percent, the size, and the speed", () => {
  const value: Progress = {
    hash: "aabbccdd", title: "Film", name: "movies/Film",
    bytesDone: 1024 ** 3, bytesTotal: 1024 ** 3 * 4,
    filesDone: 1, filesTotal: 3,
    speed: 1024 * 1024 * 5, eta: 120, startedAt: Date.now(),
  };
  const text = line(value);
  assert.match(text, /25\.0 %/);
  assert.match(text, /1\.0 GiB of 4\.0 GiB/);
  assert.match(text, /5\.0 MiB\/s/);
  assert.match(text, /2m 0s left/);
  assert.match(text, /file 2 of 3/);
});
