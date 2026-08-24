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
import { ArrClient, type ArrQueueSource } from "./arr.js";
import { config } from "./config.js";
import { incompleteDir, removeIncomplete } from "./files.js";
import { errorText, log, short } from "./log.js";
import { mapPaths } from "./paths.js";
import { applyPermissions } from "./permissions.js";
import { getProgress, line, setProgress, type Progress } from "./progress.js";
import { QBittorrent } from "./qbittorrent.js";
import { fetchTo } from "./fetcher.js";
import type { Job, Store } from "./store.js";

/**
 * A job younger than this is never checked against the *arr queue. Radarr or
 * Sonarr may not have finished adding the freshly-grabbed download to its own
 * queue view yet, and a false flag right after a grab would be misleading.
 */
const ARR_CHECK_GRACE_MS = 2 * 60_000;

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
  /** The last time checkArrQueues actually ran. 0 means "never yet". */
  private lastArrCheckAt = 0;

  constructor(
    private readonly store: Store,
    private readonly qbit = new QBittorrent(),
    private readonly radarr: ArrQueueSource = new ArrClient("Radarr", config.radarr),
    private readonly sonarr: ArrQueueSource = new ArrClient("Sonarr", config.sonarr),
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
    try {
      await this.checkArrQueues();
    } catch (error) {
      log(`ERROR in the *arr queue check: ${errorText(error)}`);
    }

    for (const job of this.store.jobs()) {
      if (!this.running) return;

      const ageHours = (Date.now() - job.addedAt) / 3_600_000;
      if (ageHours > config.timing.maxWaitHours) {
        log(`${short(job.hash)}: The time limit is over. The job stops.`);
        await this.store.record({
          hash: job.hash,
          title: job.title,
          status: "expired",
          at: Date.now(),
        });
        // The job ends here, so the part files are not needed. Remove them.
        await removeIncomplete(job.hash);
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
   * Ask Radarr and/or Sonarr (whichever is configured) for their own download
   * queue, and flag a job that is no longer in the queue of the app that
   * grabbed it. This runs at most every ARR_CHECK_INTERVAL seconds, not every
   * pass: it is a periodic sanity check, not a substitute for the webhook.
   *
   * A flag is informational only — nothing is deleted or moved because of it.
   * It shows up in the panel (see server.ts's status()/apiStatus()) so a
   * person can see that Radarr or Sonarr forgot about a download (removed by
   * hand, or imported outside this service) instead of waiting out the full
   * MAX_WAIT_HOURS to find out. A missing job with no known `source`, or a
   * check that could not reach *arr at all, is left exactly as it is: this
   * only ever flags on a confirmed "not in the list" answer.
   */
  async checkArrQueues(): Promise<void> {
    if (!this.radarr.active && !this.sonarr.active) return;

    const now = Date.now();
    if (now - this.lastArrCheckAt < config.timing.arrCheckInterval * 1000) return;

    const jobs = this.store.jobs().filter((job) => job.source !== "");
    if (jobs.length === 0) {
      this.lastArrCheckAt = now;
      return;
    }

    const radarrHashes = this.radarr.active ? await this.radarr.queueHashes() : null;
    const sonarrHashes = this.sonarr.active ? await this.sonarr.queueHashes() : null;
    this.lastArrCheckAt = now;

    for (const job of jobs) {
      if (now - job.addedAt < ARR_CHECK_GRACE_MS) continue;

      const hashes = job.source === "Sonarr" ? sonarrHashes : radarrHashes;
      // null: the app is not configured, or the request failed. Either way,
      // there is nothing to compare against, so the job is left alone.
      if (hashes === null) continue;

      const present = hashes.has(job.hash);

      if (present) {
        if (job.flaggedAt !== null) {
          await this.store.setFlag(job.hash, null);
          log(`${short(job.hash)}: It is back in ${job.source}'s queue. The flag is cleared.`);
        }
        continue;
      }

      if (job.flaggedAt === null) {
        await this.store.setFlag(job.hash, now);
        log(
          `${short(job.hash)}: It is no longer in ${job.source}'s queue. Flagged. ` +
            `It may have been removed by hand, or imported outside this service.`,
        );
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
      await this.store.record({
        hash: job.hash,
        title: job.title,
        status: "failed",
        at: Date.now(),
      });
      await removeIncomplete(job.hash);
      await this.store.remove(job.hash);
      return;
    }

    if (await exists(paths.local)) {
      log(`${short(job.hash)}: The local path is already there. Nothing to do.`);
      await this.store.record({
        hash: job.hash,
        title: job.title,
        status: "downloaded",
        at: Date.now(),
        path: paths.relative,
      });
      await this.store.markDone(job.hash, { path: paths.relative });
      return;
    }

    // The download goes into a temporary folder first.
    // Radarr then never sees an incomplete file.
    //
    // The folder is NOT wiped here. A part file from a stopped copy stays, and
    // the download resumes it from the byte it reached. This survives a retry,
    // a later pass, and a container restart, because the folder is on the
    // download volume.
    const temporary = incompleteDir(job.hash);
    await mkdir(temporary, { recursive: true });

    log(`${short(job.hash)}: Download start: '${paths.relative}'.`);

    let downloaded: string | null = null;
    for (let attempt = 1; attempt <= config.timing.copyTries; attempt += 1) {
      try {
        downloaded = await fetchTo(
          paths.relative,
          temporary,
          this.reporter(job, paths.relative),
        );
        break;
      } catch (error) {
        // Keep the part files. The next try resumes from where this one got to.
        log(
          `${short(job.hash)}: The download failed. Attempt ${attempt}. ` +
            `${errorText(error)}`,
        );
        if (attempt < config.timing.copyTries) {
          await sleep(config.timing.copyWaitSeconds);
        }
      }
    }

    // Read the byte count before the progress is cleared. The history keeps it.
    const finalBytes = getProgress()?.bytesTotal;
    setProgress(null);

    if (downloaded === null) {
      // The part files stay in the temporary folder. The next pass resumes
      // them. The line is in the Events feed already, so the history stays
      // clean until the job ends.
      log(`${short(job.hash)}: The download stopped. The next pass resumes it.`);
      return;
    }

    // The move is fast. Both folders are on the same filesystem.
    await mkdir(path.dirname(paths.local), { recursive: true });
    await rename(downloaded, paths.local);
    await rm(temporary, { recursive: true, force: true });

    // Set the owner and the mode, so the Radarr import has no permission
    // error. What runs here is set in the web panel (see Settings).
    await applyPermissions(paths.local, this.store.settings());

    log(`${short(job.hash)}: Ready at '${paths.local}'. Radarr can import it now.`);
    await this.store.record({
      hash: job.hash,
      title: job.title,
      status: "downloaded",
      at: Date.now(),
      path: paths.relative,
      ...(finalBytes === undefined ? {} : { bytes: finalBytes }),
    });
    await this.store.markDone(job.hash, {
      path: paths.relative,
      ...(finalBytes === undefined ? {} : { bytes: finalBytes }),
    });
  }
}
