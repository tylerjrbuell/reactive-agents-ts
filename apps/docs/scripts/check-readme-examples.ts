#!/usr/bin/env bun
/**
 * check-readme-examples: type-checks every ts/tsx fenced block in the root
 * README.md and every public packages/<dir>/README.md against the workspace
 * source (paths map `@reactive-agents/*` and `reactive-agents` to package src,
 * no rebuild needed).
 *
 * Report-only by default (prints a per-block table, exits 0). Flags:
 *   --fail   exit 1 when any checked block has a diagnostic (or README_EXAMPLES_FAIL=1)
 *   --json   machine output
 *
 * A block is skipped when it is marked pseudo: an HTML comment
 * `<!-- skip-typecheck -->` (or `<!-- docs-skip-typecheck -->`) on the nearest
 * non-blank line above the fence, or when the code holds a standalone `...`
 * placeholder. README snippets are meant to be copy-pasted, so unlike
 * scripts/check-doc-examples.ts this check injects NO placeholder globals or
 * auto-imports: a snippet must carry its own imports.
 *
 * The temp dir lives under node_modules/.cache so bare imports (`effect`,
 * workspace packages) resolve; an out-of-tree dir would pass vacuously.
 * Pure functions are exported for tests.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

export const REPO_ROOT = resolve(import.meta.dir, "..", "..", "..");
export const SKIP_MARKER = "skip-typecheck";

export interface ReadmeBlock {
  readonly file: string; // repo-relative
  readonly startLine: number; // 1-based line of the opening fence
  readonly lang: string;
  readonly code: string;
  readonly skipReason?: "marker" | "placeholder";
}

export interface BlockResult {
  readonly block: ReadmeBlock;
  readonly status: "PASS" | "FAIL" | "SKIP";
  readonly diagnostics: readonly string[];
}

/** True when the code holds a standalone `...` placeholder (spread syntax is followed by an identifier, so it is not matched). */
export function hasPlaceholder(code: string): boolean {
  return /\.\.\.(?=\s*(?:[,)\]}]|$|\/\/|\/\*))/m.test(code);
}

/** Extracts ts/tsx fenced blocks from markdown, flagging pseudo blocks. */
export function extractBlocks(md: string, file: string): ReadmeBlock[] {
  const lines = md.split("\n");
  const blocks: ReadmeBlock[] = [];
  let open: { lang: string; start: number; buf: string[]; marked: boolean } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (open === null) {
      const m = line.match(/^```(ts|tsx|typescript)\s*$/);
      if (m) {
        let marked = false;
        for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
          const t = lines[j]!.trim();
          if (t === "") continue;
          marked = t.includes(SKIP_MARKER);
          break;
        }
        open = { lang: m[1]!, start: i + 1, buf: [], marked };
      } else if (/^```/.test(line)) {
        // a non-ts fence: skip to its close so its contents are never scanned
        i++;
        while (i < lines.length && !/^`{3,}\s*$/.test(lines[i]!)) i++;
      }
      continue;
    }
    if (/^`{3,}\s*$/.test(line)) {
      const code = open.buf.join("\n");
      const skipReason = open.marked ? "marker" : hasPlaceholder(code) ? "placeholder" : undefined;
      blocks.push({ file, startLine: open.start, lang: open.lang, code, ...(skipReason ? { skipReason } : {}) });
      open = null;
      continue;
    }
    open.buf.push(line);
  }
  return blocks;
}

interface OwnershipEntry {
  readonly glob: string;
  readonly owner: string;
}

/** Owning warden for a README: root README is docs-warden; packages/<dir>/README.md uses tools/repo/ownership.json. */
export function ownerOf(file: string, entries: readonly OwnershipEntry[]): string {
  const m = file.match(/^packages\/([^/]+)\//);
  if (!m) return "docs-warden";
  const prefix = `packages/${m[1]}/`;
  const hit = entries.find((e) => e.glob.startsWith(prefix));
  return hit?.owner ?? "unowned";
}

function loadOwnership(root: string): OwnershipEntry[] {
  const p = join(root, "tools/repo/ownership.json");
  if (!existsSync(p)) return [];
  return (JSON.parse(readFileSync(p, "utf8")) as { entries: OwnershipEntry[] }).entries;
}

/** Root README plus every non-private packages/<dir>/README.md. */
export function collectReadmes(root: string = REPO_ROOT): string[] {
  const out = [join(root, "README.md")];
  const pkgs = join(root, "packages");
  for (const d of readdirSync(pkgs).sort()) {
    const readme = join(pkgs, d, "README.md");
    const pj = join(pkgs, d, "package.json");
    if (!existsSync(readme) || !existsSync(pj)) continue;
    if ((JSON.parse(readFileSync(pj, "utf8")) as { private?: boolean }).private === true) continue;
    out.push(readme);
  }
  return out;
}

function compilerOptions(root: string): ts.CompilerOptions {
  const metaPkgPath = join(root, "packages/reactive-agents/package.json");
  const subpaths: Record<string, string[]> = {};
  if (existsSync(metaPkgPath)) {
    const meta = JSON.parse(readFileSync(metaPkgPath, "utf8")) as { exports?: Record<string, unknown> };
    for (const key of Object.keys(meta.exports ?? {})) {
      if (key === ".") continue;
      const name = key.replace(/^\.\//, "");
      subpaths[`reactive-agents/${name}`] = [`packages/${name}/src/index.ts`];
    }
  }
  const { options } = ts.convertCompilerOptionsFromJson(
    {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      lib: ["ES2022", "DOM", "DOM.Iterable"],
      strict: true,
      jsx: "react-jsx",
      verbatimModuleSyntax: false,
      isolatedModules: false,
      noUnusedLocals: false,
      noUnusedParameters: false,
      noImplicitReturns: false,
      esModuleInterop: true,
      skipLibCheck: true,
      resolveJsonModule: true,
      noEmit: true,
      types: ["bun-types", "node"],
      ignoreDeprecations: "6.0",
      baseUrl: root,
      paths: {
        "@reactive-agents/*": ["packages/*/src/index.ts"],
        "reactive-agents": ["packages/reactive-agents/src/index.ts"],
        ...subpaths,
      },
    },
    root,
  );
  return options;
}

/** Type-checks all non-skipped blocks; returns one result per block. */
export function checkBlocks(blocks: readonly ReadmeBlock[], root: string = REPO_ROOT): BlockResult[] {
  const checked = blocks.filter((b) => b.skipReason === undefined);
  const cacheDir = join(root, "node_modules", ".cache");
  mkdirSync(cacheDir, { recursive: true });
  const tmp = mkdtempSync(join(cacheDir, "readme-examples-"));
  const diagsByBlock = new Map<ReadmeBlock, string[]>();
  try {
    const nameOf = new Map<string, ReadmeBlock>();
    checked.forEach((b, i) => {
      const ext = b.lang === "tsx" ? "tsx" : "ts";
      const name = `block_${String(i).padStart(4, "0")}.${ext}`;
      nameOf.set(name, b);
      // `export {}` forces module scope so top-level await is legal and names never collide.
      writeFileSync(join(tmp, name), `${b.code}\n\nexport {};\n`);
    });
    const options = compilerOptions(root);
    const host = ts.createCompilerHost(options);
    host.getCurrentDirectory = () => root;
    const program = ts.createProgram({ rootNames: [...nameOf.keys()].map((n) => join(tmp, n)), options, host });
    for (const sf of program.getSourceFiles()) {
      const m = sf.fileName.match(/(block_\d+\.tsx?)$/);
      const block = m ? nameOf.get(m[1]!) : undefined;
      if (!block) continue;
      for (const d of [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]) {
        if (d.category !== ts.DiagnosticCategory.Error) continue;
        const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 1;
        const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
        const arr = diagsByBlock.get(block) ?? [];
        arr.push(`${block.file}:${block.startLine + line} TS${d.code}: ${msg}`);
        diagsByBlock.set(block, arr);
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return blocks.map((block) => {
    if (block.skipReason) return { block, status: "SKIP", diagnostics: [] };
    const diagnostics = diagsByBlock.get(block) ?? [];
    return { block, status: diagnostics.length > 0 ? "FAIL" : "PASS", diagnostics };
  });
}

/** Markdown table: one row per block with first diagnostic and owning warden. */
export function renderTable(results: readonly BlockResult[], entries: readonly OwnershipEntry[]): string {
  const rows = ["| README | line | status | owner | first diagnostic |", "|---|---|---|---|---|"];
  for (const r of results) {
    const first = r.diagnostics[0]?.replace(/^[^ ]+ /, "").replace(/\|/g, "\\|") ?? (r.block.skipReason ? `skipped (${r.block.skipReason})` : "");
    rows.push(`| ${r.block.file} | ${r.block.startLine} | ${r.status} | ${ownerOf(r.block.file, entries)} | ${first} |`);
  }
  return rows.join("\n");
}

/** Failing blocks per README, with the owning warden. */
export function summarizeFailures(
  results: readonly BlockResult[],
  entries: readonly OwnershipEntry[],
): { file: string; owner: string; failing: number; checked: number }[] {
  const byFile = new Map<string, { failing: number; checked: number }>();
  for (const r of results) {
    if (r.status === "SKIP") continue;
    const cur = byFile.get(r.block.file) ?? { failing: 0, checked: 0 };
    cur.checked++;
    if (r.status === "FAIL") cur.failing++;
    byFile.set(r.block.file, cur);
  }
  return [...byFile.entries()]
    .filter(([, v]) => v.failing > 0)
    .map(([file, v]) => ({ file, owner: ownerOf(file, entries), ...v }));
}

if (import.meta.main) {
  const json = process.argv.includes("--json");
  const fail = process.argv.includes("--fail") || process.env["README_EXAMPLES_FAIL"] === "1";
  const entries = loadOwnership(REPO_ROOT);
  const blocks = collectReadmes().flatMap((abs) =>
    extractBlocks(readFileSync(abs, "utf8"), relative(REPO_ROOT, abs)),
  );
  const results = checkBlocks(blocks);
  const failing = results.filter((r) => r.status === "FAIL");
  if (json) {
    console.log(JSON.stringify({ results, failures: summarizeFailures(results, entries) }, null, 2));
  } else {
    console.log(renderTable(results, entries));
    console.log(
      `\nblocks ${results.length} | pass ${results.filter((r) => r.status === "PASS").length} | fail ${failing.length} | skip ${results.filter((r) => r.status === "SKIP").length}`,
    );
    for (const r of failing) for (const d of r.diagnostics) console.log(`  ${d}`);
  }
  if (fail && failing.length > 0) process.exit(1);
}
