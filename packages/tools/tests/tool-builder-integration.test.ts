/**
 * Integration tests for ToolBuilder — verifies that ToolBuilder-created tools
 * work correctly both as standalone definitions and when wired through the
 * ReactiveAgents builder. The existing tool-builder.test.ts only checks
 * definition shape; these tests go further.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ToolBuilder } from "../src/tool-builder.js";
import { ToolService, ToolServiceLive } from "../src/tool-service.js";
import { EventBusLive } from "@reactive-agents/core";

const TestToolLayer = ToolServiceLive.pipe(Layer.provide(EventBusLive));

// ─── Test 1: Custom tool with handler executes ────────────────────────────────

describe("ToolBuilder integration", () => {
  it("custom tool with handler executes and returns correct value", async () => {
    const { definition, handler } = new ToolBuilder("count-things")
      .description("Count items in a list")
      .param("items", "array", "List of items to count", { required: true })
      .handler((_args: unknown) => {
        return { count: 42, status: "done" };
      })
      .build();

    expect(handler).toBeDefined();

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      // Register the ToolBuilder tool with an Effect-returning handler
      yield* tools.register(definition, (args) =>
        Effect.succeed(handler!(args)),
      );

      const result = yield* tools.execute({
        toolName: "count-things",
        arguments: { items: [1, 2, 3] },
        agentId: "test-agent",
        sessionId: "test-session",
      });

      expect(result.success).toBe(true);
      expect((result.result as { count: number }).count).toBe(42);
      expect((result.result as { status: string }).status).toBe("done");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  // ─── Test 2: Required parameter enforced ─────────────────────────────────────

  it("required parameter is validated — missing param fails with ToolValidationError", async () => {
    const { definition } = new ToolBuilder("greet-person")
      .description("Greet a named person")
      .param("name", "string", "The person's name", { required: true })
      .handler((args: unknown) => `Hello, ${(args as { name: string }).name}!`)
      .build();

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;

      yield* tools.register(definition, (args) =>
        Effect.succeed(`Hello, ${(args as { name: string }).name}!`),
      );

      // Provide the required parameter — should succeed
      const ok = yield* tools.execute({
        toolName: "greet-person",
        arguments: { name: "Ada" },
        agentId: "test-agent",
        sessionId: "test-session",
      });
      expect(ok.success).toBe(true);
      expect(ok.result).toBe("Hello, Ada!");

      // Missing the required parameter — should fail
      const bad = yield* tools
        .execute({
          toolName: "greet-person",
          arguments: {},
          agentId: "test-agent",
          sessionId: "test-session",
        })
        .pipe(Effect.flip);

      expect(bad._tag).toBe("ToolValidationError");
    });

    await Effect.runPromise(program.pipe(Effect.provide(TestToolLayer)));
  });

  // ─── Test 3: Tool with enum param stores constraint in definition ─────────────

  it("tool with enum param has enum constraint in definition", () => {
    const { definition } = new ToolBuilder("set-speed")
      .description("Set execution speed")
      .param("mode", "string", "Execution speed", { enum: ["fast", "slow"] })
      .build();

    expect(definition.parameters).toHaveLength(1);
    const param = definition.parameters[0];
    expect(param.name).toBe("mode");
    expect(param.enum).toEqual(["fast", "slow"]);
  });

  // ─── Test 4: riskLevel "high" is stored in definition ─────────────────────────

  it('riskLevel("high") is stored in the definition', () => {
    const { definition } = new ToolBuilder("run-script")
      .description("Execute an arbitrary shell script")
      .riskLevel("high")
      .build();

    expect(definition.riskLevel).toBe("high");
  });

  // ─── Test 5: requiresApproval is stored in definition ────────────────────────

  it(".requiresApproval() sets requiresApproval to true in definition", () => {
    const { definition } = new ToolBuilder("delete-resource")
      .description("Permanently delete a resource")
      .requiresApproval()
      .build();

    expect(definition.requiresApproval).toBe(true);
  });

  // ─── Test 6: category is stored in definition ────────────────────────────────

  it('.category("search") stores the category in the definition', () => {
    const { definition } = new ToolBuilder("find-docs")
      .description("Search documentation")
      .category("search")
      .build();

    expect(definition.category).toBe("search");
  });
});
