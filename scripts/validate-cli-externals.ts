/**
 * Validate that all workspace package imports in the CLI are marked as external.
 * This prevents bundling issues where workspace packages can't be properly resolved.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const cliDir = path.join(import.meta.dir, "../apps/cli");
const srcDir = path.join(cliDir, "src");
const tsupConfigPath = path.join(cliDir, "tsup.config.ts");

// Read tsup config and extract external packages
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

// Recursively find all imports from workspace packages
const importedPackages = new Set<string>();

function scanFile(filePath: string) {
  const content = fs.readFileSync(filePath, "utf-8");

  // Match import statements: import ... from "@reactive-agents/..."
  const importMatches = content.matchAll(
    /from\s+["'](@reactive-agents\/[^"']+)["']/g,
  );
  for (const match of importMatches) {
    importedPackages.add(match[1]);
  }
}

function walkDir(dir: string) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      walkDir(fullPath);
    } else if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      scanFile(fullPath);
    }
  }
}

walkDir(srcDir);

// Check that all imported packages are marked as external
const missing: string[] = [];
for (const pkg of importedPackages) {
  if (!externals.has(pkg)) {
    missing.push(pkg);
  }
}

if (missing.length > 0) {
  console.error("❌ CLI imports workspace packages not marked as external:");
  for (const pkg of missing) {
    console.error(`   - ${pkg}`);
  }
  console.error("\nAdd these to the 'external' array in apps/cli/tsup.config.ts");
  process.exit(1);
}

console.log("✅ All workspace package imports are properly marked as external");
console.log(`   Checked ${importedPackages.size} imported packages`);
