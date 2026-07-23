// adaptive-repair-capabilities.test.ts — review I1.
//
// `adaptive` is a ROUTER: it re-mints whichever sub-strategy ran. It used to
// hard-code `repairCapabilities: { perIteration: true }` at its mint, but
// `dispatchStrategy` can select `plan-execute-reflect` or `blueprint`, which
// both declare `{ perIteration: false }` at their own mints. So on the default
// `adaptive` strategy routed to plan-execute — the path most users hit —
// `verdict.repairGaps` came back `undefined` and design-spec gate #4 reported
// nothing.
//
// Re-hard-coding `{ perIteration: true }` at `adaptive.ts`'s mint turns the
// plan-execute case red.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { executeAdaptive } from "../../src/strategies/adaptive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";
import { provideTestEnvelope } from "../../src/kernel/envelope/run-envelope.js";

const run = (
  layer: ReturnType<typeof TestLLMServiceLayer>,
  taskDescription: string,
  availableTools: readonly string[] = [],
) =>
  Effect.runPromise(
    provideTestEnvelope(
      executeAdaptive({
        taskDescription,
        taskType: "query",
        memoryContext: "",
        availableTools,
        config: defaultReasoningConfig,
      }).pipe(Effect.provide(layer)),
    ),
  );

describe("adaptive relays the DISPATCHED strategy's repair capability (review I1)", () => {
  it("dispatch → reactive (per-iteration repair) ⇒ no repair gap reported", async () => {
    const result = await run(
      TestLLMServiceLayer([
        { match: "Classify the task", text: "REACTIVE" },
        { match: "Think step-by-step", text: "FINAL ANSWER: done." },
      ]),
      "What is the capital of France?",
    );
    expect(result.metadata.selectedStrategy).toBe("reactive");
    expect(result.metadata.verdict?.repairGaps).toBeUndefined();
  });

  it("dispatch → plan-execute (NO per-iteration repair) ⇒ the gap is reported", async () => {
    const result = await run(
      TestLLMServiceLayer([
        { json: { steps: [{ title: "S1", instruction: "Answer the question", type: "analysis" }] } },
        { text: "FINAL ANSWER: done." },
        { text: "FINAL ANSWER: done." },
        { text: "FINAL ANSWER: done." },
      ]),
      // Matches adaptive's heuristic plan pattern ("step by step", >10 words),
      // so dispatch is deterministic and needs no analysis LLM call.
      "Set up the release workflow step by step and document every phase carefully.",
      ["file-write"],
    );
    expect(result.metadata.selectedStrategy).toBe("plan-execute-reflect");
    // THE assertion: adaptive must not paper over plan-execute's declared gap.
    expect(result.metadata.verdict?.repairGaps).toEqual(["per-iteration"]);
  });
});
