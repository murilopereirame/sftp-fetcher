/**
 * The peer-to-file download.
 *
 * This is the alternative to SFTP. The heavy lifting lives in p2f-lib: the
 * authenticated HTTP client, the transfer-key unwrap, the resumable
 * byte-range download, and the streaming AES-256-CTR decrypt. This file only
 * builds the client from the config and hands the work over.
 *
 * The behaviour matches src/sftp.ts on purpose. The remote data is read from
 * its local byte offset and appended, so a stopped copy resumes from the byte
 * it reached and the part files survive a retry, a later pass, and a restart.
 * The library verifies each finished file against the server's checksum.
 *
 * The server data stays there. This client never deletes a remote file.
 */
import { P2FClient, downloadPath } from "p2f-lib";
import { config } from "./config.js";
import type { ProgressHandler } from "./sftp.js";

let client: P2FClient | null = null;

/** One client for the whole run. It holds no session state, just the token. */
function getClient(): P2FClient {
  if (client === null) {
    client = new P2FClient({ baseUrl: config.p2f.url, token: config.p2f.token });
  }
  return client;
}

/**
 * Download one file or one folder into the local folder. `remotePath` is the
 * path inside the server's shared root. Returns the local path.
 */
export async function download(
  remotePath: string,
  localDir: string,
  onProgress?: ProgressHandler,
): Promise<string> {
  return downloadPath(getClient(), remotePath, localDir, {
    verify: config.p2f.verify,
    idleTimeoutMs: config.p2f.idleTimeoutMs,
    ...(onProgress ? { onProgress } : {}),
  });
}
