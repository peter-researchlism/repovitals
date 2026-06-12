#!/usr/bin/env node
/**
 * CLI helper: print the make_plan markdown for a given repo path.
 * Usage:  node dist/scripts/print-plan.js <repo-path>
 *         # or after build:
 *         npm run print-plan -- /path/to/repo
 */
import path from "node:path";
import { makePlan } from "../src/tools/make-plan.js";

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) {
    process.stderr.write("usage: print-plan <repo-path>\n");
    process.exit(2);
  }
  const abs = path.resolve(target);
  const plan = await makePlan(abs);
  process.stdout.write(plan.markdown);
  process.stdout.write("\n");
  // Also dump a one-line summary on stderr for the operator.
  process.stderr.write(
    `summary: P0=${plan.summary.p0} P1=${plan.summary.p1} P2=${plan.summary.p2} total=${plan.summary.total}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`print-plan failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
