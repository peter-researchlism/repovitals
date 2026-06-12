import path from "node:path";
import { promises as fs } from "node:fs";
import { SOURCE_EXTENSIONS, walkFiles } from "../utils/fs-helpers.js";
import type { Finding, FindRotResult } from "../utils/types.js";

export interface FindRotOptions {
  /** Limit scan to specific root dirs relative to repoPath. Default: ["src"]. */
  scanRoots?: string[];
  /** File names that are always considered entry points (never dead). */
  entryPointNames?: string[];
}

const DEFAULT_ENTRY_POINTS = [
  "index.ts",
  "index.js",
  "main.ts",
  "main.js",
  "server.ts",
  "server.js",
  "app.ts",
  "app.js",
  "cli.ts",
  "cli.js",
];

const TODO_PATTERN = /\b(TODO|FIXME|XXX|HACK)\b/g;

const IMPORT_PATTERNS: RegExp[] = [
  // ESM static:  import x from 'foo';   import 'foo';   export ... from 'foo'
  /\bfrom\s*['"]([^'"]+)['"]/g,
  // ESM dynamic: import('foo')
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  // CommonJS:  require('foo')
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

const RESOLVE_EXTENSIONS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.js", "/index.tsx", "/index.jsx"];

/**
 * TypeScript under NodeNext / Node16 module resolution requires source files
 * to import their siblings with a `.js` extension even when the file on disk
 * is `.ts`. So given a spec like `./foo.js`, we should also try `./foo.ts`.
 */
const TS_STRIPPABLE_EXTS = [".js", ".jsx", ".mjs", ".cjs"];
const TS_CANDIDATE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

export async function findRot(repoPath: string, options: FindRotOptions = {}): Promise<FindRotResult> {
  const root = path.resolve(repoPath);
  const scanRoots = (options.scanRoots ?? ["src"]).map((r) => path.join(root, r));
  const entryPointNames = new Set(options.entryPointNames ?? DEFAULT_ENTRY_POINTS);

  // Collect all source files under the requested roots.
  const allFiles: string[] = [];
  for (const r of scanRoots) {
    if (!(await isDirectory(r))) continue;
    const files = await walkFiles(r, { extensions: SOURCE_EXTENSIONS });
    allFiles.push(...files);
  }

  const brokenImports: FindRotResult["brokenImports"] = [];
  const importedFiles = new Set<string>();
  const todoCounts: FindRotResult["todoCounts"] = [];
  const findings: Finding[] = [];

  for (const file of allFiles) {
    const rel = path.relative(root, file);
    const content = await fs.readFile(file, "utf8").catch(() => "");
    if (!content) continue;

    // TODO/FIXME density — count only markers that appear inside real
    // comments, not inside string or regex literals. Otherwise the detector
    // would flag its own source file (the keywords live inside the regex
    // literal below) and any source file that mentions a marker in a string.
    const todos = countCommentTodos(content);
    const loc = countLoc(content);
    if (todos > 0) {
      todoCounts.push({ file: rel, todos, loc, density: loc > 0 ? todos / loc : 0 });
    }

    // Imports
    for (const pattern of IMPORT_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const spec = match[1];
        if (!spec) continue;
        if (isBareSpecifier(spec)) continue; // not something we can verify on disk
        if (spec.startsWith("node:")) continue;
        const resolved = await resolveRelativeImport(file, spec);
        if (resolved) {
          importedFiles.add(path.resolve(resolved));
        } else {
          brokenImports.push({ file: rel, import: spec, resolved: tryResolveDisplay(file, spec) });
        }
      }
    }
  }

  // Dead-code detection
  const deadFiles: FindRotResult["deadFiles"] = [];
  for (const file of allFiles) {
    const rel = path.relative(root, file);
    const base = path.basename(file);
    if (entryPointNames.has(base)) continue;
    if (importedFiles.has(path.resolve(file))) continue;
    // Heuristic: skip test files when computing dead code.
    if (/\.(test|spec)\.(ts|js|tsx|jsx)$/.test(base)) continue;
    deadFiles.push({ file: rel, reason: "no inbound import detected" });
  }

  // Convert findings
  for (const b of brokenImports) {
    findings.push({
      id: `broken-import:${b.file}:${b.import}`,
      severity: "P0",
      category: "broken-import",
      title: `Broken relative import in ${b.file}`,
      detail: `Cannot resolve "${b.import}" from ${b.file}`,
      location: b.file,
    });
  }

  for (const d of deadFiles) {
    findings.push({
      id: `dead-code:${d.file}`,
      severity: "P1",
      category: "dead-code",
      title: `Possibly-unused file: ${d.file}`,
      detail: `No inbound import found. Verify it is intentionally a script or entry point.`,
      location: d.file,
    });
  }

  // TODO density
  todoCounts.sort((a, b) => b.density - a.density);
  for (const t of todoCounts) {
    findings.push({
      id: `todo:${t.file}`,
      severity: "P2",
      category: "todo-density",
      title: `${t.todos} TODO/FIXME marker(s) in ${t.file}`,
      detail: `density=${(t.density * 1000).toFixed(2)} per 1k LOC (${t.todos}/${t.loc} lines)`,
      location: t.file,
    });
  }

  return {
    repoPath: root,
    brokenImports,
    deadFiles,
    todoCounts,
    findings,
  };
}

function isBareSpecifier(spec: string): boolean {
  if (spec.startsWith(".") || spec.startsWith("/")) return false;
  return true;
}

/**
 * Count TODO/FIXME/XXX/HACK markers that appear inside real comments only.
 * Markers inside string literals (including template literals) or regex
 * literals are ignored — the detector source itself contains those four
 * keywords inside a regex literal, and any application code that mentions a
 * marker in a string or template (e.g. an error message, a UI label) should
 * not be flagged.
 */
function countCommentTodos(source: string): number {
  return (extractCommentRegions(source).match(TODO_PATTERN) ?? []).length;
}

/**
 * Returns a copy of `source` where every character that is NOT inside a
 * real comment (// line or /* block *​/) has been replaced with a space, with
 * newlines preserved so per-line density is unaffected. Running the TODO
 * regex on the result counts only comment markers.
 *
 * Implemented as a small state machine rather than a full parser. It
 * correctly handles:
 *   - // line comments up to the next newline
 *   - /* block comments *​/, including multi-line
 *   - '...' and "..." string literals with backslash escapes
 *   - `...` template literals, including ${...} interpolation (with nested
 *     strings and templates inside the interpolation)
 *   - /regex/ literals in a regex context (preceded by an operator, opening
 *     bracket/brace/paren, semicolon, colon, comma, or start of file)
 *
 * Known limits: it does not parse JSX text or TypeScript type-position
 * strings specially; both are handled as ordinary code regions, which is
 * fine for our purposes because neither commonly contains the words TODO,
 * FIXME, XXX, or HACK as bare text.
 */
function extractCommentRegions(source: string): string {
  type State = "code" | "line" | "block" | "sq" | "dq" | "tpl" | "regex";
  type TplInner = "code" | "sq" | "dq" | "bt";

  const REGEX_CONTEXT = /[=([{;:,!&|?+\-*/%<>^~]/;
  const drop = (ch: string): string => (ch === "\n" ? "\n" : " ");
  const keep = (ch: string): string => ch;

  let state: State = "code";
  let out = "";
  const n = source.length;
  let i = 0;

  while (i < n) {
    const c = source[i]!;
    const c2 = i + 1 < n ? source[i + 1]! : "";

    if (state === "code") {
      if (c === "/" && c2 === "/") {
        state = "line";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "/" && c2 === "*") {
        state = "block";
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "'") {
        state = "sq";
        out += " ";
        i++;
        continue;
      }
      if (c === '"') {
        state = "dq";
        out += " ";
        i++;
        continue;
      }
      if (c === "`") {
        state = "tpl";
        out += " ";
        i++;
        continue;
      }
      if (c === "/") {
        // Regex literal? Look back for the previous non-whitespace char.
        let j = i - 1;
        while (j >= 0 && (source[j] === " " || source[j] === "\t")) j--;
        const prev = j >= 0 ? source[j]! : "";
        if (!prev || REGEX_CONTEXT.test(prev)) {
          state = "regex";
          out += " ";
          i++;
          continue;
        }
      }
      out += drop(c);
      i++;
      continue;
    }

    if (state === "line") {
      if (c === "\n") {
        state = "code";
        out += "\n";
      } else {
        out += keep(c);
      }
      i++;
      continue;
    }

    if (state === "block") {
      if (c === "*" && c2 === "/") {
        state = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += keep(c);
      i++;
      continue;
    }

    if (state === "sq") {
      if (c === "\\" && i + 1 < n) {
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "'") {
        state = "code";
        out += " ";
        i++;
        continue;
      }
      out += drop(c);
      i++;
      continue;
    }

    if (state === "dq") {
      if (c === "\\" && i + 1 < n) {
        out += "  ";
        i += 2;
        continue;
      }
      if (c === '"') {
        state = "code";
        out += " ";
        i++;
        continue;
      }
      out += drop(c);
      i++;
      continue;
    }

    if (state === "tpl") {
      if (c === "\\" && i + 1 < n) {
        out += "  ";
        i += 2;
        continue;
      }
      if (c === "`") {
        state = "code";
        out += " ";
        i++;
        continue;
      }
      if (c === "$" && c2 === "{") {
        // Consume ${...}, tracking brace depth and skipping any nested
        // string/template contents. We do not recurse the full state machine
        // here, but the nesting rules are the same (quotes open/close a
        // string region; backticks open/close a nested template).
        out += "${";
        i += 2;
        let depth = 1;
        let inner: TplInner = "code";
        while (i < n && depth > 0) {
          const cc = source[i]!;
          const cc2 = i + 1 < n ? source[i + 1]! : "";
          if (inner === "code") {
            if (cc === "{") {
              depth++;
              out += "{";
              i++;
              continue;
            }
            if (cc === "}") {
              depth--;
              out += "}";
              i++;
              if (depth === 0) break;
              continue;
            }
            if (cc === "'") {
              inner = "sq";
              out += " ";
              i++;
              continue;
            }
            if (cc === '"') {
              inner = "dq";
              out += " ";
              i++;
              continue;
            }
            if (cc === "`") {
              inner = "bt";
              out += " ";
              i++;
              continue;
            }
            out += drop(cc);
            i++;
            continue;
          }
          if (inner === "sq") {
            if (cc === "\\" && i + 1 < n) {
              out += "  ";
              i += 2;
              continue;
            }
            if (cc === "'") {
              inner = "code";
              out += " ";
              i++;
              continue;
            }
            out += drop(cc);
            i++;
            continue;
          }
          if (inner === "dq") {
            if (cc === "\\" && i + 1 < n) {
              out += "  ";
              i += 2;
              continue;
            }
            if (cc === '"') {
              inner = "code";
              out += " ";
              i++;
              continue;
            }
            out += drop(cc);
            i++;
            continue;
          }
          // bt (nested template)
          if (cc === "\\" && i + 1 < n) {
            out += "  ";
            i += 2;
            continue;
          }
          if (cc === "`") {
            inner = "code";
            out += " ";
            i++;
            continue;
          }
          if (cc === "$" && cc2 === "{") {
            out += "${";
            i += 2;
            depth++;
            continue;
          }
          out += drop(cc);
          i++;
        }
        continue;
      }
      out += drop(c);
      i++;
      continue;
    }

    // state === "regex"
    if (c === "\\" && i + 1 < n) {
      out += "  ";
      i += 2;
      continue;
    }
    if (c === "[") {
      // Character class — contents are individual characters and never
      // contain multi-letter marker words, but replace them anyway for
      // consistency.
      out += " ";
      i++;
      while (i < n && source[i] !== "]") {
        if (source[i] === "\\" && i + 1 < n) {
          out += "  ";
          i += 2;
          continue;
        }
        out += source[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < n) {
        out += " ";
        i++;
      } // consume ]
      continue;
    }
    if (c === "/") {
      state = "code";
      out += " ";
      i++;
      // Skip regex flags (g, i, m, s, u, y, d)
      while (i < n && /[gimsuy]/.test(source[i]!)) {
        out += " ";
        i++;
      }
      continue;
    }
    out += drop(c);
    i++;
  }

  return out;
}

async function resolveRelativeImport(fromFile: string, spec: string): Promise<string | null> {
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates: string[] = [];
  for (const ext of RESOLVE_EXTENSIONS) {
    candidates.push(base + ext);
  }
  // TypeScript NodeNext/Node16: `./foo.js` may point at `./foo.ts`.
  for (const strip of TS_STRIPPABLE_EXTS) {
    if (base.endsWith(strip)) {
      const stripped = base.slice(0, -strip.length);
      for (const ext of TS_CANDIDATE_EXTS) candidates.push(stripped + ext);
      for (const ext of TS_CANDIDATE_EXTS) candidates.push(stripped + "/index" + ext);
    }
  }
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
      if (stat.isDirectory()) {
        for (const ie of RESOLVE_EXTENSIONS.filter((e) => e.startsWith("/index"))) {
          const c2 = candidate + ie;
          const s2 = await fs.stat(c2).catch(() => null);
          if (s2?.isFile()) return c2;
        }
      }
    } catch {
      // continue
    }
  }
  return null;
}

function tryResolveDisplay(fromFile: string, spec: string): string {
  return path.resolve(path.dirname(fromFile), spec);
}

function countLoc(content: string): number {
  return content.split("\n").filter((line) => line.trim().length > 0).length;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}
