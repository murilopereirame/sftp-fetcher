/**
 * sftp-fetcher
 *
 * This program runs in its own container on the Radarr host.
 * It shares the download mount with Radarr. It does not change Radarr.
 *
 * Sequence:
 *   1. Radarr grabs a release. It sends a webhook to this program.
 *   2. This program asks qBittorrent about that torrent. It waits for 100 %.
 *   3. It downloads the data from the SFTP server on the seedbox.
 *   4. It puts the data on the path that the Radarr path mapping expects.
 *   5. Radarr finds the path on its next check. Radarr imports the movie.
 *
 * The data on the seedbox stays there. Seeding continues.
 */
import { mkdir } from "node:fs/promises";
import { config } from "./config.js";
import { log } from "./log.js";
import { createServer } from "./server.js";
import { Store } from "./store.js";
import { Worker } from "./worker.js";

export async function start(): Promise<void> {
  await mkdir(config.localRoot, { recursive: true });

  const store = new Store();
  await store.load();

  const open = store.jobs().length;
  if (open > 0) log(`${open} job(s) came back from the last run.`);

  const worker = new Worker(store);
  void worker.start();

  const server = createServer(store);
  server.listen(config.http.port, config.http.host, () => {
    log(`The webhook URL is http://<this-container>:${config.http.port}${config.http.path}`);
  });

  const stop = (signal: string): void => {
    log(`${signal}: Stop.`);
    worker.stop();
    server.close(() => process.exit(0));
    // Do not wait for a long download.
    setTimeout(() => process.exit(0), 5000).unref();
  };

  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));
}
