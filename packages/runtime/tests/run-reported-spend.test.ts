// Run: bun test packages/runtime/tests/run-reported-spend.test.ts --timeout 20000
/**
 * Reported run spend equals the run's real LLM spend.
 *
 * The defect (ablation 2026-11-05): `AgentResult.metadata.tokensUsed` summed
 * only what each reasoning PASS reported about itself. Calls a strategy makes
 * outside its own tally (planner, synthesis, classifier, quality gate,
 * structured-output calls) never reached it, so a no-switch rw-7 run reported
 * 9,985 tokens while its `LLMRequestCompleted` events summed to 18,639.
 *
 * The fix reads the reported spend from ONE source: the run-scoped spend meter
 * the observable LLM wrapper feeds on every call. The meter is now armed on
 * every run (budget or not); `runBudgetSpend` still rides only when a budget
 * was declared.
 *
 * Pin: a plan-execute run (planner + step + synthesis calls) through the
 * builder reports `tokensUsed` equal to the sum of the run's own
 * `LLMRequestCompleted.tokensUsed`.
 */
import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

interface CompletedTally {
  tokens: number;
  tokensIn: number;
  tokensOut: number;
  calls: number;
}

const emptyTally = (): CompletedTally => ({ tokens: 0, tokensIn: 0, tokensOut: 0, calls: 0 });

/** Sum every task's tally (parent + delegated children). */
const sumTallies = (byTask: ReadonlyMap<string, CompletedTally>): CompletedTally =>
  [...byTask.values()].reduce(
    (a, t) => ({
      tokens: a.tokens + t.tokens,
      tokensIn: a.tokensIn + t.tokensIn,
      tokensOut: a.tokensOut + t.tokensOut,
      calls: a.calls + t.calls,
    }),
    emptyTally(),
  );

/**
 * Pin (2026-11-05, in/out/llmCalls from the meter): the prompt/completion
 * split and the call count come from the SAME run meter as `tokensUsed`, so
 * they cannot disagree with it. The test provider reports the split, so
 * `inputTokens + outputTokens === tokensUsed` must hold exactly.
 */
function expectSplitMatchesMeter(
  metadata: { tokensUsed: number; inputTokens?: number; outputTokens?: number; llmCalls?: number },
  tally: CompletedTally,
): void {
  // The events themselves report the split (precondition for the equality).
  expect(tally.tokensIn + tally.tokensOut).toBe(tally.tokens);
  expect(metadata.inputTokens).toBe(tally.tokensIn);
  expect(metadata.outputTokens).toBe(tally.tokensOut);
  expect((metadata.inputTokens ?? 0) + (metadata.outputTokens ?? 0)).toBe(metadata.tokensUsed);
  expect(metadata.llmCalls).toBe(tally.calls);
}

async function planExecuteRun(withBudget: boolean) {
  const base = ReactiveAgents.create()
    .withName("spend-truth")
    .withReasoning({ defaultStrategy: "plan-execute-reflect" })
    .withTestScenario([
      { json: { steps: [{ instruction: "answer the question", title: "answer", type: "analysis" }] } },
      { text: "Paris is the capital of France." },
      { text: "Paris is the capital of France." },
      { text: "Paris is the capital of France." },
    ]);
  const agent = await (withBudget ? base.withBudget({ tokenLimit: 1_000_000 }) : base).build();
  const byTask = new Map<string, CompletedTally>();
  const unsub = await agent.subscribe((event) => {
    if (event._tag === "LLMRequestCompleted") {
      const t = byTask.get(event.taskId) ?? emptyTally();
      t.tokens += event.tokensUsed;
      t.tokensIn += event.tokensIn ?? 0;
      t.tokensOut += event.tokensOut ?? 0;
      t.calls += 1;
      byTask.set(event.taskId, t);
    }
  });
  try {
    const result = await agent.run("What is the capital of France?");
    return { result, byTask };
  } finally {
    unsub();
    await agent.dispose();
  }
}

describe("reported run spend = the run's real LLM spend", () => {
  it("tokensUsed equals the sum of the run's LLMRequestCompleted tokens (plan-execute, no budget)", async () => {
    const { result, byTask } = await planExecuteRun(false);
    const runTally = byTask.get(String(result.taskId));
    expect(runTally).toBeDefined();
    // Several calls happened (planner + step + synthesis at least).
    expect(runTally!.calls).toBeGreaterThan(1);
    // Every call of the run is attributed to the run's task id.
    expect([...byTask.keys()]).toEqual([String(result.taskId)]);
    expect(result.metadata.tokensUsed).toBe(runTally!.tokens);
    expectSplitMatchesMeter(result.metadata, runTally!);
    // Un-budgeted runs still carry no runBudgetSpend (wire-or-delete honesty).
    expect(result.metadata.runBudgetSpend).toBeUndefined();
  }, 20000);

  it("delegating run: tokensUsed = parent calls + child calls, counted once (no budget)", async () => {
    const filler = "prime the delegation run with a long preamble. ".repeat(6);
    const agent = await ReactiveAgents.create()
      .withName("spend-truth-deleg")
      .withDynamicSubAgents({ maxIterations: 2, maxRecursionDepth: 2 })
      .withTools()
      .withTestScenario([
        { match: "SPEND_ROOT_TRIGGER", toolCall: { name: "spawn-agent", args: { task: "CHILDWORK do the child work", name: "kid" } } },
        { match: "CHILDWORK", text: "child done" },
        { text: "Done." },
      ])
      .build();
    const byTask = new Map<string, CompletedTally>();
    const unsub = await agent.subscribe((event) => {
      if (event._tag === "LLMRequestCompleted") {
        const t = byTask.get(event.taskId) ?? emptyTally();
        t.tokens += event.tokensUsed;
        t.tokensIn += event.tokensIn ?? 0;
        t.tokensOut += event.tokensOut ?? 0;
        t.calls += 1;
        byTask.set(event.taskId, t);
      }
    });
    try {
      const result = await agent.run(`${filler} SPEND_ROOT_TRIGGER: begin the delegation.`);
      expect(result.output).toBe("Done.");
      const parentOwn = byTask.get(String(result.taskId)) ?? emptyTally();
      const all = sumTallies(byTask);
      // The child ran under its own task id and its calls are visible.
      expect(byTask.size).toBe(2);
      expect(all.tokens).toBeGreaterThan(parentOwn.tokens);
      expect(all.calls).toBeGreaterThan(parentOwn.calls);
      // Parent's reported spend = parent's calls + the child's calls, once.
      expect(result.metadata.tokensUsed).toBe(all.tokens);
      // Split and call count roll the child up exactly once too.
      expectSplitMatchesMeter(result.metadata, all);
    } finally {
      unsub();
      await agent.dispose();
    }
  }, 20000);

  it("budgeted run: tokensUsed and runBudgetSpend.tokens are the same number", async () => {
    const { result, byTask } = await planExecuteRun(true);
    const runTally = byTask.get(String(result.taskId));
    expect(runTally).toBeDefined();
    expect(result.metadata.tokensUsed).toBe(runTally!.tokens);
    expect(result.metadata.runBudgetSpend?.tokens).toBe(result.metadata.tokensUsed);
    expectSplitMatchesMeter(result.metadata, runTally!);
    const spend = result.metadata.runBudgetSpend as
      | { inputTokens?: number; outputTokens?: number; llmCalls?: number }
      | undefined;
    expect(spend?.inputTokens).toBe(result.metadata.inputTokens);
    expect(spend?.outputTokens).toBe(result.metadata.outputTokens);
    // `llmCalls` rides on the runtime value but is not yet declared on the
    // public AgentResultMetadata type, hence the structural read.
    expect(spend?.llmCalls).toBe((result.metadata as { llmCalls?: number }).llmCalls);
  }, 20000);
});
