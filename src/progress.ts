/**
 * The progress of the running download.
 *
 * One transfer runs at a time. This module holds its numbers, so that the
 * log and the /status endpoint show the same values.
 */

export interface Progress {
  hash: string;
  title: string;
  /** The path on the seedbox. */
  name: string;
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
  /** Bytes each second, from the last two updates. */
  speed: number;
  /** Seconds to the end, or null if the speed is zero. */
  eta: number | null;
  startedAt: number;
}

let current: Progress | null = null;

export function setProgress(value: Progress | null): void {
  current = value;
}

export function getProgress(): Progress | null {
  return current;
}

export function percent(value: Progress): number {
  if (value.bytesTotal <= 0) return 0;
  return (value.bytesDone / value.bytesTotal) * 100;
}

/** Write a byte count in a short form. Example: "1.4 GiB". */
export function bytes(value: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** Write a number of seconds in a short form. Example: "6m 10s". */
export function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "unknown";
  const whole = Math.round(seconds);
  if (whole < 60) return `${whole}s`;
  if (whole < 3600) return `${Math.floor(whole / 60)}m ${whole % 60}s`;
  return `${Math.floor(whole / 3600)}h ${Math.floor((whole % 3600) / 60)}m`;
}

/** One log line for the current progress. */
export function line(value: Progress): string {
  return (
    `${percent(value).toFixed(1)} % ` +
    `(${bytes(value.bytesDone)} of ${bytes(value.bytesTotal)}) ` +
    `at ${bytes(value.speed)}/s, ` +
    `${duration(value.eta)} left ` +
    `[file ${value.filesDone + 1} of ${value.filesTotal}]`
  );
}
