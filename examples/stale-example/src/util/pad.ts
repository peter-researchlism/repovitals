// Used by format.ts. Has its own TODO marker.
import { leftPad as _lp } from "left-pad"; // bare import — not dead, not verifiable

export function leftPad(s: string, n: number): string {
  // TODO: delegate to left-pad once we audit the bundle
  if (s.length >= n) return s;
  return " ".repeat(n - s.length) + s;
}
