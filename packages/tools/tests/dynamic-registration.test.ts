import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ToolService, ToolServiceLive } from "../src/tool-service.js";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import type { ToolDefinition } from "../src/types.js";
import { ToolExecutionError } from "../src/errors.js";

const testLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));

const customTool: ToolDefinition = {
  name: "custom-test-tool",
  description: "A test tool for dynamic registration",
  parameters: [
    { name: "input", type: "string", description: "Test input", required: true },
  ],
  category: "custom",
  riskLevel: "low",
  source: "function",
  timeoutMs: 5000,
  requiresApproval: false,
};

const customHandler = (args: Record<string, unknown>) =>
  Effect.succeed({ processed: args.input });

describe("dynamic tool registration", () => {
  test("register adds a tool that can be listed", async () => {
    await Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.register(customTool, customHandler);
      const tools = yield* svc.listTools();
      const names = tools.map((t) => t.name);
      expect(names).toContain("custom-test-tool");
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  });

  test("register adds a tool that can be executed", async () => {
    await Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.register(customTool, customHandler);
      const result = yield* svc.execute({
        toolName: "custom-test-tool",
        arguments: { input: "hello" },
        agentId: "test-agent",
        sessionId: "test-session",
      });
      expect(result.success).toBe(true);
      expect((result.result as { processed: unknown }).processed).toBe("hello");
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  });

  test("unregisterTool removes a previously registered tool", async () => {
    await Effect.gen(function* () {
      const svc = yield* ToolService;
      yield* svc.register(customTool, customHandler);

      // Verify it's there first
      const before = yield* svc.listTools();
      expect(before.map((t) => t.name)).toContain("custom-test-tool");

      yield* svc.unregisterTool("custom-test-tool");

      const after = yield* svc.listTools();
      expect(after.map((t) => t.name)).not.toContain("custom-test-tool");
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  });

  test("unregisterTool is a no-op for unknown tools", async () => {
    await Effect.gen(function* () {
      const svc = yield* ToolService;
      const before = yield* svc.listTools();
      const countBefore = before.length;
      yield* svc.unregisterTool("nonexistent-tool");
      const after = yield* svc.listTools();
      expect(after.length).toBe(countBefore);
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  });

  test("cannot unregister builtin tools", async () => {
    await Effect.gen(function* () {
      const svc = yield* ToolService;

      // file-write is a builtin tool
      const before = yield* svc.listTools({ source: "builtin" });
      const builtinNames = before.map((t) => t.name);
      expect(builtinNames).toContain("file-write");

      // Attempt to unregister a builtin — should be silently ignored
      yield* svc.unregisterTool("file-write");

      const after = yield* svc.listTools({ source: "builtin" });
      expect(after.map((t) => t.name)).toContain("file-write");
    }).pipe(Effect.provide(testLayer), Effect.runPromise);
  });
});
