import "./p2f-setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "../src/config.js";

test("the p2f mode is read from TRANSFER_MODE", () => {
  assert.equal(config.mode, "p2f");
});

test("the p2f url loses its trailing slash", () => {
  assert.equal(config.p2f.url, "http://127.0.0.1:8000");
});

test("the p2f token is read", () => {
  assert.equal(config.p2f.token, "p2f_testtoken1234567890");
});

test("the p2f remote dir loses its trailing slash", () => {
  assert.equal(config.p2f.remoteDir, "/media");
});

test("verify is on by default", () => {
  assert.equal(config.p2f.verify, true);
});

test("the p2f mode does not require an SFTP host", () => {
  // p2f-setup.ts sets no SFTP_HOST. Loading the config above must not throw.
  assert.equal(config.sftp.host, "");
});
