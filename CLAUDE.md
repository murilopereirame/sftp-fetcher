# CLAUDE.md

Context for Claude Code in this repository.

## What this project is

`sftp-fetcher` is a small Node.js service. It brings finished torrents from a
remote seedbox to the Radarr host over SFTP.

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
src/sftp.ts         the download, with byte progress
src/paths.ts        the path map between the four roots
src/store.ts        the queue and the history on disk
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
- **One dependency.** `ssh2-sftp-client`. Do not add a framework, a test
  runner, or a helper library. The HTTP server is `node:http`. The tests are
  `node:test`.
- **All settings come from the environment**, and only through `src/config.ts`.
  Do not read `process.env` in another file.
- **Comments in simple English.** Short sentences. Look at the current files
  and keep the same style.
- **The seedbox data is read-only.** This service never deletes a remote file.
  Seeding must continue.

## The traps

- **Four paths, one tree.** `QBIT_ROOT` (the seedbox path that qBittorrent
  reports), `REMOTE_DIR` (the same tree over SFTP), `LOCAL_ROOT` (this
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
- **Radarr has no "time to import" event.** "On Grab" is the only usable hook.
  It fires before the download starts, so this service must wait. Do not look
  for a better event; there is none.
- **The Radarr container cannot be changed.** No custom script goes inside it.
  That is the reason for the webhook.
- **The progress callback fires thousands of times.** The log line is throttled
  by `PROGRESS_INTERVAL`. Keep that throttle.
- **The web panel is one template literal in `src/panel.ts`.** The client script
  inside it must never use a backtick or a `${`. Both end the template literal
  at build time. Build strings with `+`, and escape a browser-side `\u` as
  `\\u`. The panel reads only the `/api/*` endpoints; it writes nothing.

## The test SFTP server

`sftp-test-server.mjs` gives a real SFTP server on port 2222, for the user
`torrent` and the password `secret`. It serves `/tmp/seedbox`. Use it for an
end-to-end test with no seedbox. The README shows the commands.

## The image

`.github/workflows/docker.yml` runs the tests, then builds a multi-platform
image and pushes it to the GitHub Container Registry. The triggers are a
published release and a manual start. Do not push an image from a branch.
