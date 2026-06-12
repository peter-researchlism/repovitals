import path from "node:path";
import {
  cleanVersion,
  compareSemver,
  pathExists,
  rangeToVersion,
  readJson,
} from "../utils/fs-helpers.js";
import { fetchLatestFromRegistry, isPossiblyAbandoned } from "../utils/npm-registry.js";
import type {
  DependencyInfo,
  DependencyStatus,
  ScanDependenciesResult,
} from "../utils/types.js";

interface PackageJsonShape {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface PackageLockShape {
  packages?: Record<string, { version?: string }>;
  dependencies?: Record<string, { version?: string }>;
}

export interface ScanDependenciesOptions {
  /** Override the network call for tests. */
  fetchImpl?: typeof fetch;
  /** Override the registry URL for tests. */
  registry?: string;
  /** Maximum deps to query against the network (default 50). */
  maxNetworkLookups?: number;
  /** Network timeout per lookup in ms. */
  timeoutMs?: number;
}

interface DepEntry {
  name: string;
  range: string;
  dev: boolean;
}

export async function scanDependencies(
  repoPath: string,
  options: ScanDependenciesOptions = {}
): Promise<ScanDependenciesResult> {
  const root = path.resolve(repoPath);
  const pkg = await readJson<PackageJsonShape>(path.join(root, "package.json"));
  if (!pkg) {
    return {
      repoPath: root,
      dependencies: [],
      offline: false,
      summary: zeroSummary(),
    };
  }

  const lock = await readLockfile(root);
  const entries = collectEntries(pkg);

  const maxLookups = options.maxNetworkLookups ?? 50;
  let networkCalls = 0;
  let anyNetworkFailure = false;
  let anyNetworkSuccess = false;

  const dependencies: DependencyInfo[] = [];
  for (const entry of entries) {
    const resolved = lock?.resolvedVersions.get(entry.name);
    const noteParts: string[] = [];
    let latestVersion: string | undefined;
    let latestPublishedAt: string | undefined;
    let status: DependencyStatus = "unknown";
    let networkAttempted = false;
    let networkSucceeded = false;

    if (networkCalls < maxLookups) {
      networkCalls++;
      networkAttempted = true;
      const meta = await fetchLatestFromRegistry(entry.name, {
        fetchImpl: options.fetchImpl,
        registry: options.registry,
        timeoutMs: options.timeoutMs,
      });
      if (meta) {
        networkSucceeded = true;
        latestVersion = meta.latestVersion;
        latestPublishedAt = meta.latestPublishedAt;
      } else {
        anyNetworkFailure = true;
      }
    } else {
      anyNetworkFailure = true; // skipped → treat as offline-ish
    }

    if (networkSucceeded) anyNetworkSuccess = true;

    const concreteCurrent = resolved ? cleanVersion(resolved) : rangeToVersion(entry.range);

    if (!networkSucceeded) {
      if (networkAttempted) {
        status = "unknown";
        noteParts.push("registry lookup failed");
      } else {
        status = "unknown";
        noteParts.push("registry lookup skipped (limit reached)");
      }
    } else if (latestVersion && concreteCurrent) {
      const cmp = compareSemver(latestVersion, concreteCurrent);
      if (cmp === 0) {
        status = "ok";
      } else if (latestPublishedAt && isPossiblyAbandoned(latestPublishedAt)) {
        status = "possibly-abandoned";
        noteParts.push(`latest published ${formatDateAgo(latestPublishedAt)}`);
      } else {
        status = "outdated";
        noteParts.push(`latest is ${latestVersion}`);
      }
    } else if (latestVersion && !concreteCurrent) {
      status = "unknown";
      noteParts.push(`could not parse current range "${entry.range}"`);
    } else {
      status = "unknown";
    }

    const info: DependencyInfo = {
      name: entry.name,
      currentRange: entry.range,
      dev: entry.dev,
      status,
    };
    if (resolved !== undefined) info.resolvedVersion = resolved;
    if (latestVersion !== undefined) info.latestVersion = latestVersion;
    if (latestPublishedAt !== undefined) info.latestPublishedAt = latestPublishedAt;
    if (noteParts.length > 0) info.note = noteParts.join("; ");
    dependencies.push(info);
  }

  // Stable order: dev first? No — keep declaration order, but sort by status severity.
  const order: Record<DependencyStatus, number> = {
    "possibly-abandoned": 0,
    outdated: 1,
    unknown: 2,
    ok: 3,
  };
  dependencies.sort((a, b) => {
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.name.localeCompare(b.name);
  });

  const summary = dependencies.reduce(
    (acc, d) => {
      acc.total++;
      if (d.status === "ok") acc.ok++;
      else if (d.status === "outdated") acc.outdated++;
      else if (d.status === "possibly-abandoned") acc.possiblyAbandoned++;
      else acc.unknown++;
      return acc;
    },
    zeroSummary()
  );

  const offline = !anyNetworkSuccess && entries.length > 0;

  return {
    repoPath: root,
    dependencies,
    offline,
    summary,
  };
}

function zeroSummary() {
  return { total: 0, ok: 0, outdated: 0, possiblyAbandoned: 0, unknown: 0 };
}

function collectEntries(pkg: PackageJsonShape): DepEntry[] {
  const out: DepEntry[] = [];
  const seen = new Set<string>();

  const push = (group: Record<string, string> | undefined, dev: boolean) => {
    if (!group) return;
    for (const [name, range] of Object.entries(group)) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, range, dev });
    }
  };

  push(pkg.dependencies, false);
  push(pkg.optionalDependencies, false);
  push(pkg.peerDependencies, false);
  push(pkg.devDependencies, true);
  return out;
}

async function readLockfile(root: string): Promise<{ resolvedVersions: Map<string, string> } | null> {
  const candidates = ["package-lock.json", "npm-shrinkwrap.json"];
  for (const name of candidates) {
    const p = path.join(root, name);
    if (!(await pathExists(p))) continue;
    const parsed = await readJson<PackageLockShape>(p);
    if (!parsed) continue;
    const map = new Map<string, string>();
    if (parsed.packages) {
      // v2/v3 lockfile: keys look like "node_modules/foo"
      for (const [key, val] of Object.entries(parsed.packages)) {
        if (!key) continue;
        if (key === "" || key === "node_modules/") continue;
        const idx = key.lastIndexOf("node_modules/");
        const name = idx >= 0 ? key.slice(idx + "node_modules/".length) : key;
        if (name && val?.version) map.set(name, val.version);
      }
    } else if (parsed.dependencies) {
      // v1 lockfile
      for (const [name, val] of Object.entries(parsed.dependencies)) {
        if (val?.version) map.set(name, val.version);
      }
    }
    return { resolvedVersions: map };
  }
  return null;
}

function formatDateAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

// Re-exported so the make_plan tool can re-use the registry util via the
// canonical entry point when needed. Currently unused outside this module.
export const __testing = { readLockfile, collectEntries };
