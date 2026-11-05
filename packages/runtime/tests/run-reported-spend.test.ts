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
  calls: number;
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
      const t = byTask.get(event.taskId) ?? { tokens: 0, calls: 0 };
      t.tokens += event.tokensUsed;
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
    const byTask = new Map<string, number>();
    const unsub = await agent.subscribe((event) => {
      if (event._tag === "LLMRequestCompleted") {
        byTask.set(event.taskId, (byTask.get(event.taskId) ?? 0) + event.tokensUsed);
      }
    });
    try {
      const result = await agent.run(`${filler} SPEND_ROOT_TRIGGER: begin the delegation.`);
      expect(result.output).toBe("Done.");
      const parentOwn = byTask.get(String(result.taskId)) ?? 0;
      const all = [...byTask.values()].reduce((a, b) => a + b, 0);
      // The child ran under its own task id and its calls are visible.
      expect(byTask.size).toBe(2);
      expect(all).toBeGreaterThan(parentOwn);
      // Parent's reported spend = parent's calls + the child's calls, once.
      expect(result.metadata.tokensUsed).toBe(all);
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
  }, 20000);
});
