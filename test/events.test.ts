import "./setup.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { activity, pushEvent } from "../src/events.js";

test("it keeps the lines and returns the newest first", () => {
  pushEvent("first line");
  pushEvent("second line");

  const feed = activity();
  assert.equal(feed[0]?.message, "second line");
  assert.equal(feed[1]?.message, "first line");
  assert.equal(typeof feed[0]?.at, "number");
});

test("the log function feeds the activity list", async () => {
  const { log } = await import("../src/log.js");
  log("a logged line");
  assert.equal(activity()[0]?.message, "a logged line");
});
