/**
 * Shared types for RepoVitals tools.
 */

export type DependencyStatus = "ok" | "outdated" | "possibly-abandoned" | "unknown";

export interface DependencyInfo {
  name: string;
  /** Version range as declared in package.json (e.g. "^1.2.0"). */
  currentRange: string;
  /** Concrete resolved version from the lockfile, when available. */
  resolvedVersion?: string;
  /** Latest version reported by the registry, when the lookup succeeded. */
  latestVersion?: string;
  /** Time the latest version was published (ISO 8601), when the registry returned it. */
  latestPublishedAt?: string;
  status: DependencyStatus;
  /** Short human-readable reason for the assigned status. */
  note?: string;
  /** True when this entry came from devDependencies. */
  dev: boolean;
}

export interface ScanDependenciesResult {
  repoPath: string;
  dependencies: DependencyInfo[];
  /** True when the registry could not be reached (offline / blocked / failed). */
  offline: boolean;
  summary: {
    total: number;
    ok: number;
    outdated: number;
    possiblyAbandoned: number;
    unknown: number;
  };
}

export interface HealthCheckItem {
  id: string;
  label: string;
  pass: boolean;
  note: string;
}

export interface CheckHealthResult {
  repoPath: string;
  checks: HealthCheckItem[];
  passCount: number;
  failCount: number;
}

export type FindingSeverity = "P0" | "P1" | "P2";

export type FindingCategory =
  | "broken-import"
  | "dead-code"
  | "todo-density"
  | "missing-ci"
  | "missing-test-script"
  | "missing-lockfile"
  | "missing-readme"
  | "missing-tests-dir"
  | "missing-engines"
  | "missing-license"
  | "abandoned-dependency"
  | "outdated-dependency";

export interface Finding {
  id: string;
  severity: FindingSeverity;
  category: FindingCategory;
  title: string;
  detail: string;
  location?: string;
}

export interface FindRotResult {
  repoPath: string;
  brokenImports: { file: string; import: string; resolved: string }[];
  deadFiles: { file: string; reason: string }[];
  todoCounts: { file: string; todos: number; loc: number; density: number }[];
  findings: Finding[];
}

export interface MakePlanResult {
  markdown: string;
  summary: {
    p0: number;
    p1: number;
    p2: number;
    total: number;
  };
}
