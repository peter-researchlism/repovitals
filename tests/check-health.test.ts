import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import os from "node:os";
import { checkHealth } from "../src/tools/check-health.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEALTHY = path.join(__dirname, "fixtures", "healthy-repo");

describe("check_health", () => {
  it("returns all seven checks passing for the healthy fixture", async () => {
    const result = await checkHealth(HEALTHY);
    const byId = Object.fromEntries(result.checks.map((c) => [c.id, c]));

    expect(result.passCount).toBe(7);
    expect(result.failCount).toBe(0);
    expect(byId["ci"]?.pass).toBe(true);
    expect(byId["test-script"]?.pass).toBe(true);
    expect(byId["readme"]?.pass).toBe(true);
    expect(byId["lockfile"]?.pass).toBe(true);
    expect(byId["tests-dir"]?.pass).toBe(true);
    expect(byId["engines"]?.pass).toBe(true);
    expect(byId["license"]?.pass).toBe(true);
  });

  it("reports failures for an empty / non-Node project", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repovitals-empty-"));
    try {
      const result = await checkHealth(dir);
      expect(result.passCount).toBe(0);
      expect(result.failCount).toBe(7);
      for (const c of result.checks) expect(c.pass).toBe(false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("flags the absence of a test script even when other checks pass", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repovitals-notest-"));
    try {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: "x",
          version: "0.0.0",
          scripts: { build: "tsc" },
          engines: { node: ">=18" },
          license: "MIT",
        })
      );
      await fs.writeFile(path.join(dir, "README.md"), "# x");
      await fs.writeFile(path.join(dir, "package-lock.json"), "{}");
      await fs.writeFile(path.join(dir, "LICENSE"), "MIT\n");
      await fs.mkdir(path.join(dir, "tests"), { recursive: true });
      await fs.mkdir(path.join(dir, ".github", "workflows"), { recursive: true });
      await fs.writeFile(path.join(dir, ".github", "workflows", "ci.yml"), "name: x\n");

      const result = await checkHealth(dir);
      const testScript = result.checks.find((c) => c.id === "test-script");
      expect(testScript?.pass).toBe(false);
      // All 7 checks accounted for: 6 pass, 1 fail (test-script).
      expect(result.passCount).toBe(6);
      expect(result.failCount).toBe(1);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("flags a missing engines.node field", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repovitals-noeng-"));
    try {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "0.0.0", scripts: { test: "true" } })
      );
      const result = await checkHealth(dir);
      const engines = result.checks.find((c) => c.id === "engines");
      expect(engines?.pass).toBe(false);
      expect(engines?.note).toMatch(/engines\.node/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("flags a missing LICENSE file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repovitals-nolic-"));
    try {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "0.0.0", scripts: { test: "true" } })
      );
      const result = await checkHealth(dir);
      const license = result.checks.find((c) => c.id === "license");
      expect(license?.pass).toBe(false);
      expect(license?.note).toMatch(/LICENSE/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("passes engines.node + LICENSE when both are present", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repovitals-both-"));
    try {
      await fs.writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "x", version: "0.0.0", engines: { node: ">=18" } })
      );
      await fs.writeFile(path.join(dir, "LICENSE"), "All rights reserved.\n");
      const result = await checkHealth(dir);
      expect(result.checks.find((c) => c.id === "engines")?.pass).toBe(true);
      expect(result.checks.find((c) => c.id === "license")?.pass).toBe(true);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
