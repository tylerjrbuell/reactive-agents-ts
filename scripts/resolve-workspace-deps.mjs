#!/usr/bin/env node
/**
 * resolve-workspace-deps.mjs
 *
 * Replaces workspace:* references in every publishable package.json with
 * the actual local version number before `changeset publish` runs.
 *
 * Run as part of the `release` script — after `changeset version` has
 * bumped all versions but before `changeset publish` sends packages to npm.
 *
 * Usage: node scripts/resolve-workspace-deps.mjs [workspace-root]
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join, resolve } from "path";

const workspaceRoot = resolve(process.argv[2] ?? process.cwd());
const rootPkg = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8"));

// Build name → version map from every workspace member
const versionMap = new Map();

for (const glob of rootPkg.workspaces ?? []) {
  const [dir, pattern] = glob.split("/");
  if (pattern !== "*") continue;
  const baseDir = join(workspaceRoot, dir);
  if (!existsSync(baseDir)) continue;
  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(baseDir, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.name && pkg.version) versionMap.set(pkg.name, pkg.version);
  }
}

console.log(`🗺  Version map: ${versionMap.size} workspace packages`);

let totalFixed = 0;

// Resolve each workspace member's own deps
for (const glob of rootPkg.workspaces ?? []) {
  const [dir, pattern] = glob.split("/");
  if (pattern !== "*") continue;
  const baseDir = join(workspaceRoot, dir);
  if (!existsSync(baseDir)) continue;

  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(baseDir, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;

    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.private) continue; // skip private packages

    let changed = false;

    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "peerDependenciesMeta"]) {
      const deps = pkg[field];
      if (!deps) continue;
      for (const [name, ver] of Object.entries(deps)) {
        if (!String(ver).startsWith("workspace:")) continue;
        const resolved = versionMap.get(name);
        if (!resolved) {
          console.error(`❌  Cannot resolve workspace dep "${name}" in ${pkg.name}`);
          process.exit(1);
        }
        deps[name] = resolved;
        console.log(`  ${pkg.name} › ${field}: ${name} workspace:* → ${resolved}`);
        changed = true;
        totalFixed++;
      }
    }

    if (changed) {
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    }
  }
}

if (totalFixed === 0) {
  console.log("ℹ️  No workspace:* references found — already resolved.");
} else {
  console.log(`✅  Resolved ${totalFixed} workspace:* reference(s) across all packages.`);
}

// Final guard: fail if any workspace: refs remain in publishable packages
let leaks = 0;
for (const glob of rootPkg.workspaces ?? []) {
  const [dir, pattern] = glob.split("/");
  if (pattern !== "*") continue;
  const baseDir = join(workspaceRoot, dir);
  if (!existsSync(baseDir)) continue;
  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = join(baseDir, entry.name, "package.json");
    if (!existsSync(pkgPath)) continue;
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (pkg.private) continue;
    const raw = readFileSync(pkgPath, "utf8");
    if (raw.includes('"workspace:')) {
      console.error(`❌  workspace: reference still present in ${pkgPath}`);
      leaks++;
    }
  }
}
if (leaks > 0) process.exit(1);
console.log("✅  Guard passed — no workspace: references in any publishable package.");
