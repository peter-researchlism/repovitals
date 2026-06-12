// Used by index.ts — not dead, just simple.
import { padLeft } from "./util/format.js";

export function greet(name: string): string {
  // FIXME: trim whitespace from `name` before padding
  return `Hello, ${padLeft(name, 8)}!`;
}
