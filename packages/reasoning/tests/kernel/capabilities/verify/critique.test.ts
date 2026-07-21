// File: tests/kernel/capabilities/verify/critique.test.ts
/**
 * Invariant + drift-prevention tests for the shared critique primitive.
 *
 * Phase 0 template, applied to primitive #2:
 *   1. Unit tests for pure-logic (depth → maxTokens mapping)
 *   2. Effect tests via TestLLMServiceLayer (happy path, fallback paths,
 *      error wrapping)
 *   3. Drift contract — no strategies/*.ts file may re-implement an LLM
 *      critique pass locally; all must route through runCritiquePass.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LLMService, TestLLMServiceLayer, LLMError } from "@reactive-agents/llm-provider";
import {
  runCritiquePass,
  critiqueMaxTokens,
} from "../../../../src/kernel/capabilities/verify/critique.js";
import { ExecutionError } from "../../../../src/errors/errors.js";

// An LLMService whose completion call fails with a transient provider error —
// the exact shape that killed a whole run before the critique pass learned to
// degrade (Wave 5 root-cause: critique.ts hard-failed on any LLM error).
const failingLLMLayer = Layer.succeed(LLMService, {
  complete: () => Effect.fail(new LLMError({ message: "529 overloaded_error: server overloaded", provider: "anthropic" })),
  stream: () => Effect.fail(new LLMError({ message: "529 overloaded_error: server overloaded", provider: "anthropic" })),
  completeStructured: () => Effect.die("unused: completeStructured"),
  embed: () => Effect.die("unused: embed"),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.die("unused: getModelConfig"),
  getStructuredOutputCapabilities: () => Effect.die("unused: getStructuredOutputCapabilities"),
  capabilities: () => Effect.die("unused: capabilities"),
});

const runPassFailing = (strategyName = "reflexion", step = 0) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* runCritiquePass({
        llm,
        systemPrompt: "You are an evaluator.",
        promptBody: "Critique this response.",
        depth: "shallow",
        strategyName,
        step,
      });
    }).pipe(Effect.provide(failingLLMLayer)),
  );

// ── 1. critiqueMaxTokens — pure depth mapping ────────────────────────────────

describe("critiqueMaxTokens", () => {
  it("shallow → THINKING_SAFE_MIN_TOKENS (2048)", () => {
    expect(critiqueMaxTokens("shallow")).toBe(2048);
  });

  it("deep → 2500", () => {
    expect(critiqueMaxTokens("deep")).toBe(2500);
  });
});

// ── 2. runCritiquePass — Effect wrapper invariants ───────────────────────────

const runPass = (input: {
  systemPrompt?: string;
  promptBody?: string;
  depth?: "shallow" | "deep";
  strategyName?: string;
  step?: number;
  llmTurns: { text?: string; thinking?: string }[];
}) => {
  const layer = TestLLMServiceLayer(input.llmTurns);
  const program = Effect.gen(function* () {
    const llm = yield* LLMService;
    return yield* runCritiquePass({
      llm,
      systemPrompt: input.systemPrompt ?? "You are an evaluator.",
      promptBody: input.promptBody ?? "Critique this response.",
      depth: input.depth ?? "shallow",
      strategyName: input.strategyName ?? "test-strategy",
      step: input.step ?? 1,
    });
  }).pipe(Effect.provide(layer));
  return Effect.runPromise(program);
};

describe("runCritiquePass — happy path", () => {
  it("returns clean content + tokens + cost", async () => {
    const r = await runPass({
      llmTurns: [{ text: "This response missed step 3." }],
    });
    expect(r.content).toBe("This response missed step 3.");
    expect(r.recovered).toBe(false);
    expect(r.thinking).toBeNull();
    expect(r.tokens).toBeGreaterThan(0);
    expect(r.cost).toBeGreaterThanOrEqual(0);
  });

  it("strips <think> blocks from response content", async () => {
    const r = await runPass({
      llmTurns: [
        { text: "<think>let me consider...</think>This response missed step 3." },
      ],
    });
    expect(r.content).toBe("This response missed step 3.");
    expect(r.recovered).toBe(true);
    expect(r.thinking).toBe("let me consider...");
  });
});

describe("runCritiquePass — thinking-safe fallback chain", () => {
  it("rescues critique trapped entirely inside <think> (strict upgrade)", async () => {
    // Previously plan-execute would silently return empty here via stripThinking.
    const r = await runPass({
      llmTurns: [{ text: "<think>The plan satisfied all steps cleanly.</think>" }],
    });
    expect(r.content).toBe("The plan satisfied all steps cleanly.");
    expect(r.recovered).toBe(true);
    expect(r.thinking).toBe("The plan satisfied all steps cleanly.");
  });

  it("returns empty content when both raw + thinking are empty", async () => {
    const r = await runPass({
      llmTurns: [{ text: "" }],
    });
    expect(r.content).toBe("");
    expect(r.recovered).toBe(true);
    expect(r.thinking).toBeNull();
  });
});

describe("runCritiquePass — graceful degradation on LLM failure", () => {
  it("degrades to an empty, flagged critique instead of failing the whole run", async () => {
    // Root cause (Wave 5): a transient LLM error in the critique pass mapped to
    // an ExecutionError that killed a run which had ALREADY produced an answer.
    // A critique is an enhancement, not a gate — a failed one must degrade to
    // "no critique this round", never abort. The Effect must RESOLVE, not reject.
    const r = await runPassFailing("reflexion", 0);
    expect(r.content).toBe("");
    expect(r.thinking).toBeNull();
    expect(r.tokens).toBe(0);
    expect(r.cost).toBe(0);
    expect(r.degraded).toBeDefined();
    expect(r.degraded?.reason).toContain("overloaded");
  });

  it("does not reject the Effect (the strategy fiber survives)", async () => {
    // If this ever throws, a provider blip is once again zeroing whole runs.
    await expect(runPassFailing("plan-execute-reflect", 3)).resolves.toBeDefined();
  });

  // Type sanity: ExecutionError remains constructible (still used elsewhere).
  it("ExecutionError shape is intact", () => {
    const err = new ExecutionError({ strategy: "s", message: "m", step: 1, cause: new Error("x") });
    expect(err.strategy).toBe("s");
  });
});

// ── 3. DRIFT-PREVENTION — strategies must route through critique primitive ───

describe("drift contract — critique primitive", () => {
  it("no strategies/*.ts file may inline a critique recipe (llm.complete with thinking extraction)", () => {
    // The critique drift signature is unambiguous: a `llm.complete` call
    // immediately followed (within ~40 lines) by an `extractThinking` /
    // `extractThinkingSafeContent` / `stripThinking` call. This recipe IS
    // the critique primitive — implementing it inline duplicates the shared
    // module. Synthesizer and planner LLM calls do not match (they use
    // `extractStructuredOutput` or skip thinking-extraction entirely).
    //
    // Allow opt-out comment `// critique-primitive-exempt` above the
    // `llm.complete` call if a strategy genuinely needs a one-off shape.
    const stratDir = join(__dirname, "../../../../src/strategies");
    const files = readdirSync(stratDir).filter((f) => f.endsWith(".ts"));
    const violations: { file: string; snippet: string }[] = [];

    for (const file of files) {
      const src = readFileSync(join(stratDir, file), "utf8");
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!/llm\s*\.\s*complete\s*\(/.test(lines[i] ?? "")) continue;
        const exemptWindow = lines.slice(Math.max(0, i - 3), i).join("\n");
        if (/critique-primitive-exempt/.test(exemptWindow)) continue;
        const followup = lines.slice(i, Math.min(lines.length, i + 40)).join("\n");
        if (
          /extractThinkingSafeContent\s*\(/.test(followup) ||
          /extractThinking\s*\(/.test(followup)
        ) {
          violations.push({
            file,
            snippet: (lines[i] ?? "").trim().slice(0, 100),
          });
        }
      }
    }

    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  ${v.file}: inline critique recipe — route via runCritiquePass\n    ${v.snippet}`)
        .join("\n");
      throw new Error(
        `Drift contract violated — critique passes must route through kernel/capabilities/verify/critique.ts:\n${msg}`,
      );
    }
    expect(violations.length).toBe(0);
  });
});
