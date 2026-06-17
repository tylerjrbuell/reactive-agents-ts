#!/usr/bin/env bun
/**
 * Build-time metrics generator for the docs site.
 *
 * Single source of truth for the numbers that appear on the home page,
 * the cheatsheet, the architecture page, and anywhere else that cites
 * "30 packages / 5 apps / 12 phases / 5 strategies / 6 providers / N tests."
 *
 * Counts derived from filesystem + canonical TypeScript source — never
 * from a hardcoded literal that can drift. Test count is read from a
 * cached snapshot (refreshed by CI on PR merge to main).
 *
 * Output: apps/docs/src/data/metrics.json
 *
 * Run manually:   bun run apps/docs/scripts/generate-metrics.ts
 * Auto-run:       package.json "prebuild" hook
 */

import { readdirSync, readFileSync, statSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import * as fs from "node:fs";

const DOCS_DIR = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(DOCS_DIR, "../..");
const OUTPUT = resolve(DOCS_DIR, "src/data/metrics.json");
const CACHE_FILE = resolve(DOCS_DIR, "src/data/metrics-cache.json");

/** Read JSON safely, returning null on any failure. */
const readJson = <T>(path: string): T | null => {
  try { return JSON.parse(readFileSync(path, "utf-8")) as T; } catch { return null; }
};

/* ─────────── Filesystem counts ─────────── */

const countPackages = (): { total: number; publishable: number; private: number } => {
  const dir = join(REPO_ROOT, "packages");
  const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory());
  let publishable = 0;
  let priv = 0;
  for (const entry of entries) {
    const pkg = readJson<{ private?: boolean }>(join(dir, entry.name, "package.json"));
    if (!pkg) continue;
    if (pkg.private) priv++;
    else publishable++;
  }
  return { total: publishable + priv, publishable, private: priv };
};

const countApps = (): number => {
  const dir = join(REPO_ROOT, "apps");
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(join(dir, e.name, "package.json"))).length;
};

const countTestFiles = (): number => {
  const roots = ["packages", "apps"];
  let count = 0;
  const walk = (path: string) => {
    let entries: fs.Dirent[];
    try { entries = readdirSync(path, { withFileTypes: true }) as fs.Dirent[]; } catch { return; }
    for (const e of entries) {
      if (e.name.toString() === "node_modules" || e.name.toString() === "dist" || e.name.toString().startsWith(".")) continue;
      const full = join(path, e.name.toString());
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && (e.name.toString().endsWith(".test.ts") || e.name.toString().endsWith(".spec.ts"))) count++;
    }
  };
  for (const r of roots) walk(join(REPO_ROOT, r));
  return count;
};

const countDirectoryEntries = (relPath: string, predicate: (name: string) => boolean): number => {
  const dir = join(REPO_ROOT, relPath);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(predicate).length;
};

/* ─────────── Source-code parsing ─────────── */

/**
 * Parse the LifecyclePhase Schema.Literal in packages/runtime/src/types.ts
 * and return the count of phase strings. Uses paren-balance scanning so
 * a closing paren inside an inline JSDoc comment doesn't truncate the match
 * (a naive non-greedy regex bites on `(foo)` inside /** ... * /).
 */
const countLifecyclePhases = (): number => {
  const path = join(REPO_ROOT, "packages/runtime/src/types.ts");
  const src = readFileSync(path, "utf-8");
  const startTag = "export const LifecyclePhase = Schema.Literal(";
  const startIdx = src.indexOf(startTag);
  if (startIdx === -1) {
    throw new Error("Could not locate LifecyclePhase in types.ts — did the file move?");
  }

  // Walk forward from the opening paren, balancing parens, ignoring those
  // inside strings or block comments, until we close back to depth 0.
  let i = startIdx + startTag.length - 1; // position of opening (
  let depth = 0;
  let inString: '"' | "'" | "`" | null = null;
  let inBlockComment = false;

  for (; i < src.length; i++) {
    const ch = src[i];
    const next = src[i + 1];

    if (inBlockComment) {
      if (ch === "*" && next === "/") { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "/" && next === "*") { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch as '"' | "'" | "`"; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error("LifecyclePhase declaration is unbalanced");

  const block = src.slice(startIdx, i + 1);
  // Strip block comments before counting so JSDoc string literals don't sneak in
  const stripped = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const phaseMatches = stripped.match(/"[a-z][a-z-]*"/g);
  return phaseMatches?.length ?? 0;
};

/* ─────────── Test-count snapshot ─────────── */

/**
 * Test count comes from a snapshot file (refreshed by CI). Falls back to
 * test-file-count * average-tests-per-file if missing.
 */
const readTestCount = (testFiles: number): { tests: number; cached: boolean } => {
  const cache = readJson<{ tests: number; updated: string }>(CACHE_FILE);
  if (cache && typeof cache.tests === "number") {
    return { tests: cache.tests, cached: true };
  }
  // Conservative estimate: ~9 tests per file on average across this codebase
  return { tests: testFiles * 9, cached: false };
};

/* ─────────── Generate ─────────── */

const main = () => {
  const packages = countPackages();
  const apps = countApps();
  const testFiles = countTestFiles();
  const phases = countLifecyclePhases();
  const strategies = countDirectoryEntries(
    "packages/reasoning/src/strategies",
    (name) =>
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".spec.ts") &&
      !name.includes("prompts") &&
      !name.includes("registry") &&
      !name.includes("kernel") &&
      // `direct` is a no-op passthrough (no reasoning loop), not a reasoning
      // strategy — excluding it keeps the count honest at the marketed 6.
      !name.includes("direct"),
  );
  const providers = countDirectoryEntries(
    "packages/llm-provider/src/providers",
    (name) =>
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".spec.ts") &&
      !name.includes("probe"), // local-probe.ts is internal
  );
  // +1 for the deterministic test provider, registered separately
  const totalProviders = providers + 1;

  const { tests, cached } = readTestCount(testFiles);

  const metrics = {
    generatedAt: new Date().toISOString(),
    packages: packages.publishable,
    packagesPrivate: packages.private,
    packagesTotal: packages.total,
    apps,
    grandTotal: packages.total + apps,
    tests,
    testsCached: cached,
    testFiles,
    phases,
    strategies,
    providers: totalProviders,
  } as const;

  // Ensure output directory exists
  mkdirSync(resolve(DOCS_DIR, "src/data"), { recursive: true });
  writeFileSync(OUTPUT, JSON.stringify(metrics, null, 2) + "\n");

  console.log("[metrics] generated:", JSON.stringify(metrics, null, 2));
};

main();
