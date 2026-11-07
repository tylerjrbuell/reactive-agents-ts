// Run: bun test packages/runtime/tests/subagent/failed-child-cost.test.ts --timeout 15000
//
// D-2026-10-29-CHILD-COST: a delegated child that FAILS (its engine run errors
// after real LLM spend) must still fold that spend into the parent's run meter,
// through the same `foldChildMeter` as a successful child.
//
// Scope note (2026-11-05): a scripted `error:` turn does NOT crash the child's
// engine; the child returns a `success:false` result and takes the executor's
// SUCCESS exit. The e2e tests below therefore pin an LLM-errored child. The
// executor's FAILURE exit (Exit failure / interruption) is pinned at the seam:
// the probe's hooks on a real hook registry inside a real child meter scope.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { addRunSpend, makeRunBudgetMeter, withRunBudgetMeter } from "@reactive-agents/reasoning";
import { ReactiveAgents } from "../../src/index.js";
import {
  foldChildMeter,
  makeChildSpendProbe,
  spendOfChildResult,
} from "../../src/builder/build-effect/child-spend-probe.js";
import { LifecycleHookRegistry, LifecycleHookRegistryLive } from "../../src/hooks.js";
import type { ExecutionContext } from "../../src/types.js";

const bareCtx = (): ExecutionContext => Object.assign(Object.create(null), { tokensUsed: 0, cost: 0 });

const filler = "prime the delegation run with a long preamble. ".repeat(6);
const parentTask = `${filler} FAILCOST_ROOT_TRIGGER: begin the delegation.`;

async function run(childTurns: ReadonlyArray<Record<string, unknown>>) {
  const agent = await ReactiveAgents.create()
    .withName("child-cost")
    .withProvider("test")
    .withModel("test-model")
    .withDynamicSubAgents({ maxIterations: 2, maxRecursionDepth: 2 })
    .withTools()
    .withBudget({ tokenLimit: 50_000 })
    .withTestScenario([
      {
        match: "FAILCOST_ROOT_TRIGGER",
        toolCall: { name: "spawn-agent", args: { task: "CHILDWORK do the child work", name: "kid" } },
      },
      ...(childTurns as never[]),
      { text: "Done." },
    ])
    .build();
  // Per-task billed-call sum: the parent's OWN calls run under its taskId, the
  // child's under its own, so the parent-only spend is separable.
  const callTokensByTask = new Map<string, number>();
  const callsByTask = new Map<string, number>();
  const billed = { tokens: 0, tokensIn: 0, tokensOut: 0, calls: 0 };
  await agent.subscribe((event) => {
    if (event._tag === "LLMRequestCompleted") {
      callTokensByTask.set(event.taskId, (callTokensByTask.get(event.taskId) ?? 0) + event.tokensUsed);
      callsByTask.set(event.taskId, (callsByTask.get(event.taskId) ?? 0) + 1);
      billed.tokens += event.tokensUsed;
      billed.tokensIn += event.tokensIn ?? 0;
      billed.tokensOut += event.tokensOut ?? 0;
      billed.calls += 1;
    }
  });
  try {
    const result = await agent.run(parentTask);
    return Object.assign(result, {
      parentOwnCallTokens: callTokensByTask.get(String(result.taskId)) ?? 0,
      parentOwnCalls: callsByTask.get(String(result.taskId)) ?? 0,
      billed,
    });
  } finally {
    await agent.dispose();
  }
}

describe("failed child spend folds into the parent run meter", () => {
  it("crashed child (seam): its full meter, including spend inside the failing phase, folds into the parent once", async () => {
    // Parent already spent one call (binary-exact costs keep toEqual exact).
    const parentMeter = { tokens: 10, cost: 0.125, inputTokens: 5, outputTokens: 5, llmCalls: 1 };
    const probe = makeChildSpendProbe();
    // The child's run: its own meter, the probe's hooks on a real registry.
    const childRun = Effect.gen(function* () {
      const registry = yield* LifecycleHookRegistry;
      yield* Effect.forEach(probe.hooks, (h) => registry.register(h), { discard: true });
      yield* registry.run("bootstrap", "before", bareCtx());
      yield* addRunSpend({ tokens: 100, cost: 0.5, inputTokens: 80, outputTokens: 20, llmCalls: 1 });
      yield* registry.run("think", "after", bareCtx());
      // Spend inside a phase that then fails: no phase boundary after it.
      yield* addRunSpend({ tokens: 50, cost: 0.25, inputTokens: 40, outputTokens: 10, llmCalls: 1 });
      return yield* Effect.fail("child engine crashed" as const);
    }).pipe(Effect.provide(LifecycleHookRegistryLive));
    const parentRun = Effect.gen(function* () {
      const exit = yield* Effect.exit(withRunBudgetMeter(childRun, makeRunBudgetMeter()));
      expect(exit._tag).toBe("Failure");
      return yield* foldChildMeter(probe.read());
    });
    const folded = await Effect.runPromise(withRunBudgetMeter(parentRun, parentMeter));
    expect(folded).toEqual({ tokens: 150, cost: 0.75, inputTokens: 120, outputTokens: 30, llmCalls: 2 });
    expect(parentMeter).toEqual({ tokens: 160, cost: 0.875, inputTokens: 125, outputTokens: 35, llmCalls: 3 });
  });

  it("probe before any hook reads zero; fold with no armed meter is a no-op", async () => {
    const probe = makeChildSpendProbe();
    expect(probe.read()).toEqual({ tokens: 0, cost: 0 });
    const spend = spendOfChildResult({ tokensUsed: 7, cost: 0.1, inputTokens: 5, outputTokens: 2, llmCalls: 1 });
    expect(await Effect.runPromise(foldChildMeter(spend))).toEqual(spend);
  });

  it("executor wires the probe and folds BOTH exits through foldChildMeter", () => {
    const src = readFileSync(
      new URL("../../src/builder/build-effect/sub-agent-executor.ts", import.meta.url),
      "utf8",
    );
    expect(src).toContain("subEngine.registerHook(h)");
    expect(src).toMatch(/foldChildMeter\(spendOfChildResult\(result\?\.metadata\)\)/);
    expect(src).toMatch(/foldChildMeter\(spendProbe\.read\(\)\)/);
    // No second fold path: the meter is only touched through foldChildMeter.
    expect(src).not.toMatch(/addRunSpend\(/);
  });

  it("child that errors after spending still counts", async () => {
    const ok = await run([{ match: "CHILDWORK", text: "child done" }]);
    const failed = await run([
      { match: "CHILDWORK", toolCall: { name: "file-read", args: { path: "/nonexistent-child-cost" } } },
      { match: "CHILDWORK", error: "child llm exploded" },
    ]);
    // Delta over the parent's OWN calls (tokensUsed now reports the run meter,
    // child fold included, so it can no longer serve as the parent-only base).
    expect(ok.parentOwnCallTokens).toBeGreaterThan(0);
    expect(failed.parentOwnCallTokens).toBeGreaterThan(0);
    const okDelta = ok.metadata.runBudgetSpend!.tokens - ok.parentOwnCallTokens;
    const failDelta = failed.metadata.runBudgetSpend!.tokens - failed.parentOwnCallTokens;
    expect(okDelta).toBeGreaterThan(0);
    expect(failDelta).toBeGreaterThan(0);
    // Reported spend and the meter are one number on both paths.
    expect(ok.metadata.tokensUsed).toBe(ok.metadata.runBudgetSpend!.tokens);
    expect(failed.metadata.tokensUsed).toBe(failed.metadata.runBudgetSpend!.tokens);
  }, 15000);

  it("an LLM-errored child's full meter (in/out/llmCalls) reaches the parent result exactly once", async () => {
    const failed = await run([
      { match: "CHILDWORK", toolCall: { name: "file-read", args: { path: "/nonexistent-child-cost" } } },
      { match: "CHILDWORK", error: "child llm exploded" },
    ]);
    // Precondition: the child really spent (billed calls under a second task id).
    expect(failed.billed.calls).toBeGreaterThan(failed.parentOwnCalls);
    // Every billed call of the run (parent + crashed child) is on the result,
    // from the same meter as tokensUsed: no field drops the child, none counts it twice.
    expect(failed.metadata.tokensUsed).toBe(failed.billed.tokens);
    expect(failed.metadata.inputTokens).toBe(failed.billed.tokensIn);
    expect(failed.metadata.outputTokens).toBe(failed.billed.tokensOut);
    expect(failed.metadata.llmCalls).toBe(failed.billed.calls);
  }, 15000);
});
