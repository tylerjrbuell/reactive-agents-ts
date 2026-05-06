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
      // "35 total" header label
      {
        label: "grand-total header",
        pattern: /\*\*\d+ total\*\*/,
        replacement: `**${metrics.grandTotal} total**`,
      },
      // "30 packages + 5 apps"
      {
        label: "packages + apps inline",
        pattern: /\d+ packages \+ \d+ apps/,
        replacement: `${metrics.packagesTotal} packages + ${metrics.apps} apps`,
      },
      // "**5,028 tests · 556 files**"
      {
        label: "tests · files header",
        pattern: /\*\*[\d,]+ tests · \d+ files\*\*/,
        replacement: `**${fmt(metrics.tests)} tests · ${metrics.testFiles} files**`,
      },
      // "5,028 tests across 556 files" prose
      {
        label: "tests across files prose",
        pattern: /\*\*[\d,]+ tests\*\* across \d+ files/,
        replacement: `**${fmt(metrics.tests)} tests** across ${metrics.testFiles} files`,
      },
      // Comparison table row "5,028 tests"
      {
        label: "comparison table tests",
        pattern: /\|\s+[\d,]+ tests\s+\|/,
        replacement: `|   ${fmt(metrics.tests)} tests   |`,
      },
      // bun test command help "(5,028 tests / 556 files, ~65s)"
      {
        label: "bun test help comment",
        pattern: /\([\d,]+ tests \/ \d+ files,/,
        replacement: `(${fmt(metrics.tests)} tests / ${metrics.testFiles} files,`,
      },
    ],
  },
];

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
