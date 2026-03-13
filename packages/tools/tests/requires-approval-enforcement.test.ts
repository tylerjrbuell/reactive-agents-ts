/**
 * Behavioral contract tests for requiresApproval() on ToolBuilder.
 *
 * IMPORTANT: Automatic enforcement is NOT implemented at the framework level.
 * requiresApproval() sets a boolean metadata flag on ToolDefinition. The
 * ToolService will execute a tool with requiresApproval: true without any
 * pause or prompt. Enforcement is the developer's responsibility — check
 * `definition.requiresApproval` in your own execution pipeline before
 * calling ToolService.execute().
 */

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ToolBuilder } from "../src/tool-builder.js";
import { ToolService, ToolServiceLive } from "../src/tool-service.js";
import { EventBusLive } from "@reactive-agents/core";

const TestToolLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));

describe("requiresApproval — behavioral contract", () => {
  it("sets requiresApproval to true in the definition", () => {
    const { definition } = new ToolBuilder("dangerous-op")
      .description("A dangerous operation requiring user approval")
      .param("target", "string", "Target resource", { required: true })
      .riskLevel("critical")
      .requiresApproval()
      .build();

    expect(definition.requiresApproval).toBe(true);
  });

  it("defaults requiresApproval to false when not called", () => {
    const { definition } = new ToolBuilder("safe-op")
      .description("A safe operation")
      .build();

    expect(definition.requiresApproval).toBe(false);
  });

  it("executes a tool with requiresApproval: true without automatic enforcement", async () => {
    // The framework does NOT block or pause on requiresApproval — it is purely
    // metadata. This test documents that behavior as a contract.
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(
        {
          name: "approval-required-tool",
          description: "A tool that claims to require approval",
          parameters: [
            {
              name: "value",
              type: "string",
              description: "Some value",
              required: true,
            },
          ],
          riskLevel: "high",
          timeoutMs: 5_000,
          requiresApproval: true, // flag is set, but ToolService does NOT enforce it
          source: "function",
        },
        (args) => Effect.succeed({ echoed: args.value }),
      );

      // Despite requiresApproval: true, execute() proceeds without any pause or error
      const result = yield* tools.execute({
        toolName: "approval-required-tool",
        arguments: { value: "hello" },
        agentId: "test-agent",
        sessionId: "test-session",
      });

      // Tool executes successfully — no automatic approval gate fires
      expect(result.success).toBe(true);
      expect((result.result as { echoed: string }).echoed).toBe("hello");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  it("exposes requiresApproval flag via listTools() for custom enforcement", async () => {
    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(
        {
          name: "custom-enforcement-tool",
          description: "Tool whose flag a custom pipeline can inspect",
          parameters: [],
          riskLevel: "high",
          timeoutMs: 5_000,
          requiresApproval: true,
          source: "function",
        },
        () => Effect.succeed("done"),
      );

      const allTools = yield* tools.listTools();
      const found = allTools.find((d) => d.name === "custom-enforcement-tool");

      // The flag is visible in listTools() so callers can gate execution themselves
      expect(found).toBeDefined();
      expect(found!.requiresApproval).toBe(true);
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });
});
