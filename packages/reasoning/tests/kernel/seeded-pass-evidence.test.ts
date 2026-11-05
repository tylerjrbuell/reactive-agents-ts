// Run: bun test packages/reasoning/tests/kernel/seeded-pass-evidence.test.ts --timeout 20000
//
// Plan 9 Phase 1 close, advisor item 4 ("seeded passes", Findings log
// 2026-11-05). A multi-pass strategy (reflexion improve pass, plan-execute
// step) runs the kernel once per pass and hands each later pass the run ledger
// (`seedRunLedger`). The gates read tool evidence from the PASS's `steps`, so a
// continuing pass forgot pass 1: a seeded pass ending on end_turn with no new
// call drew a grounding redirect and then forced abstention, and
// `maxCallsPerTool` reset every pass. `state.evidence` (derived from the ledger
// at transitionState) spans the run; these pins drive the real react kernel.
import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { reactKernel } from "../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../src/kernel/loop/run-pass.js";
import { mockToolServiceLayer } from "../../src/testing/tool-service-mock.js";
import type { KernelInput } from "../../src/kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";

const WS_SCHEMA = {
  name: "web-search",
  description: "search the web",
  parameters: [{ name: "query", type: "string", required: true }],
};

const TASK = "Look up the current answer using the search tool";

/** A web-search double that counts its executions. */
const countingSearch = () => {
  let calls = 0;
  const layer = mockToolServiceLayer({
    execute: () => {
      calls += 1;
      return Effect.succeed({ success: true, result: { items: ["result-1", "result-2"] } });
    },
    getTool: (name: string) => Effect.succeed({ name, description: "test", parameters: [] }),
  });
  return { layer, calls: () => calls };
};

const runReactive = (
  input: KernelInput,
  llm: ReturnType<typeof TestLLMServiceLayer>,
  tools: ReturnType<typeof mockToolServiceLayer>,
) =>
  Effect.runPromise(
    runPass(reactKernel, input, {
      maxIterations: 6,
      strategy: "reflexion",
      kernelType: "react",
      taskId: "seeded-pass-evidence",
    }).pipe(Effect.provide(Layer.mergeAll(llm, tools))),
  );

const groundingSignals = (steps: readonly ReasoningStep[]) =>
  steps.filter((s) => s.type === "harness_signal" && /Recovery required|Grounding required/.test(s.content));

/** Pass 1: one successful web-search, then a final answer. Returns its state. */
const firstPass = async () => {
  const search = countingSearch();
  const pass = await runReactive(
    { task: TASK, requiredTools: ["web-search"], availableToolSchemas: [WS_SCHEMA] },
    TestLLMServiceLayer([
      { toolCall: { name: "web-search", args: { query: "answer" } } },
      { text: "FINAL ANSWER: the answer is result-1." },
    ]),
    search.layer,
  );
  expect(search.calls()).toBe(1);
  return pass.state;
};

describe("seeded pass — tool evidence spans the run, not the pass", () => {
  it("a seeded pass ending on end_turn with no new call draws no grounding redirect and no abstention", async () => {
    const first = await firstPass();
    const contract = first.meta.runContract;
    const second = await runReactive(
      {
        task: "Improve the previous answer.",
        requiredTools: ["web-search"],
        availableToolSchemas: [WS_SCHEMA],
        ...(contract ? { seedRunContract: contract } : {}),
        seedRunLedger: first.ledger ?? [],
      },
      TestLLMServiceLayer([
        { text: "The answer is result-1, confirmed by the earlier search." },
        { text: "The answer is result-1, confirmed by the earlier search." },
      ]),
      countingSearch().layer,
    );

    expect(groundingSignals(second.state.steps)).toEqual([]);
    expect(second.state.meta.groundingRedirectCount ?? 0).toBe(0);
    expect(second.state.meta.terminatedBy).not.toBe("abstained");
    expect(second.state.status).toBe("done");
    expect(second.state.evidence.substantive).toBe(true);
    expect(second.state.evidence.seeded).toBe(true);
    expect(second.state.evidence.successfulCounts["web-search"]).toBe(1);
  }, 20000);

  // Control for the pin below: the budget holds inside ONE pass. A resolver that
  // gated a native-FC batch to zero used to fall through to the no-resolver
  // fallback, which re-dispatched the same calls ungated.
  it("within one pass, a native-FC call over maxCallsPerTool is not executed", async () => {
    const search = countingSearch();
    const pass = await runReactive(
      {
        task: TASK,
        requiredTools: ["web-search"],
        availableToolSchemas: [WS_SCHEMA],
        maxCallsPerTool: { "web-search": 1 },
      },
      TestLLMServiceLayer([
        { toolCall: { name: "web-search", args: { query: "answer" } } },
        { toolCall: { name: "web-search", args: { query: "answer again" } } },
        { text: "FINAL ANSWER: the answer is result-1." },
        { text: "FINAL ANSWER: the answer is result-1." },
      ]),
      search.layer,
    );
    expect(search.calls()).toBe(1);
    expect(pass.state.evidence.successfulCounts["web-search"]).toBe(1);
  }, 20000);

  // Named intended behavior change: `maxCallsPerTool` is a RUN budget. Before
  // the fix each pass started its count at zero, so a 1-call budget allowed one
  // call per pass.
  it("maxCallsPerTool counts calls across passes of one run", async () => {
    const first = await firstPass();
    const contract = first.meta.runContract;
    const search = countingSearch();
    const second = await runReactive(
      {
        task: TASK,
        requiredTools: ["web-search"],
        availableToolSchemas: [WS_SCHEMA],
        maxCallsPerTool: { "web-search": 1 },
        ...(contract ? { seedRunContract: contract } : {}),
        seedRunLedger: first.ledger ?? [],
      },
      TestLLMServiceLayer([
        { toolCall: { name: "web-search", args: { query: "answer again" } } },
        { text: "FINAL ANSWER: the answer is result-1." },
        { text: "FINAL ANSWER: the answer is result-1." },
      ]),
      search.layer,
    );

    // The seed already spent the 1-call budget: pass 2 must not execute another.
    expect(search.calls()).toBe(0);
    expect(second.state.evidence.successfulCounts["web-search"]).toBe(1);
  }, 20000);
});
