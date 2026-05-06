/**
 * Validate CLI bundling/runtime hygiene:
 *
 *   1. Every workspace package imported by CLI source is marked `external`
 *      in `tsup.config.ts` (otherwise tsup tries to bundle a workspace package
 *      and breaks resolution).
 *
 *   2. Every external workspace package is also declared in `apps/cli/package.json`
 *      `dependencies` or `peerDependencies` (otherwise tsup leaves the import
 *      alone — correctly — but `npm install @reactive-agents/cli` doesn't pull
 *      it in, so it crashes at runtime with `Cannot find package '...'`).
 *
 * Both gaps were missed by the previous version of this gate; #2 caused the
 * v0.10.4 ship to crash on every CLI invocation in a clean install.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const cliDir = path.join(import.meta.dir, "../apps/cli");
const srcDir = path.join(cliDir, "src");
const tsupConfigPath = path.join(cliDir, "tsup.config.ts");
const cliPkgPath = path.join(cliDir, "package.json");

const tsupContent = fs.readFileSync(tsupConfigPath, "utf-8");
const externalsMatch = tsupContent.match(/external:\s*\[([\s\S]*?)\]/);
if (!externalsMatch) {
  console.error("❌ Failed to parse external list from tsup.config.ts");
  process.exit(1);
}

const externals = new Set(
  externalsMatch[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean),
);

const cliPkg = JSON.parse(fs.readFileSync(cliPkgPath, "utf-8")) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const declaredDeps = new Set([
  ...Object.keys(cliPkg.dependencies ?? {}),
  ...Object.keys(cliPkg.peerDependencies ?? {}),
]);

// Match imports of workspace packages: scoped @reactive-agents/* AND the
// unscoped umbrella `reactive-agents`. The previous regex only caught the
// scoped form, so umbrella imports slipped past the gate.
const importedPackages = new Set<string>();

function scanFile(filePath: string) {
  const content = fs.readFileSync(filePath, "utf-8");

  const importRegex =
    /from\s+["'](@reactive-agents\/[^"']+|reactive-agents)["']/g;
  for (const match of content.matchAll(importRegex)) {
    importedPackages.add(match[1]);
  }
}

function walkDir(dir: string) {
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walkDir(full);
    } else if (
      (file.endsWith(".ts") || file.endsWith(".tsx")) &&
      // Skip generator/template files — they emit imports as strings into
      // user projects (via template literals or string returns), they aren't
      // imports the CLI itself executes.
      !full.includes("/generators/") &&
      !full.includes("/templates/")
    ) {
      scanFile(full);
    }
  }
}

walkDir(srcDir);

// Check 1: imports must be marked external in tsup
const missingExternals: string[] = [];
for (const pkg of importedPackages) {
  if (!externals.has(pkg)) missingExternals.push(pkg);
}

// Check 2: every workspace package marked external must be in deps so npm
// will install it at runtime. (We only enforce this for workspace packages
// the CLI actually imports — e.g. `bun:sqlite` is an external runtime, not
// a workspace package, so we skip non-workspace externals.)
const workspacePackages = new Set(
  [...externals].filter(
    (p) => p.startsWith("@reactive-agents/") || p === "reactive-agents",
  ),
);
const missingDeps: string[] = [];
for (const pkg of workspacePackages) {
  if (!importedPackages.has(pkg)) continue; // not actually imported, OK
  if (!declaredDeps.has(pkg)) missingDeps.push(pkg);
}

let failed = false;

if (missingExternals.length > 0) {
  console.error(
    "❌ CLI imports workspace packages not marked as `external` in tsup.config.ts:",
  );
  for (const pkg of missingExternals) console.error(`   - ${pkg}`);
  console.error("\nAdd these to the `external` array in apps/cli/tsup.config.ts");
  failed = true;
}

if (missingDeps.length > 0) {
  console.error(
    "❌ CLI imports workspace packages not declared in apps/cli/package.json:",
  );
  for (const pkg of missingDeps) console.error(`   - ${pkg}`);
  console.error(
    "\nAdd these to `dependencies` (or `peerDependencies` if optional) in apps/cli/package.json.",
  );
  console.error(
    "Without this, `npm install @reactive-agents/cli` won't pull them in and the CLI crashes with `Cannot find package`.",
  );
  failed = true;
}

if (failed) process.exit(1);

console.log(
  `✅ CLI imports are properly external AND declared as dependencies (${importedPackages.size} workspace imports verified).`,
);
