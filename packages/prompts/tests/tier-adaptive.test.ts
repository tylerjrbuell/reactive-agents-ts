/**
 * Tier-adaptive template tests — verify that different model tiers
 * (local, frontier) produce appropriately sized/structured templates,
 * and that the PromptService compile() tier resolution works correctly.
 */
import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { PromptService, PromptServiceLive } from "../src/services/prompt-service.js";
import { interpolate, estimateTokens } from "../src/services/template-engine.js";

// Base templates
import { reactSystemTemplate } from "../src/templates/reasoning/react-system.js";
import { reactThoughtTemplate } from "../src/templates/reasoning/react-thought.js";

// Local tier variants
import { reactSystemLocalTemplate } from "../src/templates/reasoning/react-system-local.js";
import { reactThoughtLocalTemplate } from "../src/templates/reasoning/react-thought-local.js";

// Frontier tier variants
import { reactSystemFrontierTemplate } from "../src/templates/reasoning/react-system-frontier.js";
import { reactThoughtFrontierTemplate } from "../src/templates/reasoning/react-thought-frontier.js";

const runWithService = <A, E>(
  effect: Effect.Effect<A, E, PromptService>,
): Promise<A> =>
  effect.pipe(Effect.provide(PromptServiceLive), Effect.runPromise);

// ─── Template Content Tier Differences ───

describe("tier variant content characteristics", () => {
  test("local system prompt is shorter than frontier", async () => {
    const localResult = await Effect.runPromise(
      interpolate(reactSystemLocalTemplate, { task: "test task" }),
    );
    const frontierResult = await Effect.runPromise(
      interpolate(reactSystemFrontierTemplate, { task: "test task" }),
    );
    expect(localResult.length).toBeLessThan(frontierResult.length);
  });

  test("local system prompt uses simpler language", async () => {
    const result = await Effect.runPromise(
      interpolate(reactSystemLocalTemplate, { task: "analyze data" }),
    );
    expect(result).toContain("One action per turn");
    // Should not have complex multi-paragraph instructions
    expect(result.split("\n").length).toBeLessThan(5);
  });

  test("frontier system prompt includes detailed strategy guidance", async () => {
    const result = await Effect.runPromise(
      interpolate(reactSystemFrontierTemplate, { task: "analyze data" }),
    );
    expect(result).toContain("highly capable reasoning agent");
    expect(result).toContain("Think carefully");
    // Should have multiple paragraphs or bullet points
    expect(result.split("\n").length).toBeGreaterThan(3);
  });

  test("local thought prompt is concise", async () => {
    const result = await Effect.runPromise(
      interpolate(reactThoughtLocalTemplate, { context: "ctx", history: "" }),
    );
    expect(result).toContain("Think briefly");
    expect(result.length).toBeLessThan(200);
  });

  test("frontier thought prompt includes detailed reasoning instructions", async () => {
    const result = await Effect.runPromise(
      interpolate(reactThoughtFrontierTemplate, { context: "ctx", history: "prev steps" }),
    );
    expect(result).toContain("Analyze the current state");
    expect(result).toContain("Reason through");
  });

  test("local templates use fewer tokens than frontier", () => {
    const localTokens = estimateTokens(reactSystemLocalTemplate.template);
    const frontierTokens = estimateTokens(reactSystemFrontierTemplate.template);
    expect(localTokens).toBeLessThan(frontierTokens);
  });
});

// ─── Tier ID Convention ───

describe("tier variant ID conventions", () => {
  test("local variants use :local suffix", () => {
    expect(reactSystemLocalTemplate.id).toBe("reasoning.react-system:local");
    expect(reactThoughtLocalTemplate.id).toBe("reasoning.react-thought:local");
  });

  test("frontier variants use :frontier suffix", () => {
    expect(reactSystemFrontierTemplate.id).toBe("reasoning.react-system:frontier");
    expect(reactThoughtFrontierTemplate.id).toBe("reasoning.react-thought:frontier");
  });

  test("base templates have no tier suffix", () => {
    expect(reactSystemTemplate.id).toBe("reasoning.react-system");
    expect(reactThoughtTemplate.id).toBe("reasoning.react-thought");
  });
});

// ─── PromptService Tier Resolution ───

describe("PromptService compile() tier resolution", () => {
  const setup = Effect.gen(function* () {
    const ps = yield* PromptService;
    yield* ps.register(reactSystemTemplate);
    yield* ps.register(reactSystemLocalTemplate);
    yield* ps.register(reactSystemFrontierTemplate);
    yield* ps.register(reactThoughtTemplate);
    yield* ps.register(reactThoughtLocalTemplate);
    yield* ps.register(reactThoughtFrontierTemplate);
    return ps;
  });

  test("tier=local resolves to local variant", async () => {
    const result = await runWithService(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-system", { task: "test" }, { tier: "local" }),
        ),
      ),
    );
    expect(result.templateId).toBe("reasoning.react-system:local");
    expect(result.content).toContain("One action per turn");
  });

  test("tier=frontier resolves to frontier variant", async () => {
    const result = await runWithService(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-system", { task: "test" }, { tier: "frontier" }),
        ),
      ),
    );
    expect(result.templateId).toBe("reasoning.react-system:frontier");
    expect(result.content).toContain("highly capable reasoning agent");
  });

  test("tier=mid falls back to base template (no mid variant registered)", async () => {
    const result = await runWithService(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-system", { task: "test" }, { tier: "mid" }),
        ),
      ),
    );
    expect(result.templateId).toBe("reasoning.react-system");
  });

  test("no tier specified uses base template", async () => {
    const result = await runWithService(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-system", { task: "test" }),
        ),
      ),
    );
    expect(result.templateId).toBe("reasoning.react-system");
  });

  test("tier resolution works for thought templates too", async () => {
    const local = await runWithService(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-thought", { context: "c", history: "h" }, { tier: "local" }),
        ),
      ),
    );
    const frontier = await runWithService(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-thought", { context: "c", history: "h" }, { tier: "frontier" }),
        ),
      ),
    );
    expect(local.templateId).toBe("reasoning.react-thought:local");
    expect(frontier.templateId).toBe("reasoning.react-thought:frontier");
    expect(local.content.length).toBeLessThan(frontier.content.length);
  });

  test("tier=large falls back to base (no large variant)", async () => {
    const result = await runWithService(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-system", { task: "test" }, { tier: "large" }),
        ),
      ),
    );
    expect(result.templateId).toBe("reasoning.react-system");
  });

  test("compiled result includes correct version", async () => {
    const result = await runWithService(
      setup.pipe(
        Effect.flatMap((ps) =>
          ps.compile("reasoning.react-system", { task: "test" }, { tier: "local" }),
        ),
      ),
    );
    expect(result.version).toBe(reactSystemLocalTemplate.version);
  });
});
