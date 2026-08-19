/**
 * The job store. It keeps the queue on disk.
 * A container restart does not lose a job.
 *
 * Three files in the state folder:
 *   queue.json    the open jobs
 *   done.json     the infohashes that this program finished
 *   history.json  the record of every event, for the web panel
 */
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

export interface Job {
  hash: string;
  title: string;
  /** The time of the Radarr webhook, in milliseconds. */
  addedAt: number;
}

/** What happened to a torrent. The web panel shows this list as the history. */
export type HistoryStatus = "grabbed" | "downloaded" | "failed" | "expired";

export interface HistoryEntry {
  hash: string;
  title: string;
  status: HistoryStatus;
  /** The time of the event, in milliseconds. */
  at: number;
  /** The path under the download root. Set when the status is "downloaded". */
  path?: string;
  /** The size in bytes. Set when it is known. */
  bytes?: number;
}

export class Store {
  private queue: Job[] = [];
  private done: string[] = [];
  private past: HistoryEntry[] = [];

  private get queueFile(): string {
    return path.join(config.stateDir, "queue.json");
  }

  private get doneFile(): string {
    return path.join(config.stateDir, "done.json");
  }

  private get historyFile(): string {
    return path.join(config.stateDir, "history.json");
  }

  async load(): Promise<void> {
    await mkdir(config.stateDir, { recursive: true });
    this.queue = await this.readJson<Job[]>(this.queueFile, []);
    this.done = await this.readJson<string[]>(this.doneFile, []);
    this.past = await this.readJson<HistoryEntry[]>(this.historyFile, []);
  }

  private async readJson<T>(file: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch {
      return fallback;
    }
  }

  /** Write to a temporary file first, then rename. A crash cannot break the file. */
  private async writeJson(file: string, value: unknown): Promise<void> {
    const temporary = `${file}.tmp`;
    await writeFile(temporary, JSON.stringify(value, null, 2), "utf8");
    await rename(temporary, file);
  }

  jobs(): Job[] {
    return [...this.queue];
  }

  knows(hash: string): boolean {
    return this.done.includes(hash) || this.queue.some((job) => job.hash === hash);
  }

  async add(job: Job): Promise<void> {
    this.queue.push(job);
    await this.writeJson(this.queueFile, this.queue);
  }

  async remove(hash: string): Promise<void> {
    this.queue = this.queue.filter((job) => job.hash !== hash);
    await this.writeJson(this.queueFile, this.queue);
  }

  async markDone(hash: string): Promise<void> {
    if (!this.done.includes(hash)) {
      this.done.push(hash);
      // Keep the last 1000 entries only. The file stays small.
      this.done = this.done.slice(-1000);
      await this.writeJson(this.doneFile, this.done);
    }
    await this.remove(hash);
  }

  /** The history, newest event first. */
  history(): HistoryEntry[] {
    return [...this.past].reverse();
  }

  /** Add one event to the history. The panel shows it. */
  async record(entry: HistoryEntry): Promise<void> {
    this.past.push(entry);
    // Keep the last 1000 events only. The file stays small.
    this.past = this.past.slice(-1000);
    await this.writeJson(this.historyFile, this.past);
  }
}
