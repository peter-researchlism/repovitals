import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanDependencies } from "../src/tools/scan-dependencies.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "healthy-repo");

/** A fetch stub that always fails — simulates offline / blocked. */
const failingFetch: typeof fetch = (async () => {
  throw new Error("network unavailable");
}) as unknown as typeof fetch;

describe("scan_dependencies", () => {
  it("returns an empty result for a directory without package.json", async () => {
    const result = await scanDependencies(path.join(FIXTURE, "src"), { maxNetworkLookups: 0 });
    expect(result.dependencies).toEqual([]);
    expect(result.summary.total).toBe(0);
  });

  it("reads the fixture's package.json + lockfile and falls back to 'unknown' when the registry is unreachable", async () => {
    const result = await scanDependencies(FIXTURE, {
      fetchImpl: failingFetch,
      maxNetworkLookups: 5,
      timeoutMs: 50,
    });

    const names = result.dependencies.map((d) => d.name).sort();
    expect(names).toContain("left-pad");
    expect(names).toContain("vitest");

    const leftPad = result.dependencies.find((d) => d.name === "left-pad");
    expect(leftPad).toBeDefined();
    expect(leftPad?.currentRange).toBe("^1.3.0");
    expect(leftPad?.resolvedVersion).toBe("1.3.0");
    expect(leftPad?.dev).toBe(false);
    // With the network stub failing, status is unknown.
    expect(leftPad?.status).toBe("unknown");
    expect(result.offline).toBe(true);
  });

  it("honors maxNetworkLookups=0 without throwing", async () => {
    const result = await scanDependencies(FIXTURE, { maxNetworkLookups: 0 });
    expect(result.dependencies.length).toBeGreaterThan(0);
    expect(result.offline).toBe(true);
    for (const d of result.dependencies) {
      expect(["unknown"]).toContain(d.status);
    }
  });

  it("marks deps as 'ok' when the stub registry agrees with the resolved version", async () => {
    const okFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.endsWith("/left-pad")) throw new Error("404");
      return new Response(
        JSON.stringify({
          name: "left-pad",
          "dist-tags": { latest: "1.3.0" },
          time: { "1.3.0": new Date().toISOString() },
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const result = await scanDependencies(FIXTURE, {
      fetchImpl: okFetch,
      maxNetworkLookups: 5,
      timeoutMs: 200,
    });
    const leftPad = result.dependencies.find((d) => d.name === "left-pad");
    expect(leftPad?.status).toBe("ok");
    expect(leftPad?.latestVersion).toBe("1.3.0");
    expect(result.offline).toBe(false);
  });

  it("flags outdated + possibly-abandoned statuses from a stub registry", async () => {
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 3).toISOString();
    const fetchStub: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/left-pad")) {
        return new Response(
          JSON.stringify({
            name: "left-pad",
            "dist-tags": { latest: "2.0.0" },
            time: { "2.0.0": oldDate },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      if (url.endsWith("/vitest")) {
        return new Response(
          JSON.stringify({
            name: "vitest",
            "dist-tags": { latest: "2.0.0" },
            time: { "2.0.0": new Date().toISOString() },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      throw new Error("unexpected url: " + url);
    }) as unknown as typeof fetch;

    const result = await scanDependencies(FIXTURE, {
      fetchImpl: fetchStub,
      maxNetworkLookups: 10,
      timeoutMs: 200,
    });
    const leftPad = result.dependencies.find((d) => d.name === "left-pad");
    const vitest = result.dependencies.find((d) => d.name === "vitest");
    expect(leftPad?.status).toBe("possibly-abandoned");
    expect(vitest?.status).toBe("outdated");
  });
});
