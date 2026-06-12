import path from "node:path";
import { promises as fs } from "node:fs";
import { listDirectorySafe, pathExists, readJson } from "../utils/fs-helpers.js";
import type { CheckHealthResult, HealthCheckItem } from "../utils/types.js";

interface PackageJsonShape {
  scripts?: Record<string, string>;
}

export async function checkHealth(repoPath: string): Promise<CheckHealthResult> {
  const root = path.resolve(repoPath);
  const checks: HealthCheckItem[] = [];

  // 1. CI config
  const ci = await hasCiConfig(root);
  checks.push({
    id: "ci",
    label: "CI config present (.github/workflows)",
    pass: ci.pass,
    note: ci.note,
  });

  // 2. Test script
  const testScript = await hasTestScript(root);
  checks.push({
    id: "test-script",
    label: 'Test script defined in package.json',
    pass: testScript.pass,
    note: testScript.note,
  });

  // 3. README
  const readme = await hasReadme(root);
  checks.push({
    id: "readme",
    label: "README present",
    pass: readme.pass,
    note: readme.note,
  });

  // 4. Lockfile
  const lock = await hasLockfile(root);
  checks.push({
    id: "lockfile",
    label: "Lockfile present",
    pass: lock.pass,
    note: lock.note,
  });

  // 5. Tests directory
  const testsDir = await hasTestsDir(root);
  checks.push({
    id: "tests-dir",
    label: "Tests directory present",
    pass: testsDir.pass,
    note: testsDir.note,
  });

  // 6. package.json declares an engines.node field
  const engines = await hasEnginesNode(root);
  checks.push({
    id: "engines",
    label: 'package.json declares "engines.node"',
    pass: engines.pass,
    note: engines.note,
  });

  // 7. LICENSE file at repo root
  const license = await hasLicense(root);
  checks.push({
    id: "license",
    label: "LICENSE file present at repo root",
    pass: license.pass,
    note: license.note,
  });

  const passCount = checks.filter((c) => c.pass).length;
  const failCount = checks.length - passCount;

  return { repoPath: root, checks, passCount, failCount };
}

async function hasCiConfig(root: string): Promise<{ pass: boolean; note: string }> {
  const workflowsDir = path.join(root, ".github", "workflows");
  if (!(await pathExists(workflowsDir))) {
    return { pass: false, note: "no .github/workflows directory" };
  }
  const entries = await listDirectorySafe(workflowsDir);
  const wf = entries.filter((f) => /\.(yml|yaml)$/i.test(f));
  if (wf.length === 0) {
    return { pass: false, note: ".github/workflows exists but contains no YAML files" };
  }
  return {
    pass: true,
    note: `found ${wf.length} workflow file(s) (${wf.slice(0, 3).join(", ")}${wf.length > 3 ? ", …" : ""})`,
  };
}

async function hasTestScript(root: string): Promise<{ pass: boolean; note: string }> {
  const pkg = await readJson<PackageJsonShape>(path.join(root, "package.json"));
  if (!pkg) {
    return { pass: false, note: "no package.json found" };
  }
  const script = pkg.scripts?.test;
  if (!script) {
    return { pass: false, note: 'package.json has no "scripts.test"' };
  }
  return { pass: true, note: `"test" → ${script}` };
}

async function hasReadme(root: string): Promise<{ pass: boolean; note: string }> {
  const entries = await listDirectorySafe(root);
  const readmeMatch = entries.find((f) => /^readme(\.md|\.markdown|\.txt)?$/i.test(f));
  if (!readmeMatch) {
    return { pass: false, note: "no README file at repo root" };
  }
  // Bonus: report size
  try {
    const stat = await fs.stat(path.join(root, readmeMatch));
    return { pass: true, note: `${readmeMatch} (${stat.size} bytes)` };
  } catch {
    return { pass: true, note: readmeMatch };
  }
}

async function hasLockfile(root: string): Promise<{ pass: boolean; note: string }> {
  const candidates = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"];
  for (const name of candidates) {
    if (await pathExists(path.join(root, name))) {
      return { pass: true, note: name };
    }
  }
  return { pass: false, note: "no package-lock.json / yarn.lock / pnpm-lock.yaml" };
}

async function hasTestsDir(root: string): Promise<{ pass: boolean; note: string }> {
  const candidates = ["tests", "test", "__tests__", "spec"];
  for (const name of candidates) {
    const p = path.join(root, name);
    if (!(await pathExists(p))) continue;
    const stat = await fs.stat(p).catch(() => null);
    if (stat?.isDirectory()) {
      const entries = await listDirectorySafe(p);
      return { pass: true, note: `${name}/ (${entries.length} entries)` };
    }
  }
  return { pass: false, note: "no tests/, test/, or __tests__/ directory" };
}

async function hasEnginesNode(root: string): Promise<{ pass: boolean; note: string }> {
  // Re-use the PackageJsonShape with engines. We cast to a structural type
  // to avoid widening the existing interface.
  const pkg = await readJson<PackageJsonShape & { engines?: { node?: unknown } }>(
    path.join(root, "package.json")
  );
  if (!pkg) {
    return { pass: false, note: "no package.json found" };
  }
  const value = pkg.engines?.node;
  if (typeof value !== "string" || value.trim() === "") {
    return { pass: false, note: 'package.json has no "engines.node"' };
  }
  return { pass: true, note: `"engines.node" → ${value}` };
}

async function hasLicense(root: string): Promise<{ pass: boolean; note: string }> {
  const candidates = [
    "LICENSE",
    "LICENSE.md",
    "LICENSE.txt",
    "license",
    "license.md",
    "LICENCE",
    "LICENCE.md",
  ];
  for (const name of candidates) {
    const p = path.join(root, name);
    if (!(await pathExists(p))) continue;
    const stat = await fs.stat(p).catch(() => null);
    if (stat?.isFile()) {
      return { pass: true, note: `${name} (${stat.size} bytes)` };
    }
  }
  return { pass: false, note: "no LICENSE / LICENSE.md / LICENCE at repo root" };
}
