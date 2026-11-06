// Seam pin: a configured shell timeout (ShellExecuteConfig.timeoutMs) is honored
// end to end. ToolService races every handler against the DEFINITION timeout,
// so a definition hard-coded at 30s silently capped `terminal.timeoutMs` above
// 30s (runtime-warden finding 2026-11-06). The definition must follow the
// config, with a grace margin so the handler's own kill (and its partial
// output) wins the race against the outer ToolService timeout.
import { describe, expect, test } from "bun:test";
import { Effect, Fiber, Layer, TestClock, TestContext } from "effect";
import { EventBusLive } from "@reactive-agents/core";
import { ToolService, ToolServiceLive } from "../../src/tool-service.js";
import {
  SHELL_TIMEOUT_GRACE_MS,
  shellExecuteToolFor,
} from "../../src/skills/shell-execute-definition.js";
import { shellExecuteHandler, type ShellExecuteConfig } from "../../src/skills/shell-execution.js";
import { runHostShell } from "../../src/skills/shell-host-process.js";
import { tmpdir } from "node:os";
import { HANDLER_TIMEOUT_GRACE_MS } from "../../src/skills/timeout-grace.js";
import { gitCliTool, makeGitCliHandler } from "../../src/skills/cli/git-cli.js";
import { ghCliTool, makeGhCliHandler } from "../../src/skills/cli/gh-cli.js";
import { gwsCliTool, makeGwsCliHandler } from "../../src/skills/cli/gws-cli.js";
import type { CliRunner } from "../../src/skills/cli/cli-runner.js";
import { codeExecuteToolFor } from "../../src/skills/code-execution.js";
import { dockerExecuteTool } from "../../src/skills/docker-execution.js";
import { DEFAULT_DOCKER_CONFIG } from "../../src/execution/docker-sandbox.js";

const TestToolLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));

const runShell = (config: ShellExecuteConfig, command: string) =>
  Effect.gen(function* () {
    const tools = yield* ToolService;
    yield* tools.register(shellExecuteToolFor(config), shellExecuteHandler(config));
    return yield* tools.execute({
      toolName: "shell-execute",
      arguments: { command },
      agentId: "agent-1",
      sessionId: "session-1",
    });
  });

describe("shellExecuteToolFor — timeout follows config", () => {
  test("a configured timeout above 30s raises the definition timeout above it", () => {
    expect(shellExecuteToolFor({ timeoutMs: 60_000 }).timeoutMs).toBeGreaterThan(60_000);
  });

  test("definition timeout = configured timeout + grace margin", () => {
    expect(shellExecuteToolFor({ timeoutMs: 2_000 }).timeoutMs).toBe(2_000 + SHELL_TIMEOUT_GRACE_MS);
    expect(shellExecuteToolFor({ timeoutMs: 1_000 }).timeoutMs).toBe(1_000 + SHELL_TIMEOUT_GRACE_MS);
  });

  test("default keeps the handler's 30s kill, with the outer race just behind it", () => {
    expect(shellExecuteToolFor().timeoutMs).toBe(30_000 + SHELL_TIMEOUT_GRACE_MS);
  });

  test("grace margin is small and positive", () => {
    expect(SHELL_TIMEOUT_GRACE_MS).toBeGreaterThan(0);
    expect(SHELL_TIMEOUT_GRACE_MS).toBeLessThanOrEqual(5_000);
  });
});

describe("ToolService + shell-execute — configured timeout honored end to end", () => {
  test("a run past 30s but under the configured 60s is not cut by ToolService", async () => {
    // TestClock drives only the outer ToolService race; the real command takes
    // ~0.3s of wall time. Advancing the virtual clock 31s simulates a command
    // that outlives the old hard-coded 30s definition timeout.
    const program = Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        runShell({ timeoutMs: 60_000, additionalCommands: ["sleep"] }, "sleep 0.3"),
      );
      yield* TestClock.adjust("31 seconds");
      return yield* Fiber.join(fiber);
    });
    const result = await Effect.runPromise(
      program.pipe(Effect.provide(TestToolLayer), Effect.provide(TestContext.TestContext)),
    );
    expect(result.success).toBe(true);
    expect((result.result as { executed: boolean }).executed).toBe(true);
  });

  test("the handler's own kill wins the race: a 1s config returns the handler result", async () => {
    const start = Date.now();
    const result = await Effect.runPromise(
      runShell(
        { timeoutMs: 1_000, additionalCommands: ["sleep"] },
        "sleep 5",
      ).pipe(Effect.provide(TestToolLayer)),
    );
    const elapsed = Date.now() - start;
    // Handler killed the process at ~1s; ToolService did not raise a timeout.
    expect((result.result as { executed: boolean }).executed).toBe(true);
    expect((result.result as { exitCode: number }).exitCode).not.toBe(0);
    expect(elapsed).toBeLessThan(1_000 + SHELL_TIMEOUT_GRACE_MS);
  });
});

// Timeout follow-ups (2026-11-06): the host kill reached only `sh`, so a
// grandchild holding the stdout pipe (`… | sleep 5`) kept the read open past
// the kill; and a timed-out run looked like any other non-zero exit to the
// model. The kill now targets the process group, and the result carries
// `timedOut: true` plus a short note.
describe("runHostShell — timeout kills the process group", () => {
  test("a pipe-holding grandchild cannot outlive a 1s kill", async () => {
    const start = Date.now();
    const result = await runHostShell({
      command: "echo partial; sleep 5 | sleep 5",
      cwd: tmpdir(),
      path: process.env.PATH ?? "/usr/bin:/bin",
      timeoutMs: 1_000,
      homeInCwd: false,
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3_000);
    expect(result.stdout).toContain("partial");
    expect(result.timedOut).toBe(true);
  });

  test("a command that finishes in time is not marked timed out", async () => {
    const result = await runHostShell({
      command: "echo done",
      cwd: tmpdir(),
      path: process.env.PATH ?? "/usr/bin:/bin",
      timeoutMs: 5_000,
      homeInCwd: false,
    });
    expect(result.stdout).toContain("done");
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });
});

// Same tie as shell had: each handler killed at exactly its definition
// timeout, so ToolService's outer race could fire first and drop the handler's
// own result. The outer race must run strictly after the handler's kill.
describe("handler kill runs before the ToolService race (no timeout ties)", () => {
  const cliCases = [
    ["git-cli", gitCliTool, makeGitCliHandler],
    ["gh-cli", ghCliTool, makeGhCliHandler],
    ["gws-cli", gwsCliTool, makeGwsCliHandler],
  ] as const;

  for (const [name, def, makeHandler] of cliCases) {
    test(`${name}: definition timeout = runner kill + grace`, async () => {
      let killMs = -1;
      const runner: CliRunner = async (_cmd, _args, timeoutMs) => {
        killMs = timeoutMs;
        return { stdout: "", stderr: "", exitCode: 0 };
      };
      await Effect.runPromise(makeHandler(runner)({ command: "status" }));
      expect(killMs).toBeGreaterThan(0);
      expect(def.timeoutMs).toBe(killMs + HANDLER_TIMEOUT_GRACE_MS);
    });
  }

  test("code-execute: definition timeout = 30s host kill + grace", () => {
    expect(codeExecuteToolFor().timeoutMs).toBe(30_000 + HANDLER_TIMEOUT_GRACE_MS);
  });

  test("docker-execute: definition timeout = default sandbox kill + grace", () => {
    expect(dockerExecuteTool.timeoutMs).toBe(DEFAULT_DOCKER_CONFIG.timeoutMs + HANDLER_TIMEOUT_GRACE_MS);
  });

  test("shell grace is the shared grace", () => {
    expect(SHELL_TIMEOUT_GRACE_MS).toBe(HANDLER_TIMEOUT_GRACE_MS);
  });
});

describe("shell-execute — a timed-out run is marked for the model", () => {
  test("result carries timedOut: true and a note naming the limit", async () => {
    const result = await Effect.runPromise(
      runShell({ timeoutMs: 1_000, additionalCommands: ["sleep"] }, "sleep 5").pipe(
        Effect.provide(TestToolLayer),
      ),
    );
    const r = result.result as { executed: boolean; timedOut?: boolean; note?: string };
    expect(r.executed).toBe(true);
    expect(r.timedOut).toBe(true);
    expect(r.note).toContain("timed out after 1000ms");
  });

  test("a normal run carries no timeout marker", async () => {
    const result = await Effect.runPromise(
      runShell({ timeoutMs: 5_000 }, "echo ok").pipe(Effect.provide(TestToolLayer)),
    );
    const r = result.result as { timedOut?: boolean; note?: string };
    expect(r.timedOut).toBeUndefined();
    expect(r.note).toBeUndefined();
  });
});
