#!/usr/bin/env bun
/**
 * Ensures all public (non-private) packages share the same version before a
 * release. Prevents the recurring drift where newly-added packages are
 * published at a different version than the rest of the monorepo, causing
 * changeset bumps to produce an incoherent version graph.
 *
 * Run via: bun run check:version-sync
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
}

function findPackageJsons(root: string): string[] {
  const out: string[] = [];
  for (const dir of ["packages", "apps"]) {
    const full = join(root, dir);
    try {
      for (const entry of readdirSync(full)) {
        const pkgPath = join(full, entry, "package.json");
        try {
          if (statSync(pkgPath).isFile()) out.push(pkgPath);
        } catch {}
      }
    } catch {}
  }
  return out;
}

const root = process.cwd();
const pkgs = findPackageJsons(root)
  .map((p) => ({ path: p, data: JSON.parse(readFileSync(p, "utf8")) as PackageJson }))
  .filter(({ data }) => !data.private);

// Count version occurrences to identify the canonical version
const counts = new Map<string, number>();
for (const { data } of pkgs) {
  counts.set(data.version, (counts.get(data.version) ?? 0) + 1);
}

// Canonical = most common; ties broken by highest semver
const canonical = [...counts.entries()]
  .sort(([va, ca], [vb, cb]) => {
    if (cb !== ca) return cb - ca; // more occurrences wins
    const pa = va.split(".").map(Number);
    const pb = vb.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pb[i] ?? 0) !== (pa[i] ?? 0)) return (pb[i] ?? 0) - (pa[i] ?? 0);
    }
    return 0;
  })[0][0];

const mismatches = pkgs.filter(({ data }) => data.version !== canonical);

console.log(`Canonical version: ${canonical}`);
console.log(`Public packages: ${pkgs.length}`);

if (mismatches.length === 0) {
  console.log(`✓ All ${pkgs.length} public packages are at ${canonical}`);
  process.exit(0);
}

console.error(`\n✗ ${mismatches.length} package(s) not at ${canonical}:\n`);
for (const { data } of mismatches) {
  console.error(`  ${data.name}: ${data.version}  (expected ${canonical})`);
}
const mismatchNames = mismatches.map(({ data }) => data.name.replace(/^.*\//, "")).join(" ");
console.error(
  `\nFix: set all packages to ${canonical} before running changesets.\n` +
    `  bun run scripts/set-version.ts ${canonical} ${mismatchNames}`,
);
process.exit(1);
