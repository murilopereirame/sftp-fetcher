/**
 * The webhook server.
 *
 * Radarr sends a POST for each grab. The payload holds "downloadId".
 * For a torrent, that value is the infohash. That is all this program needs.
 *
 * Radarr connection: Settings > Connect > Webhook.
 * Select the trigger "On Grab" only.
 */
import http from "node:http";
import { config } from "./config.js";
import { activity } from "./events.js";
import { listFiles, removeIncomplete, removeLocal } from "./files.js";
import { errorText, log, short } from "./log.js";
import { panelHtml } from "./panel.js";
import { bytes, duration, getProgress, percent } from "./progress.js";
import type { Settings, Store } from "./store.js";

interface RadarrWebhook {
  eventType?: string;
  downloadId?: string;
  release?: { releaseTitle?: string };
  movie?: { title?: string };
}

/** Keep the hex characters only. A bad value cannot become a path. */
function cleanHash(value: string | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-f0-9]/g, "");
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;

    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Stop a very large body. The Radarr payload is small.
      if (size > 1_000_000) {
        reject(new Error("The body is too large."));
        request.destroy();
        return;
      }
      parts.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    request.on("error", reject);
  });
}

function reply(
  response: http.ServerResponse,
  code: number,
  text: string,
  type = "text/plain",
): void {
  response.writeHead(code, { "Content-Type": type });
  response.end(text);
}

/** The answer of GET /status. It shows the queue and the running download. */
function status(store: Store): unknown {
  const progress = getProgress();

  return {
    mode: config.mode,
    queue: store.jobs().map((job) => ({
      hash: job.hash,
      title: job.title,
      waitingSince: new Date(job.addedAt).toISOString(),
    })),
    download:
      progress === null
        ? null
        : {
            hash: progress.hash,
            title: progress.title,
            name: progress.name,
            percent: Number(percent(progress).toFixed(1)),
            done: bytes(progress.bytesDone),
            total: bytes(progress.bytesTotal),
            speed: `${bytes(progress.speed)}/s`,
            timeLeft: duration(progress.eta),
            files: `${progress.filesDone} of ${progress.filesTotal}`,
            runningFor: duration((Date.now() - progress.startedAt) / 1000),
          },
  };
}

/**
 * The answer of GET /api/status. The web panel reads it every few seconds.
 * The numbers are raw here. The page makes them pretty in the browser.
 */
function apiStatus(store: Store): unknown {
  const progress = getProgress();

  return {
    mode: config.mode,
    queue: store.jobs().map((job) => ({
      hash: job.hash,
      title: job.title,
      waitingSince: new Date(job.addedAt).toISOString(),
    })),
    download:
      progress === null
        ? null
        : {
            hash: progress.hash,
            title: progress.title,
            name: progress.name,
            percent: percent(progress),
            bytesDone: progress.bytesDone,
            bytesTotal: progress.bytesTotal,
            speed: progress.speed,
            eta: progress.eta,
            filesDone: progress.filesDone,
            filesTotal: progress.filesTotal,
            runningFor: (Date.now() - progress.startedAt) / 1000,
          },
    counts: {
      queue: store.jobs().length,
      history: store.history().length,
    },
  };
}

export function createServer(store: Store): http.Server {
  return http.createServer((request, response) => {
    void handle(request, response, store).catch((error: unknown) => {
      log(`ERROR in the webhook: ${errorText(error)}`);
      if (!response.headersSent) reply(response, 500, "error");
    });
  });
}

async function handle(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  store: Store,
): Promise<void> {
  const target = (request.url ?? "").split("?")[0]?.replace(/\/+$/, "") ?? "";

  if (request.method === "GET") {
    if (target === "" || target === "/panel") {
      reply(response, 200, panelHtml, "text/html; charset=utf-8");
      return;
    }
    if (target === "/health") {
      reply(response, 200, "healthy");
      return;
    }
    if (target === "/status") {
      reply(response, 200, JSON.stringify(status(store), null, 2), "application/json");
      return;
    }
    if (target === "/api/status") {
      reply(response, 200, JSON.stringify(apiStatus(store), null, 2), "application/json");
      return;
    }
    if (target === "/api/history") {
      reply(response, 200, JSON.stringify(store.history(), null, 2), "application/json");
      return;
    }
    if (target === "/api/files") {
      const files = await listFiles();
      reply(response, 200, JSON.stringify({ root: config.localRoot, files }, null, 2), "application/json");
      return;
    }
    if (target === "/api/activity") {
      reply(response, 200, JSON.stringify(activity(), null, 2), "application/json");
      return;
    }
    if (target === "/api/settings") {
      reply(response, 200, JSON.stringify(settingsView(store), null, 2), "application/json");
      return;
    }
    reply(response, 404, "not found");
    return;
  }

  // The panel sends this to take a stale torrent out of the queue by hand.
  if (request.method === "POST" && target === "/api/remove") {
    await handleRemove(request, response, store);
    return;
  }

  // The panel sends this to change the chown and chmod preferences.
  if (request.method === "POST" && target === "/api/settings") {
    await handleSettings(request, response, store);
    return;
  }

  if (request.method !== "POST" || target !== config.http.path) {
    reply(response, 404, "not found");
    return;
  }

  let payload: RadarrWebhook;
  try {
    payload = JSON.parse(await readBody(request)) as RadarrWebhook;
  } catch {
    reply(response, 400, "bad json");
    return;
  }

  // Radarr sends this when you press the Test button.
  if (payload.eventType === "Test") {
    log("The Radarr test webhook arrived.");
    reply(response, 200, "ok");
    return;
  }

  // "Download" is the Radarr word for a finished import. The film is in the
  // library now, so the local copy this program staged can go.
  if (payload.eventType === "Download") {
    await handleImport(payload, store);
    reply(response, 200, "ok");
    return;
  }

  if (payload.eventType !== "Grab") {
    reply(response, 200, "ok");
    return;
  }

  const title = payload.release?.releaseTitle ?? payload.movie?.title ?? "unknown";
  const hash = cleanHash(payload.downloadId);

  if (hash === "") {
    log(`The webhook has no downloadId. Title: '${title}'.`);
    reply(response, 200, "ok");
    return;
  }

  if (store.knows(hash)) {
    log(`${short(hash)}: This torrent is in the queue or done already.`);
  } else {
    const now = Date.now();
    await store.add({ hash, title, addedAt: now });
    await store.record({ hash, title, status: "grabbed", at: now });
    log(`${short(hash)}: Added to the queue. Title: '${title}'.`);
  }

  reply(response, 200, "ok");
}

/**
 * Take a torrent out of the queue on request from the panel. The part files
 * are removed too, because the job is over. The seedbox is not touched.
 */
async function handleRemove(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  store: Store,
): Promise<void> {
  let body: { hash?: string };
  try {
    body = JSON.parse(await readBody(request)) as { hash?: string };
  } catch {
    reply(response, 400, "bad json");
    return;
  }

  const hash = cleanHash(body.hash);
  const job = store.jobs().find((item) => item.hash === hash);
  if (job === undefined) {
    reply(response, 404, JSON.stringify({ ok: false, reason: "not in the queue" }), "application/json");
    return;
  }

  await store.remove(hash);
  await removeIncomplete(hash);
  await store.record({ hash, title: job.title, status: "removed", at: Date.now() });
  log(`${short(hash)}: Removed from the queue by hand.`);
  reply(response, 200, JSON.stringify({ ok: true }), "application/json");
}

/**
 * React to a Radarr import. Delete the local copy that this program staged,
 * so the disk is free. The path comes from the store, by the infohash. If the
 * torrent is unknown, or the file is already gone, this does nothing.
 */
async function handleImport(payload: RadarrWebhook, store: Store): Promise<void> {
  if (!config.removeAfterImport) return;

  const hash = cleanHash(payload.downloadId);
  if (hash === "") return;

  const relative = store.donePath(hash);
  if (relative === null) {
    log(`${short(hash)}: Radarr imported a torrent this program does not know.`);
    return;
  }

  const title = payload.movie?.title ?? relative;
  const removed = await removeLocal(relative);
  if (removed) {
    log(`${short(hash)}: Radarr imported it. The local copy '${relative}' is deleted.`);
    await store.record({ hash, title, status: "imported", at: Date.now(), path: relative });
  } else {
    log(`${short(hash)}: Radarr imported it. The local copy was gone already.`);
  }
}

/**
 * The settings, shaped for the panel. The modes go out as octal text ("664"),
 * the way a person reads and types them.
 */
function settingsView(store: Store): unknown {
  const s = store.settings();
  return {
    chown: s.chown,
    uid: s.uid,
    gid: s.gid,
    chmod: s.chmod,
    fileMode: s.fileMode === null ? null : s.fileMode.toString(8),
    dirMode: s.dirMode === null ? null : s.dirMode.toString(8),
  };
}

interface SettingsBody {
  chown?: unknown;
  uid?: unknown;
  gid?: unknown;
  chmod?: unknown;
  fileMode?: unknown;
  dirMode?: unknown;
}

/** Read a whole, non-negative number from the body, or null for empty. */
function readId(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value));
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("a UID or a GID must be a whole number, zero or more");
  }
  return parsed;
}

/** Read an octal mode like "664" from the body, or null for empty. */
function readMode(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  if (!/^[0-7]{3,4}$/.test(text)) {
    throw new Error("a mode must be three or four octal digits, like 664");
  }
  return Number.parseInt(text, 8);
}

/**
 * Change the chown and chmod preferences from the panel. Every field is
 * optional; only the ones that are sent change. A bad value gives a 400 with
 * the reason, so the panel can show it.
 */
async function handleSettings(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  store: Store,
): Promise<void> {
  let body: SettingsBody;
  try {
    body = JSON.parse(await readBody(request)) as SettingsBody;
  } catch {
    reply(response, 400, "bad json");
    return;
  }

  const partial: Partial<Settings> = {};
  try {
    if (body.chown !== undefined) partial.chown = body.chown === true;
    if (body.chmod !== undefined) partial.chmod = body.chmod === true;
    if (body.uid !== undefined) partial.uid = readId(body.uid);
    if (body.gid !== undefined) partial.gid = readId(body.gid);
    if (body.fileMode !== undefined) partial.fileMode = readMode(body.fileMode);
    if (body.dirMode !== undefined) partial.dirMode = readMode(body.dirMode);
  } catch (error) {
    reply(response, 400, JSON.stringify({ ok: false, reason: errorText(error) }), "application/json");
    return;
  }

  store.saveSettings(partial);
  log("The permission settings changed.");
  reply(response, 200, JSON.stringify({ ok: true, settings: settingsView(store) }), "application/json");
}
