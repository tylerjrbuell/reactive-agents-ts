// File: tests/prompt-variants.test.ts
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { PromptService, PromptServiceLive } from "../src/services/prompt-service.js";
import { reactSystemTemplate } from "../src/templates/reasoning/react-system.js";
import { reactSystemLocalTemplate } from "../src/templates/reasoning/react-system-local.js";
import { reactSystemFrontierTemplate } from "../src/templates/reasoning/react-system-frontier.js";
import { reactThoughtLocalTemplate } from "../src/templates/reasoning/react-thought-local.js";
import { reactThoughtFrontierTemplate } from "../src/templates/reasoning/react-thought-frontier.js";

describe("Prompt template tier variants", () => {
  const setup = Effect.gen(function* () {
    const ps = yield* PromptService;
    // Register base + variants
    yield* ps.register(reactSystemTemplate);
    yield* ps.register(reactSystemLocalTemplate);
    yield* ps.register(reactSystemFrontierTemplate);
    yield* ps.register(reactThoughtLocalTemplate);
    yield* ps.register(reactThoughtFrontierTemplate);
    return ps;
  });

  it("resolves local variant when tier=local", async () => {
    const result = await Effect.runPromise(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-system", { task: "test" }, { tier: "local" }),
        ),
        Effect.provide(PromptServiceLive),
      ),
    );
    expect(result.content).toContain("One action per turn");
    expect(result.templateId).toBe("reasoning.react-system:local");
  });

  it("resolves frontier variant when tier=frontier", async () => {
    const result = await Effect.runPromise(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-system", { task: "test" }, { tier: "frontier" }),
        ),
        Effect.provide(PromptServiceLive),
      ),
    );
    expect(result.content).toContain("highly capable reasoning agent");
    expect(result.templateId).toBe("reasoning.react-system:frontier");
  });

  it("falls back to base template when tier has no variant", async () => {
    const result = await Effect.runPromise(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-system", { task: "test" }, { tier: "mid" }),
        ),
        Effect.provide(PromptServiceLive),
      ),
    );
    // No "mid" variant registered, should fall back to base
    expect(result.content).toContain("reasoning agent");
    expect(result.templateId).toBe("reasoning.react-system");
  });

  it("falls back to base template when no tier specified", async () => {
    const result = await Effect.runPromise(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-system", { task: "test" }),
        ),
        Effect.provide(PromptServiceLive),
      ),
    );
    expect(result.templateId).toBe("reasoning.react-system");
  });

  it("local thought variant is more concise", async () => {
    const result = await Effect.runPromise(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-thought", { context: "ctx", history: "" }, { tier: "local" }),
        ),
        Effect.provide(PromptServiceLive),
      ),
    );
    expect(result.content).toContain("Think briefly");
    expect(result.content.length).toBeLessThan(400);
  });

  it("frontier thought variant includes detailed instructions", async () => {
    const result = await Effect.runPromise(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-thought", { context: "ctx", history: "prev" }, { tier: "frontier" }),
        ),
        Effect.provide(PromptServiceLive),
      ),
    );
    expect(result.content).toContain("Analyze the current state");
    expect(result.content).toContain("Reason through");
  });
});
