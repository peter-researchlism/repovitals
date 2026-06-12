// Entry point for the stale example. Has a broken relative import on purpose.
import { greet } from "./greet.js";
import { notHere } from "./does-not-exist.js"; // P0: broken import

export function run(name: string): string {
  // TODO: add input validation
  return greet(name);
}
