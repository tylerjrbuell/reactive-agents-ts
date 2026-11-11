// Run: bun test packages/runtime/tests/local-agent-child-spend.test.ts --timeout 20000
//
// A `.withAgentTool` (local-agent) child folds its spend into the PARENT run
// meter (builder/build-effect/local-agent-tools.ts), via the same fold the
// spawn path uses (child-spend-probe.ts: foldChildMeter + spendOfChildResult).
//
// Pins:
//   L1 — integration: a local child with a reported split adds to the parent's
//        tokensUsed AND its prompt/completion split and call count. The parent
//        result reports in + out === tokensUsed, equal to the sum of every
//        task's LLMRequestCompleted (parent + child).
//   L2 — fold unit: a child reporting a total only adds its tokens and cost
//        to the meter and leaves inputTokens/outputTokens untouched (no split
//        is invented for it).
//   L3 — fold unit: a child reporting a split and llmCalls adds all three.
//
// Red-on-cut: replace the foldChildMeter(...) call in local-agent-tools.ts with
// addRunSpend({ tokens, cost }); L1 fails (in/out no longer include the child).
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { makeRunBudgetMeter, withRunBudgetMeter } from "@reactive-agents/reasoning";
import { ReactiveAgents } from "../src/index.js";
import { foldChildMeter, spendOfChildResult } from "../src/builder/build-effect/child-spend-probe.js";

interface Tally {
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  calls: number;
}

const filler = "prime the local delegation run with a long preamble. ".repeat(6);
const parentTask = `${filler} LOCAL_PARENT_GO: delegate the child work.`;

async function localDelegationRun() {
  const agent = await ReactiveAgents.create()
    .withName("local-child-spend")
    .withProvider("test")
    .withModel("test-model")
    .withTools()
    .withAgentTool("kid-tool", {
      name: "kid",
      description: "Child worker",
      persona: { role: "Local child worker", instructions: "Do the child work" },
      systemPrompt: "Answer the child task.",
    })
    .withTestScenario([
      {
        match: "LOCAL_PARENT_GO",
        toolCall: { name: "kid-tool", args: { input: "LOCALCHILD do the child work" } },
      },
      { match: "LOCALCHILD", text: "child done" },
      { text: "Done." },
    ])
    .build();
  const byTask = new Map<string, Tally>();
  const unsub = await agent.subscribe((event) => {
    if (event._tag === "LLMRequestCompleted") {
      const t = byTask.get(event.taskId) ?? { tokens: 0, tokensIn: 0, tokensOut: 0, calls: 0 };
      t.tokens += event.tokensUsed;
      t.tokensIn += event.tokensIn ?? 0;
      t.tokensOut += event.tokensOut ?? 0;
      t.calls += 1;
      byTask.set(event.taskId, t);
    }
  });
  try {
    const result = await agent.run(parentTask);
    return { result, byTask };
  } finally {
    unsub();
    await agent.dispose();
  }
}

const runFold = (spend: ReturnType<typeof spendOfChildResult>) => {
  const meter = makeRunBudgetMeter();
  return Effect.runPromise(withRunBudgetMeter(foldChildMeter(spend), meter)).then(() => meter);
};

describe("local-agent child spend folds into the parent run meter", () => {
  it("L1: the child's split and calls add to the parent; in + out equals tokensUsed", async () => {
    const { result, byTask } = await localDelegationRun();
    const parentOwn = byTask.get(String(result.taskId));
    expect(parentOwn).toBeDefined();
    // The child ran under its own task id, so more than one task spent tokens.
    const childTasks = [...byTask.keys()].filter((k) => k !== String(result.taskId));
    expect(childTasks.length).toBeGreaterThan(0);

    const all = [...byTask.values()].reduce(
      (a, t) => ({
        tokens: a.tokens + t.tokens,
        tokensIn: a.tokensIn + t.tokensIn,
        tokensOut: a.tokensOut + t.tokensOut,
        calls: a.calls + t.calls,
      }),
      { tokens: 0, tokensIn: 0, tokensOut: 0, calls: 0 },
    );
    // The parent's total includes the child (it was not parent-only).
    expect(result.metadata.tokensUsed).toBe(all.tokens);
    expect(result.metadata.tokensUsed).toBeGreaterThan(parentOwn!.tokens);
    // The split carries the child's in/out, not just the parent's.
    expect(result.metadata.inputTokens).toBe(all.tokensIn);
    expect(result.metadata.outputTokens).toBe(all.tokensOut);
    expect((result.metadata.inputTokens ?? 0) + (result.metadata.outputTokens ?? 0)).toBe(
      result.metadata.tokensUsed,
    );
    expect(result.metadata.llmCalls).toBe(all.calls);
  }, 20000);

  it("L2: a total-only child adds tokens and cost, and invents no in/out split", async () => {
    const meter = await runFold(spendOfChildResult({ tokensUsed: 120, cost: 0.02 }));
    expect(meter.tokens).toBe(120);
    expect(meter.cost).toBe(0.02);
    // A child that spent tokens without a split makes the halves unknown, not 0.
    expect(meter.inputTokens).toBeUndefined();
    expect(meter.outputTokens).toBeUndefined();
    expect(meter.llmCalls).toBe(0);
  });

  it("L3: a child reporting a split and calls adds all of them", async () => {
    const meter = await runFold(
      spendOfChildResult({ tokensUsed: 100, cost: 0.01, inputTokens: 60, outputTokens: 40, llmCalls: 2 }),
    );
    expect(meter.tokens).toBe(100);
    expect(meter.inputTokens).toBe(60);
    expect(meter.outputTokens).toBe(40);
    expect(meter.llmCalls).toBe(2);
  });
});
