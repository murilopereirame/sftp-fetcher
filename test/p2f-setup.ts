/**
 * Test settings for the "p2f" mode. Import this file FIRST, like setup.ts.
 * It sets no SFTP_HOST on purpose: the p2f mode must not require it.
 *
 * The Node test runner runs each test file in its own process, so these
 * environment values do not leak into the SFTP-mode tests.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = mkdtempSync(path.join(tmpdir(), "fetcher-p2f-test-"));

process.env["TRANSFER_MODE"] = "p2f";
process.env["P2F_URL"] = "http://127.0.0.1:8000/";
process.env["P2F_TOKEN"] = "p2f_testtoken1234567890";
process.env["P2F_REMOTE_DIR"] = "/media";
process.env["QBIT_URL"] = "http://127.0.0.1:8080";
process.env["QBIT_API_KEY"] = "qbt_abcdefghijklmnopqrstuvwx1234";
process.env["QBIT_ROOT"] = "/downloads";
process.env["LOCAL_ROOT"] = path.join(root, "downloads");
process.env["STATE_DIR"] = path.join(root, "state");

export const testRoot = root;
