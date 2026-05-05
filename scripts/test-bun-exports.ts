/**
 * Test that all PUBLIC bun exports point to valid dist/ paths.
 * Only tests packages with publishConfig.access: "public" (published to npm)
 */
import * as fs from "node:fs";
import * as path from "node:path";

const packagesDir = path.join(import.meta.dir, "../packages");
const appsDir = path.join(import.meta.dir, "../apps");

interface PackageJson {
  name: string;
  private?: boolean;
  publishConfig?: { access: string };
  exports?: Record<string, any>;
  bin?: Record<string, string> | string;
}

interface ExportConfig {
  bun?: string;
  import?: string;
  types?: string;
  default?: string;
}

function isPublicPackage(pkg: PackageJson): boolean {
  // Must not be private and should be published to npm
  return !pkg.private && pkg.publishConfig?.access === "public";
}

function isLibraryPackage(pkg: PackageJson): boolean {
  // Library packages need exports. CLI-like packages (with bin) don't.
  return !pkg.bin;
}

function testPackageExports(pkgJsonPath: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const pkgDir = path.dirname(pkgJsonPath);

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as PackageJson;
    const pkgName = pkg.name;

    // Only test public packages
    if (!isPublicPackage(pkg)) {
      return { ok: true, errors: [] }; // Skip non-public packages
    }

    const exports = pkg.exports;

    if (!exports || !exports["."]) {
      errors.push(`${pkgName}: No default export`);
      return { ok: false, errors };
    }

    const exportsConfig = exports["."] as ExportConfig;

    // Test 1: bun export should exist
    if (!exportsConfig.bun) {
      errors.push(`${pkgName}: No 'bun' export defined`);
      return { ok: false, errors };
    }

    // Test 2: bun export should NOT point to src/
    if (exportsConfig.bun.includes("/src/")) {
      errors.push(`${pkgName}: bun export still points to src/: ${exportsConfig.bun}`);
      return { ok: false, errors };
    }

    // Test 3: bun export should point to dist/
    if (!exportsConfig.bun.includes("/dist/")) {
      errors.push(`${pkgName}: bun export doesn't point to dist/: ${exportsConfig.bun}`);
      return { ok: false, errors };
    }

    // Test 4: bun export file should exist in dist/
    const bunExportPath = path.join(pkgDir, exportsConfig.bun);
    if (!fs.existsSync(bunExportPath)) {
      errors.push(`${pkgName}: bun export file doesn't exist: ${exportsConfig.bun} (resolved to ${bunExportPath})`);
      return { ok: false, errors };
    }

    // Test 5: Verify import export also exists and is consistent
    if (exportsConfig.import && exportsConfig.import !== exportsConfig.bun) {
      const importPath = path.join(pkgDir, exportsConfig.import);
      if (!fs.existsSync(importPath)) {
        errors.push(`${pkgName}: import export file doesn't exist: ${exportsConfig.import}`);
        return { ok: false, errors };
      }
    }

    return { ok: true, errors: [] };
  } catch (e) {
    errors.push(`Error reading package.json: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, errors };
  }
}

function findPackages(dir: string): string[] {
  const packages: string[] = [];
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const itemPath = path.join(dir, item);
    const pkgJsonPath = path.join(itemPath, "package.json");

    if (fs.existsSync(pkgJsonPath)) {
      packages.push(pkgJsonPath);
    }
  }

  return packages;
}

// Test all packages
const allPackages = [
  ...findPackages(packagesDir),
  ...findPackages(appsDir),
];

let allOk = true;
const results: { pkg: string; ok: boolean; errors: string[]; skipped?: boolean }[] = [];
let skippedCount = 0;

for (const pkgJsonPath of allPackages) {
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf-8")) as PackageJson;

  if (!isPublicPackage(pkg)) {
    skippedCount++;
    continue;
  }

  // Skip CLI-like packages that have a bin field (they don't need exports)
  if (!isLibraryPackage(pkg)) {
    skippedCount++;
    continue;
  }

  const result = testPackageExports(pkgJsonPath);
  results.push({ pkg: pkg.name, ...result });

  if (!result.ok) {
    allOk = false;
  }
}

// Report results
console.log("\n📦 Bun Export Validation Results\n");
console.log(`Testing ${results.length} public packages (${skippedCount} non-public skipped)...\n`);

const passing = results.filter((r) => r.ok);
const failing = results.filter((r) => !r.ok);

if (failing.length > 0) {
  console.error("❌ FAILURES:\n");
  for (const result of failing) {
    console.error(`  ${result.pkg}:`);
    for (const error of result.errors) {
      console.error(`    - ${error}`);
    }
  }
  console.error();
}

console.log(`✅ Passing: ${passing.length}/${results.length}`);

if (failing.length > 0) {
  console.log(`❌ Failing: ${failing.length}/${results.length}`);
  process.exit(1);
} else {
  console.log("✅ All public packages have correct bun exports!");
  process.exit(0);
}
