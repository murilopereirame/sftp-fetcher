/**
 * The test settings. Import this file FIRST in each test file.
 * The config module reads the environment when it loads, so the values
 * must be there before that.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(tmpdir(), "fetcher-test-"));

process.env["SFTP_HOST"] = "127.0.0.1";
process.env["SFTP_PORT"] = "2222";
process.env["SFTP_USER"] = "torrent";
process.env["SFTP_PASSWORD"] = "secret";
process.env["REMOTE_DIR"] = "/uploads";
process.env["QBIT_URL"] = "http://127.0.0.1:8080";
process.env["QBIT_API_KEY"] = "qbt_abcdefghijklmnopqrstuvwx1234";
process.env["QBIT_ROOT"] = "/downloads";
process.env["LOCAL_ROOT"] = path.join(root, "downloads");
process.env["STATE_DIR"] = path.join(root, "state");

export const testRoot = root;
