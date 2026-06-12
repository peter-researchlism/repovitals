// Entry point for the healthy fixture. Intentionally small and connected.
import { add } from "./lib/math.js";

export function run(n: number): number {
  return add(n, 2);
}
