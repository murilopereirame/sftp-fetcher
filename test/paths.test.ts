import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { mapPaths } from "../src/paths.js";
import type { Torrent } from "../src/qbittorrent.js";

function torrent(content: string, name = "Film.2024"): Torrent {
  return { name, progress: 1, content_path: content, state: "pausedUP" };
}

test("it keeps the part of the path after the qBittorrent root", () => {
  const result = mapPaths(torrent("/downloads/movies/Film.2024"));
  assert.ok(result);
  assert.equal(result.relative, "movies/Film.2024");
  assert.equal(result.remote, "/uploads/movies/Film.2024");
  assert.match(result.local, /\/downloads\/movies\/Film\.2024$/);
});

test("it works for a torrent in the root folder", () => {
  const result = mapPaths(torrent("/downloads/Film.2024"));
  assert.ok(result);
  assert.equal(result.remote, "/uploads/Film.2024");
});

test("it uses the torrent name if the prefix does not match", () => {
  const result = mapPaths(torrent("/other/place/Film.2024", "Film.2024"));
  assert.ok(result);
  assert.equal(result.relative, "Film.2024");
  assert.equal(result.remote, "/uploads/Film.2024");
});

test("it refuses a path that goes out of the local root", () => {
  assert.equal(mapPaths(torrent("/downloads/../../etc/passwd")), null);
});

test("it refuses an empty path", () => {
  assert.equal(mapPaths(torrent("", "")), null);
});
