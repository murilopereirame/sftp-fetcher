/**
 * The download loop.
 *
 * One pass every POLL_INTERVAL seconds:
 *   1. Read the queue.
 *   2. Ask qBittorrent about each torrent.
 *   3. At 100 %, download the data over SFTP.
 *   4. Move the data to the path that the Radarr mapping expects.
 *
 * Radarr checks its download queue each minute. It sees the new path
 * and imports the film. This program does not talk to Radarr.
 */
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { errorText, log, short } from "./log.js";
import { mapPaths } from "./paths.js";
import { line, setProgress, type Progress } from "./progress.js";
import { QBittorrent } from "./qbittorrent.js";
import { download } from "./sftp.js";
import type { Job, Store } from "./store.js";

const sleep = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export class Worker {
  private running = false;

  constructor(
    private readonly store: Store,
    private readonly qbit = new QBittorrent(),
  ) {}

  stop(): void {
    this.running = false;
  }

  async start(): Promise<void> {
    this.running = true;
    log(`The worker starts. The pass interval is ${config.timing.pollInterval} s.`);

    while (this.running) {
      try {
        await this.pass();
      } catch (error) {
        log(`ERROR in the pass: ${errorText(error)}`);
      }
      await sleep(config.timing.pollInterval);
    }
  }

  /** One pass over the queue. The jobs run one after the other. */
  private async pass(): Promise<void> {
    for (const job of this.store.jobs()) {
      if (!this.running) return;

      const ageHours = (Date.now() - job.addedAt) / 3_600_000;
      if (ageHours > config.timing.maxWaitHours) {
        log(`${short(job.hash)}: The time limit is over. The job stops.`);
        await this.store.remove(job.hash);
        continue;
      }

      try {
        await this.handle(job);
      } catch (error) {
        log(`${short(job.hash)}: ERROR. ${errorText(error)}`);
      }
    }
  }

  /**
   * Make the progress handler for one job. It updates the shared state on
   * each step, but it writes to the log only every PROGRESS_INTERVAL seconds.
   * A large file gives thousands of steps. The log must stay readable.
   */
  private reporter(job: Job, name: string): (transfer: {
    bytesDone: number;
    bytesTotal: number;
    filesDone: number;
    filesTotal: number;
  }) => void {
    const startedAt = Date.now();
    let lastLogAt = 0;
    let lastBytes = 0;
    let lastTime = startedAt;

    return (transfer) => {
      const now = Date.now();
      const seconds = (now - lastTime) / 1000;
      const speed = seconds > 0 ? (transfer.bytesDone - lastBytes) / seconds : 0;
      const left = transfer.bytesTotal - transfer.bytesDone;

      const progress: Progress = {
        hash: job.hash,
        title: job.title,
        name,
        bytesDone: transfer.bytesDone,
        bytesTotal: transfer.bytesTotal,
        filesDone: transfer.filesDone,
        filesTotal: transfer.filesTotal,
        speed,
        eta: speed > 0 ? left / speed : null,
        startedAt,
      };
      setProgress(progress);

      if (now - lastLogAt >= config.timing.progressInterval * 1000) {
        log(`${short(job.hash)}: ${line(progress)}`);
        lastLogAt = now;
        lastBytes = transfer.bytesDone;
        lastTime = now;
      }
    };
  }

  private async handle(job: Job): Promise<void> {
    const torrent = await this.qbit.info(job.hash);

    if (torrent === null) {
      log(`${short(job.hash)}: qBittorrent does not know this torrent. Wait.`);
      return;
    }

    if (torrent.progress < 1) {
      const percent = (torrent.progress * 100).toFixed(1);
      log(`${short(job.hash)}: ${percent} % complete. Wait.`);
      return;
    }

    const paths = mapPaths(torrent);
    if (paths === null) {
      log(`${short(job.hash)}: ERROR. The path '${torrent.content_path}' is not usable.`);
      await this.store.remove(job.hash);
      return;
    }

    if (await exists(paths.local)) {
      log(`${short(job.hash)}: The local path is already there. Nothing to do.`);
      await this.store.markDone(job.hash);
      return;
    }

    // The download goes into a temporary folder first.
    // Radarr then never sees an incomplete file.
    const temporary = path.join(config.localRoot, ".incomplete", job.hash);
    await rm(temporary, { recursive: true, force: true });
    await mkdir(temporary, { recursive: true });

    log(`${short(job.hash)}: Download start: '${paths.relative}'.`);

    let downloaded: string | null = null;
    for (let attempt = 1; attempt <= config.timing.copyTries; attempt += 1) {
      try {
        downloaded = await download(
          paths.remote,
          temporary,
          this.reporter(job, paths.relative),
        );
        break;
      } catch (error) {
        log(
          `${short(job.hash)}: The download failed. Attempt ${attempt}. ` +
            `${errorText(error)}`,
        );
        await rm(temporary, { recursive: true, force: true });
        await mkdir(temporary, { recursive: true });
        if (attempt < config.timing.copyTries) {
          await sleep(config.timing.copyWaitSeconds);
        }
      }
    }

    setProgress(null);

    if (downloaded === null) {
      await rm(temporary, { recursive: true, force: true });
      log(`${short(job.hash)}: ERROR. The download failed. The next pass tries again.`);
      return;
    }

    // The move is fast. Both folders are on the same filesystem.
    await mkdir(path.dirname(paths.local), { recursive: true });
    await rename(downloaded, paths.local);
    await rm(temporary, { recursive: true, force: true });

    log(`${short(job.hash)}: Ready at '${paths.local}'. Radarr can import it now.`);
    await this.store.markDone(job.hash);
  }
}
