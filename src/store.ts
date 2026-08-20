/**
 * The job store. It keeps the state in a small SQLite database.
 * A container restart does not lose a job.
 *
 * The database is one file in the state folder: `fetcher.db`. It holds
 * three tables:
 *   queue    the open jobs, one row each
 *   done     the infohashes that this program finished, with the local path
 *   history  the record of every event, for the web panel
 *
 * The database is `node:sqlite`, a part of Node itself. It is not a new
 * dependency, so the two-dependency rule of this project still holds.
 *
 * On the first start after the upgrade, the old JSON files (queue.json,
 * done.json, history.json) are read into the database once and then renamed
 * to `*.imported`. See migrateFromJson below.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./log.js";

export interface Job {
  hash: string;
  title: string;
  /** The time of the Radarr webhook, in milliseconds. */
  addedAt: number;
}

/**
 * What happened to a torrent. The web panel shows this list as the history.
 *
 *   grabbed     Radarr grabbed it; the job is in the queue.
 *   downloaded  the data is on the local disk, ready for Radarr.
 *   failed      the remote path was not usable.
 *   expired     the wait time ran out.
 *   removed     a person took it out of the queue by hand.
 *   imported    Radarr imported it, so the local copy was deleted.
 */
export type HistoryStatus =
  | "grabbed"
  | "downloaded"
  | "failed"
  | "expired"
  | "removed"
  | "imported";

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

/** What is known about a finished torrent. Used to clean up after an import. */
export interface DoneInfo {
  /** The path under the download root, if it was recorded. */
  path?: string;
  /** The size in bytes, if it was known. */
  bytes?: number;
}

/**
 * The permission preferences. They live in the database, so the web panel can
 * change them without a restart. The worker reads them after each download.
 *
 * `chown` sets the owner of the finished files. Use it when the container runs
 * as root but Radarr runs as another user.
 *
 * `chmod` sets the mode of the finished files. Use it when the container and
 * Radarr share a group and the files must be group-writable. The modes are
 * octal, like 0o664 for a file and 0o775 for a folder (a folder needs the
 * search bit).
 */
export interface Settings {
  chown: boolean;
  uid: number | null;
  gid: number | null;
  chmod: boolean;
  fileMode: number | null;
  dirMode: number | null;
}

/** The mode when a new install has nothing set. A file, then a folder. */
const DEFAULT_FILE_MODE = 0o664;
const DEFAULT_DIR_MODE = 0o775;

/** Read an integer column. SQLite may give a number or a bigint. */
function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return 0;
}

/** Read a text column that may be null. */
function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Read a text column that may be null, and keep the null as undefined. */
function toOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Read an integer column that may be null, and keep the null as undefined. */
function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return undefined;
}

/** Read and parse a JSON file. A missing or broken file gives null. */
async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Rename a file to `*.imported`. A missing file is fine. */
async function archive(file: string): Promise<void> {
  try {
    await rename(file, `${file}.imported`);
  } catch {
    // The file was not there, or could not be renamed. Not fatal.
  }
}

export class Store {
  private db: DatabaseSync | null = null;

  private get database(): DatabaseSync {
    if (this.db === null) throw new Error("The store is not loaded.");
    return this.db;
  }

  async load(): Promise<void> {
    await mkdir(config.stateDir, { recursive: true });
    const file = path.join(config.stateDir, "fetcher.db");
    this.db = new DatabaseSync(file);
    // WAL keeps the reads fast while one writer works.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        hash     TEXT PRIMARY KEY,
        title    TEXT NOT NULL,
        added_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS done (
        hash    TEXT PRIMARY KEY,
        path    TEXT,
        bytes   INTEGER,
        done_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history (
        id     INTEGER PRIMARY KEY AUTOINCREMENT,
        hash   TEXT NOT NULL,
        title  TEXT NOT NULL,
        status TEXT NOT NULL,
        at     INTEGER NOT NULL,
        path   TEXT,
        bytes  INTEGER
      );
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    this.seedSettings();
    await this.migrateFromJson();
  }

  /**
   * Bring the old JSON state into the database, once. Earlier versions kept
   * three files in the state folder: queue.json, done.json, history.json.
   * On the first start after the upgrade, read them, copy the rows in, and
   * rename each file to `*.imported` so it is a backup and is not read again.
   * A marker in the settings table makes this run only once.
   */
  private async migrateFromJson(): Promise<void> {
    if (this.getSetting("jsonMigrated") === "1") return;

    const dir = config.stateDir;
    const queue = await readJsonFile<Job[]>(path.join(dir, "queue.json"));
    const done = await readJsonFile<string[]>(path.join(dir, "done.json"));
    const history = await readJsonFile<HistoryEntry[]>(path.join(dir, "history.json"));

    const db = this.database;

    // The old done.json is just a list of hashes, with no path. Take the path
    // and the size from the newest "downloaded" event, so a later import can
    // still find and delete the local copy.
    const meta = new Map<string, DoneInfo>();
    for (const entry of history ?? []) {
      if (entry.status === "downloaded") {
        const info: DoneInfo = {};
        if (entry.path !== undefined) info.path = entry.path;
        if (entry.bytes !== undefined) info.bytes = entry.bytes;
        meta.set(entry.hash, info);
      }
    }

    const insertQueue = db.prepare(
      "INSERT OR IGNORE INTO queue (hash, title, added_at) VALUES (?, ?, ?)",
    );
    for (const job of queue ?? []) {
      if (typeof job.hash !== "string" || job.hash === "") continue;
      insertQueue.run(job.hash, job.title ?? "", job.addedAt ?? Date.now());
    }

    const insertDone = db.prepare(
      "INSERT OR REPLACE INTO done (hash, path, bytes, done_at) VALUES (?, ?, ?, ?)",
    );
    const now = Date.now();
    for (const hash of done ?? []) {
      if (typeof hash !== "string" || hash === "") continue;
      const info = meta.get(hash);
      insertDone.run(hash, info?.path ?? null, info?.bytes ?? null, now);
    }

    const insertHistory = db.prepare(
      "INSERT INTO history (hash, title, status, at, path, bytes) VALUES (?, ?, ?, ?, ?, ?)",
    );
    for (const entry of history ?? []) {
      if (typeof entry.hash !== "string") continue;
      insertHistory.run(
        entry.hash,
        entry.title ?? "",
        entry.status,
        entry.at ?? now,
        entry.path ?? null,
        entry.bytes ?? null,
      );
    }

    // Keep the same caps the runtime uses, in case an old file was larger.
    db.exec(
      "DELETE FROM history WHERE id NOT IN " +
        "(SELECT id FROM history ORDER BY id DESC LIMIT 1000)",
    );
    db.exec(
      "DELETE FROM done WHERE hash NOT IN " +
        "(SELECT hash FROM done ORDER BY done_at DESC LIMIT 1000)",
    );

    this.putSetting("jsonMigrated", "1");

    if (queue !== null || done !== null || history !== null) {
      log(
        `Migrated the old JSON state: ${queue?.length ?? 0} queued, ` +
          `${done?.length ?? 0} done, ${history?.length ?? 0} history event(s). ` +
          `The old files are kept as *.imported.`,
      );
      await archive(path.join(dir, "queue.json"));
      await archive(path.join(dir, "done.json"));
      await archive(path.join(dir, "history.json"));
    }
  }

  /**
   * Write the first settings when the table is empty. The chown is seeded
   * from PUID and PGID, so the old environment-only behaviour still works.
   */
  private seedSettings(): void {
    const row = this.database
      .prepare("SELECT COUNT(*) AS n FROM settings")
      .get();
    if (toNumber(row?.["n"]) > 0) return;

    const hasOwner = config.owner.uid !== null || config.owner.gid !== null;
    this.writeSettings({
      chown: hasOwner,
      uid: config.owner.uid,
      gid: config.owner.gid,
      chmod: false,
      fileMode: DEFAULT_FILE_MODE,
      dirMode: DEFAULT_DIR_MODE,
    });
  }

  private getSetting(key: string): string | null {
    const row = this.database
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key);
    if (row === undefined) return null;
    return toText(row["value"]);
  }

  private putSetting(key: string, value: string): void {
    this.database
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  /** Parse a stored base-10 integer, or null when it is empty. */
  private intSetting(key: string): number | null {
    const value = this.getSetting(key);
    if (value === null || value === "") return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }

  /** Parse a stored octal mode like "664", or null when it is empty. */
  private modeSetting(key: string): number | null {
    const value = this.getSetting(key);
    if (value === null || value === "") return null;
    const parsed = Number.parseInt(value, 8);
    return Number.isInteger(parsed) ? parsed : null;
  }

  /** The current permission preferences. */
  settings(): Settings {
    return {
      chown: this.getSetting("chown") === "1",
      uid: this.intSetting("uid"),
      gid: this.intSetting("gid"),
      chmod: this.getSetting("chmod") === "1",
      fileMode: this.modeSetting("fileMode"),
      dirMode: this.modeSetting("dirMode"),
    };
  }

  /** Write a full settings object to the table. */
  private writeSettings(s: Settings): void {
    this.putSetting("chown", s.chown ? "1" : "0");
    this.putSetting("uid", s.uid === null ? "" : String(s.uid));
    this.putSetting("gid", s.gid === null ? "" : String(s.gid));
    this.putSetting("chmod", s.chmod ? "1" : "0");
    this.putSetting(
      "fileMode",
      s.fileMode === null ? "" : (s.fileMode & 0o7777).toString(8),
    );
    this.putSetting(
      "dirMode",
      s.dirMode === null ? "" : (s.dirMode & 0o7777).toString(8),
    );
  }

  /** Change some preferences and return the whole set after the change. */
  saveSettings(partial: Partial<Settings>): Settings {
    const merged: Settings = { ...this.settings(), ...partial };
    this.writeSettings(merged);
    return merged;
  }

  /** Close the database. Used by the tests. */
  close(): void {
    if (this.db !== null) {
      this.db.close();
      this.db = null;
    }
  }

  jobs(): Job[] {
    const rows = this.database
      .prepare("SELECT hash, title, added_at FROM queue ORDER BY added_at ASC")
      .all();
    return rows.map((row) => ({
      hash: toText(row["hash"]),
      title: toText(row["title"]),
      addedAt: toNumber(row["added_at"]),
    }));
  }

  knows(hash: string): boolean {
    const inQueue = this.database
      .prepare("SELECT 1 FROM queue WHERE hash = ?")
      .get(hash);
    if (inQueue !== undefined) return true;
    const inDone = this.database
      .prepare("SELECT 1 FROM done WHERE hash = ?")
      .get(hash);
    return inDone !== undefined;
  }

  async add(job: Job): Promise<void> {
    this.database
      .prepare(
        "INSERT OR IGNORE INTO queue (hash, title, added_at) VALUES (?, ?, ?)",
      )
      .run(job.hash, job.title, job.addedAt);
  }

  async remove(hash: string): Promise<void> {
    this.database.prepare("DELETE FROM queue WHERE hash = ?").run(hash);
  }

  /**
   * Mark a torrent finished and take it out of the queue. The path and the
   * byte count are kept, so a later import event can find the local file.
   */
  async markDone(hash: string, info: DoneInfo = {}): Promise<void> {
    this.database
      .prepare(
        "INSERT OR REPLACE INTO done (hash, path, bytes, done_at) VALUES (?, ?, ?, ?)",
      )
      .run(hash, info.path ?? null, info.bytes ?? null, Date.now());
    // Keep the last 1000 rows only. The table stays small.
    this.database.exec(
      "DELETE FROM done WHERE hash NOT IN " +
        "(SELECT hash FROM done ORDER BY done_at DESC LIMIT 1000)",
    );
    await this.remove(hash);
  }

  /** The recorded path of a finished torrent, or null if it is not known. */
  donePath(hash: string): string | null {
    const row = this.database
      .prepare("SELECT path FROM done WHERE hash = ?")
      .get(hash);
    if (row === undefined) return null;
    return toOptionalText(row["path"]) ?? null;
  }

  /** The history, newest event first. */
  history(): HistoryEntry[] {
    const rows = this.database
      .prepare(
        "SELECT hash, title, status, at, path, bytes FROM history ORDER BY id DESC",
      )
      .all();
    return rows.map((row) => {
      const entry: HistoryEntry = {
        hash: toText(row["hash"]),
        title: toText(row["title"]),
        status: toText(row["status"]) as HistoryStatus,
        at: toNumber(row["at"]),
      };
      const p = toOptionalText(row["path"]);
      if (p !== undefined) entry.path = p;
      const b = toOptionalNumber(row["bytes"]);
      if (b !== undefined) entry.bytes = b;
      return entry;
    });
  }

  /** Add one event to the history. The panel shows it. */
  async record(entry: HistoryEntry): Promise<void> {
    this.database
      .prepare(
        "INSERT INTO history (hash, title, status, at, path, bytes) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        entry.hash,
        entry.title,
        entry.status,
        entry.at,
        entry.path ?? null,
        entry.bytes ?? null,
      );
    // Keep the last 1000 events only. The table stays small.
    this.database.exec(
      "DELETE FROM history WHERE id NOT IN " +
        "(SELECT id FROM history ORDER BY id DESC LIMIT 1000)",
    );
  }
}
