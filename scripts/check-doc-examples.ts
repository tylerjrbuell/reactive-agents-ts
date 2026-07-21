#!/usr/bin/env bun
/**
 * docs:examples:check — the anti-rot gate for documentation code examples.
 *
 * Extracts every fenced ```ts / ```typescript block from README.md and
 * apps/docs/src/content/docs/ ** / *.{md,mdx}, writes each to a temp .ts file,
 * and typechecks the whole set with `tsc --noEmit` against the REAL workspace
 * source (paths map `reactive-agents` and `@reactive-agents/*` to package src,
 * so edits are live with no rebuild). A doc example that references a
 * non-existent export or the wrong API shape makes this go RED.
 *
 * Illustrative fragments (partial snippets, type signatures, result-shape
 * literals, bare `.withX()` method-chain fragments) opt out with a
 * `docs-skip-typecheck` marker. The marker is an INVISIBLE comment on the line
 * immediately before the code fence — `<!-- docs-skip-typecheck -->` in .md,
 * `{/* docs-skip-typecheck *​/}` in .mdx — so it never renders in the docs.
 * (A `// docs-skip-typecheck` inside the block also works but shows in output.)
 * The script REPORTS how many blocks it skips.
 *
 * Usage:
 *   bun run scripts/check-doc-examples.ts             # check all docs
 *   bun run scripts/check-doc-examples.ts --list      # list every block + status
 *   bun run scripts/check-doc-examples.ts <glob...>   # limit to matching source files
 */
import { Glob } from "bun";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import ts from "typescript";

const REPO_ROOT = resolve(import.meta.dir, "..");
const SKIP_MARKER = "docs-skip-typecheck";
// Skip-count ratchet. Baseline 2026-07-19: 283 → 262 (Wave 1) → 256 (Wave 3,
// 2026-07-20, after deleting the orchestration cookbook blocks) → 250
// (2026-07-21, fabricated-API docs fix: ToolBuilder/session/ContextProfile
// blocks corrected to compile and un-skipped) → 249 (2026-07-21, entry-page
// audit: your-first-agent testing block made self-contained and un-skipped).
// THE CEILING ONLY GOES DOWN:
// when you un-skip blocks, lower this number to the new skip count. Never
// raise it — adding a skip marker to dodge a failure is exactly the drift
// this gate exists to stop.
const SKIP_CEILING = 249;

interface Block {
  sourceFile: string; // repo-relative
  startLine: number; // 1-based line of the opening fence
  lang: string;
  code: string;
  skipped: boolean;
  tempName?: string;
  preambleLines?: number;
}

// ─── 1. collect source files ────────────────────────────────────────────────
const argFilters = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const listMode = process.argv.includes("--list");

async function collectFiles(): Promise<string[]> {
  const files: string[] = [];
  const readme = join(REPO_ROOT, "README.md");
  files.push(readme);
  const docGlob = new Glob("apps/docs/src/content/docs/**/*.{md,mdx}");
  for await (const f of docGlob.scan({ cwd: REPO_ROOT, absolute: true })) {
    files.push(f);
  }
  let result = files;
  if (argFilters.length > 0) {
    result = files.filter((f) =>
      argFilters.some((filter) => f.includes(filter)),
    );
  }
  return result.sort();
}

// A block opts out if the marker appears inside it OR on the nearest non-blank
// line above the opening fence (as an invisible HTML/JSX comment).
function precedingMarker(lines: string[], fenceIdx: number): boolean {
  for (let j = fenceIdx - 1; j >= 0 && j >= fenceIdx - 3; j--) {
    const t = lines[j].trim();
    if (t === "") continue;
    return t.includes(SKIP_MARKER);
  }
  return false;
}

// ─── 2. extract fenced ts/typescript blocks ─────────────────────────────────
function extractBlocks(absPath: string): Block[] {
  const rel = relative(REPO_ROOT, absPath);
  const lines = readFileSync(absPath, "utf8").split("\n");
  const blocks: Block[] = [];
  let inBlock = false;
  let lang = "";
  let buf: string[] = [];
  let startLine = 0;
  let precedeSkip = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w+)?/);
    if (!inBlock && fence && /^(ts|typescript)$/.test(fence[1] ?? "")) {
      inBlock = true;
      lang = fence[1] ?? "";
      buf = [];
      startLine = i + 1;
      precedeSkip = precedingMarker(lines, i);
      continue;
    }
    // Close on a fence at least as long as the opener (all openers are 3
    // backticks). CommonMark lets a 4-backtick line close a 3-backtick block —
    // MDX <TabItem> wrappers use this, so `^`{3,}` avoids swallowing siblings.
    if (inBlock && /^`{3,}\s*$/.test(line)) {
      const code = buf.join("\n");
      blocks.push({
        sourceFile: rel,
        startLine,
        lang,
        code,
        skipped: precedeSkip || code.includes(SKIP_MARKER),
      });
      inBlock = false;
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return blocks;
}

// ─── 3. build a tsconfig that resolves the workspace from src ────────────────
function packageSubpaths(): Record<string, string[]> {
  // reactive-agents/<x> subpath exports map 1:1 to packages/<x> (per the meta
  // package.json exports map). Enumerate from the meta package's exports.
  const metaPkg = JSON.parse(
    readFileSync(join(REPO_ROOT, "packages/reactive-agents/package.json"), "utf8"),
  ) as { exports: Record<string, unknown> };
  const paths: Record<string, string[]> = {};
  for (const key of Object.keys(metaPkg.exports)) {
    if (key === ".") continue;
    const name = key.replace(/^\.\//, ""); // e.g. "core"
    paths[`reactive-agents/${name}`] = [`packages/${name}/src/index.ts`];
  }
  return paths;
}

function gateCompilerOptions(): ts.CompilerOptions {
  const json = {
    target: "ES2022",
    module: "ESNext",
    moduleResolution: "bundler",
    lib: ["ES2022", "DOM", "DOM.Iterable"],
    strict: true,
    // Relaxed vs the repo config: doc snippets are typechecked for API
    // correctness, not compiled — allow value/type import mixing and unused
    // locals that read naturally in prose.
    verbatimModuleSyntax: false,
    isolatedModules: false,
    noUnusedLocals: false,
    noUnusedParameters: false,
    noImplicitReturns: false,
    // Doc callbacks routinely omit param types for brevity (`(payload) =>
    // ...`); that reads fine and is not an API-correctness concern.
    noImplicitAny: false,
    esModuleInterop: true,
    skipLibCheck: true,
    resolveJsonModule: true,
    noEmit: true,
    types: ["bun-types", "node"],
    ignoreDeprecations: "6.0",
    baseUrl: REPO_ROOT,
    paths: {
      "@reactive-agents/*": ["packages/*/src/index.ts"],
      "reactive-agents": ["packages/reactive-agents/src/index.ts"],
      "reactive-agents/compose/killswitches": [
        "packages/compose/src/killswitches/index.ts",
      ],
      ...packageSubpaths(),
    },
  };
  // convertCompilerOptionsFromJson handles the enum-valued fields
  // (target/module/lib/moduleResolution) exactly as a tsconfig.json would.
  const { options, errors } = ts.convertCompilerOptionsFromJson(json, REPO_ROOT);
  if (errors.length > 0) {
    for (const e of errors) {
      console.error(ts.flattenDiagnosticMessageText(e.messageText, "\n"));
    }
    process.exit(2);
  }
  return options;
}

// ─── 3b. narrative continuation support ──────────────────────────────────────
// Docs elide the `import` line in follow-up snippets and reference vars defined
// in an earlier block. We inject the missing framework import (KEEPING full type
// checking of e.g. `ReactiveAgents.create().withBadOption()`), and declare pure
// narrative placeholders. Both are injected ONLY when the block does not define
// the name itself — so blocks that DO construct the value are still fully checked.

// symbol → module. Injected as a real import when referenced but not imported.
const AUTO_IMPORTS: Record<string, string> = {
  ReactiveAgents: "reactive-agents",
  HarnessProfile: "reactive-agents",
  createAgent: "reactive-agents",
  AgentStream: "reactive-agents",
  Effect: "effect",
  Layer: "effect",
  Stream: "effect",
  Schema: "effect",
};

// Pure narrative placeholders — the result of an elided construction step.
// Declared as `any` (test tooling; the block that constructs them is still
// fully checked). Kept short and specific to avoid masking real names.
const PLACEHOLDERS = [
  "agent", "agent2", "result", "session", "builder", "restored", "config",
  "json", "obs", "orch", "harness", "workflow", "workflowId", "runId", "taskId",
  "llm", "eventBus", "state", "steps", "task", "run", "alerting", "metrics",
  "suite", "schemas", "sourceContext", "logFn", "goal", "query", "input",
  "killSwitchService", "agentId",
];

function definesName(code: string, name: string): boolean {
  const decl = new RegExp(
    `\\b(?:const|let|var|function|function\\*|class)\\s+${name}\\b`,
  );
  const imp = new RegExp(`\\bimport\\b[^;]*\\b${name}\\b[^;]*from`);
  const destructure = new RegExp(`(?:const|let|var)\\s*(?:\\{|\\[)[^}\\]]*\\b${name}\\b`);
  return decl.test(code) || imp.test(code) || destructure.test(code);
}

function references(code: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(code);
}

function buildPreamble(code: string): string {
  const imports: Record<string, string[]> = {};
  const declares: string[] = [];
  for (const [sym, mod] of Object.entries(AUTO_IMPORTS)) {
    if (references(code, sym) && !definesName(code, sym)) {
      (imports[mod] ??= []).push(sym);
    }
  }
  for (const name of PLACEHOLDERS) {
    if (
      references(code, name) &&
      !definesName(code, name) &&
      !(name in AUTO_IMPORTS)
    ) {
      declares.push(`declare const ${name}: any;`);
    }
  }
  const lines: string[] = [];
  for (const [mod, syms] of Object.entries(imports)) {
    lines.push(`import { ${[...new Set(syms)].join(", ")} } from "${mod}";`);
  }
  lines.push(...declares);
  return lines.length ? lines.join("\n") + "\n" : "";
}

// ─── 4. main ────────────────────────────────────────────────────────────────
const files = await collectFiles();
const allBlocks: Block[] = [];
for (const f of files) allBlocks.push(...extractBlocks(f));

const checked = allBlocks.filter((b) => !b.skipped);
const skipped = allBlocks.filter((b) => b.skipped);

// The temp dir MUST live inside the repo so bare imports (`effect`, the
// workspace packages, `bun-types`) resolve via the repo's node_modules —
// tsc from an out-of-tree /tmp dir can't find them and would pass vacuously.
const tmp = mkdtempSync(join(REPO_ROOT, ".doc-examples-tmp-"));
const byTempName = new Map<string, Block>();
checked.forEach((b, idx) => {
  const name = `block_${String(idx).padStart(4, "0")}.ts`;
  b.tempName = name;
  byTempName.set(name, b);
  const preamble = buildPreamble(b.code);
  b.preambleLines = preamble ? preamble.split("\n").length - 1 : 0;
  // `export {}` forces module scope so top-level names never collide and
  // top-level await is legal.
  writeFileSync(join(tmp, name), `${preamble}${b.code}\n\nexport {};\n`);
});
// Typecheck IN-PROCESS via the compiler API rather than spawning `tsc -p`.
// Rationale: when any single file has a syntax error, the tsc CLI suppresses
// semantic diagnostics for the ENTIRE program — one malformed snippet would
// hide every other block's API drift. Collecting per-file syntactic AND
// semantic diagnostics keeps every block independently accountable: a file
// with syntax errors reports them, and all other files still get full
// semantic checking.
const options = gateCompilerOptions();
const host = ts.createCompilerHost(options);
host.getCurrentDirectory = () => REPO_ROOT;
const rootNames = checked.map((b) => join(tmp, b.tempName!));
const program = ts.createProgram({ rootNames, options, host });

const setupDiags = program.getOptionsDiagnostics();
if (setupDiags.length > 0) {
  for (const d of setupDiags) {
    console.error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  }
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}

// ─── 5. map diagnostics back to doc blocks ───────────────────────────────────
const failingBlocks = new Map<Block, string[]>();
for (const sf of program.getSourceFiles()) {
  const m = sf.fileName.match(/block_(\d+)\.ts$/);
  if (!m) continue;
  const block = byTempName.get(`block_${m[1]}.ts`);
  if (!block) continue;
  const diags = [
    ...program.getSyntacticDiagnostics(sf),
    ...program.getSemanticDiagnostics(sf),
  ];
  for (const d of diags) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    // temp line = preamble + inner block line; map back past the injected preamble.
    const tempLine =
      d.file !== undefined && d.start !== undefined
        ? d.file.getLineAndCharacterOfPosition(d.start).line + 1
        : 1;
    const innerLine = tempLine - (block.preambleLines ?? 0);
    const docLine = block.startLine + Math.max(0, innerLine); // fence + inner line
    const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
    const arr = failingBlocks.get(block) ?? [];
    arr.push(`  ${block.sourceFile}:${docLine}  error TS${d.code}: ${msg}`);
    failingBlocks.set(block, arr);
  }
}

rmSync(tmp, { recursive: true, force: true });

// ─── 6. report ───────────────────────────────────────────────────────────────
const passing = checked.length - failingBlocks.size;
if (listMode) {
  for (const b of allBlocks) {
    const status = b.skipped
      ? "SKIP"
      : failingBlocks.has(b)
        ? "FAIL"
        : "PASS";
    console.log(`${status}  ${b.sourceFile}:${b.startLine}`);
  }
  console.log("");
}

if (failingBlocks.size > 0) {
  console.log("── Failing doc examples ──────────────────────────────────────");
  const byFile = new Map<string, string[]>();
  for (const [b, errs] of failingBlocks) {
    const arr = byFile.get(b.sourceFile) ?? [];
    arr.push(...errs);
    byFile.set(b.sourceFile, arr);
  }
  for (const [file, errs] of [...byFile.entries()].sort()) {
    console.log(`\n${file}`);
    for (const e of errs) console.log(e);
  }
  console.log("");
}

console.log("── docs:examples:check summary ───────────────────────────────");
console.log(`  source files scanned : ${files.length}`);
console.log(`  ts/tsx blocks found  : ${allBlocks.length}`);
console.log(`  checked (typechecked): ${checked.length}`);
console.log(`  passed               : ${passing}`);
console.log(`  failed               : ${failingBlocks.size}`);
console.log(`  skipped (marked)     : ${skipped.length}`);

let red = false;
if (failingBlocks.size > 0) {
  console.log(
    `\n✗ ${failingBlocks.size} doc example(s) do not typecheck. ` +
      `Fix the API usage or mark illustrative fragments with \`// ${SKIP_MARKER}\`.`,
  );
  red = true;
}
if (skipped.length > SKIP_CEILING) {
  console.log(
    `\n✗ skip-count ratchet violated: ${skipped.length} skipped block(s) > ` +
      `ceiling ${SKIP_CEILING} (overage ${skipped.length - SKIP_CEILING}). ` +
      `The ceiling only goes DOWN — remove ${SKIP_MARKER} markers (and lower ` +
      `SKIP_CEILING when un-skipping); never add skips to silence failures.`,
  );
  red = true;
}
if (red) process.exit(1);
console.log("\n✓ all checked doc examples typecheck.");
