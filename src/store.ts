/**
 * The job store. It keeps the queue on disk.
 * A container restart does not lose a job.
 *
 * Two files in the state folder:
 *   queue.json   the open jobs
 *   done.json    the infohashes that this program finished
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

export class Store {
  private queue: Job[] = [];
  private done: string[] = [];

  private get queueFile(): string {
    return path.join(config.stateDir, "queue.json");
  }

  private get doneFile(): string {
    return path.join(config.stateDir, "done.json");
  }

  async load(): Promise<void> {
    await mkdir(config.stateDir, { recursive: true });
    this.queue = await this.readJson<Job[]>(this.queueFile, []);
    this.done = await this.readJson<string[]>(this.doneFile, []);
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
}
