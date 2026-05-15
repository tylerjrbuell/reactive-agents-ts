#!/usr/bin/env bun
/**
 * Runs after `changeset version` to ensure all public packages share the same
 * version. Changesets can miscompute versions in a fixed group when package
 * versions diverge between runs — this script re-normalizes to the highest
 * version any fixed-group package received.
 *
 * Run via: bun run version  (called automatically by changesets/action)
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  [key: string]: unknown;
}

function findPackageJsons(root: string): string[] {
  const out: string[] = [];
  for (const dir of ["packages", "apps"]) {
    const full = join(root, dir);
    try {
      for (const entry of readdirSync(full)) {
        const p = join(full, entry, "package.json");
        try {
          if (statSync(p).isFile()) out.push(p);
        } catch {}
      }
    } catch {}
  }
  return out;
}

function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

const root = process.cwd();
const cfgPath = join(root, ".changeset", "config.json");
const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as { fixed?: string[][] };
const fixedGroup = new Set<string>(cfg.fixed?.[0] ?? []);

const pkgs = findPackageJsons(root)
  .map((p) => ({ path: p, data: JSON.parse(readFileSync(p, "utf8")) as PackageJson }))
  .filter(({ data }) => !data.private && fixedGroup.has(data.name));

// Find the highest version any fixed-group package was bumped to
let canonical = "0.0.0";
for (const { data } of pkgs) {
  if (semverGt(data.version, canonical)) canonical = data.version;
}

const mismatches = pkgs.filter(({ data }) => data.version !== canonical);

if (mismatches.length === 0) {
  console.log(`✓ All fixed-group packages already at ${canonical}`);
  process.exit(0);
}

console.log(`Normalizing ${mismatches.length} package(s) to ${canonical}:`);
for (const { path, data } of mismatches) {
  data.version = canonical;
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
  console.log(`  ${data.name}: → ${canonical}`);
}
console.log(`✓ Done`);
