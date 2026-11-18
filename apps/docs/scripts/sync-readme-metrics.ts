#!/usr/bin/env bun
/**
 * Sync the repo README + main package READMEs against the latest
 * metrics.json so GitHub-rendered stats stay in sync with the docs site.
 *
 * Approach: regex-replace specific stat patterns in known locations,
 * NOT a full rewrite. Failure mode is conservative — if a pattern
 * doesn't match anymore (because someone reworded a line), we log a
 * warning and move on rather than silently dropping content.
 *
 * Run:
 *   bun run apps/docs/scripts/sync-readme-metrics.ts
 *   bun run apps/docs/scripts/sync-readme-metrics.ts --check    # CI gate
 *
 * --check mode exits non-zero if any file would change, so CI can fail
 * on drift instead of silently fixing it.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const METRICS_FILE = resolve(REPO_ROOT, "apps/docs/src/data/metrics.json");

const checkMode = process.argv.includes("--check");

const metrics = JSON.parse(readFileSync(METRICS_FILE, "utf-8")) as {
  packages: number;
  packagesTotal: number;
  apps: number;
  grandTotal: number;
  tests: number;
  testFiles: number;
  phases: number;
  strategies: number;
  providers: number;
};

const fmt = (n: number) => n.toLocaleString();

/** Test count is a rounded-down floor ("20,700+"), never an exact number. */
const testsFloor = (n: number) => `${fmt(n)}+`;

/**
 * Test-file count as a floor ("1,600+"), not an exact number: the exact count
 * changed with every new test file, so each commit that added one turned the
 * CI metrics check red until README was resynced by hand.
 */
const filesFloor = (n: number) => `${fmt(Math.floor(n / 100) * 100)}+`;

/**
 * Each rule: a file path, plus an array of `{ pattern, replacement }`
 * entries that match a literal stat phrase and rewrite it. The pattern
 * uses `\d{1,3}(?:,\d{3})*` to match any current N — so we can rerun
 * any time and it converges to the metrics.json values.
 */
type Rule = { file: string; subs: { pattern: RegExp; replacement: string; label: string }[] };

const rules: Rule[] = [
  {
    file: "README.md",
    subs: [
      // bun test command help "(5,028 tests / 556 files, ~65s)"
      {
        label: "bun test help comment",
        pattern: /\([\d,]+\+? tests \/ [\d,]+\+? files(?=[,)])/,
        replacement: `(${testsFloor(metrics.tests)} tests / ${filesFloor(metrics.testFiles)} files`,
      },
      // Hero stats table "| **5,028 tests**             |"
      {
        label: "hero stats table tests",
        pattern: /\| \*\*[\d,]+\+? tests\*\*\s+\|/,
        replacement: `| **${testsFloor(metrics.tests)} tests**             |`,
      },
    ],
  },
  {
    // Docs prose that quotes counts (docs IA mission, 2026-11-17): same
    // metrics, same sync, so these cannot drift from metrics.json.
    file: "apps/docs/src/content/docs/guides/faq.mdx",
    subs: [
      {
        label: "faq tests across files",
        pattern: /[\d,]+\+? tests across [\d,]+\+? files/,
        replacement: `${testsFloor(metrics.tests)} tests across ${filesFloor(metrics.testFiles)} files`,
      },
      {
        label: "faq package counts",
        pattern: /\d+ packages on npm \(\d+ total in the monorepo, \d+ private\)/,
        replacement: `${metrics.packages} packages on npm (${metrics.packagesTotal} total in the monorepo, ${metrics.packagesTotal - metrics.packages} private)`,
      },
    ],
  },
  {
    file: "apps/docs/src/content/docs/guides/contributing.md",
    subs: [
      {
        label: "contributing bun test count",
        pattern: /# [\d,]+\+? tests — all must pass/,
        replacement: `# ${testsFloor(metrics.tests)} tests — all must pass`,
      },
      {
        label: "contributing build package count",
        pattern: /for all \d+ packages/,
        replacement: `for all ${metrics.packagesTotal} packages`,
      },
    ],
  },
];

// Removed 2026-08-16: "packages + apps inline" (headline package count
// deliberately dropped from the hero: see the "Reframe as architecture"
// framing decision) and "comparison table tests" (the comparison table was
// trimmed to defensible structural-differentiator rows only; a raw test-count
// row read as a bragging metric, not a comparison). Both patterns no longer
// have a corresponding line in README.md by design, not by drift.
// Removed 2026-11-18: "tests across files prose" (the README launch slim cut
// the Features > Confidence list; the hero table row and the bun test help
// comment still carry the synced count).

let driftDetected = false;

for (const rule of rules) {
  const path = join(REPO_ROOT, rule.file);
  if (!existsSync(path)) {
    console.warn(`[sync] skip — ${rule.file} not found`);
    continue;
  }
  const original = readFileSync(path, "utf-8");
  let updated = original;

  for (const sub of rule.subs) {
    if (!sub.pattern.test(updated)) {
      console.warn(`[sync] ${rule.file}: pattern not matched — "${sub.label}". Was the line reworded?`);
      continue;
    }
    updated = updated.replace(sub.pattern, sub.replacement);
  }

  if (updated !== original) {
    if (checkMode) {
      driftDetected = true;
      console.error(`[sync] ${rule.file}: would change (run without --check to fix)`);
    } else {
      writeFileSync(path, updated);
      console.log(`[sync] ${rule.file}: updated`);
    }
  } else {
    console.log(`[sync] ${rule.file}: in sync`);
  }
}

if (checkMode && driftDetected) process.exit(1);
