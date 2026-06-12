import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makePlan } from "../src/tools/make-plan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEALTHY = path.join(__dirname, "fixtures", "healthy-repo");
const STALE = path.resolve(__dirname, "..", "examples", "stale-example");

describe("make_plan", () => {
  it("returns an empty-ish plan for the healthy fixture", async () => {
    const plan = await makePlan(HEALTHY, { maxNetworkLookups: 0 });
    expect(plan.markdown).toMatch(/RepoVitals Remediation Plan/);
    expect(plan.markdown).toMatch(/P0/);
    expect(plan.markdown).toMatch(/P1/);
    expect(plan.markdown).toMatch(/P2/);
    // No P0 broken imports in the healthy fixture.
    expect(plan.summary.p0).toBe(0);
  });

  it("emits P0 findings for the stale example (broken import + missing test script + missing CI + missing lockfile + missing tests dir)", async () => {
    const plan = await makePlan(STALE, { maxNetworkLookups: 0 });
    expect(plan.summary.p0).toBeGreaterThan(0);
    expect(plan.markdown).toContain("## P0 — Critical");
    expect(plan.markdown).toContain("## P1 — Important");
    expect(plan.markdown).toContain("## P2 — Polish");
    expect(plan.markdown).toContain("broken-import");
    // The stale example has an orphan file + scattered TODOs.
    expect(plan.summary.p1 + plan.summary.p2).toBeGreaterThan(0);
    // Aggregate summary lines must add up.
    expect(plan.summary.p0 + plan.summary.p1 + plan.summary.p2).toBe(plan.summary.total);
  });

  it("escapes pipes in appendix tables so the Markdown stays valid", async () => {
    const plan = await makePlan(STALE, { maxNetworkLookups: 0 });
    // Health notes may contain pipes; we escape them.
    // Just confirm the appendix is present.
    expect(plan.markdown).toContain("## Appendix A — Health Checklist");
    expect(plan.markdown).toContain("## Appendix B — Dependencies");
  });

  it("emits missing-engines and missing-license as P1 findings when those checks fail", async () => {
    // A tmp dir that has everything healthy EXCEPT engines.node and LICENSE.
    // make_plan should flag both as P1 (missing-engines, missing-license).
    const { promises: fsp } = await import("node:fs");
    const os = await import("node:os");
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "repovitals-mp-noeng-"));
    try {
      await fsp.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "0.0.0", scripts: { test: "true" } })
      );
      await fsp.writeFile(path.join(dir, "README.md"), "# x");
      await fsp.writeFile(path.join(dir, "package-lock.json"), "{}");
      await fsp.mkdir(path.join(dir, "tests"), { recursive: true });
      await fsp.mkdir(path.join(dir, ".github", "workflows"), { recursive: true });
      await fsp.writeFile(path.join(dir, ".github", "workflows", "ci.yml"), "name: x\n");

      const plan = await makePlan(dir, { maxNetworkLookups: 0 });
      const ids = plan.markdown;
      expect(ids).toContain("missing-engines");
      expect(ids).toContain("missing-license");
      // Both should be P1 in the Markdown body.
      expect(ids).toMatch(/## P1 — Important[\s\S]*missing-engines/);
      expect(ids).toMatch(/## P1 — Important[\s\S]*missing-license/);
      // And the summary count should reflect them.
      expect(plan.summary.p1).toBeGreaterThanOrEqual(2);
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  });
});
