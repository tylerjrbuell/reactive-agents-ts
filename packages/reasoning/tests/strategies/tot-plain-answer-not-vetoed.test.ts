// Run: bun run repo test packages/reasoning/tests/strategies/tot-plain-answer-not-vetoed.test.ts
//
// 2026-11-03 C4 (reconfirm report): tree-of-thought with a model-authored,
// verified plain answer (no tools needed) must ship success with NO outstanding
// criteria — same as reactive/reflexion/plan-execute on that shape. Reproduced
// on all four ToT paths (cost-gated skip vs full BFS, with/without tools).
//
// SCOPE NOTE: the live C4 cell failed because the 3B model never authored a
// final answer (tool-loop -> stall -> harness_deliverable); the terminal gate's
// `output-is-model-authored` refusal there is an HONEST veto shared with
// reactive, so the second case pins that it still bites (no weakening).
// RED-ON-CUT: drop `kernelMeta: execState.meta` in tree-of-thought.ts -> the
// outcome loses its verdict/deliverable (case 1); drop the
// `deliverableDecisionEnvelope` join in finalize-result.ts -> case 2 completed.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeTreeOfThought } from "../../src/strategies/tree-of-thought.js";
import { finalizeStrategyResult } from "../../src/kernel/capabilities/sense/finalize-result.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";
import { initialKernelState } from "../../src/kernel/state/kernel-state.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";

const task = "What is 17 times 3, and what is the capital of France? Answer both.";

describe("ToT plain answer is not vetoed by outstanding criteria", () => {
  for (const skipBfsForTrivial of [true, false]) {
    for (const tools of [[], ["file-read", "file-write"]] as string[][]) {
      it(`model-authored verified answer ships completed (skipBfs=${skipBfsForTrivial}, tools=${tools.length})`, async () => {
        const layer = TestLLMServiceLayer([
          { match: "Generate exactly", text: "1. Compute directly\n2. Recall" },
          { match: "Rate each", text: "0.8" },
          { match: "17 times 3", text: "FINAL ANSWER: 17 times 3 is 51 and the capital of France is Paris." },
        ]);
        const result = await Effect.runPromise(
          provideTestEnvelope(
            executeTreeOfThought({
              taskDescription: task, taskType: "query", memoryContext: "", availableTools: tools,
              config: {
                ...defaultReasoningConfig,
                strategies: { ...defaultReasoningConfig.strategies, treeOfThought: { breadth: 2, depth: 2, pruningThreshold: 0.3, skipBfsForTrivial } as never },
              },
            }).pipe(Effect.provide(layer)),
          ),
        );
        expect(result.status).toBe("completed");
        expect((result.metadata as Record<string, unknown>).outstandingCriteria).toBeUndefined();
        expect(result.metadata.extensions?.terminalOutcome).toMatchObject({
          status: "completed", success: true, outstanding: [], deliverable: { accepted: true },
        });
      }, 20000);
    }
  }

  it("a harness-authored deliverable the gate REFUSED still vetoes (answer + output-is-model-authored)", async () => {
    const meta = {
      ...initialKernelState({ strategy: "tree-of-thought", kernelType: "react", maxIterations: 4 }).meta,
      terminatedBy: "harness_deliverable",
      deliverableDecision: {
        chosen: "tool-artifact" as const, accepted: false, why: "output-is-model-authored", rejected: [],
        verdictSummary: "final-answer: failed at output-is-model-authored",
        verifier: { verified: false, failedChecks: ["output-is-model-authored"] },
      },
    };
    const value = await Effect.runPromise(
      provideTestEnvelope(
        finalizeStrategyResult({
          strategy: "tree-of-thought", taskId: "tot-veto", steps: [makeStep("thought", "t")],
          output: "17 times 3 is 51 and the capital of France is Paris.", status: "completed",
          start: Date.now(), totalTokens: 1, totalCost: 0, kernelMeta: meta, extraMetadata: { terminatedBy: "end_turn" },
          requiredTools: [], runLedger: [], repairCapabilities: { perIteration: true },
        }),
      ),
    );
    expect(value.status).toBe("partial");
    expect(value.metadata.extensions?.terminalOutcome).toMatchObject({
      status: "partial", success: false, outstanding: expect.arrayContaining(["answer"]),
    });
  });
});
