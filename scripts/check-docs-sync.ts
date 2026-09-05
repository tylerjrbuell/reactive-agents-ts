#!/usr/bin/env bun
/**
 * docs:sync:check — deterministic docs-vs-code sync ledger.
 *
 * Rule-based, git-history-driven drift detector: scripts/docs-sync-ledger.json
 * pairs code paths with the doc paths that must move with them. For each
 * rule, this script walks `git log <lastSha>..HEAD -- <codePaths>`:
 *
 *   - no commits touch codePaths           → in sync, nothing to do
 *   - commits touch codePaths AND docPaths  → docs moved together, auto-advance
 *   - commits touch codePaths, docPaths didn't → DRIFT, exit 1
 *
 * A rule with `versionHeaderTrigger` (e.g. CHANGELOG.md ↔ What's New) swaps
 * "any commit touched this file" for "a NEW dated `## [X.Y.Z]` header exists
 * at HEAD that wasn't there at lastSha" — CHANGELOG.md accumulates entries
 * under `## [Unreleased]` between releases, and firing on every one of those
 * would make the gate go red on routine commits, not just at release cuts.
 *
 * This needs no LLM judgment for the two easy cases — only real drift
 * (code moved, docs didn't) surfaces for a human/agent to fix. Ledger
 * baselines are commit SHAs, so this requires full git history
 * (`actions/checkout@v4` with `fetch-depth: 0`, or a local non-shallow clone).
 *
 * Usage:
 *   bun run scripts/check-docs-sync.ts                  # report + fail on drift, no writes
 *   bun run scripts/check-docs-sync.ts --update          # also advance clean/auto-synced rules to HEAD
 *   bun run scripts/check-docs-sync.ts --ack <id[,id...]> # force-advance specific rule(s): "reviewed, no doc change needed"
 *   bun run scripts/check-docs-sync.ts --ack-all          # force-advance every rule to HEAD
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const LEDGER_PATH = resolve(REPO_ROOT, "scripts/docs-sync-ledger.json");

interface Rule {
  id: string;
  description: string;
  codePaths: string[];
  docPaths: string[];
  lastSha: string;
  /**
   * Optional: one of codePaths. When set, trigger only on a NEW dated
   * `## [X.Y.Z]` header appearing at HEAD that wasn't present at lastSha —
   * not on every commit that merely edits the file (e.g. Unreleased entries).
   */
  versionHeaderTrigger?: string;
}

interface Ledger {
  rules: Rule[];
}

function git(args: string[]): string {
  const result = spawnSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function shaExists(sha: string): boolean {
  return spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: REPO_ROOT }).status === 0;
}

function commitsTouching(sinceSha: string, paths: string[]): string[] {
  const out = git(["log", "--format=%h %s", `${sinceSha}..HEAD`, "--", ...paths]);
  return out.length > 0 ? out.split("\n") : [];
}

const VERSION_HEADER = /^## \[(\d+\.\d+\.\d+)\]/gm;

function versionHeadersAt(sha: string, path: string): Set<string> {
  const result = spawnSync("git", ["show", `${sha}:${path}`], { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0) return new Set(); // file didn't exist at that commit
  return new Set([...result.stdout.matchAll(VERSION_HEADER)].map((m) => m[1]));
}

function hasNewVersionHeader(sinceSha: string, path: string): boolean {
  const before = versionHeadersAt(sinceSha, path);
  const after = versionHeadersAt("HEAD", path);
  return [...after].some((v) => !before.has(v));
}

const args = process.argv.slice(2);
const updateAll = args.includes("--update");
const ackAll = args.includes("--ack-all");
const ackFlagIndex = args.indexOf("--ack");
const ackIds = ackFlagIndex >= 0 ? (args[ackFlagIndex + 1] ?? "").split(",").filter(Boolean) : [];

const ledger: Ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
const head = git(["rev-parse", "HEAD"]);

const knownIds = new Set(ledger.rules.map((r) => r.id));
for (const id of ackIds) {
  if (!knownIds.has(id)) {
    console.warn(`⚠ --ack ${id}: no such rule in ${LEDGER_PATH} — check for a typo.`);
  }
}

let drift = false;
let ledgerChanged = false;

for (const rule of ledger.rules) {
  const forced = ackAll || ackIds.includes(rule.id);

  if (!shaExists(rule.lastSha)) {
    console.warn(
      `⚠ ${rule.id}: baseline commit ${rule.lastSha.slice(0, 8)} not found (shallow clone or rewritten history) — skipping. Re-baseline with --ack ${rule.id}.`,
    );
    continue;
  }

  const allCodeCommits = commitsTouching(rule.lastSha, rule.codePaths);
  const triggered = rule.versionHeaderTrigger
    ? hasNewVersionHeader(rule.lastSha, rule.versionHeaderTrigger)
    : allCodeCommits.length > 0;
  // Reported/considered commits: for a version-header rule this is still the
  // full commit list (useful context), but the sync decision above only
  // looks at whether a new dated header actually landed.
  const codeCommits = triggered ? allCodeCommits : [];

  if (codeCommits.length === 0) {
    if (forced) {
      rule.lastSha = head;
      ledgerChanged = true;
    }
    const untriggered = rule.versionHeaderTrigger && allCodeCommits.length > 0;
    console.log(
      untriggered
        ? `✓ ${rule.id}: ${allCodeCommits.length} commit(s) touched the file, no new version header yet`
        : `✓ ${rule.id}: no code changes since baseline`,
    );
    continue;
  }

  const docCommits = commitsTouching(rule.lastSha, rule.docPaths);

  if (docCommits.length > 0) {
    console.log(`✓ ${rule.id}: ${codeCommits.length} code commit(s), docs moved together`);
    if (updateAll || forced) {
      rule.lastSha = head;
      ledgerChanged = true;
    }
    continue;
  }

  if (forced) {
    console.log(`✓ ${rule.id}: acknowledged — ${codeCommits.length} code commit(s), no doc change needed (reviewed)`);
    rule.lastSha = head;
    ledgerChanged = true;
    continue;
  }

  drift = true;
  console.error(`✗ ${rule.id}: DRIFT — code changed, docs untouched since ${rule.lastSha.slice(0, 8)}`);
  console.error(`  ${rule.description}`);
  console.error(`  Doc paths to check: ${rule.docPaths.join(", ")}`);
  for (const c of codeCommits) console.error(`    ${c}`);
}

if (ledgerChanged) {
  writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
  console.log(`\nLedger updated → ${LEDGER_PATH}`);
}

if (drift) {
  console.error(
    "\nUnresolved drift. Update the listed docs and re-run, or if no doc change is truly needed:\n  bun run scripts/check-docs-sync.ts --ack <rule-id>",
  );
  process.exit(1);
}

console.log("\nDocs sync ledger: all rules in sync.");
