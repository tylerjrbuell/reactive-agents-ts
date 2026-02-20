import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  PromptService,
  PromptServiceLive,
  reactTemplate,
  planExecuteTemplate,
  factCheckTemplate,
} from "../src/index.js";

const runWithService = <A, E>(
  effect: Effect.Effect<A, E, PromptService>,
): Promise<A> =>
  effect.pipe(Effect.provide(PromptServiceLive), Effect.runPromise);

describe("PromptService", () => {
  it("should register and compile a template", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(reactTemplate);
        return yield* svc.compile("reasoning.react", {
          task: "Find weather in Tokyo",
          tools: "search, calculator",
        });
      }),
    );

    expect(result.templateId).toBe("reasoning.react");
    expect(result.version).toBe(1);
    expect(result.content).toContain("Find weather in Tokyo");
    expect(result.content).toContain("search, calculator");
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it("should fail on missing required variable", async () => {
    const result = await Effect.gen(function* () {
      const svc = yield* PromptService;
      yield* svc.register(reactTemplate);
      return yield* svc.compile("reasoning.react", { task: "Do something" }).pipe(Effect.flip);
    }).pipe(Effect.provide(PromptServiceLive), Effect.runPromise);

    expect(result._tag).toBe("VariableError");
  });

  it("should fail on unknown template", async () => {
    const result = await Effect.gen(function* () {
      const svc = yield* PromptService;
      return yield* svc.compile("nonexistent", {}).pipe(Effect.flip);
    }).pipe(Effect.provide(PromptServiceLive), Effect.runPromise);

    expect(result._tag).toBe("TemplateNotFoundError");
  });

  it("should fill default values for optional variables", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(reactTemplate);
        return yield* svc.compile("reasoning.react", {
          task: "Test task",
          tools: "tool1",
        });
      }),
    );

    // constraints has defaultValue "" so {{constraints}} should be replaced
    expect(result.content).not.toContain("{{constraints}}");
  });

  it("should compose multiple prompts", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(reactTemplate);
        yield* svc.register(factCheckTemplate);

        const p1 = yield* svc.compile("reasoning.react", {
          task: "Research claim",
          tools: "search",
        });
        const p2 = yield* svc.compile("verification.fact-check", {
          claim: "The sky is blue",
        });

        return yield* svc.compose([p1, p2], { separator: "\n---\n" });
      }),
    );

    expect(result.templateId).toBe("composed");
    expect(result.content).toContain("Research claim");
    expect(result.content).toContain("The sky is blue");
    expect(result.content).toContain("---");
  });

  it("should track version history", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register({ ...reactTemplate, version: 1 });
        yield* svc.register({ ...reactTemplate, version: 2, template: "v2: {{task}} {{tools}}" });

        const history = yield* svc.getVersionHistory("reasoning.react");
        expect(history).toHaveLength(2);
        expect(history[0]!.version).toBe(1);
        expect(history[1]!.version).toBe(2);

        // Compile should use latest version
        const compiled = yield* svc.compile("reasoning.react", {
          task: "test",
          tools: "t",
        });
        expect(compiled.version).toBe(2);
        expect(compiled.content).toContain("v2:");

        return history;
      }),
    );

    expect(result).toHaveLength(2);
  });

  it("should get specific version", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(planExecuteTemplate);
        return yield* svc.getVersion("reasoning.plan-execute", 1);
      }),
    );

    expect(result.id).toBe("reasoning.plan-execute");
    expect(result.name).toBe("Plan and Execute");
  });

  it("should respect maxTokens option", async () => {
    const result = await runWithService(
      Effect.gen(function* () {
        const svc = yield* PromptService;
        yield* svc.register(reactTemplate);
        return yield* svc.compile(
          "reasoning.react",
          { task: "Test", tools: "t" },
          { maxTokens: 10 },
        );
      }),
    );

    // Content should be truncated to ~40 chars (10 tokens * 4 chars)
    expect(result.content.length).toBeLessThanOrEqual(40);
    expect(result.tokenEstimate).toBeLessThanOrEqual(10);
  });
});
