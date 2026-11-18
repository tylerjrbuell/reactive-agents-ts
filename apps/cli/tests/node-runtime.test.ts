// rax runs on Node.js 22.5+ as well as Bun (Node shebang since 2026-11-18).
// Unit tests for the runtime helpers, a source guard against new Bun-only
// globals, and a smoke run of the BUILT CLI under `node` with no bun on PATH.
import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { isBelowNodeFloor, isSqliteExperimentalWarning } from "../src/node-preflight.js";
import { detectPackageManager, installCommand, isEntrypoint } from "../src/runtime.js";
import { pickDevRunner } from "../src/commands/dev.js";

const CLI_DIR = resolve(import.meta.dir, "..");
const DIST_ENTRY = join(CLI_DIR, "dist", "index.js");

describe("node-preflight", () => {
  it("enforces the Node 22.5 floor", () => {
    expect(isBelowNodeFloor("20.18.0")).toBe(true);
    expect(isBelowNodeFloor("22.4.1")).toBe(true);
    expect(isBelowNodeFloor("22.5.0")).toBe(false);
    expect(isBelowNodeFloor("24.14.1")).toBe(false);
  });

  it("matches only Node's SQLite ExperimentalWarning", () => {
    const sqlite = "SQLite is an experimental feature and might change at any time";
    expect(isSqliteExperimentalWarning(sqlite, ["ExperimentalWarning"])).toBe(true);
    expect(isSqliteExperimentalWarning(sqlite, [{ type: "ExperimentalWarning" }])).toBe(true);
    expect(isSqliteExperimentalWarning(sqlite, ["DeprecationWarning"])).toBe(false);
    expect(isSqliteExperimentalWarning("Type Stripping is an experimental feature", ["ExperimentalWarning"])).toBe(false);
  });
});

describe("runtime helpers", () => {
  it("detects the package manager from the runtime, then the user agent", () => {
    expect(detectPackageManager({}, true)).toBe("bun");
    expect(detectPackageManager({ npm_config_user_agent: "bun/1.3.10 npm/? node/v24.3.0" }, false)).toBe("bun");
    expect(detectPackageManager({ npm_config_user_agent: "pnpm/9.0.0 npm/? node/v22.5.0" }, false)).toBe("pnpm");
    expect(detectPackageManager({ npm_config_user_agent: "npm/10.8.0 node/v22.5.0" }, false)).toBe("npm");
    expect(detectPackageManager({}, false)).toBe("npm");
  });

  it("renders install commands per package manager", () => {
    expect(installCommand("npm", "reactive-agents")).toBe("npm install reactive-agents");
    expect(installCommand("bun", "reactive-agents")).toBe("bun add reactive-agents");
  });

  it("isEntrypoint trusts import.meta.main when the runtime provides it", () => {
    expect(isEntrypoint(import.meta.url, true)).toBe(true);
    expect(isEntrypoint(import.meta.url, false)).toBe(false);
  });

  it("rax dev prefers Bun, falls back to the project's tsx, else nothing", () => {
    expect(pickDevRunner("src/index.ts", true, { bunAvailable: true, tsxPath: "/p/tsx" })).toEqual({
      command: "bun",
      label: "bun",
      args: ["--watch", "run", "src/index.ts"],
    });
    expect(pickDevRunner("src/index.ts", false, { bunAvailable: false, tsxPath: "/p/tsx" })).toEqual({
      command: "/p/tsx",
      label: "tsx",
      args: ["src/index.ts"],
    });
    expect(pickDevRunner("src/index.ts", true, { bunAvailable: false, tsxPath: undefined })).toBeUndefined();
  });
});

describe("source guard: no Bun-only globals in CLI runtime code", () => {
  // templates/ holds generated-project text (Dockerfiles, Bun.serve servers),
  // not code rax itself runs.
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === "templates" ? [] : files(join(dir, e.name))) : e.name.endsWith(".ts") ? [join(dir, e.name)] : [],
    );

  it("uses node: built-ins instead of Bun.* / bun:* in apps/cli/src", () => {
    const offenders = files(join(CLI_DIR, "src")).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
        .filter(({ line }) => /\bBun\.[a-z]/.test(line) || /from\s+["']bun:/.test(line) || /typeof Bun\b/.test(line))
        .map(({ n, line }) => `${file}:${n}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });
});

// ── Built dist under Node, bun removed from PATH ────────────────────────────
const nodeBin = spawnSync("node", ["--version"]).status === 0 ? "node" : undefined;
const nodeDir = nodeBin ? dirname(spawnSync("node", ["-p", "process.execPath"]).stdout.toString().trim()) : "";
// Needs a prior `bun run --cwd apps/cli build`; POSIX PATH handling below.
const canSmoke = nodeBin !== undefined && existsSync(DIST_ENTRY) && process.platform !== "win32";

describe.skipIf(!canSmoke)("built rax under Node (no bun on PATH)", () => {
  // Keyless and offline: no provider keys, Ollama pointed at a closed port.
  const env: Record<string, string> = {
    PATH: [nodeDir, "/usr/bin", "/bin"].join(":"),
    HOME: process.env.HOME ?? tmpdir(),
    OLLAMA_ENDPOINT: "http://127.0.0.1:9",
    NO_COLOR: "1",
  };
  const rax = (args: readonly string[], cwd: string = CLI_DIR) =>
    spawnSync("node", [DIST_ENTRY, ...args], { cwd, env, encoding: "utf8", timeout: 60_000, input: "" });

  it("has a Node shebang", () => {
    expect(readFileSync(DIST_ENTRY, "utf8").split("\n")[0]).toBe("#!/usr/bin/env node");
  });

  it("--help and --version exit 0 with no Node warnings on stderr", () => {
    for (const args of [["--help"], ["--version"]]) {
      const r = rax(args);
      expect({ args, code: r.status, err: r.stderr }).toEqual({ args, code: 0, err: "" });
    }
  });

  it("demo, run --provider test, and cortex --help exit 0", () => {
    for (const args of [["demo"], ["run", "say hi", "--provider", "test"], ["cortex", "--help"]]) {
      const r = rax(args);
      expect({ args, code: r.status, err: r.status === 0 ? "" : r.stderr }).toEqual({ args, code: 0, err: "" });
    }
  }, 120_000);

  it("init scaffolds a project with npm next steps", () => {
    const dir = mkdtempSync(join(tmpdir(), "rax-node-init-"));
    try {
      const r = rax(["init", "node-proj"], dir);
      expect({ code: r.status, err: r.stderr }).toEqual({ code: 0, err: "" });
      expect(existsSync(join(dir, "node-proj", "package.json"))).toBe(true);
      expect(r.stdout).toContain("npm");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("Bun-only commands print one 'needs Bun' line instead of crashing", () => {
    const r = rax(["cortex", "--no-open"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("rax cortex needs Bun");
  });
});
