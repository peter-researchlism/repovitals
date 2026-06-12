# RepoVitals

> A fast, structured health diagnosis for any local code repository — exposed
> as an [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server
> so any AI coding agent can ask for it.

RepoVitals is a tiny TypeScript MCP server that registers four tools:

| Tool              | What it does                                                                  |
| ----------------- | ----------------------------------------------------------------------------- |
| `scan_dependencies` | Read `package.json` + lockfile, return each dep with an `ok / outdated / possibly-abandoned / unknown` status. Best-effort npm registry lookup with a graceful offline fallback. |
| `check_health`     | Return a pass/fail checklist: CI config, test script, README, lockfile, tests directory. |
| `find_rot`         | Static scan for broken relative imports, possibly-unused files, and TODO/FIXME density. |
| `make_plan`        | Aggregate the three above into a prioritized P0/P1/P2 Markdown remediation report. |

MVP scope: **Node / JavaScript / TypeScript repos only.** No Python or Go.

---

## Install · Build · Run

```bash
npm install && npm run build
```

Then, to run the server over stdio (the way an MCP host expects):

```bash
npm start
```

You should see **no output on stdout** — the server is waiting for JSON-RPC
messages on stdin. (`listTools` / `tools/call` are how clients talk to it.)

To sanity-check the analyzer without an MCP host, print the
`make_plan` report for the included stale example:

```bash
npm run build && node dist/scripts/print-plan.js examples/stale-example
```

A real run against the bundled `examples/stale-example` produces this
header (the full report is checked in at
[`examples/stale-example.plan.md`](examples/stale-example.plan.md)):

```markdown
# RepoVitals Remediation Plan

Generated for: `/…/examples/stale-example`

## Summary

- **P0 (must fix)**: 4
- **P1 (should fix)**: 6
- **P2 (nice to fix)**: 6
- **Total findings**: 16
- **Health checks**: 0 pass / 7 fail
- **Dependencies**: 4 total — 2 ok, 1 outdated, 1 possibly abandoned, 0 unknown
- **Static analysis**: 1 broken import(s), 1 possibly unused file(s), 5 file(s) with TODO/FIXME markers

## P0 — Critical (block release)

- **[broken-import]** Broken relative import in src/index.ts
  - Cannot resolve "./does-not-exist.js" from src/index.ts (`src/index.ts`)
- **[missing-ci]** No CI configuration
  - no .github/workflows directory
- **[missing-lockfile]** No lockfile committed
  - no package-lock.json / yarn.lock / pnpm-lock.yaml
- **[missing-test-script]** No "test" script in package.json
  - package.json has no "scripts.test"
```

`summary: P0=4 P1=6 P2=6 total=16` is also printed to stderr for scripting.

- `scan_dependencies`
- `check_health`
- `find_rot`
- `make_plan`

Each takes a single `repoPath` argument pointing at a local directory.

### Example prompt

> "Run RepoVitals on `/Users/me/code/my-app` and give me the P0 list."

Your agent will likely call `make_plan` first and then drill into individual
tools as needed.

---

## Tool reference

### `scan_dependencies(repoPath)`

Reads `package.json` (and `package-lock.json` / `npm-shrinkwrap.json` if
present) and returns:

```json
{
  "repoPath": "/abs/path",
  "offline": false,
  "summary": { "total": 42, "ok": 30, "outdated": 8, "possiblyAbandoned": 2, "unknown": 2 },
  "dependencies": [
    {
      "name": "left-pad",
      "currentRange": "^1.3.0",
      "resolvedVersion": "1.3.0",
      "latestVersion": "1.3.0",
      "latestPublishedAt": "2018-...",
      "status": "possibly-abandoned",
      "note": "latest published 7y ago",
      "dev": false
    }
  ]
}
```

**Status meanings:**

- `ok` — registry confirms current version matches the latest.
- `outdated` — registry reports a newer version.
- `possibly-abandoned` — latest version was published more than 2 years ago.
- `unknown` — could not reach the registry, or the version range was unparseable.

The tool **never throws** on network failure. If the registry is unreachable,
every dep is reported as `unknown` and `offline: true` is set.

### `check_health(repoPath)`

```json
{
  "repoPath": "/abs/path",
  "passCount": 5,
  "failCount": 2,
  "checks": [
    { "id": "ci",          "label": "CI config present (.github/workflows)",      "pass": true,  "note": "found 1 workflow file (ci.yml)" },
    { "id": "test-script", "label": "Test script defined in package.json",         "pass": true,  "note": "\"test\" → vitest run" },
    { "id": "readme",      "label": "README present",                              "pass": true,  "note": "README.md (7910 bytes)" },
    { "id": "lockfile",    "label": "Lockfile present",                           "pass": true,  "note": "package-lock.json" },
    { "id": "tests-dir",   "label": "Tests directory present",                    "pass": true,  "note": "tests/ (6 entries)" },
    { "id": "engines",     "label": "package.json declares \"engines.node\"",      "pass": true,  "note": "\"engines.node\" → >=18" },
    { "id": "license",     "label": "LICENSE file present at repo root",          "pass": false, "note": "no LICENSE / LICENSE.md / LICENCE at repo root" }
  ]
}
```

### `find_rot(repoPath)`

```json
{
  "repoPath": "/abs/path",
  "brokenImports": [
    { "file": "src/index.ts", "import": "./does-not-exist.js", "resolved": "/abs/.../src/does-not-exist.js" }
  ],
  "deadFiles": [
    { "file": "src/orphan.ts", "reason": "no inbound import detected" }
  ],
  "todoCounts": [
    { "file": "src/util/pad.ts", "todos": 1, "loc": 8, "density": 0.125 }
  ],
  "findings": [
    { "id": "broken-import:src/index.ts:./does-not-exist.js", "severity": "P0", "category": "broken-import", "title": "…", "detail": "…", "location": "src/index.ts" }
  ]
}
```

Notes on the static analysis:

- It scans `src/` by default; pass a custom `scanRoots` array via the API
  (the MCP tool currently exposes only `repoPath`).
- It walks the directory tree skipping `node_modules`, `dist`, `build`,
  `coverage`, `.git`, `.next`, `.turbo`, and `out`.
- Relative imports are resolved with the standard Node/TS resolution order,
  including the TS-NodeNext `.js`-extension-on-`.ts`-file quirk.
- Bare specifiers (`react`, `node:fs`) are ignored — they cannot be
  verified on disk.
- Files matching `*.test.*` / `*.spec.*` and common entry-point names
  (`index.ts`, `main.ts`, `app.ts`, …) are exempt from the dead-file check.
- TODO/FIXME/XXX/HACK markers are counted **only when they appear inside
  real comments** (`//` line or `/* */` block). A small state machine
  strips string literals, template literals (including `${...}`
  interpolation), and `/regex/` literals before applying the regex, so the
  detector will not flag its own source file or any code that mentions a
  marker in a string.
- TODO/FIXME/XXX/HACK markers are counted **only when they appear inside
  real comments** (`//` line or `/* */` block). A small state machine
  strips string literals, template literals (including `${...}`
  interpolation), and `/regex/` literals before applying the regex, so the
  detector will not flag its own source file or any code that mentions a
  marker in a string.

### `make_plan(repoPath)`

Calls the other three tools in parallel and returns:

```json
{
  "markdown": "# RepoVitals Remediation Plan\n\n…",
  "summary": { "p0": 3, "p1": 2, "p2": 5, "total": 10 }
}
```

The Markdown report contains three prioritized sections (**P0 / P1 / P2**)
plus an appendix with the raw health checklist and dependency table.

Severity rules (P0 → P2):

- **P0** — broken import, missing CI, missing test script, missing lockfile.
- **P1** — possibly-abandoned dep, missing README, missing tests dir, possibly-unused file, missing `engines.node`, missing LICENSE.
- **P2** — outdated dep, TODO/FIXME density.

---

## Project layout

```
repovitals/
├── src/
│   ├── index.ts              # MCP stdio entry point
│   ├── server.ts             # createServer() — registers the four tools
│   ├── tools/
│   │   ├── scan-dependencies.ts
│   │   ├── check-health.ts
│   │   ├── find-rot.ts
│   │   └── make-plan.ts
│   └── utils/
│       ├── fs-helpers.ts
│       ├── npm-registry.ts
│       └── types.ts
├── tests/                    # vitest suite
│   ├── fixtures/healthy-repo/
│   ├── scan-dependencies.test.ts
│   ├── check-health.test.ts
│   ├── find-rot.test.ts
│   ├── make-plan.test.ts
│   └── server.test.ts
├── examples/stale-example/   # deliberately-stale demo repo
├── scripts/print-plan.ts     # CLI: dump make_plan markdown
├── package.json
├── tsconfig.json
└── README.md
```

---

## Scope guardrails (MVP)

- **Node/JS/TS repos only.** Python and Go are out of scope for this version.
- **Best-effort network.** All registry calls are wrapped in timeouts and
  try/catch. Tools never throw on missing or blocked network.
- **Static analysis only.** No AST-based parsing — the import regex covers
  `import … from '…'`, `import('…')`, and `require('…')`. That is good
  enough for a health snapshot, not for a full compiler.
- **No background jobs, no daemon mode.** The server runs on stdio and exits
  when the host disconnects.

---

## License

MIT
