/**
 * The download, either way.
 *
 * The worker does not care how the bytes arrive. It hands a job's relative
 * path here, and this file picks the transport from the config: SFTP, or the
 * peer-to-file protocol. Both give the same thing back: the local path of the
 * new file or folder, with the same resume-safe part files on disk.
 *
 * The two transports build the full remote path from the same relative path
 * but their own root:
 *   sftp   REMOTE_DIR/<relative>       (e.g. /uploads/movies/Film.2024)
 *   p2f    P2F_REMOTE_DIR/<relative>   (a path inside the shared root)
 */
import { config } from "./config.js";
import { download as p2fDownload } from "./p2f.js";
import { download as sftpDownload, type ProgressHandler } from "./sftp.js";

/** Join a root and a relative path, with no root meaning the relative alone. */
function join(root: string, relative: string): string {
  return root === "" ? relative : `${root}/${relative}`;
}

/**
 * Download the item at `relative` into `localDir`. The transport comes from
 * TRANSFER_MODE. Returns the local path.
 */
export function fetchTo(
  relative: string,
  localDir: string,
  onProgress?: ProgressHandler,
): Promise<string> {
  if (config.mode === "p2f") {
    return p2fDownload(join(config.p2f.remoteDir, relative), localDir, onProgress);
  }
  return sftpDownload(join(config.sftp.remoteDir, relative), localDir, onProgress);
}
