#!/usr/bin/env bun
/**
 * Validates that all published packages have versions that won't conflict
 * with what's already on npm. Prevents the version drift that occurs when
 * packages are manually published or when changesets compute a next version
 * that collides with an existing npm release.
 *
 * Fails CI if:
 *   - Any package's local version <= the version published on npm
 *     (which would cause a publish conflict or be silently skipped)
 *   - Internal @reactive-agents/* dependency versions don't match the
 *     local versions of those workspace packages
 *
 * Run via: bun run scripts/check-npm-versions.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function findPackageJsons(root: string): string[] {
  const out: string[] = [];
  const dirs = ["packages", "apps"];
  for (const dir of dirs) {
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

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

async function fetchNpmVersion(name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${name}/latest`);
    if (!res.ok) return null;
    const data = (await res.json()) as { version: string };
    return data.version;
  } catch {
    return null;
  }
}

const root = process.cwd();
const pkgPaths = findPackageJsons(root);
const localVersions = new Map<string, string>();
const errors: string[] = [];
const warnings: string[] = [];

const pkgs: Array<{ path: string; data: PackageJson }> = [];
for (const p of pkgPaths) {
  const data = JSON.parse(readFileSync(p, "utf8")) as PackageJson;
  pkgs.push({ path: p, data });
  localVersions.set(data.name, data.version);
}

console.log(`Checking ${pkgs.length} package(s)...\n`);

for (const { path, data } of pkgs) {
  if (data.private) {
    console.log(`  ⊘ ${data.name}@${data.version} (private, skipped)`);
    continue;
  }

  const npmVersion = await fetchNpmVersion(data.name);
  if (npmVersion === null) {
    console.log(`  ? ${data.name}@${data.version} (not on npm yet)`);
  } else {
    const cmp = compareVersions(data.version, npmVersion);
    if (cmp <= 0) {
      const msg = `${data.name}: local=${data.version} <= npm=${npmVersion} (publish would conflict; bump main past npm before changeset)`;
      errors.push(msg);
      console.log(`  ✗ ${msg}`);
    } else {
      console.log(`  ✓ ${data.name}: local=${data.version} > npm=${npmVersion}`);
    }
  }

  for (const depMap of [data.dependencies, data.devDependencies, data.peerDependencies]) {
    if (!depMap) continue;
    for (const [depName, depVersion] of Object.entries(depMap)) {
      if (!depName.startsWith("@reactive-agents/") && depName !== "reactive-agents") continue;
      const localVer = localVersions.get(depName);
      if (!localVer) continue;
      if (
        depVersion === "workspace:*" ||
        depVersion.startsWith("^") ||
        depVersion.startsWith("~") ||
        depVersion.startsWith(">") ||
        depVersion.startsWith("<") ||
        depVersion === "*"
      ) continue;
      if (depVersion !== localVer) {
        const msg = `${data.name} depends on ${depName}@${depVersion} but workspace has ${localVer} (internal dep drift)`;
        warnings.push(msg);
      }
    }
  }
}

console.log();
if (warnings.length > 0) {
  console.log(`⚠ ${warnings.length} internal dependency drift warning(s):`);
  for (const w of warnings) console.log(`  - ${w}`);
  console.log();
}

if (errors.length > 0) {
  console.error(`✗ ${errors.length} npm version conflict(s) — release would fail or skip packages:`);
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "\nTo fix: bump main package versions past the highest npm version, then let the changeset compute the next bump.",
  );
  process.exit(1);
}

if (warnings.length > 0) {
  console.error("✗ Internal dependency drift detected (see warnings above) — fix before publish.");
  process.exit(1);
}

console.log("✓ All package versions clean — safe to publish.");
