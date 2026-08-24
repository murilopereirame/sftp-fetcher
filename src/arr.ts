/**
 * A small client for the Radarr/Sonarr REST API. Not the webhook: the
 * webhook is a push from *arr to this service (see server.ts); this is a
 * pull the other way, used only to ask "is this torrent still in your
 * queue?" (see Worker.checkArrQueues in worker.ts).
 *
 * Radarr and Sonarr are both "Servarr" apps and share the same API v3 shape
 * for this purpose, so one class serves both; only the base URL, the API
 * key, and the name (for the log) differ per instance.
 *
 * Make a key in either app: Settings > General > Security > API Key.
 */
import { errorText, log } from "./log.js";

export interface ArrConfig {
  url: string;
  apiKey: string;
}

/**
 * The shape Worker.checkArrQueues needs. ArrClient implements it; the tests
 * use a plain object instead, so they never make a real HTTP call. A type
 * with only public members (no class fields) keeps that substitution
 * possible — a parameter typed as the concrete ArrClient class would not
 * accept a different class's instance, because TypeScript compares private
 * fields nominally.
 */
export interface ArrQueueSource {
  readonly active: boolean;
  queueHashes(): Promise<Set<string> | null>;
}

interface QueueRecord {
  downloadId?: string;
}

interface QueueResponse {
  records?: QueueRecord[];
}

export class ArrClient implements ArrQueueSource {
  constructor(
    private readonly name: string,
    private readonly cfg: ArrConfig,
  ) {}

  /** True once both the URL and the API key are set. */
  get active(): boolean {
    return this.cfg.url !== "" && this.cfg.apiKey !== "";
  }

  /**
   * The infohashes (lower case) that *arr currently has in its download
   * queue. Null means "could not tell" (not configured, unreachable, or a
   * bad answer) — the caller must never flag a job on a null result, only
   * on a real, empty-or-not list.
   */
  async queueHashes(): Promise<Set<string> | null> {
    if (!this.active) return null;

    try {
      const response = await fetch(`${this.cfg.url}/api/v3/queue?pageSize=1000`, {
        headers: { "X-Api-Key": this.cfg.apiKey },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        log(`${this.name}: the queue check answered with the status ${response.status}.`);
        return null;
      }

      const body = (await response.json()) as QueueResponse;
      const hashes = new Set<string>();
      for (const record of body.records ?? []) {
        if (typeof record.downloadId === "string" && record.downloadId !== "") {
          hashes.add(record.downloadId.toLowerCase());
        }
      }
      return hashes;
    } catch (error) {
      log(`${this.name}: could not read the queue. ${errorText(error)}`);
      return null;
    }
  }
}
