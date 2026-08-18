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

/** Remove the last slash. The path parts then join correctly. */
function trim(value: string): string {
  return value.replace(/\/+$/, "");
}

/** The password comes from a file (a Docker secret) or from a variable. */
function password(): string {
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
  http: {
    port: number("LISTEN_PORT", 8080),
    host: optional("LISTEN_HOST", "0.0.0.0"),
    path: trim(optional("WEBHOOK_PATH", "/radarr")),
  },
  sftp: {
    host: required("SFTP_HOST"),
    port: number("SFTP_PORT", 22),
    user: optional("SFTP_USER", "torrent"),
    password: password(),
    /** The SFTP server shows the torrent data under this folder. */
    remoteDir: trim(optional("REMOTE_DIR", "/uploads")),
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
