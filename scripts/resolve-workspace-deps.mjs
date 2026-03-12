#!/usr/bin/env node
/**
 * resolve-workspace-deps.mjs
 *
 * Replaces workspace:* references in a package.json with the actual local
 * version number from the corresponding workspace member's package.json.
 *
 * Usage:
 *   node scripts/resolve-workspace-deps.mjs <pkg-dir> [workspace-root]
 *
 * Edits <pkg-dir>/package.json in-place. Safe to run in CI (ephemeral checkout).
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const pkgDir = process.argv[2];
const workspaceRoot = process.argv[3] ?? process.cwd();

if (!pkgDir) {
  console.error("Usage: resolve-workspace-deps.mjs <pkg-dir> [workspace-root]");
  process.exit(1);
}

const pkgPath = join(pkgDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

// Read the root package.json to discover all workspace globs
const rootPkg = JSON.parse(readFileSync(join(workspaceRoot, "package.json"), "utf8"));

// Build a map of package name → version from every workspace member
const versionMap = new Map();

import { readdirSync, existsSync } from "fs";

for (const glob of rootPkg.workspaces ?? []) {
  // Support simple globs like "packages/*" and "apps/*"
  const [dir, pattern] = glob.split("/");
  if (pattern !== "*") continue; // only handle simple globs

  const baseDir = join(workspaceRoot, dir);
  if (!existsSync(baseDir)) continue;

  for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const memberPkgPath = join(baseDir, entry.name, "package.json");
    if (!existsSync(memberPkgPath)) continue;
    const memberPkg = JSON.parse(readFileSync(memberPkgPath, "utf8"));
    if (memberPkg.name && memberPkg.version) {
      versionMap.set(memberPkg.name, memberPkg.version);
    }
  }
}

let changed = false;

for (const depField of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
  const deps = pkg[depField];
  if (!deps) continue;

  for (const [name, ver] of Object.entries(deps)) {
    if (!String(ver).startsWith("workspace:")) continue;

    const resolved = versionMap.get(name);
    if (!resolved) {
      console.error(`ERROR: Could not resolve workspace dep "${name}" — not found in workspace map.`);
      process.exit(1);
    }

    deps[name] = resolved;
    console.log(`  ${depField}: ${name} workspace:* → ${resolved}`);
    changed = true;
  }
}

if (changed) {
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`✅ Resolved workspace deps in ${pkgPath}`);
} else {
  console.log(`ℹ️  No workspace deps to resolve in ${pkgPath}`);
}
