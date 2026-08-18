/** Write one line to stdout. Read it with "docker logs". */
export function log(message: string): void {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`${now} ${message}`);
}

/** Show only the first 8 characters of an infohash. The log stays short. */
export function short(hash: string): string {
  return hash.slice(0, 8);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
