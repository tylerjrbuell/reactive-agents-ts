#!/usr/bin/env bun
/**
 * Clean-install smoke test.
 *
 * Builds and packs every publishable workspace package as an npm tarball,
 * installs the resulting tarballs into a fresh empty project, and runs
 * smoke tests against the installed artifacts. Catches the class of bug
 * that broke v0.10.4: imports declared `external` in tsup but missing from
 * `package.json` `dependencies` — which compiles cleanly in the workspace
 * but crashes with `Cannot find package` after a real `npm install`.
 *
 * Smoke test matrix:
 *   1. rax --version (CLI binary resolution)
 *   2. rax --help (all command modules load without unresolved imports)
 *   3. rax cortex --help (lazy-load path, friendly error if cortex absent)
 *   4. Bun: import reactive-agents umbrella (SDK import under Bun)
 *   5. Node: import reactive-agents umbrella (ESM dynamic import under Node)
 *   6. Node: import v0.11 standalones — observe, replay, compose (catches missing deps post-publish)
 *   7. Node: require() reactive-agents throws helpful ESM-only error (not ERR_MODULE_NOT_FOUND)
 *   8. create-reactive-agent: scaffold minimal → install deps → verify import resolves under Node
 *
 * Run via:
 *   bun run scripts/test-clean-install.ts
 *
 * Exit codes:
 *   0 — all packages install and smoke tests pass
 *   1 — install or smoke test failed
 *
 * CI wiring: add as a publish.yml step BEFORE the changesets/action publish
 * step so a broken release fails the workflow before it hits npm.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

interface PackageInfo {
  name: string;
  version: string;
  dir: string;
  isPrivate: boolean;
}

const repoRoot = resolve(import.meta.dir, "..");
const testDir = resolve("/tmp/rax-clean-install-test");

function log(msg: string) {
  console.log(`[clean-install] ${msg}`);
}

function run(cmd: string, cwd: string, opts: { stdio?: "inherit" | "pipe" } = {}): string {
  try {
    return execSync(cmd, { cwd, stdio: opts.stdio ?? "pipe", encoding: "utf8" });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    console.error(`Command failed: ${cmd}`);
    if (e.stdout) console.error(`stdout:\n${e.stdout}`);
    if (e.stderr) console.error(`stderr:\n${e.stderr}`);
    throw err;
  }
}

function discoverPackages(): PackageInfo[] {
  const out: PackageInfo[] = [];
  const dirs = ["packages", "apps"];
  for (const dir of dirs) {
    const full = join(repoRoot, dir);
    if (!existsSync(full)) continue;
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    for (const entry of readdirSync(full)) {
      const pkgJson = join(full, entry, "package.json");
      if (!existsSync(pkgJson)) continue;
      try {
        if (!statSync(pkgJson).isFile()) continue;
      } catch {
        continue;
      }
      const data = JSON.parse(readFileSync(pkgJson, "utf8")) as {
        name: string;
        version: string;
        private?: boolean;
      };
      out.push({
        name: data.name,
        version: data.version,
        dir: join(full, entry),
        isPrivate: data.private === true,
      });
    }
  }
  return out;
}

function rewriteWorkspaceDeps(pkgPath: string, versionMap: Map<string, string>): string | null {
  const data = JSON.parse(readFileSync(pkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  let changed = false;
  for (const key of ["dependencies", "devDependencies", "peerDependencies"] as const) {
    const map = data[key];
    if (!map) continue;
    for (const [depName, depVersion] of Object.entries(map)) {
      if (depVersion === "workspace:*" && versionMap.has(depName)) {
        map[depName] = versionMap.get(depName)!;
        changed = true;
      }
    }
  }
  if (!changed) return null;
  const original = readFileSync(pkgPath, "utf8");
  writeFileSync(pkgPath, JSON.stringify(data, null, 2) + "\n");
  return original;
}

async function main() {
  log("discovering workspace packages...");
  const allPackages = discoverPackages();
  const publishable = allPackages.filter((p) => !p.isPrivate);
  log(`found ${publishable.length} publishable packages, ${allPackages.length - publishable.length} private`);

  const versionMap = new Map<string, string>();
  for (const p of publishable) versionMap.set(p.name, p.version);

  // Build everything first. Cycles are caught at this stage.
  log("building all packages (turbo)...");
  run("bun run build", repoRoot, { stdio: "inherit" });

  // Set up clean test directory
  if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  mkdirSync(testDir, { recursive: true });
  const tarballDir = join(testDir, "tarballs");
  mkdirSync(tarballDir, { recursive: true });

  // Pack each publishable package. Temporarily rewrite workspace:* refs to
  // pinned versions so the resulting tarball mirrors the npm-published shape.
  log(`packing ${publishable.length} packages → ${tarballDir}`);
  const restoreMap = new Map<string, string>();
  try {
    for (const p of publishable) {
      const pkgJson = join(p.dir, "package.json");
      const original = rewriteWorkspaceDeps(pkgJson, versionMap);
      if (original !== null) restoreMap.set(pkgJson, original);
    }

    for (const p of publishable) {
      run(`npm pack --pack-destination "${tarballDir}" --silent`, p.dir);
    }
  } finally {
    for (const [path, original] of restoreMap) writeFileSync(path, original);
  }

  // Build install map: every publishable package installed from its tarball.
  // npm resolves cross-package deps to the matching tarball when the version
  // numbers line up, so this exercises the same resolution that npm install
  // does post-publish.
  const tarballEntries: Record<string, string> = {};
  for (const p of publishable) {
    const tarballName = p.name.replace("@", "").replace("/", "-") + "-" + p.version + ".tgz";
    const tarballPath = join(tarballDir, tarballName);
    if (!existsSync(tarballPath)) {
      throw new Error(`Tarball not found for ${p.name}: ${tarballPath}`);
    }
    tarballEntries[p.name] = `file:${tarballPath}`;
  }

  const projectDir = join(testDir, "project");
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(
    join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "rax-clean-install-test",
        version: "1.0.0",
        type: "module",
        dependencies: tarballEntries,
      },
      null,
      2,
    ),
  );

  log("installing tarballs into clean project (npm install)...");
  run("npm install --no-audit --no-fund --silent", projectDir, { stdio: "inherit" });

  // Smoke tests: run the published CLI binary + import the published SDK.
  log("smoke test 1: rax --version");
  const versionOut = run("./node_modules/.bin/rax --version", projectDir);
  if (!versionOut.toLowerCase().includes("rax") && !/\d+\.\d+\.\d+/.test(versionOut)) {
    throw new Error(`rax --version produced unexpected output:\n${versionOut}`);
  }
  console.log(versionOut.trim());

  log("smoke test 2: rax --help (loads command modules without unresolved imports)");
  run("./node_modules/.bin/rax --help", projectDir);

  log("smoke test 3: rax cortex --help (exercises lazy-load path)");
  // We don't require @reactive-agents/cortex to be installed — the CLI should
  // print the friendly "install cortex" message. What we ARE testing is that
  // loading the cortex command module doesn't fail with `Cannot find package`.
  run("./node_modules/.bin/rax cortex --help", projectDir);

  log("smoke test 4: import { ReactiveAgents } from 'reactive-agents' (under Bun)");
  writeFileSync(
    join(projectDir, "smoke-sdk.ts"),
    `import { ReactiveAgents } from "reactive-agents";
if (typeof ReactiveAgents?.create !== "function") {
  console.error("ReactiveAgents.create is not a function");
  process.exit(1);
}
console.log("SDK import OK");
`,
  );
  run("bun smoke-sdk.ts", projectDir, { stdio: "inherit" });

  log("smoke test 5: import reactive-agents (under Node ESM)");
  writeFileSync(
    join(projectDir, "smoke-node.mjs"),
    `import { ReactiveAgents } from "reactive-agents";
if (typeof ReactiveAgents?.create !== "function") {
  console.error("ReactiveAgents.create is not a function");
  process.exit(1);
}
console.log("Node ESM import OK");
`,
  );
  run("node smoke-node.mjs", projectDir, { stdio: "inherit" });

  log("smoke test 6: import v0.11 standalones (observe, replay, compose) under Node");
  writeFileSync(
    join(projectDir, "smoke-standalones.mjs"),
    `import { OpenInferenceTracerLayer } from "@reactive-agents/observe";
import { loadRecordedRun } from "@reactive-agents/replay";
import { maxIterations } from "@reactive-agents/compose";
if (typeof OpenInferenceTracerLayer === "undefined") { console.error("observe: OpenInferenceTracerLayer missing"); process.exit(1); }
if (typeof loadRecordedRun !== "function") { console.error("replay: loadRecordedRun missing"); process.exit(1); }
if (typeof maxIterations !== "function") { console.error("compose: maxIterations missing"); process.exit(1); }
console.log("Node standalones import OK");
`,
  );
  run("node smoke-standalones.mjs", projectDir, { stdio: "inherit" });

  log("smoke test 7: require('reactive-agents') throws helpful ESM-only error (not ERR_MODULE_NOT_FOUND)");
  writeFileSync(
    join(projectDir, "smoke-cjs-require.cjs"),
    `try {
  require("reactive-agents");
  console.error("Expected require() to throw — it did not");
  process.exit(1);
} catch (err) {
  const msg = err && err.message ? err.message : String(err);
  if (msg.includes("Cannot find module") || msg.includes("ERR_MODULE_NOT_FOUND")) {
    console.error("require() threw ERR_MODULE_NOT_FOUND — cjs-shim is missing or misconfigured:", msg);
    process.exit(1);
  }
  if (!msg.includes("ESM-only") && !msg.includes("import syntax")) {
    console.error("require() threw unexpected error:", msg);
    process.exit(1);
  }
  console.log("CJS require correctly throws ESM-only guidance error OK");
}
`,
  );
  run("node smoke-cjs-require.cjs", projectDir, { stdio: "inherit" });

  log("smoke test 8: create-reactive-agent scaffold → install → Node ESM import");
  // Run the CLI from the installed tarball, non-interactively
  run(
    `node ./node_modules/.bin/create-reactive-agent --template=minimal --provider=anthropic --pm=npm --yes scaffold-app`,
    projectDir,
    { stdio: "inherit" },
  );
  const scaffoldAppDir = join(projectDir, "scaffold-app");
  const scaffoldPkgPath = join(scaffoldAppDir, "package.json");
  if (!existsSync(scaffoldPkgPath)) {
    throw new Error("create-reactive-agent did not produce scaffold-app/package.json");
  }
  for (const expected of ["src/index.ts", "tsconfig.json", ".env.example", ".gitignore", "README.md"]) {
    if (!existsSync(join(scaffoldAppDir, expected))) {
      throw new Error(`create-reactive-agent scaffold missing expected file: ${expected}`);
    }
  }
  // Point reactive-agents dep to our local tarball so npm install resolves offline.
  // Also add npm `overrides` for every @reactive-agents/* package so transitive deps
  // resolve to the local tarballs rather than stale registry versions. Without this,
  // npm falls back to published versions (e.g. reactive-intelligence@0.10.6) that
  // pre-date runtime-shim and contain `import { Database } from "bun:sqlite"` as a
  // static ESM import, which crashes Node with ERR_UNSUPPORTED_ESM_URL_SCHEME.
  const scaffoldPkg = JSON.parse(readFileSync(scaffoldPkgPath, "utf8")) as {
    dependencies?: Record<string, string>;
    overrides?: Record<string, string>;
  };
  if (scaffoldPkg.dependencies) {
    if ("reactive-agents" in scaffoldPkg.dependencies) {
      scaffoldPkg.dependencies["reactive-agents"] = tarballEntries["reactive-agents"]!;
    }
  }
  scaffoldPkg.overrides = { ...tarballEntries };
  writeFileSync(scaffoldPkgPath, JSON.stringify(scaffoldPkg, null, 2) + "\n");
  run("npm install --no-audit --no-fund --silent", scaffoldAppDir, { stdio: "inherit" });
  writeFileSync(
    join(scaffoldAppDir, "smoke-scaffold.mjs"),
    `import { ReactiveAgents } from "reactive-agents";
if (typeof ReactiveAgents?.create !== "function") { console.error("scaffold: ReactiveAgents.create missing"); process.exit(1); }
console.log("scaffold import OK");
`,
  );
  run("node smoke-scaffold.mjs", scaffoldAppDir, { stdio: "inherit" });

  log("✓ all clean-install smoke tests passed");
}

main().catch((err) => {
  console.error("✗ clean-install test failed");
  console.error(err);
  process.exit(1);
});
