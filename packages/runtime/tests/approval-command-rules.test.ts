// Run: bun test packages/runtime/tests/approval-command-rules.test.ts --timeout 30000
//
// `.withApprovalPolicy({ commands })` (owner decision 2026-11-11): a git/gh
// write in the read-only git preset asks for approval instead of being
// refused. The SAME rule list must reach two places:
//   - the kernel approval gate (`ApprovalGateConfig.commands`), which decides
//     whether a shell call needs approval (deny by default);
//   - every shell the agent registers (`ShellExecuteConfig.approvalCommands`),
//     which runs a rule-matched git/gh write WITHOUT asking.
// If the shell got the list and the gate did not, a matched write would run
// unapproved. `approvalCommandsOf` is the one reader of `policy.commands`.
//
// The integration cells push to a local bare remote (no network), so "the
// push ran" is observable as the remote gaining `refs/heads/main`.
//
// RED-ON-CUT (verified by temporary mutation):
//   - dropping `commands` from `configureApprovalPolicy` (the gate never sees
//     the rule): "no decider" fails, the push runs unapproved.
//   - dropping `commands` from `buildRunEnvelopeFromConfig`: same cell fails.
//   - not passing `approvalCommands` to the init layer: "approved" fails, the
//     read-only preset refuses the approved push.
//   - `withPolicyCommands` keeping `terminal.approvalCommands` with no policy:
//     the pure "terminal rules without a policy" cell fails.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "@reactive-agents/core";
import { scopedShellToolFor, shellExecuteToolFor } from "@reactive-agents/tools";
import { ReactiveAgents } from "../src/index.js";
import type { ApprovalPolicyConfig } from "../src/builder/types.js";
import { resolveShellRegistration } from "../src/builder/build-effect/tool-init-layer.js";
import {
  approvalCommandsOf,
  configureApprovalPolicy,
} from "../src/builder/build-effect/approval-autofeed.js";
import { buildLightRuntimeConfig } from "../src/runtime.js";
import { buildRunEnvelopeFromConfig } from "../src/engine/run-envelope-config.js";
import { defaultReactiveAgentsConfig } from "../src/types.js";
import { agentConfigFromJSON, agentConfigToBuilder, agentConfigToJSON } from "../src/agent-config.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

/** A repo with one commit on `main` and a local bare `origin` that has no branches yet. */
const freshRepo = (): { readonly repo: string; readonly remote: string } => {
  const root = mkdtempSync(join(tmpdir(), "ra-approval-cmd-"));
  dirs.push(root);
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  execFileSync("git", ["init", "--bare", "-q", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hi\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "remote", "add", "origin", remote);
  return { repo, remote };
};

/** True when the bare remote has a `main` branch (the push ran). */
const remoteHasMain = (remote: string): boolean => {
  try {
    execFileSync("git", ["--git-dir", remote, "rev-parse", "--verify", "-q", "refs/heads/main"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

type ToolDone = { readonly toolName: string; readonly success: boolean; readonly result?: unknown; readonly error?: unknown };

/** Build a git-preset agent in `repo`, script one `git push origin main` call, run it. */
const runPush = async (
  repo: string,
  policy: ApprovalPolicyConfig | undefined,
): Promise<{ readonly done: ToolDone[] }> => {
  let b = ReactiveAgents.create()
    .withName("approval-commands")
    .withTestScenario([
      { text: "Pushing.", toolCall: { name: "shell-execute", args: { command: "git push origin main" } } },
      { text: "FINAL ANSWER: done." },
    ] as never)
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(3)
    .withTools({ builtins: ["git"], workspace: repo });
  if (policy) b = b.withApprovalPolicy(policy);
  const agent = await b.build();
  const done: ToolDone[] = [];
  try {
    await agent.subscribe((e: AgentEvent) => {
      if (e._tag === "ToolCallCompleted" && e.toolName === "shell-execute") done.push(e);
    });
    await agent.run("push main").catch(() => undefined);
    return { done };
  } finally {
    await agent.dispose();
  }
};

const text = (d: ToolDone): string => JSON.stringify([d.result, d.error]);

describe("approval command rules: one list for the gate and the shell (pure)", () => {
  it("approvalCommandsOf: only a non-empty commands list", () => {
    expect(approvalCommandsOf(undefined)).toBeUndefined();
    expect(approvalCommandsOf({ tools: ["x"] })).toBeUndefined();
    expect(approvalCommandsOf({ commands: [] })).toBeUndefined();
    expect(approvalCommandsOf({ commands: ["git push"] })).toEqual(["git push"]);
  });

  it("configureApprovalPolicy carries commands to the configured policy, absent when none", () => {
    const withRules = configureApprovalPolicy({ commands: ["git push"] }, "block", []);
    expect(withRules.commands).toEqual(["git push"]);
    const without = configureApprovalPolicy({ tools: ["a"] }, "block", []);
    expect("commands" in without).toBe(false);
  });

  it("the envelope gate and a sub-agent's light config both carry commands", () => {
    const envelope = buildRunEnvelopeFromConfig({
      ...defaultReactiveAgentsConfig("agent"),
      approvalPolicy: { mode: "block", tools: [], commands: ["git push"] },
    });
    expect(envelope.rails.approvalPolicy?.commands).toEqual(["git push"]);
    const child = buildLightRuntimeConfig({
      agentId: "child",
      provider: "test",
      approvalPolicy: { mode: "detach", commands: ["git push"] },
    } as Parameters<typeof buildLightRuntimeConfig>[0]);
    expect(child.approvalPolicy?.mode).toBe("block");
    expect(child.approvalPolicy?.commands).toEqual(["git push"]);
  });

  it("scoped preset: approvalCommands on the shell config and in its description", () => {
    const reg = resolveShellRegistration(undefined, ["git", "gh"], scopedShellToolFor, shellExecuteToolFor, undefined, [
      "git push",
    ]);
    expect(reg?.config?.approvalCommands).toEqual(["git push"]);
    expect(reg?.config?.gitReadOnly).toBe(true);
    expect(reg?.definition.description).toContain("after a human approves the call: git push");
  });

  it("terminal (with a preset, or narrowed by allowedTools): approvalCommands set from the policy", () => {
    const merged = resolveShellRegistration(true, ["git"], scopedShellToolFor, shellExecuteToolFor, undefined, ["git push"]);
    expect(merged?.config?.approvalCommands).toEqual(["git push"]);
    const narrowed = resolveShellRegistration(true, ["git"], scopedShellToolFor, shellExecuteToolFor, ["git"], ["git push"]);
    expect(narrowed?.config?.approvalCommands).toEqual(["git push"]);
    const bare = resolveShellRegistration(true, [], scopedShellToolFor, shellExecuteToolFor, undefined, ["git push"]);
    expect(bare?.config?.approvalCommands).toEqual(["git push"]);
  });

  it("no policy rules: no shell carries approvalCommands, even one set on the terminal", () => {
    const scoped = resolveShellRegistration(undefined, ["git"], scopedShellToolFor, shellExecuteToolFor);
    expect(scoped?.config?.approvalCommands).toBeUndefined();
    for (const programs of [[], ["git"]]) {
      const reg = resolveShellRegistration(
        { approvalCommands: ["git push"], timeoutMs: 1234 },
        programs,
        scopedShellToolFor,
        shellExecuteToolFor,
      );
      expect(reg?.config?.approvalCommands).toBeUndefined();
      expect(reg?.config?.timeoutMs).toBe(1234);
    }
  });

  it("a policy's commands replace the terminal's own approvalCommands", () => {
    const reg = resolveShellRegistration(
      { approvalCommands: ["rm"] },
      [],
      scopedShellToolFor,
      shellExecuteToolFor,
      undefined,
      ["git push"],
    );
    expect(reg?.config?.approvalCommands).toEqual(["git push"]);
  });
});

describe("approval command rules: stored config round-trips", () => {
  it("toConfig → JSON → builder → toConfig keeps mode, tools and commands (not onApprove)", async () => {
    const config = ReactiveAgents.create()
      .withName("rt")
      .withProvider("test")
      .withApprovalPolicy({ mode: "block", tools: ["file-write"], commands: ["git push"], onApprove: () => true })
      .toConfig();
    expect(config.approvalPolicy).toEqual({ mode: "block", tools: ["file-write"], commands: ["git push"] });
    const restored = (await agentConfigToBuilder(agentConfigFromJSON(agentConfigToJSON(config)))).toConfig();
    expect(restored.approvalPolicy).toEqual({ mode: "block", tools: ["file-write"], commands: ["git push"] });
  });

  it("no approval policy: no approvalPolicy key", () => {
    const config = ReactiveAgents.create().withName("rt").withProvider("test").toConfig();
    expect(config.approvalPolicy).toBeUndefined();
  });
});

describe("approval command rules: git push through the read-only git preset", () => {
  beforeAll(() => {
    // The cells need a real git binary; fail loudly rather than pass vacuously.
    execFileSync("git", ["--version"], { stdio: "ignore" });
  });

  it("commands ['git push'], block mode, no onApprove: refused, never reaches the shell", async () => {
    const { repo, remote } = freshRepo();
    await runPush(repo, { mode: "block", commands: ["git push"] });
    // The shell holds the rule and would push if reached; the remote is empty.
    expect(remoteHasMain(remote)).toBe(false);
  }, 30_000);

  it("commands ['git push'], onApprove true: asked once per call, and the push runs", async () => {
    const { repo, remote } = freshRepo();
    const asked: string[] = [];
    const { done } = await runPush(repo, {
      mode: "block",
      commands: ["git push"],
      onApprove: ({ toolName, args }) => {
        asked.push(`${toolName} ${JSON.stringify(args)}`);
        return true;
      },
    });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked[0]).toContain("git push origin main");
    // CONTROL for the refusal cells: the scripted call dispatched and ran.
    expect(done.length).toBeGreaterThan(0);
    expect(remoteHasMain(remote)).toBe(true);
  }, 30_000);

  it("commands ['git push'], onApprove denies: the push does not run", async () => {
    const { repo, remote } = freshRepo();
    let asked = 0;
    await runPush(repo, {
      mode: "block",
      commands: ["git push"],
      onApprove: () => {
        asked += 1;
        return { approve: false, reason: "not now" };
      },
    });
    expect(asked).toBeGreaterThan(0);
    expect(remoteHasMain(remote)).toBe(false);
  }, 30_000);

  it("no approval policy: the read-only preset still refuses the push", async () => {
    const { repo, remote } = freshRepo();
    const { done } = await runPush(repo, undefined);
    expect(done.length).toBeGreaterThan(0);
    expect(text(done[0]!)).toContain("blocked by security policy");
    expect(remoteHasMain(remote)).toBe(false);
  }, 30_000);

  it("a policy without commands: the shell gets no rules, so the preset refuses the push", async () => {
    const { repo, remote } = freshRepo();
    let asked = 0;
    const { done } = await runPush(repo, {
      mode: "block",
      tools: ["some_other_tool"],
      onApprove: () => {
        asked += 1;
        return true;
      },
    });
    // Not a gated call (no rule names it), so it reached the shell, which refused it.
    expect(asked).toBe(0);
    expect(done.length).toBeGreaterThan(0);
    expect(text(done[0]!)).toContain("blocked by security policy");
    expect(remoteHasMain(remote)).toBe(false);
  }, 30_000);
});
