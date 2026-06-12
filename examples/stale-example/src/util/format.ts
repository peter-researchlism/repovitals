// Used by greet.ts.
import { leftPad } from "./pad.js";

export function padLeft(s: string, n: number): string {
  // HACK: ignore the requested width for now
  return leftPad(s, n);
}
