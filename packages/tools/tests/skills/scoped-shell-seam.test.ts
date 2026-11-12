// Seam pin: skills/scoped-shell.ts — gh-cli, git-cli and gws-cli folded into
// shell-execute (owner decision 2026-11-10).
//
// Spike over 3,090 traces: the wrapper tools failed 29% (gh) and 38% (git) of
// calls, almost all wrapper confusion (`gh gh ...`, `git git ...`, `ls` sent to
// gh-cli). A shell scoped to the programs takes the full command line the model
// already writes, so that class of failure cannot happen. The preset reuses
// shell-execute's guard unchanged; these tests pin that it refuses anything
// outside the program list.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BUILTIN_SHELL_PRESETS,
  DEPRECATED_CLI_TOOLS,
  REMOVED_BUILTIN_NAMES,
  scopedShellConfig,
  scopedShellTool,
  scopedShellToolFor,
} from "../../src/skills/scoped-shell.js";
import {
  BUILTIN_TOOL_NAMES,
  BUILTIN_TOOLSET_ALIASES,
  builtinTools,
  isBuiltinToolsetAlias,
  resolveBuiltinNames,
  resolveBuiltinSelection,
} from "../../src/skills/builtin.js";
import { buildHostShellEnv } from "../../src/skills/shell-host-process.js";
import { shellExecuteToolFor } from "../../src/skills/shell-execute-definition.js";
import { shellExecuteHandler } from "../../src/skills/shell-execution.js";

type ShellResult = {
  readonly executed: boolean;
  readonly success?: boolean;
  readonly error?: string;
  readonly output?: string;
  readonly exitCode?: number;
};

const run = (programs: readonly string[], command: string): Promise<ShellResult> =>
  Effect.runPromise(scopedShellTool(programs).handler({ command })) as Promise<ShellResult>;

describe("scopedShellConfig — allow-list is exactly the programs", () => {
  test("no default commands are merged in", () => {
    const config = scopedShellConfig(["git", "gh"]);
    expect(config.allowedCommands).toEqual([]);
    expect(config.additionalCommands).toEqual(["git", "gh"]);
    expect(config.commandAccess).toBeUndefined();
    // The effective list shell-execute computes from this config.
    expect(shellExecuteToolFor(config).description).toContain("Allowed commands: git, gh.");
  });

  test("a base config keeps its sandbox fields but never widens the list", () => {
    const config = scopedShellConfig(["gh"], {
      timeoutMs: 5_000,
      cwd: "/tmp/x",
      additionalCommands: ["curl"],
      commandAccess: { capabilities: ["javascript"] },
    });
    expect(config.timeoutMs).toBe(5_000);
    expect(config.cwd).toBe("/tmp/x");
    expect([...(config.allowedCommands ?? []), ...(config.additionalCommands ?? [])]).toEqual(["gh"]);
    expect(config.commandAccess).toBeUndefined();
  });

  test("programs are de-duplicated", () => {
    expect(scopedShellConfig(["gh", "gh", "git"]).additionalCommands).toEqual(["gh", "git"]);
  });
});

describe("scopedShellToolFor — definition", () => {
  test("is shell-execute, and the description names the programs and asks for the full command", () => {
    const def = scopedShellToolFor(["git", "gh"]);
    expect(def.name).toBe("shell-execute");
    expect(def.description).toContain("git, gh");
    expect(def.description).toContain("full command");
    expect(def.description).toContain("gh repo view owner/name");
    expect(def.description).toContain("git log --oneline -5");
    // No generic shell noise: the scoped tool runs only its programs.
    expect(def.description).not.toContain("Not enabled (developer opt-in required)");
  });

  test("has the removed wrappers' posture (no approval, medium risk) and shell-execute's timeout rule", () => {
    const def = scopedShellToolFor(["gh"], { timeoutMs: 2_000 });
    expect(def.requiresApproval).toBe(false);
    expect(def.riskLevel).toBe("medium");
    expect(def.timeoutMs).toBeGreaterThan(2_000);
  });

  test("plain shell-execute (terminal) flags are unchanged", () => {
    const def = shellExecuteToolFor();
    expect(def.requiresApproval).toBe(true);
    expect(def.riskLevel).toBe("high");
  });

  test("workspace surface states the run workspace", () => {
    expect(scopedShellToolFor(["git"], undefined, { runWorkspace: true }).description).toContain(
      "run's workspace directory",
    );
  });
});

describe("scopedShellTool — guard (shell-execute's, reused)", () => {
  // A program installed outside the standard dirs (like gws under nvm): the
  // preset must resolve it on PATH and pass the whole command line through.
  let binDir = "";
  let savedPath: string | undefined;
  beforeAll(() => {
    binDir = mkdtempSync(join(tmpdir(), "ra-scoped-bin-"));
    const fake = join(binDir, "ra-fake-cli");
    writeFileSync(fake, '#!/bin/sh\necho "fake-cli $*"\n');
    chmodSync(fake, 0o755);
    savedPath = process.env.PATH;
    process.env.PATH = `${binDir}:${savedPath ?? "/usr/bin:/bin"}`;
  });
  afterAll(() => {
    process.env.PATH = savedPath;
    rmSync(binDir, { recursive: true, force: true });
  });

  test("runs a full command line for an allowed program found on the host PATH", async () => {
    const r = await run(["ra-fake-cli"], "ra-fake-cli repo view a/b");
    expect(r.executed).toBe(true);
    expect(r.exitCode).toBe(0);
    expect(r.output?.trim()).toBe("fake-cli repo view a/b");
  });

  test("`gh repo view a/b` passes the guard (refusals never set executed: true)", async () => {
    // `--version` keeps this offline; the guard decision is on the program name.
    const r = await run(["git", "gh"], "gh --version");
    expect(r.executed).toBe(true);
  });

  test("refuses a program outside the list, naming what is allowed", async () => {
    const r = await run(["git", "gh"], "ls");
    expect(r.executed).toBe(false);
    expect(r.success).toBe(false);
    expect(r.error).toContain('Command "ls" is not in the allowed commands list');
    expect(r.error).toContain("Allowed commands: git, gh");
  });

  test("refuses a subcommand sent without its program (the old wrapper habit)", async () => {
    const r = await run(["gh"], "repo view a/b");
    expect(r.executed).toBe(false);
    expect(r.error).toContain('Command "repo" is not in the allowed commands list');
  });

  test("refuses `;` chaining into another program", async () => {
    const r = await run(["git", "gh"], "gh repo view x; rm -rf /");
    expect(r.executed).toBe(false);
    expect(r.error).toContain('"rm"');
  });

  test("refuses && chaining into another program", async () => {
    const r = await run(["git", "gh"], "git status && curl http://x");
    expect(r.executed).toBe(false);
    expect(r.error).toContain('"curl"');
  });

  test("refuses $(...) command substitution", async () => {
    const r = await run(["git", "gh"], "gh repo view $(id -u)");
    expect(r.executed).toBe(false);
    expect(r.error).toContain("Command blocked by security policy");
  });

  test("refuses backtick substitution", async () => {
    const r = await run(["git", "gh"], "gh repo view `id`");
    expect(r.executed).toBe(false);
    expect(r.error).toContain("Command blocked by security policy");
  });

  test("refuses a pipe into a program outside the list", async () => {
    const r = await run(["git", "gh"], "gh pr list | sh");
    expect(r.executed).toBe(false);
  });

  test("a pipe between two allowed programs is allowed (each segment is checked)", async () => {
    const r = await run(["ra-fake-cli"], "ra-fake-cli a | ra-fake-cli b");
    expect(r.executed).toBe(true);
    expect(r.output?.trim()).toBe("fake-cli b");
  });

  test("refuses git -c config injection (shell-execute block-list)", async () => {
    const r = await run(["git"], "git -c core.pager=id log");
    expect(r.executed).toBe(false);
    expect(r.error).toContain("git -c is blocked");
  });
});

describe("toolset aliases map to the scoped shell", () => {
  test("`git` expands to shell-execute; its programs live in BUILTIN_SHELL_PRESETS", () => {
    expect([...BUILTIN_TOOLSET_ALIASES.git]).toEqual(["shell-execute"]);
    expect(BUILTIN_SHELL_PRESETS).toEqual({ git: ["git", "gh"] });
    expect(isBuiltinToolsetAlias("git")).toBe(true);
  });

  test("no preset runs gws, and `workspace` is no longer an alias (removed 2026-11-10)", () => {
    expect(Object.values(BUILTIN_SHELL_PRESETS).flat()).not.toContain("gws");
    expect(Object.hasOwn(BUILTIN_TOOLSET_ALIASES, "workspace")).toBe(false);
    expect(isBuiltinToolsetAlias("WORKSPACE")).toBe(false);
  });

  test("alias `git` yields one shell-execute tool scoped to [git, gh]", () => {
    const sel = resolveBuiltinSelection(["git"]);
    expect([...sel.names]).toEqual(["shell-execute"]);
    expect(sel.shellPrograms).toEqual(["git", "gh"]);
    expect(sel.deprecations).toEqual([]);
  });

  test("a preset and a deprecated CLI name merge into one program list", () => {
    const sel = resolveBuiltinSelection(["Git", "gh-cli", "grep"]);
    expect([...sel.names].sort()).toEqual(["grep", "shell-execute"]);
    expect(sel.shellPrograms).toEqual(["git", "gh"]);
  });

  test("tool-name aliases request no shell", () => {
    expect(resolveBuiltinSelection(["research"]).shellPrograms).toEqual([]);
  });

  test("`all` stays the capability built-ins: no shell is granted implicitly", () => {
    const sel = resolveBuiltinSelection(["all"]);
    expect(sel.shellPrograms).toEqual([]);
    expect(sel.names.has("shell-execute")).toBe(false);
  });
});

describe("deprecated gh-cli / git-cli / gws-cli names", () => {
  test("each resolves to shell-execute scoped to its program, with a deprecation", () => {
    for (const [name, program] of Object.entries(DEPRECATED_CLI_TOOLS)) {
      const sel = resolveBuiltinSelection([name]);
      expect([...sel.names]).toEqual(["shell-execute"]);
      expect(sel.shellPrograms).toEqual([program]);
      expect(sel.deprecations).toHaveLength(1);
      expect(sel.deprecations[0]!.name).toBe(name);
      expect(sel.deprecations[0]!.program).toBe(program);
      expect(sel.deprecations[0]!.message).toContain("shell-execute");
    }
  });

  test("resolveBuiltinNames maps a deprecated name to shell-execute", () => {
    expect([...resolveBuiltinNames(["gh-cli", "grep"])].sort()).toEqual(["grep", "shell-execute"]);
  });

  test("the wrappers are no longer built-ins", () => {
    for (const name of [...Object.keys(DEPRECATED_CLI_TOOLS), ...Object.keys(REMOVED_BUILTIN_NAMES)]) {
      expect(BUILTIN_TOOL_NAMES.has(name)).toBe(false);
    }
    expect(builtinTools.some((t) => t.definition.name.endsWith("-cli"))).toBe(false);
  });
});

describe("removed `workspace` / `gws-cli` names select nothing", () => {
  test("each resolves to NO tool and NO shell program, with a deprecation naming the terminal fix", () => {
    for (const name of ["workspace", "gws-cli", "Workspace"]) {
      const sel = resolveBuiltinSelection([name]);
      expect([...sel.names]).toEqual([]);
      expect(sel.shellPrograms).toEqual([]);
      expect(sel.deprecations).toHaveLength(1);
      const dep = sel.deprecations[0]!;
      expect(dep.name).toBe(name);
      expect(dep.replacement).toBeNull();
      expect(dep.program).toBe("gws");
      expect(dep.message).toContain("selects no tool");
      expect(dep.message).toContain("terminal");
      expect(dep.message).toContain('additionalCommands: ["gws"]');
    }
  });

  test("a removed name never widens to a shell, even next to other built-ins", () => {
    const sel = resolveBuiltinSelection(["workspace", "gws-cli", "grep"]);
    expect([...sel.names]).toEqual(["grep"]);
    expect(sel.names.has("shell-execute")).toBe(false);
    expect(sel.deprecations.map((d) => d.name)).toEqual(["workspace", "gws-cli"]);
    expect([...resolveBuiltinNames(["workspace"])]).toEqual([]);
  });
});

describe("git config: a shell that inherits git config sees the user's identity", () => {
  // The old git-cli ran with the real environment, so `git commit` had the
  // user's name. The confined HOME hid ~/.gitconfig; git now gets a per-call
  // config with only user.name / user.email. The scoped preset is read-only
  // (refuses `git config`, see scoped-shell-git-hardening.test.ts), so the
  // identity is read through a terminal-shaped config (inheritGitConfig only).
  const inheriting = (command: string): Promise<ShellResult> =>
    Effect.runPromise(shellExecuteHandler({ inheritGitConfig: true })({ command })) as Promise<ShellResult>;
  let fakeHome = "";
  let saved: NodeJS.ProcessEnv = {};
  beforeAll(() => {
    saved = { ...process.env };
    fakeHome = mkdtempSync(join(tmpdir(), "ra-fake-home-"));
    writeFileSync(join(fakeHome, ".gitconfig"), "[user]\n\tname = RA Test User\n\temail = ra@test.invalid\n");
    process.env.HOME = fakeHome;
    delete process.env.GIT_CONFIG_GLOBAL;
    delete process.env.XDG_CONFIG_HOME;
  });
  afterAll(() => {
    process.env = saved;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test("scopedShellConfig turns inheritance on only when git is allowed", () => {
    expect(scopedShellConfig(["git", "gh"]).inheritGitConfig).toBe(true);
    expect(scopedShellConfig(["gh"]).inheritGitConfig).toBe(false);
    expect(scopedShellConfig(["git"], { inheritGitConfig: false }).inheritGitConfig).toBe(false);
  });

  test("scopedShellConfig makes any git or gh shell read-only; a base cannot turn it off", () => {
    expect(scopedShellConfig(["git", "gh"]).gitReadOnly).toBe(true);
    expect(scopedShellConfig(["gh"]).gitReadOnly).toBe(true);
    expect(scopedShellConfig(["git"], { gitReadOnly: false }).gitReadOnly).toBe(true);
    expect(scopedShellConfig(["ra-fake-cli"]).gitReadOnly).toBe(false);
  });

  test("`git config user.name` returns the real user's name", async () => {
    const r = await inheriting("git config user.name");
    expect(r.exitCode).toBe(0);
    expect(r.output?.trim()).toBe("RA Test User");
  });

  test("the read-only preset refuses `git config`", async () => {
    const r = await run(["git"], "git config user.name");
    expect(r.executed).toBe(false);
    expect(r.error).toContain("read-only");
  });

  test("`git config --global` writes the per-call file, never the real file", async () => {
    const r = await inheriting("git config --global user.name Mallory");
    expect(r.exitCode).toBe(0);
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(join(fakeHome, ".gitconfig"), "utf8")).toContain("RA Test User");
    expect(readFileSync(join(fakeHome, ".gitconfig"), "utf8")).not.toContain("Mallory");
  });

  test("plain shell-execute does not inherit git config", async () => {
    const r = (await Effect.runPromise(shellExecuteHandler()({ command: "git config user.name" }))) as ShellResult;
    expect(r.executed).toBe(true);
    expect(r.output?.trim()).toBe("");
  });

  test("GIT_AUTHOR_* / GIT_COMMITTER_* are forwarded only with git inheritance", () => {
    process.env.GIT_AUTHOR_NAME = "Author X";
    process.env.GIT_COMMITTER_EMAIL = "c@x.invalid";
    try {
      const on = buildHostShellEnv("/usr/bin", "/tmp/s", { globalConfig: "/tmp/s/.gitconfig" });
      expect(on.GIT_CONFIG_GLOBAL).toBe("/tmp/s/.gitconfig");
      expect(on.GIT_AUTHOR_NAME).toBe("Author X");
      expect(on.GIT_COMMITTER_EMAIL).toBe("c@x.invalid");
      const off = buildHostShellEnv("/usr/bin", "/tmp/s");
      expect(off.GIT_CONFIG_GLOBAL).toBeUndefined();
      expect(off.GIT_AUTHOR_NAME).toBeUndefined();
    } finally {
      delete process.env.GIT_AUTHOR_NAME;
      delete process.env.GIT_COMMITTER_EMAIL;
    }
  });
});

describe("host env: authenticated CLIs keep their credential store", () => {
  test("gh gets its real config dir (hosts.yml from `gh auth login`) while HOME stays confined", () => {
    const saved = { ...process.env };
    try {
      delete process.env.GH_TOKEN;
      delete process.env.GITHUB_TOKEN;
      delete process.env.GH_CONFIG_DIR;
      delete process.env.XDG_CONFIG_HOME;
      process.env.HOME = "/home/someone";
      expect(buildHostShellEnv("/usr/bin", "/tmp/scratch", undefined, ["gh"]).GH_CONFIG_DIR).toBe("/home/someone/.config/gh");
      process.env.XDG_CONFIG_HOME = "/xdg";
      expect(buildHostShellEnv("/usr/bin", "/tmp/scratch", undefined, ["gh"]).GH_CONFIG_DIR).toBe("/xdg/gh");
      process.env.GH_CONFIG_DIR = "/srv/gh";
      expect(buildHostShellEnv("/usr/bin", "/tmp/scratch", undefined, ["gh"]).GH_CONFIG_DIR).toBe("/srv/gh");
    } finally {
      process.env = saved;
    }
  });

  test("a gh token is forwarded and takes the place of the config dir", () => {
    const saved = { ...process.env };
    try {
      process.env.GH_TOKEN = "tok";
      const env = buildHostShellEnv("/usr/bin", "/tmp/scratch", undefined, ["gh"]);
      expect(env.GH_TOKEN).toBe("tok");
      expect(env.GH_CONFIG_DIR).toBeUndefined();
    } finally {
      process.env = saved;
    }
  });

  test("gws gets its real config dir while HOME stays confined", () => {
    const saved = { ...process.env };
    try {
      delete process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR;
      delete process.env.XDG_CONFIG_HOME;
      process.env.HOME = "/home/someone";
      const env = buildHostShellEnv("/usr/bin", "/tmp/scratch", undefined, ["gws"]);
      expect(env.HOME).toBe("/tmp/scratch");
      expect(env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR).toBe("/home/someone/.config/gws");
    } finally {
      process.env = saved;
    }
  });

  test("an explicit gws config dir or token is forwarded as set", () => {
    const saved = { ...process.env };
    try {
      process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = "/srv/gws";
      process.env.GOOGLE_WORKSPACE_CLI_TOKEN = "tok";
      const env = buildHostShellEnv("/usr/bin", "/tmp/scratch", undefined, ["gws"]);
      expect(env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR).toBe("/srv/gws");
      expect(env.GOOGLE_WORKSPACE_CLI_TOKEN).toBe("tok");
    } finally {
      process.env = saved;
    }
  });
});
