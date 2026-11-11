// Run: bun test packages/runtime/tests/seam-scoped-shell-preset.test.ts --timeout 20000
//
// Seam pin: the gh-cli / git-cli wrappers are folded into a scoped
// `shell-execute`; `workspace` / `gws-cli` select no tool and only warn
// (owner decisions 2026-11-10). The tools package resolves the
// names (`resolveBuiltinSelection`); the runtime registers the one shell,
// exposes it, maps allowed/required names, and reports deprecations.
//
// Cells:
//   (a) `builtins: ["git"]` registers exactly one shell-execute scoped to
//       git+gh, running in the run workspace; a gh call goes through, a
//       program outside the preset is refused.
//   (b) `allowedTools: ["gh-cli"]` exposes shell-execute, does not block the
//       call, and the build warns once about the removed name.
//   (c) terminal + git preset: one shell-execute whose allow-list includes gh.
//   (d) `requiredTools: ["git-cli"]` is met by a shell-execute call.
//
// RED-ON-CUT (verified by temporary mutation):
//   - `resolveShellRegistration` returning undefined when there is no
//     terminal: (a), (b) and (d) fail (no shell-execute registered).
//   - dropping the preset merge into the terminal's additionalCommands: (c)
//     fails (gh is refused by the default terminal allow-list).
//   - dropping `resolveRequiredToolNames` in runtime-construction and the
//     pre-loop mapping: (d) fails (the run never calls "git-cli").
//   - ignoring the agent's own tool names in `resolveToolNameList` and
//     `builtinSelectionFor`: the custom `web` and custom `git` cells fail.
//   - validating the raw contract (no `resolveContractToolNames`): the
//     contract `gh-cli` cell fails under strict validation.
import { afterAll, afterEach, beforeAll, describe, expect, it, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { AgentEvent, TaskContract } from "@reactive-agents/core";
import { ToolService, shellExecuteToolFor } from "@reactive-agents/tools";
import type { ToolDefinition } from "@reactive-agents/tools";
import { ReactiveAgents } from "../src/index.js";
import { resolveShellRegistration } from "../src/builder/build-effect/tool-init-layer.js";
import { scopedShellToolFor } from "@reactive-agents/tools";
import { computeExposedToolNames } from "../src/builder/contract-tool-set.js";
import { builtinSelectionFor, isKnownBuiltinName } from "../src/builder/builtins-option.js";

const MARKER = "FAKE-GH-OK-7f3a";
/**
 * gh ran: the fake prints MARKER; a real gh earlier on the shell's strict PATH
 * (e.g. /usr/bin/gh) prints "gh version". Either proves the call executed.
 */
const GH_RAN = new RegExp(`${MARKER}|gh version`);
const dirs: string[] = [];
let originalPath: string | undefined;

beforeAll(() => {
  // A fake `gh` first on PATH, so the gh cell does not depend on a real gh.
  const bin = mkdtempSync(join(tmpdir(), "ra-scoped-shell-bin-"));
  dirs.push(bin);
  const gh = join(bin, "gh");
  writeFileSync(gh, `#!/bin/sh\necho ${MARKER} "$@"\n`);
  chmodSync(gh, 0o755);
  originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
});

afterAll(() => {
  process.env.PATH = originalPath;
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const spies: Array<ReturnType<typeof spyOn>> = [];
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
});
const captureWarnings = (): string[] => {
  const lines: string[] = [];
  spies.push(
    spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    }),
  );
  return lines;
};

type Agent = Awaited<ReturnType<ReturnType<typeof ReactiveAgents.create>["build"]>>;
type ToolDone = { readonly toolName: string; readonly success: boolean; readonly result?: unknown; readonly error?: unknown };

/** The shell-execute definitions in the agent's own ToolService. */
const shellDefs = (agent: Agent): Promise<readonly ToolDefinition[]> =>
  agent.runtime.runPromise(
    Effect.gen(function* () {
      const ts = yield* ToolService;
      const all = yield* ts.listTools();
      return all.filter((t) => t.name === "shell-execute");
    }),
  );

/** Run `task`, the scenario calling shell-execute once per command; return the completed calls. */
const runShell = async (
  agent: Agent,
  task: string,
): Promise<{ readonly done: ToolDone[]; readonly success: boolean }> => {
  const done: ToolDone[] = [];
  await agent.subscribe((e: AgentEvent) => {
    if (e._tag === "ToolCallCompleted" && e.toolName === "shell-execute") done.push(e);
  });
  const result = await agent.run(task).catch(() => undefined);
  return { done, success: result?.success === true };
};

/** A custom tool with one string parameter; `onCall` runs on each call. */
const customTool = (name: string, onCall: () => void) => ({
  definition: {
    name,
    description: `Custom ${name} tool.`,
    parameters: [{ name: "q", type: "string" as const, description: "query", required: false }],
    riskLevel: "low" as const,
    timeoutMs: 5000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (_args: Record<string, unknown>) =>
    Effect.sync(() => {
      onCall();
      return { ok: true };
    }),
});

/** Test-provider turns: one shell-execute call per command, then a final answer. */
const scenario = (...commands: string[]) =>
  [
    ...commands.map((command) => ({ text: "Running.", toolCall: { name: "shell-execute", args: { command } } })),
    { text: "FINAL ANSWER: done." },
  ] as never;

describe("resolveShellRegistration (pure)", () => {
  it("no terminal, no preset: no shell", () => {
    expect(resolveShellRegistration(undefined, [], scopedShellToolFor, shellExecuteToolFor)).toBeUndefined();
  });

  it("preset without terminal: shell-execute scoped to exactly the preset programs", () => {
    const reg = resolveShellRegistration(undefined, ["git", "gh"], scopedShellToolFor, shellExecuteToolFor);
    expect(reg?.definition.name).toBe("shell-execute");
    expect(reg?.definition.description).toContain("git, gh");
    expect(reg?.config?.allowedCommands).toEqual([]);
    expect(reg?.config?.additionalCommands).toEqual(["git", "gh"]);
    expect(reg?.unrootedInHostCwd).toBe(true);
    // The model reads where it runs: the description matches the handler.
    expect(reg?.definition.description).toContain("current directory of the host process");
    expect(reg?.definition.description).not.toContain("temporary directory under /tmp");
  });

  it("the terminal (with or without a preset) never falls back to the host cwd", () => {
    for (const programs of [[], ["git", "gh"]]) {
      const reg = resolveShellRegistration(true, programs, scopedShellToolFor, shellExecuteToolFor);
      expect(reg?.unrootedInHostCwd).toBe(false);
      expect(reg?.definition.description).toContain("temporary directory under /tmp");
      expect(reg?.definition.description).not.toContain("current directory of the host process");
    }
  });

  it("terminal + preset: the terminal config gains the preset programs, nothing removed", () => {
    const reg = resolveShellRegistration(
      { additionalCommands: ["node", "git"] },
      ["git", "gh"],
      scopedShellToolFor,
      shellExecuteToolFor,
    );
    expect(reg?.config?.additionalCommands).toEqual(["node", "git", "gh"]);
    expect(reg?.config?.allowedCommands).toBeUndefined();
    expect(reg?.config?.inheritGitConfig).toBe(true);
  });

  it("terminal + preset: the one shell honours the terminal's cwd, sandbox and timeout", () => {
    const reg = resolveShellRegistration(
      { cwd: "sub", sandbox: "host", timeoutMs: 1234, maxOutputChars: 99 },
      ["gws"],
      scopedShellToolFor,
      shellExecuteToolFor,
    );
    expect(reg?.config?.cwd).toBe("sub");
    expect(reg?.config?.sandbox).toBe("host");
    expect(reg?.config?.timeoutMs).toBe(1234);
    expect(reg?.config?.maxOutputChars).toBe(99);
    expect(reg?.config?.additionalCommands).toEqual(["gws"]);
  });

  it("terminal + preset keeps the terminal's own approval/risk flags (no downgrade)", () => {
    const terminalOnly = shellExecuteToolFor(undefined, { runWorkspace: true });
    const reg = resolveShellRegistration(true, ["git", "gh"], scopedShellToolFor, shellExecuteToolFor);
    expect(reg?.definition.requiresApproval).toBe(terminalOnly.requiresApproval);
    expect(reg?.definition.riskLevel).toBe(terminalOnly.riskLevel);
    expect(reg?.definition.description).not.toContain("Only git, gh may run");
  });

  it("terminal + a preset without git: inheritGitConfig stays off; an explicit value wins", () => {
    const ws = resolveShellRegistration(true, ["gws"], scopedShellToolFor, shellExecuteToolFor);
    expect(ws?.config?.inheritGitConfig).toBe(false);
    const explicit = resolveShellRegistration(
      { inheritGitConfig: false },
      ["git"],
      scopedShellToolFor,
      shellExecuteToolFor,
    );
    expect(explicit?.config?.inheritGitConfig).toBe(false);
  });

  it("preset without terminal passes scopedShellConfig through (git preset inherits git config)", () => {
    const reg = resolveShellRegistration(undefined, ["git", "gh"], scopedShellToolFor, shellExecuteToolFor);
    expect(reg?.config?.inheritGitConfig).toBe(true);
  });
});

describe("builtins / allowedTools name resolution", () => {
  it("a removed CLI name is a known builtins name (deprecation, not ToolsOptionError)", () => {
    expect(isKnownBuiltinName("gh-cli")).toBe(true);
    expect(() => ReactiveAgents.create().withTools({ builtins: "gh-cli" })).not.toThrow();
  });

  it("allowedTools: [\"gh-cli\"] exposes shell-execute and selects gh", () => {
    expect(computeExposedToolNames({ allowedTools: ["gh-cli"] })).toEqual(["shell-execute"]);
    const sel = builtinSelectionFor({ allowedTools: ["gh-cli"] });
    expect(sel.shellPrograms).toEqual(["gh"]);
    expect(sel.deprecations.map((d) => d.name)).toEqual(["gh-cli"]);
  });

  it("toolset names inside allowedTools (Cortex) select the scoped shell; removed `workspace` adds nothing", () => {
    expect(computeExposedToolNames({ allowedTools: ["git", "workspace"] })).toEqual(["shell-execute"]);
    expect(builtinSelectionFor({ allowedTools: ["git", "workspace"] }).shellPrograms).toEqual(["git", "gh"]);
  });

  it("removed gws names are known scalar builtins (deprecation, not ToolsOptionError); an unknown name still throws", () => {
    expect(isKnownBuiltinName("workspace")).toBe(true);
    expect(isKnownBuiltinName("gws-cli")).toBe(true);
    expect(() => ReactiveAgents.create().withTools({ builtins: "workspace" })).not.toThrow();
    expect(() => ReactiveAgents.create().withTools({ builtins: "gws-cli" })).not.toThrow();
    expect(isKnownBuiltinName("not-a-builtin")).toBe(false);
    expect(() => ReactiveAgents.create().withTools({ builtins: "not-a-builtin" })).toThrow();
  });

  for (const name of ["workspace", "gws-cli"] as const) {
    it(`builtins: "${name}" builds with the same deprecation warning as builtins: ["${name}"], and no shell`, async () => {
      const build = async (builtins: string | string[]): Promise<string[]> => {
        const warnings = captureWarnings();
        const agent = await ReactiveAgents.create()
          .withName(`removed-${name}`)
          .withProvider("test")
          .withModel("test")
          .withTools({ builtins, adaptive: false })
          .build();
        try {
          expect((await shellDefs(agent)).length).toBe(0);
        } finally {
          await agent.dispose();
        }
        for (const s of spies.splice(0)) s.mockRestore();
        return warnings.filter((w) => w.includes(`"${name}" was removed`));
      };
      const scalar = await build(name);
      const array = await build([name]);
      expect(scalar.length).toBe(1);
      expect(scalar[0]).toContain('additionalCommands: ["gws"]');
      expect(scalar).toEqual(array);
    }, 20000);
  }

  it("builtins: true and \"all\" grant no shell", () => {
    expect(computeExposedToolNames({ builtins: true })).not.toContain("shell-execute");
    expect(computeExposedToolNames({ builtins: ["all"] })).not.toContain("shell-execute");
  });
});

describe("scoped shell through the builder", () => {
  it("(a) builtins: [\"git\"] registers one shell-execute scoped to git+gh; gh runs, echo is refused", async () => {
    const ws = mkdtempSync(join(tmpdir(), "ra-scoped-shell-ws-"));
    dirs.push(ws);
    const agent = await ReactiveAgents.create()
      .withName("scoped-git")
      .withProvider("test")
      .withModel("test")
      .withTestScenario(scenario("gh --version", "echo hi"))
      .withTools({ builtins: ["git"], adaptive: false, workspace: ws })
      .withMaxIterations(5)
      .build();
    try {
      const defs = await shellDefs(agent);
      expect(defs.length).toBe(1);
      expect(defs[0]?.description).toContain("git, gh");
      const { done } = await runShell(agent, "Run gh --version");
      const text = done.map((d) => JSON.stringify(d.result ?? d.error));
      expect(text[0]).toMatch(GH_RAN);
      expect(text[1]).toContain("not in the allowed commands list");
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("(b) allowedTools: [\"gh-cli\"] warns once and the shell-execute call is not blocked", async () => {
    const warnings = captureWarnings();
    const agent = await ReactiveAgents.create()
      .withName("scoped-gh-allowed")
      .withProvider("test")
      .withModel("test")
      .withTestScenario(scenario("gh --version"))
      .withTools({ allowedTools: ["gh-cli"], adaptive: false })
      .withMaxIterations(4)
      .build();
    try {
      expect(warnings.filter((w) => w.includes('"gh-cli" was removed')).length).toBe(1);
      expect((await shellDefs(agent)).length).toBe(1);
      const { done } = await runShell(agent, "Run gh --version");
      expect(done.length).toBeGreaterThan(0);
      expect(JSON.stringify(done[0]?.result ?? done[0]?.error)).toMatch(GH_RAN);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("(b2) allowedTools: [\"git\"] (Cortex) registers the scoped shell and the call is not blocked", async () => {
    const agent = await ReactiveAgents.create()
      .withName("scoped-git-allowed")
      .withProvider("test")
      .withModel("test")
      .withTestScenario(scenario("git --version"))
      .withTools({ allowedTools: ["git"], adaptive: false })
      .withMaxIterations(4)
      .build();
    try {
      expect((await shellDefs(agent)).length).toBe(1);
      const { done } = await runShell(agent, "Run git --version");
      expect(JSON.stringify(done[0]?.result ?? done[0]?.error)).toContain("git version");
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("a custom tool named `web` in allowedTools stays `web` (not the web toolset) and is callable", async () => {
    let called = 0;
    const web = customTool("web", () => {
      called += 1;
    });
    expect(computeExposedToolNames({ tools: [web], allowedTools: ["web"] })).toEqual(["web"]);
    const agent = await ReactiveAgents.create()
      .withName("custom-web")
      .withProvider("test")
      .withModel("test")
      .withTestScenario([{ text: "Calling.", toolCall: { name: "web", args: { q: "x" } } }, { text: "FINAL ANSWER: done." }] as never)
      .withTools({ tools: [web], allowedTools: ["web"], adaptive: false })
      .withMaxIterations(4)
      .build();
    const done: ToolDone[] = [];
    await agent.subscribe((e: AgentEvent) => {
      if (e._tag === "ToolCallCompleted") done.push(e);
    });
    try {
      await agent.run("Run the web tool");
    } finally {
      await agent.dispose();
    }
    expect(called).toBe(1);
    expect(done.some((d) => d.toolName === "web" && d.success)).toBe(true);
  }, 20000);

  it("a custom tool named `git` in allowedTools is that tool: no scoped shell is registered", async () => {
    const git = customTool("git", () => undefined);
    expect(builtinSelectionFor({ tools: [git], allowedTools: ["git"] }).shellPrograms).toEqual([]);
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withModel("test")
      .withTools({ tools: [git], allowedTools: ["git"], adaptive: false })
      .build();
    try {
      expect((await shellDefs(agent)).length).toBe(0);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("a contract that requires `gh-cli` passes strict build validation (resolves to the scoped shell)", async () => {
    const contract: TaskContract = {
      prompt: "x",
      tools: [{ kind: "required", name: "gh-cli" }],
      success: { type: "regex", pattern: "ok" },
    };
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withModel("test")
      .withStrictValidation()
      .withContract(contract)
      .withTools({ adaptive: false })
      .build();
    try {
      expect((await shellDefs(agent)).length).toBe(1);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("(c) terminal + git preset: one shell-execute that also runs gh", async () => {
    const agent = await ReactiveAgents.create()
      .withName("terminal-plus-git")
      .withProvider("test")
      .withModel("test")
      .withTestScenario(scenario("gh --version"))
      .withTools({ terminal: true, builtins: ["git"], adaptive: false })
      .withMaxIterations(4)
      .build();
    try {
      expect((await shellDefs(agent)).length).toBe(1);
      const { done } = await runShell(agent, "Run gh --version");
      expect(JSON.stringify(done[0]?.result ?? done[0]?.error)).toMatch(GH_RAN);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("(e) builtins: [\"git\"], no workspace: git runs in the host process cwd (old git-cli parity)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("scoped-git-host-cwd")
      .withProvider("test")
      .withModel("test")
      .withTestScenario(scenario("git rev-parse --show-toplevel"))
      .withTools({ builtins: ["git"], adaptive: false })
      .withMaxIterations(4)
      .build();
    try {
      const { done } = await runShell(agent, "Show the repo top level");
      const out = JSON.stringify(done[0]?.result ?? done[0]?.error);
      expect(out).not.toContain("not a git repository");
      // The test runner's cwd is inside this repo: the shell saw the same top level.
      const top = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd(), encoding: "utf8" }).trim();
      expect(top.length).toBeGreaterThan(0);
      expect(out).toContain(top);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("(f) builtins: [\"git\"] with a workspace: git runs in the workspace, not the host cwd", async () => {
    const ws = mkdtempSync(join(tmpdir(), "ra-scoped-shell-ws-"));
    dirs.push(ws);
    const agent = await ReactiveAgents.create()
      .withName("scoped-git-ws")
      .withProvider("test")
      .withModel("test")
      .withTestScenario(scenario("git rev-parse --show-toplevel"))
      .withTools({ builtins: ["git"], adaptive: false, workspace: ws })
      .withMaxIterations(4)
      .build();
    try {
      const { done } = await runShell(agent, "Show the repo top level");
      // ws is a fresh tmp dir outside any repo: git refuses there.
      expect(JSON.stringify(done[0]?.result ?? done[0]?.error)).toContain("not a git repository");
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("(g) terminal + git preset, no workspace: the terminal's /tmp sandbox is kept", async () => {
    const agent = await ReactiveAgents.create()
      .withName("terminal-git-sandbox")
      .withProvider("test")
      .withModel("test")
      .withTestScenario(scenario("git rev-parse --show-toplevel"))
      .withTools({ terminal: true, builtins: ["git"], adaptive: false })
      .withMaxIterations(4)
      .build();
    try {
      const { done } = await runShell(agent, "Show the repo top level");
      expect(JSON.stringify(done[0]?.result ?? done[0]?.error)).toContain("not a git repository");
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("(d) requiredTools: [\"git-cli\"] is met by a shell-execute call", async () => {
    const agent = await ReactiveAgents.create()
      .withName("required-git-cli")
      .withProvider("test")
      .withModel("test")
      .withTestScenario(scenario("git --version"))
      .withTools({ adaptive: false })
      .withRequiredTools({ tools: ["git-cli"] })
      .withMaxIterations(4)
      .build();
    try {
      expect((await shellDefs(agent)).length).toBe(1);
      const { done, success } = await runShell(agent, "Run git --version");
      expect(done.some((d) => d.success)).toBe(true);
      expect(success).toBe(true);
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
