/**
 * Tiny best-effort npm registry client.
 *
 * All network calls are wrapped: any failure (timeout, non-2xx, parse error) is
 * swallowed and reported as `null` so the calling tool can fall back to a
 * sensible default.
 */

export interface NpmPackageMeta {
  name: string;
  latestVersion: string;
  latestPublishedAt?: string;
}

const DEFAULT_TIMEOUT_MS = 4000;
const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/**
 * Fetch the latest version + publish time for a package. Returns `null` on
 * any failure — never throws.
 */
export async function fetchLatestFromRegistry(
  packageName: string,
  options: { timeoutMs?: number; registry?: string; fetchImpl?: typeof fetch } = {}
): Promise<NpmPackageMeta | null> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!isSafePackageName(packageName)) return null;

  const url = `${registry.replace(/\/+$/, "")}/${encodeURIComponent(packageName).replace(/^%40/, "@")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "repovitals/0.1" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      name?: string;
      "dist-tags"?: Record<string, string>;
      time?: Record<string, string>;
    };
    const latest = json["dist-tags"]?.latest;
    if (!latest) return null;
    const publishedAt = json.time?.[latest];
    return {
      name: json.name ?? packageName,
      latestVersion: latest,
      latestPublishedAt: publishedAt,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function isPossiblyAbandoned(isoPublishedAt: string | undefined, now: Date = new Date()): boolean {
  if (!isoPublishedAt) return false;
  const t = Date.parse(isoPublishedAt);
  if (Number.isNaN(t)) return false;
  const ageMs = now.getTime() - t;
  const twoYearsMs = 1000 * 60 * 60 * 24 * 365 * 2;
  return ageMs > twoYearsMs;
}

function isSafePackageName(name: string): boolean {
  if (!name) return false;
  if (name.length > 214) return false;
  // npm package names: lowercase, may start with @scope/
  return /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name);
}
