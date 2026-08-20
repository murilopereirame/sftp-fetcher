/**
 * All settings come from environment variables. See the compose file.
 */
import { readFileSync } from "node:fs";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`The environment variable ${name} is not set.`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function number(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`The environment variable ${name} is not a number.`);
  }
  return parsed;
}

/** A yes/no setting. "1", "true", "yes", "on" mean true. */
function boolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/** A secret comes from a file (a Docker secret) or from a variable. */
function secret(fileVar: string, plainVar: string, fallback = ""): string {
  const file = optional(fileVar, "");
  if (file !== "") {
    const firstLine = readFileSync(file, "utf8").split("\n")[0] ?? "";
    return firstLine.trim();
  }
  return optional(plainVar, fallback);
}

/** Remove the last slash. The path parts then join correctly. */
function trim(value: string): string {
  return value.replace(/\/+$/, "");
}

/**
 * A UID or a GID. Empty means "do not change the owner". A bad value is an
 * error, so a typo does not pass silently.
 */
function id(name: string): number | null {
  const value = process.env[name];
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`The environment variable ${name} is not a whole number.`);
  }
  return parsed;
}

/**
 * Where the file data comes from.
 *
 *   "sftp"  the seedbox over SFTP. The old default. Simple, but slow.
 *   "p2f"   a peer-to-file server, over its authenticated HTTP webseed.
 *           Resumable, encrypted, and much faster on a lossy link.
 *
 * Only the settings for the chosen mode are required. See the two config
 * blocks below.
 */
export type TransferMode = "sftp" | "p2f";

function transferMode(): TransferMode {
  const value = optional("TRANSFER_MODE", "sftp").toLowerCase();
  if (value !== "sftp" && value !== "p2f") {
    throw new Error('TRANSFER_MODE must be "sftp" or "p2f".');
  }
  return value;
}

const mode = transferMode();

/** The SFTP password. Required only in the "sftp" mode. */
function password(): string {
  if (mode !== "sftp") return "";
  const file = optional("SFTP_PASSWORD_FILE", "");
  if (file !== "") {
    const firstLine = readFileSync(file, "utf8").split("\n")[0] ?? "";
    return firstLine.trim();
  }
  return required("SFTP_PASSWORD");
}

export type QbitAuthMode = "apikey" | "password" | "none";

/**
 * qBittorrent 5.2.0 and Web API 2.14.1 added API keys. A key starts with
 * "qbt_" and goes in the Authorization header with the Bearer scheme.
 * There is no login call and no cookie.
 *
 *   "apikey"    the API key. This is the best mode for 5.2.0 and later.
 *   "password"  the user and the password. This is for older versions.
 *   "none"      no authentication. qBittorrent whitelists this IP.
 */
function authMode(): QbitAuthMode {
  const explicit = optional("QBIT_AUTH", "").toLowerCase();
  const key = optional("QBIT_API_KEY", "");

  if (explicit === "") {
    // No mode is set. A key means the apikey mode. Nothing means a password.
    return key === "" ? "password" : "apikey";
  }

  if (explicit !== "apikey" && explicit !== "password" && explicit !== "none") {
    throw new Error('QBIT_AUTH must be "apikey", "password", or "none".');
  }

  if (explicit === "apikey" && key === "") {
    throw new Error('QBIT_AUTH is "apikey", but QBIT_API_KEY is empty.');
  }

  return explicit;
}

export const config = {
  /** "sftp" or "p2f". See transferMode() above. */
  mode,
  http: {
    port: number("LISTEN_PORT", 8080),
    host: optional("LISTEN_HOST", "0.0.0.0"),
    /** Radarr posts its "On Grab" and "On Import" webhooks here. */
    radarrPath: trim(optional("WEBHOOK_PATH", "/radarr")),
    /** Sonarr posts its "On Grab" and "On Import" webhooks here. */
    sonarrPath: trim(optional("SONARR_WEBHOOK_PATH", "/sonarr")),
  },
  sftp: {
    // The host is required only in the "sftp" mode.
    host: mode === "sftp" ? required("SFTP_HOST") : optional("SFTP_HOST", ""),
    port: number("SFTP_PORT", 22),
    user: optional("SFTP_USER", "torrent"),
    password: password(),
    /** The SFTP server shows the torrent data under this folder. */
    remoteDir: trim(optional("REMOTE_DIR", "/uploads")),
  },
  p2f: {
    // The URL and the token are required only in the "p2f" mode.
    /** The peer-to-file server, e.g. http://10.0.0.1:8000. */
    url: mode === "p2f" ? trim(required("P2F_URL")) : trim(optional("P2F_URL", "")),
    /** An API token that starts with "p2f_". Make it on the server:
     *  node src/server/cli.ts add-token <user> <name>. */
    token:
      mode === "p2f"
        ? (() => {
            const value = secret("P2F_TOKEN_FILE", "P2F_TOKEN");
            if (value === "") throw new Error("P2F_TOKEN (or P2F_TOKEN_FILE) is not set.");
            return value;
          })()
        : secret("P2F_TOKEN_FILE", "P2F_TOKEN"),
    /** A prefix inside the server's shared root, if the tree is not at the
     *  root. Like REMOTE_DIR for SFTP. Empty means the shared root itself. */
    remoteDir: trim(optional("P2F_REMOTE_DIR", "")),
    /** Check each finished file against the server's plaintext SHA-256. */
    verify: boolean("P2F_VERIFY", true),
    /** Drop a stalled connection after this many ms with no bytes. */
    idleTimeoutMs: number("P2F_IDLE_TIMEOUT_MS", 60_000),
  },
  qbit: {
    url: trim(required("QBIT_URL")),
    /** "apikey", "password", or "none". See authMode() above. */
    auth: authMode(),
    /** The qBittorrent API key. It starts with "qbt_". */
    apiKey: optional("QBIT_API_KEY", ""),
    user: optional("QBIT_USER", "admin"),
    password: optional("QBIT_PASS", "adminadmin"),
    /** The prefix that qBittorrent reports in "content_path". */
    root: trim(optional("QBIT_ROOT", "/downloads")),
  },
  /** The download folder, as THIS container sees it. */
  localRoot: trim(optional("LOCAL_ROOT", "/downloads")),
  stateDir: trim(optional("STATE_DIR", "/state")),
  /**
   * The owner for the files this program puts on the local disk. Set PUID and
   * PGID to the UID and the GID that Radarr runs as, and each finished file is
   * chowned to them. Radarr can then import it with no permission error. Empty
   * means "leave the owner as it is".
   */
  owner: {
    uid: id("PUID"),
    gid: id("PGID"),
  },
  /**
   * Delete the local copy when Radarr sends its "On Import" webhook. The film
   * is in the library by then, so the staged copy only wastes disk. The
   * seedbox data is never touched. Set to false to keep the local copy.
   */
  removeAfterImport: boolean("REMOVE_AFTER_IMPORT", true),
  timing: {
    /** Seconds between two passes over the queue. */
    pollInterval: number("POLL_INTERVAL", 60),
    /** A job stops after this many hours. */
    maxWaitHours: number("MAX_WAIT_HOURS", 48),
    copyTries: number("COPY_TRIES", 3),
    copyWaitSeconds: number("COPY_WAIT", 60),
    /** Seconds between two progress lines in the log. */
    progressInterval: number("PROGRESS_INTERVAL", 15),
  },
} as const;

export type Config = typeof config;
