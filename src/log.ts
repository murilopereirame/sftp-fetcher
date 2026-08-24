import { pushEvent } from "./events.js";
import type { LogLevel } from "./config.js";

/**
 * The current log level. It starts from LOG_LEVEL (see config.ts) and can be
 * changed at runtime from the web panel Settings tab (see store.ts). This
 * module cannot import the store to read it live: the store already imports
 * this module for its own log lines, and a two-way import would be circular.
 * So the level lives here, and app.ts and the settings endpoint call
 * setLogLevel() whenever it changes.
 */
let level: LogLevel = "info";

export function setLogLevel(next: LogLevel): void {
  level = next;
}

export function currentLogLevel(): LogLevel {
  return level;
}

function write(message: string): void {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`${now} ${message}`);
  // The web panel reads the same lines from memory.
  pushEvent(message);
}

/** Write one line to stdout. Read it with "docker logs". Always shown. */
export function log(message: string): void {
  write(message);
}

/**
 * Write one line only when the log level is "debug". Used for the raw
 * Radarr/Sonarr webhook body and other detail that is too noisy for every
 * day but useful when tracking down a webhook that behaves oddly.
 */
export function debug(message: string): void {
  if (level === "debug") write(`DEBUG: ${message}`);
}

/** Show only the first 8 characters of an infohash. The log stays short. */
export function short(hash: string): string {
  return hash.slice(0, 8);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
