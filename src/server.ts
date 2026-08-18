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
import { errorText, log, short } from "./log.js";
import { bytes, duration, getProgress, percent } from "./progress.js";
import type { Store } from "./store.js";

interface RadarrWebhook {
  eventType?: string;
  downloadId?: string;
  release?: { releaseTitle?: string };
  movie?: { title?: string };
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
    if (target === "/status") {
      reply(response, 200, JSON.stringify(status(store), null, 2), "application/json");
      return;
    }
    if (target === "/health" || target === "") {
      reply(response, 200, "healthy");
      return;
    }
    reply(response, 404, "not found");
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

  if (payload.eventType !== "Grab") {
    reply(response, 200, "ok");
    return;
  }

  const title = payload.release?.releaseTitle ?? payload.movie?.title ?? "unknown";
  // Keep the hex characters only. A bad value cannot become a path.
  const hash = (payload.downloadId ?? "").toLowerCase().replace(/[^a-f0-9]/g, "");

  if (hash === "") {
    log(`The webhook has no downloadId. Title: '${title}'.`);
    reply(response, 200, "ok");
    return;
  }

  if (store.knows(hash)) {
    log(`${short(hash)}: This torrent is in the queue or done already.`);
  } else {
    await store.add({ hash, title, addedAt: Date.now() });
    log(`${short(hash)}: Added to the queue. Title: '${title}'.`);
  }

  reply(response, 200, "ok");
}
