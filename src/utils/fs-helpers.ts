import { promises as fs } from "node:fs";
import path from "node:path";

/** Directories we never want to descend into when scanning. */
export const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".next",
  ".turbo",
  "out",
]);

/** File extensions considered "source" for static scans. */
export const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function readJson<T = unknown>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function listDirectorySafe(p: string): Promise<string[]> {
  try {
    return await fs.readdir(p);
  } catch {
    return [];
  }
}

/** Walk a directory recursively, returning absolute file paths. */
export async function walkFiles(
  root: string,
  options: { skipDirs?: Set<string>; extensions?: Set<string> } = {}
): Promise<string[]> {
  const skipDirs = options.skipDirs ?? SKIP_DIRS;
  const extensions = options.extensions;
  const out: string[] = [];

  async function visit(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        await visit(full);
      } else if (entry.isFile()) {
        if (!extensions || extensions.has(path.extname(entry.name))) {
          out.push(full);
        }
      }
    }
  }

  await visit(root);
  return out;
}

/** Strip JSON comments in a tolerant way (for tsconfig, etc.). */
export function safeRelative(fromFile: string, toFile: string): string {
  return path.relative(path.dirname(fromFile), toFile);
}

/** A minimal SemVer comparator: returns -1, 0, or 1. */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! > pb[i]!) return 1;
    if (pa[i]! < pb[i]!) return -1;
  }
  if (pa[3] !== pb[3]) {
    if (pa[3] === undefined) return -1;
    if (pb[3] === undefined) return 1;
    if (pa[3] > pb[3]) return 1;
    if (pa[3] < pb[3]) return -1;
  }
  return 0;
}

function parseSemver(v: string): [number, number, number, number | undefined] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] ? preReleaseRank(m[4]) : undefined];
}

function preReleaseRank(id: string): number {
  if (id.includes("-")) return -1; // pre-release sorts before release
  return 0;
}

/** Strip leading "v" / caret / tilde / range operators from a version spec. */
export function cleanVersion(v: string | undefined | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  const match = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(trimmed);
  return match ? match[1]! : null;
}

/** Convert a non-relative spec range to a single version we can compare. */
export function rangeToVersion(range: string | undefined | null): string | null {
  if (!range) return null;
  // Try to pull out the first concrete version inside a range like "^1.2.0", "~1.2", "1.2.0 - 2.0.0"
  const match = /(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/.exec(range);
  return match ? match[1]! : null;
}
