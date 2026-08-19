/**
 * The SFTP download. It uses an API key nowhere: SFTP takes a password.
 *
 * The download reports progress. The program first lists the remote files
 * and adds the sizes. It then copies each file and counts the bytes.
 *
 * The download resumes. Each file goes to the same local path every time.
 * If a copy stops, the local file keeps the bytes it already has. The next
 * try reads the remote file from that byte offset and appends the rest. So a
 * dropped connection does not throw the work away.
 *
 * The copy is one file at a time, from a byte offset (SFTP "start"). A whole
 * local file is then always a correct prefix of the remote file, and the
 * resume is safe. A parallel copy (fastGet) is faster but leaves holes, so it
 * cannot resume. This program chooses the safe way.
 *
 * The data on the seedbox stays there. This program never deletes it.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
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

/** What to do with one file, from the bytes it has on the local disk. */
export interface ResumePlan {
  /** The file is complete. Do not copy it. */
  skip: boolean;
  /** The byte offset to read from on the remote file. */
  start: number;
  /** Add to the local file (a resume), or write it new (from the start). */
  append: boolean;
}

/**
 * Decide how to copy one file, from the local size and the remote size.
 *   equal          the file is done. Skip it.
 *   local smaller  a part is there. Resume from the local size.
 *   local bigger   the local file is bad. Write it again from the start.
 */
export function planResume(existing: number, size: number): ResumePlan {
  if (existing === size) return { skip: true, start: size, append: false };
  if (existing > size) return { skip: false, start: 0, append: false };
  return { skip: false, start: existing, append: existing > 0 };
}

/** The size of a local file, or 0 if it is not there. */
async function localSize(target: string): Promise<number> {
  try {
    return (await stat(target)).size;
  } catch {
    return 0;
  }
}

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
 *
 * The copy resumes. A file that is already there in full is skipped. A file
 * with a part on disk is read from its byte offset and finished.
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

    // ---- step 2: the copy, one file at a time, with a resume ----
    if (kind === "d") await mkdir(target, { recursive: true });

    // The bytes of the files before this one. It keeps the total right.
    let base = 0;

    for (const file of files) {
      const local = file.relative === "" ? target : path.join(target, file.relative);
      await mkdir(path.dirname(local), { recursive: true });

      const existing = await localSize(local);
      const plan = planResume(existing, file.size);

      if (plan.skip) {
        // The whole file is already on disk. Count it and move on.
        base += file.size;
        transfer.bytesDone = base;
        transfer.filesDone += 1;
        onProgress?.(transfer);
        continue;
      }

      if (!plan.append && existing > 0) {
        // A bad part is on disk. Remove it and start the file again.
        await rm(local, { force: true });
      }

      if (plan.start > 0) {
        log(`Resume '${file.relative || path.basename(local)}' at ${plan.start} of ${file.size} bytes.`);
      }

      // The offset is already on disk. Show it before the first byte arrives.
      transfer.bytesDone = base + plan.start;
      onProgress?.(transfer);

      const reader = client.createReadStream(
        file.remote,
        plan.start > 0 ? { start: plan.start } : {},
      );
      const writer = createWriteStream(local, { flags: plan.append ? "a" : "w" });

      let read = 0;
      reader.on("data", (chunk: Buffer) => {
        read += chunk.length;
        transfer.bytesDone = base + plan.start + read;
        onProgress?.(transfer);
      });

      await pipeline(reader, writer);

      // Check the size. A short read means the link dropped. Throw, so the
      // caller tries again and the resume finishes the rest.
      const finalSize = await localSize(local);
      if (finalSize !== file.size) {
        throw new Error(
          `The file '${file.relative || path.basename(local)}' is short: ` +
            `${finalSize} of ${file.size} bytes. The next try resumes it.`,
        );
      }

      base += file.size;
      transfer.bytesDone = base;
      transfer.filesDone += 1;
      onProgress?.(transfer);
    }
  } finally {
    await client.end();
  }

  return target;
}
