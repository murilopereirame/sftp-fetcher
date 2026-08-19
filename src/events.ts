/**
 * The activity feed.
 *
 * The program keeps the last log lines in memory. The web panel reads them
 * and shows a live list, the way Radarr shows its events. Nothing is on disk.
 * A restart starts with an empty feed.
 */

export interface ActivityEvent {
  /** The time of the line, in milliseconds. */
  at: number;
  message: string;
}

/** Keep this many lines. An old line drops off the front. */
const MAX = 500;

const feed: ActivityEvent[] = [];

/** Add one line to the feed. The log calls this for every line. */
export function pushEvent(message: string): void {
  feed.push({ at: Date.now(), message });
  if (feed.length > MAX) feed.shift();
}

/** The feed, newest line first. */
export function activity(): ActivityEvent[] {
  return [...feed].reverse();
}
