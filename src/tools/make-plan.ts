import { scanDependencies } from "./scan-dependencies.js";
import { checkHealth } from "./check-health.js";
import { findRot } from "./find-rot.js";
import type {
  CheckHealthResult,
  Finding,
  FindRotResult,
  MakePlanResult,
  ScanDependenciesResult,
} from "../utils/types.js";

export interface MakePlanOptions {
  maxNetworkLookups?: number;
  fetchImpl?: typeof fetch;
  registry?: string;
  timeoutMs?: number;
}

export async function makePlan(repoPath: string, options: MakePlanOptions = {}): Promise<MakePlanResult> {
  const scanOpts = {
    fetchImpl: options.fetchImpl,
    registry: options.registry,
    maxNetworkLookups: options.maxNetworkLookups,
    timeoutMs: options.timeoutMs,
  };

  const [deps, health, rot] = await Promise.all([
    scanDependencies(repoPath, scanOpts),
    checkHealth(repoPath),
    findRot(repoPath),
  ]);

  const findings: Finding[] = [...rot.findings];

  // Health-driven findings
  for (const check of health.checks) {
    if (check.pass) continue;
    switch (check.id) {
      case "ci":
        findings.push({
          id: "missing-ci",
          severity: "P0",
          category: "missing-ci",
          title: "No CI configuration",
          detail: check.note,
        });
        break;
      case "test-script":
        findings.push({
          id: "missing-test-script",
          severity: "P0",
          category: "missing-test-script",
          title: 'No "test" script in package.json',
          detail: check.note,
        });
        break;
      case "lockfile":
        findings.push({
          id: "missing-lockfile",
          severity: "P0",
          category: "missing-lockfile",
          title: "No lockfile committed",
          detail: check.note,
        });
        break;
      case "readme":
        findings.push({
          id: "missing-readme",
          severity: "P1",
          category: "missing-readme",
          title: "No README at repo root",
          detail: check.note,
        });
        break;
      case "tests-dir":
        findings.push({
          id: "missing-tests-dir",
          severity: "P1",
          category: "missing-tests-dir",
          title: "No tests directory",
          detail: check.note,
        });
        break;
      case "engines":
        findings.push({
          id: "missing-engines",
          severity: "P1",
          category: "missing-engines",
          title: 'No "engines.node" in package.json',
          detail: check.note,
        });
        break;
      case "license":
        findings.push({
          id: "missing-license",
          severity: "P1",
          category: "missing-license",
          title: "No LICENSE at repo root",
          detail: check.note,
        });
        break;
    }
  }

  // Dependency-driven findings
  for (const dep of deps.dependencies) {
    if (dep.status === "possibly-abandoned") {
      findings.push({
        id: `abandoned:${dep.name}`,
        severity: "P1",
        category: "abandoned-dependency",
        title: `Possibly abandoned dependency: ${dep.name}`,
        detail: dep.note ?? `latest ${dep.latestVersion ?? "?"} published long ago`,
        location: dep.name,
      });
    } else if (dep.status === "outdated") {
      findings.push({
        id: `outdated:${dep.name}`,
        severity: "P2",
        category: "outdated-dependency",
        title: `Outdated dependency: ${dep.name}`,
        detail: dep.note ?? `current ${dep.currentRange}, latest ${dep.latestVersion ?? "?"}`,
        location: dep.name,
      });
    }
  }

  // Deduplicate by id (in case rot and health both flag the same thing)
  const seen = new Set<string>();
  const deduped = findings.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });

  // Sort: severity, then category, then title
  const sevOrder: Record<Finding["severity"], number> = { P0: 0, P1: 1, P2: 2 };
  deduped.sort((a, b) => {
    if (sevOrder[a.severity] !== sevOrder[b.severity]) return sevOrder[a.severity] - sevOrder[b.severity];
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.title.localeCompare(b.title);
  });

  const summary = {
    p0: deduped.filter((f) => f.severity === "P0").length,
    p1: deduped.filter((f) => f.severity === "P1").length,
    p2: deduped.filter((f) => f.severity === "P2").length,
    total: deduped.length,
  };

  const markdown = renderMarkdown({ deps, health, rot, findings: deduped, summary });
  return { markdown, summary };
}

function renderMarkdown(input: {
  deps: ScanDependenciesResult;
  health: CheckHealthResult;
  rot: FindRotResult;
  findings: Finding[];
  summary: MakePlanResult["summary"];
}): string {
  const { deps, health, rot, findings, summary } = input;
  const lines: string[] = [];

  lines.push(`# RepoVitals Remediation Plan`);
  lines.push("");
  lines.push(`Generated for: \`${health.repoPath}\``);
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(`- **P0 (must fix)**: ${summary.p0}`);
  lines.push(`- **P1 (should fix)**: ${summary.p1}`);
  lines.push(`- **P2 (nice to fix)**: ${summary.p2}`);
  lines.push(`- **Total findings**: ${summary.total}`);
  lines.push(`- **Health checks**: ${health.passCount} pass / ${health.failCount} fail`);
  lines.push(`- **Dependencies**: ${deps.summary.total} total — ${deps.summary.ok} ok, ${deps.summary.outdated} outdated, ${deps.summary.possiblyAbandoned} possibly abandoned, ${deps.summary.unknown} unknown${deps.offline ? " (offline mode)" : ""}`);
  lines.push(`- **Static analysis**: ${rot.brokenImports.length} broken import(s), ${rot.deadFiles.length} possibly unused file(s), ${rot.todoCounts.length} file(s) with TODO/FIXME markers`);
  lines.push("");

  const renderSection = (severity: Finding["severity"], title: string, intro: string) => {
    const items = findings.filter((f) => f.severity === severity);
    lines.push(`## ${title}`);
    lines.push("");
    if (items.length === 0) {
      lines.push("_No findings at this priority._");
      lines.push("");
      return;
    }
    if (intro) {
      lines.push(intro);
      lines.push("");
    }
    for (const f of items) {
      lines.push(`- **[${f.category}]** ${f.title}`);
      lines.push(`  - ${f.detail}${f.location ? ` (\`${f.location}\`)` : ""}`);
    }
    lines.push("");
  };

  renderSection("P0", "P0 — Critical (block release)", "Fix these first; they break builds, break imports, or have no test coverage.");
  renderSection("P1", "P1 — Important (weaken reliability)", "Tackle within the current iteration; they erode trust over time.");
  renderSection("P2", "P2 — Polish (technical debt)", "Backlog these; address opportunistically.");

  // Appendix: raw health checklist
  lines.push("## Appendix A — Health Checklist");
  lines.push("");
  lines.push("| Check | Result | Note |");
  lines.push("| --- | --- | --- |");
  for (const c of health.checks) {
    lines.push(`| ${c.label} | ${c.pass ? "✅ pass" : "❌ fail"} | ${c.note.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");

  // Appendix: dependency table (truncated)
  if (deps.dependencies.length > 0) {
    lines.push("## Appendix B — Dependencies");
    lines.push("");
    lines.push("| Name | Range | Resolved | Latest | Status | Note |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const d of deps.dependencies) {
      const note = (d.note ?? "").replace(/\|/g, "\\|");
      lines.push(`| ${d.name} | ${d.currentRange} | ${d.resolvedVersion ?? "—"} | ${d.latestVersion ?? "—"} | ${d.status} | ${note} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
