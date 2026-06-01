// Run: bun test packages/reasoning/tests/strategies/reflexion-required-completion-gate.test.ts --timeout 20000
//
// Regression: reflexion's `isSatisfied(critique)` judges OUTPUT TEXT only — it
// cannot see whether a required side-effect tool actually fired. A task like
// "create a markdown file" yields a good-looking summary the critique rubber-
// stamps as SATISFIED while the file was never written (spot-test: success:true,
// no commits.md — the verifier lied). The completion gate must NOT accept
// "satisfied" while a required tool is still uncalled.
//
// Phase 1 Step 4: Also tests the generalized PostCondition spine gate
// (RA_POST_CONDITIONS=1), which checks ArtifactProduced conditions derived
// from the task description in addition to the required-tools gate.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

const PRIOR_LAZY = process.env.RA_LAZY_TOOLS;
beforeAll(() => { delete process.env.RA_LAZY_TOOLS; });
afterAll(() => {
  if (PRIOR_LAZY === undefined) delete process.env.RA_LAZY_TOOLS;
  else process.env.RA_LAZY_TOOLS = PRIOR_LAZY;
});

// Mock LLM: gen/improve passes emit a plain text answer (NO tool call); the
// critique pass (system prompt mentions "critical evaluator") returns SATISFIED.
// So without the gate, reflexion terminates "satisfied" on iteration 1 despite
// `file-write` never being called.
async function makeMockLayer() {
  const { LLMService } = await import("@reactive-agents/llm-provider");
  const respond = (req: any) => {
    const sys = typeof req.systemPrompt === "string" ? req.systemPrompt : "";
    const isCritique = sys.includes("critical evaluator") || sys.includes("critique");
    const content = isCritique
      ? "SATISFIED: the response fully addresses the task."
      : "Here is the report:\n\n# Commits\n- feat: things\n- fix: bugs";
    return { content, stopReason: "end_turn" as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 }, model: "m" };
  };
  const layer = Layer.succeed(LLMService, {
    complete: (req: any) => Effect.succeed(respond(req)),
    stream: (req: any) => {
      const c = respond(req).content;
      return Effect.succeed(
        Stream.make(
          { type: "text_delta" as const, text: c },
          { type: "content_complete" as const, content: c },
          { type: "usage" as const, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, estimatedCost: 0 } },
        ) as any,
      );
    },
    completeStructured: () => Effect.succeed({} as any),
    embed: (t: string[]) => Effect.succeed(t.map(() => [])),
    countTokens: () => Effect.succeed(0),
    getModelConfig: () => Effect.succeed({ provider: "anthropic" as const, model: "m" }),
  } as any);
  return layer;
}

describe("reflexion required-tools completion gate", () => {
  it("does NOT report success when a required tool was never called, despite SATISFIED critique", async () => {
    const layer = await makeMockLayer();
    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Fetch data and create a markdown file (./out.md) summarizing it.",
        taskType: "general",
        memoryContext: "",
        availableTools: ["file-write"],
        availableToolSchemas: [
          { name: "file-write", description: "Write a file", parameters: [
            { name: "path", type: "string", description: "path", required: true },
            { name: "content", type: "string", description: "content", required: true },
          ] },
        ],
        requiredTools: ["file-write"],
        config: defaultReasoningConfig,
      } as any).pipe(Effect.provide(layer)),
    );
    // file-write never fired → must not be reported as a completed task.
    expect(result.status).not.toBe("completed");
  }, 20000);

  it("reports success normally when there are NO required tools (gate is scoped)", async () => {
    const layer = await makeMockLayer();
    const result = await Effect.runPromise(
      executeReflexion({
        taskDescription: "Summarize the concept of recursion in two sentences.",
        taskType: "general",
        memoryContext: "",
        availableTools: [],
        availableToolSchemas: [],
        config: defaultReasoningConfig,
      } as any).pipe(Effect.provide(layer)),
    );
    expect(result.status).toBe("completed");
  }, 20000);
});

// ── Phase 1 Step 4: PostCondition spine gate (RA_POST_CONDITIONS=1) ──────────

describe("reflexion PostCondition spine gate (RA_POST_CONDITIONS=1)", () => {
  // Save and restore RA_POST_CONDITIONS around these tests to avoid leaking
  // into the required-tools tests above or any tests that run after.
  const PRIOR_PC = process.env.RA_POST_CONDITIONS;
  beforeAll(() => { process.env.RA_POST_CONDITIONS = "1"; });
  afterAll(() => {
    if (PRIOR_PC === undefined) delete process.env.RA_POST_CONDITIONS;
    else process.env.RA_POST_CONDITIONS = PRIOR_PC;
  });

  it(
    "does NOT report success when ArtifactProduced condition is unmet (file-write never called) with RA_POST_CONDITIONS=1",
    async () => {
      // Task: derive-conditions will extract ArtifactProduced('./report.md') from
      // this description (write verb + file noun + path in parens).
      // The mock LLM never emits a tool call, so file-write never fires.
      // With RA_POST_CONDITIONS=1 the spine gate should block "satisfied".
      const layer = await makeMockLayer();
      const result = await Effect.runPromise(
        executeReflexion({
          taskDescription:
            "Write a summary report and save it as a markdown file (./report.md).",
          taskType: "general",
          memoryContext: "",
          availableTools: ["file-write"],
          availableToolSchemas: [
            {
              name: "file-write",
              description: "Write a file",
              parameters: [
                { name: "path", type: "string", description: "path", required: true },
                { name: "content", type: "string", description: "content", required: true },
              ],
            },
          ],
          // No requiredTools — this test isolates the ArtifactProduced spine gate,
          // not the existing required-tools B gate. The task description alone drives
          // the condition derivation when RA_POST_CONDITIONS=1.
          config: defaultReasoningConfig,
        } as any).pipe(Effect.provide(layer)),
      );
      // file-write never fired → ArtifactProduced('./report.md') unmet
      // → spine gate must block "satisfied" → status must NOT be "completed".
      expect(result.status).not.toBe("completed");
    },
    20000,
  );

  it(
    "reports success normally when RA_POST_CONDITIONS=0 (opt-out = existing required-tools-only gate)",
    async () => {
      // Same task as above but spine OPTED OUT (RA_POST_CONDITIONS=0) — no
      // ArtifactProduced check. No requiredTools either → existing B gate doesn't
      // fire → SATISFIED critique from mock → should complete normally.
      // (Default-on flip 2026-05-31: unset now means gate ACTIVE, so the legacy
      // prose-only path must be exercised via the explicit =0 opt-out.)
      const PRIOR = process.env.RA_POST_CONDITIONS;
      process.env.RA_POST_CONDITIONS = "0";
      try {
        const layer = await makeMockLayer();
        const result = await Effect.runPromise(
          executeReflexion({
            taskDescription:
              "Write a summary report and save it as a markdown file (./report.md).",
            taskType: "general",
            memoryContext: "",
            availableTools: ["file-write"],
            availableToolSchemas: [
              {
                name: "file-write",
                description: "Write a file",
                parameters: [
                  { name: "path", type: "string", description: "path", required: true },
                  { name: "content", type: "string", description: "content", required: true },
                ],
              },
            ],
            // No requiredTools — flag-off means the spine gate is inactive and only
            // the narrow required-tools B gate runs (which is a no-op here).
            config: defaultReasoningConfig,
          } as any).pipe(Effect.provide(layer)),
        );
        // With RA_POST_CONDITIONS off and no requiredTools, critique SATISFIED
        // should pass through → "completed".
        expect(result.status).toBe("completed");
      } finally {
        if (PRIOR === undefined) delete process.env.RA_POST_CONDITIONS;
        else process.env.RA_POST_CONDITIONS = PRIOR;
      }
    },
    20000,
  );
});
