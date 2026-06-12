import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import os from "node:os";
import { findRot } from "../src/tools/find-rot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEALTHY = path.join(__dirname, "fixtures", "healthy-repo");
const STALE = path.resolve(__dirname, "..", "examples", "stale-example");

describe("find_rot", () => {
  it("finds no broken imports / no dead files in the healthy fixture", async () => {
    const result = await findRot(HEALTHY);
    expect(result.brokenImports).toEqual([]);
    expect(result.deadFiles).toEqual([]);
    expect(result.findings).toEqual([]);
  });

  it("finds broken imports, dead files, and TODO markers in the stale example", async () => {
    const result = await findRot(STALE);

    const broken = result.brokenImports.find((b) => b.file.endsWith("index.ts"));
    expect(broken).toBeDefined();
    expect(broken?.import).toBe("./does-not-exist.js");

    const orphan = result.deadFiles.find((d) => d.file.endsWith("orphan.ts"));
    expect(orphan).toBeDefined();

    // TODO/FIXME/HACK are scattered across the example.
    expect(result.todoCounts.length).toBeGreaterThan(0);
    const ids = result.findings.map((f) => f.category);
    expect(ids).toContain("broken-import");
    expect(ids).toContain("dead-code");
    expect(ids).toContain("todo-density");
  });

  it("treats CJS require the same as ESM from-imports", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repovitals-cjs-"));
    try {
      await fs.mkdir(path.join(dir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(dir, "src", "entry.cjs"),
        "const x = require('./missing.js');\nmodule.exports = x;\n"
      );
      const result = await findRot(dir);
      expect(result.brokenImports.length).toBe(1);
      expect(result.brokenImports[0]?.import).toBe("./missing.js");
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not count TODO/FIXME/XXX/HACK markers inside string or regex literals", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "repovitals-todo-no-fp-"));
    try {
      await fs.mkdir(path.join(dir, "src"), { recursive: true });
      await fs.writeFile(
        path.join(dir, "src", "no-fp.ts"),
        [
          "// real line comment with a real TODO: fix this thing",
          "const s1 = 'this string mentions TODO and FIXME but is not a comment';",
          "const s2 = \"double-quoted XXX and HACK stay in the string\";",
          "const s3 = `template literal with TODO and FIXME ignored too`;",
          "const r = /\\b(TODO|FIXME|XXX|HACK)\\b/g;",
          "/* block comment with one TODO marker */",
        ].join("\n"),
      );
      const result = await findRot(dir);
      const file = result.todoCounts.find((t) => t.file === "src/no-fp.ts");
      expect(file).toBeDefined();
      // Exactly 2: the line comment (1 TODO) + the block comment (1 TODO).
      // The 4 string mentions, 2 template-literal mentions, and 4 regex
      // literal mentions must all be ignored.
      expect(file?.todos).toBe(2);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("does not flag its own source as containing TODO markers (false-positive guard)", async () => {
    // The detector source (`src/tools/find-rot.ts`) contains the four
    // keywords inside a regex literal (`TODO_PATTERN = /\b(TODO|...)/g`) and
    // inside a template literal (`${t.todos} TODO/FIXME marker(s)…`), in
    // addition to several real `// TODO` and `/* TODO */` comments. The
    // detector must count only the real comments.
    //
    // To prove the fix is in effect, we read the file and compare two
    // counts:
    //   - `naive` = matches returned by the old broken approach (regex
    //     applied to the whole file, including string/regex literals)
    //   - `detector` = matches returned by find_rot for find-rot.ts
    //
    // If the false-positive fix is working, detector must be strictly less
    // than naive (regex+template-literal keywords are excluded). And
    // detector must be > 0 (real comments are still counted).
    const filePath = path.resolve(__dirname, "..", "src", "tools", "find-rot.ts");
    const source = await fs.readFile(filePath, "utf8");
    const naive = (source.match(/\b(TODO|FIXME|XXX|HACK)\b/g) ?? []).length;
    expect(naive).toBeGreaterThan(0);

    const REPO_ROOT = path.resolve(__dirname, "..");
    const result = await findRot(REPO_ROOT, { scanRoots: ["src/tools"] });
    const own = result.todoCounts.find((t) => t.file === "src/tools/find-rot.ts");
    expect(own).toBeDefined();
    expect(own!.todos).toBeGreaterThan(0);
    expect(own!.todos).toBeLessThan(naive);

    // Specifically: the regex-literal line contributes 4 keywords
    // (TODO/FIXME/XXX/HACK) and the template-literal title line contributes
    // 2 (TODO/FIXME). The detector must not count any of those 6.
    expect(naive - own!.todos).toBeGreaterThanOrEqual(6);
  });
});
