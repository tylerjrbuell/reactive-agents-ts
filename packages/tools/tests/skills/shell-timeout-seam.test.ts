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
