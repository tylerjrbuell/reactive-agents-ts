// Run: bun test packages/runtime/tests/subagent/failed-child-cost.test.ts --timeout 15000
//
// D-2026-10-29-CHILD-COST: a delegated child that FAILS (its engine run errors
// after real LLM spend) must still fold that spend into the parent's run meter,
// at the same boundary as a successful child. RED-ON-CUT: drop the failure-path
// fold in sub-agent-executor.ts and the failing-child delta goes to 0.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { ReactiveAgents } from "../../src/index.js";
import {
  foldFailedChildSpend,
  makeChildSpendProbe,
} from "../../src/builder/build-effect/child-spend-probe.js";
import type { ExecutionContext } from "../../src/types.js";

const ctxAt = (tokensUsed: number, cost: number): ExecutionContext =>
  Object.assign(Object.create(null), { tokensUsed, cost });

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
  await agent.subscribe((event) => {
    if (event._tag === "LLMRequestCompleted") {
      callTokensByTask.set(event.taskId, (callTokensByTask.get(event.taskId) ?? 0) + event.tokensUsed);
    }
  });
  try {
    const result = await agent.run(parentTask);
    return Object.assign(result, {
      parentOwnCallTokens: callTokensByTask.get(String(result.taskId)) ?? 0,
    });
  } finally {
    await agent.dispose();
  }
}

describe("failed child spend folds into the parent run meter", () => {
  it("probe records the highest cumulative spend, also from on-error hooks", () => {
    const probe = makeChildSpendProbe();
    const hook = (phase: string, timing: string) =>
      probe.hooks.find((h) => h.phase === phase && h.timing === timing)!;
    hook("think", "after").handler(ctxAt(120, 0.002));
    hook("verify", "on-error").handler(ctxAt(150, 0.003));
    hook("act", "after").handler(ctxAt(90, 0.001)); // stale lower value never regresses
    expect(probe.read()).toEqual({ tokens: 150, cost: 0.003 });
  });

  it("a crashed child's probed spend lands on the parent meter; no meter is a no-op", () => {
    const probe = makeChildSpendProbe();
    probe.hooks.find((h) => h.phase === "think" && h.timing === "after")!.handler(ctxAt(200, 0.01));
    const meter = { tokens: 10, cost: 0.5 };
    expect(foldFailedChildSpend(meter, probe)).toEqual({ tokens: 200, cost: 0.01 });
    expect(meter).toEqual({ tokens: 210, cost: 0.51 });
    expect(foldFailedChildSpend(null, probe).tokens).toBe(200);
  });

  it("executor wires the probe: hooks on the child engine + fold in the failure branch", () => {
    const src = readFileSync(
      "packages/runtime/src/builder/build-effect/sub-agent-executor.ts",
      "utf8",
    );
    expect(src).toContain("subEngine.registerHook(h)");
    expect(src).toMatch(/foldFailedChildSpend\(failedMeter, spendProbe\)/);
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
});
