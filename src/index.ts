/**
 * The entry point.
 *
 * The modules load here, not at the top of the file. A bad setting then
 * gives one clear line, and not a stack trace.
 */
import { errorText, log } from "./log.js";

try {
  const { start } = await import("./app.js");
  await start();
} catch (error) {
  log(`ERROR at the start: ${errorText(error)}`);
  process.exit(1);
}
