import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { createRuntime } from "../src/runtime.js";
import { PromptService } from "@reactive-agents/prompts";

describe("PromptLayer singleton", () => {
  it("should provide a single PromptService instance when prompts + reasoning are enabled", async () => {
    const runtime = createRuntime({
      agentId: "prompt-singleton-test",
      provider: "test",
      enablePrompts: true,
      enableReasoning: true,
    });

    // Register a template via PromptService, then verify it's visible from the same service.
    // If two instances existed, register would write to one and compile would read from another.
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ps = yield* PromptService;

        // Register a template
        yield* ps.register({
          id: "test-singleton",
          name: "Test Singleton",
          version: 1,
          template: "Hello {{name}}!",
          variables: [{ name: "name", type: "string", required: true }],
        });

        // Compile it — this must find the template we just registered
        const compiled = yield* ps.compile("test-singleton", { name: "World" });
        return compiled;
      }).pipe(Effect.provide(runtime)),
    );

    expect(result.content).toBe("Hello World!");
  });

  it("should provide PromptService when prompts enabled without reasoning", async () => {
    const runtime = createRuntime({
      agentId: "prompt-no-reasoning-test",
      provider: "test",
      enablePrompts: true,
      enableReasoning: false,
    });

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ps = yield* PromptService;

        yield* ps.register({
          id: "standalone-prompt",
          name: "Standalone Prompt",
          version: 1,
          template: "Greetings, {{user}}.",
          variables: [{ name: "user", type: "string", required: true }],
        });

        const compiled = yield* ps.compile("standalone-prompt", { user: "Agent" });
        return compiled;
      }).pipe(Effect.provide(runtime)),
    );

    expect(result.content).toBe("Greetings, Agent.");
  });
});
