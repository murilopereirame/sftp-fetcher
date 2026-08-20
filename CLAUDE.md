# CLAUDE.md

Context for Claude Code in this repository.

## What this project is

`sftp-fetcher` is a small Node.js service. It brings finished torrents from a
remote seedbox to the Radarr host — over SFTP, or over the peer-to-file
protocol (`TRANSFER_MODE=sftp|p2f`).

The problem: Radarr and the download client are on different machines. Radarr
cannot import a file that is not on its own disk.

The solution: Radarr sends an "On Grab" webhook. This service waits for the
torrent, copies the data over SFTP, and puts it on the path that the Radarr
**Remote Path Mapping** expects. Radarr then imports the film by itself.

Read `README.md` first. It has the full flow diagram and all settings.

## The layout

```
src/index.ts        entry point; loads app.ts inside a try
src/app.ts          starts the HTTP server and the worker
src/server.ts       POST /radarr, GET /, GET /status, GET /api/*, GET /health
src/worker.ts       the loop: poll, download, move
src/qbittorrent.ts  the Web API client (apikey | password | none)
src/fetcher.ts      picks the transport (sftp | p2f) from the mode
src/sftp.ts         the SFTP download, with byte progress
src/p2f.ts          the peer-to-file download (thin wrapper over p2f-lib)
src/paths.ts        the path map between the four roots
src/store.ts        the queue, the done list, the history, the settings (SQLite)
src/permissions.ts  the chown and chmod of a finished file, from the settings
src/progress.ts     the progress numbers and their form
src/files.ts        the list of files on the local disk
src/events.ts       the activity feed (last log lines), in memory
src/panel.ts        the web panel: one HTML page, no framework
src/config.ts       every environment variable, in one place
test/               unit tests for the Node test runner
```

## The commands

```bash
npm ci            # install
npm run build     # compile to dist/
npm test          # compile with the tests, then run them
npm run typecheck # types only
npm start         # run dist/index.js
```

Run `npm run typecheck` and `npm test` before you finish a change. Both must
pass. There is no linter in this project.

## The rules of this codebase

- **TypeScript, strict mode.** `noUncheckedIndexedAccess` is on. Do not use
  `any`. Do not use `!` to remove a null.
- **Two dependencies, both purposeful.** `ssh2-sftp-client` for the SFTP mode,
  and `p2f-lib` (the extracted peer-to-file client, its own repo) for the p2f
  mode. Do not add a framework, a test runner, a database driver, or a helper
  library. The HTTP server is `node:http`. The tests are `node:test`. The
  database is `node:sqlite` (built in; it prints one experimental warning, so
  the start command passes `--disable-warning=ExperimentalWarning`). `p2f-lib`
  is a git dependency; keep the lockfile's `resolved` URL on `git+https` (npm's
  `install` rewrites it to `git+ssh`, which breaks anonymous CI/Docker clones —
  `npm ci` never rewrites it).
- **All settings come from the environment**, and only through `src/config.ts`.
  Do not read `process.env` in another file.
- **Comments in simple English.** Short sentences. Look at the current files
  and keep the same style.
- **The seedbox data is read-only.** This service never deletes a remote file.
  Seeding must continue.

## The traps

- **Two transports, one worker.** The worker never calls SFTP or p2f directly;
  it calls `src/fetcher.ts`, which builds the mode's remote path from the same
  `relative` and dispatches. `src/sftp.ts` keeps taking a full remote path, so
  it is unchanged. `src/p2f.ts` is a thin wrapper over `p2f-lib`. The p2f
  download resumes the same way SFTP does (read from the local byte offset,
  append) — the library handles the byte-range request and the decrypt.
- **Four paths, one tree.** `QBIT_ROOT` (the seedbox path that qBittorrent
  reports), `REMOTE_DIR` (the same tree over SFTP) or `P2F_REMOTE_DIR` (the
  same tree inside the peer-to-file shared root), `LOCAL_ROOT` (this
  container), and the Radarr Local Path in the remote path mapping. A change to
  the map logic in `src/paths.ts` needs a test.
- **The download must be atomic.** The data goes into
  `LOCAL_ROOT/.incomplete/<infohash>/` first. The move into place is one
  rename. If Radarr sees a part file, it imports a broken film.
- **The download resumes, so the part files must survive.** `.incomplete/` is
  not wiped on a failed try, a later pass, or a restart. `src/sftp.ts` reads
  each remote file from its local size (an SFTP `start` offset) and appends.
  That needs a sequential copy: a whole local file is then always a correct
  prefix of the remote file. Do not switch back to `fastGet`. It is faster but
  writes chunks in parallel and can leave holes, so its part file is not a
  prefix and cannot resume. Only a job that ends (done or expired or a bad
  path) clears its `.incomplete/` folder.
- **qBittorrent 5.2.0 added API keys.** The header is
  `Authorization: Bearer qbt_...`. There is no login call and no cookie in that
  mode. The `password` mode is for older versions only.
- **Radarr has no "torrent is done" event.** "On Grab" is the only hook that
  starts a job. It fires before the download starts, so this service must wait
  and poll qBittorrent. Do not look for a better event; there is none. ("On
  Import" also arrives, as `eventType: "Download"`, but only *after* Radarr
  imports — too late to start anything. It is used only to clean up the local
  copy, see the next trap.)
- **The JSON-to-SQLite migration runs once.** On the first start after the
  upgrade, `store.migrateFromJson` reads the old `queue.json`, `done.json`, and
  `history.json` into the tables, then renames each to `*.imported`. A
  `jsonMigrated` marker in the `settings` table guards it, so it never runs
  twice or on a fresh install. The old done list had no path, so each done row
  takes its path from the newest matching "downloaded" history event.
- **The import cleanup deletes a local file, so it must be exact.** On the "On
  Import" webhook (`eventType: "Download"`), the service deletes its staged copy
  to free the disk. It finds the copy by the infohash: `store.donePath(hash)`
  gives the path it recorded, and `removeLocal` deletes it — but only inside
  `LOCAL_ROOT`, never a `..` escape, and never the root itself. **The seedbox is
  never touched; only the local staged copy.** Gate it with
  `REMOVE_AFTER_IMPORT`.
- **The permissions run after the rename, from the DB settings.** The chown and
  chmod of a finished file are preferences in the `settings` table, set from the
  panel, not env-only. `PUID`/`PGID` only seed the chown on the first start. The
  worker calls `applyPermissions(paths.local, store.settings())` after the move.
  A chown needs root; it fails soft (one log line), because the file is already
  safe on disk.
- **The Radarr container cannot be changed.** No custom script goes inside it.
  That is the reason for the webhook.
- **The progress callback fires thousands of times.** The log line is throttled
  by `PROGRESS_INTERVAL`. Keep that throttle.
- **The web panel is one template literal in `src/panel.ts`.** The client script
  inside it must never use a backtick or a `${`. Both end the template literal
  at build time. Build strings with `+`, and escape a browser-side `\u` as
  `\\u`. The panel reads the `/api/*` endpoints, and it has two writes: the
  **Remove** button (`POST /api/remove`) and the **Settings** tab
  (`POST /api/settings`). The Settings tab loads once on open, never on the
  2-second tick, or the tick would wipe out what the user is typing.

## The test SFTP server

`sftp-test-server.mjs` gives a real SFTP server on port 2222, for the user
`torrent` and the password `secret`. It serves `/tmp/seedbox`. Use it for an
end-to-end test with no seedbox. The README shows the commands.

## The image

`.github/workflows/docker.yml` runs the tests, then builds a multi-platform
image and pushes it to the GitHub Container Registry. The triggers are a
published release and a manual start. Do not push an image from a branch.
