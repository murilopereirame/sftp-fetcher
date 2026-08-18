/**
 * The SFTP download. It uses an API key nowhere: SFTP takes a password.
 *
 * The download reports progress. The program first lists the remote files
 * and adds the sizes. It then copies each file and counts the bytes.
 *
 * The data on the seedbox stays there. This program never deletes it.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import Client from "ssh2-sftp-client";
import { config } from "./config.js";
import { log } from "./log.js";

interface RemoteFile {
  /** The full path on the seedbox. */
  remote: string;
  /** The path under the download target. */
  relative: string;
  size: number;
}

export interface Transfer {
  bytesDone: number;
  bytesTotal: number;
  filesDone: number;
  filesTotal: number;
}

export type ProgressHandler = (transfer: Transfer) => void;

/** List one remote folder and all its subfolders. */
async function listFiles(
  client: Client,
  remoteDir: string,
  base = "",
): Promise<RemoteFile[]> {
  const files: RemoteFile[] = [];

  for (const entry of await client.list(remoteDir)) {
    const remote = `${remoteDir}/${entry.name}`;
    const relative = base === "" ? entry.name : `${base}/${entry.name}`;

    if (entry.type === "d") {
      files.push(...(await listFiles(client, remote, relative)));
    } else if (entry.type === "-") {
      files.push({ remote, relative, size: entry.size });
    } else {
      log(`The entry '${remote}' is not a file or a folder. It is not copied.`);
    }
  }

  return files;
}

/**
 * Download one file or one folder into the local folder.
 * Return the path of the new local item.
 */
export async function download(
  remotePath: string,
  localDir: string,
  onProgress?: ProgressHandler,
): Promise<string> {
  const client = new Client();
  const target = path.join(localDir, path.basename(remotePath));

  await client.connect({
    host: config.sftp.host,
    port: config.sftp.port,
    username: config.sftp.user,
    password: config.sftp.password,
    readyTimeout: 20_000,
  });

  try {
    const kind = await client.exists(remotePath);
    if (kind === false) {
      throw new Error(`The remote path '${remotePath}' does not exist.`);
    }

    // ---- step 1: the file list and the total size ----
    let files: RemoteFile[];
    if (kind === "d") {
      files = await listFiles(client, remotePath);
    } else {
      const info = await client.stat(remotePath);
      files = [{ remote: remotePath, relative: "", size: info.size }];
    }

    const bytesTotal = files.reduce((sum, file) => sum + file.size, 0);
    const transfer: Transfer = {
      bytesDone: 0,
      bytesTotal,
      filesDone: 0,
      filesTotal: files.length,
    };
    onProgress?.(transfer);

    // ---- step 2: the copy ----
    if (kind === "d") await mkdir(target, { recursive: true });

    for (const file of files) {
      const local = file.relative === "" ? target : path.join(target, file.relative);
      await mkdir(path.dirname(local), { recursive: true });

      const before = transfer.bytesDone;
      await client.fastGet(file.remote, local, {
        step: (transferred: number) => {
          transfer.bytesDone = before + transferred;
          onProgress?.(transfer);
        },
      });

      // The step count can stop short. Use the known size.
      transfer.bytesDone = before + file.size;
      transfer.filesDone += 1;
      onProgress?.(transfer);
    }
  } finally {
    await client.end();
  }

  return target;
}
