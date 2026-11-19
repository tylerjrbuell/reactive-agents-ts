// Run: bun test packages/runtime/tests/seam-environment-update-once-per-run.test.ts --timeout 20000
//
// Audit G10 (2026-11-18 strategy-substrate conformance): the between-turn
// environment notice must reach the model at most ONCE per run, under every
// strategy. Multi-pass strategies (reflexion: generate + improve passes) ran
// each pass with a fresh kernel signal ledger, so the "once" guard reset and
// the notice was re-injected on every pass.
import { describe, it, expect } from "bun:test";
import type { AgentEvent } from "@reactive-agents/core";
import { ReactiveAgents } from "../src/builder.js";

const NOTICE = "Environment update since your last turn:\n- Model switched to qwen3:14b.";

async function injections(strategy: string, environmentUpdate?: string): Promise<number> {
  const agent = await ReactiveAgents.create()
    .withName(`env-once-${strategy}`)
    .withProvider("test")
    .withModel("test")
    // Every call answers with plain text; reflexion's critique never says
    // "satisfied", so it runs its improve passes.
    .withTestScenario([{ text: "The metric rose 12% last quarter." }] as never)
    .withReasoning({
      defaultStrategy: strategy as never,
      enableStrategySwitching: false,
      ...(strategy === "reflexion" ? { strategies: { reflexion: { maxRetries: 2 } } } : {}),
    } as never)
    .withMaxIterations(6)
    .build();
  let count = 0;
  const unsubscribe = await agent.subscribe((e: AgentEvent) => {
    if (e._tag === "HarnessSignalInjectedEmitted" && e.origin === "environment-update") count += 1;
  });
  await agent.run("Summarize the metric change.", environmentUpdate ? { environmentUpdate } : {});
  unsubscribe();
  await agent.dispose();
  return count;
}

describe("G10: environment notice once per run", () => {
  it("reactive: one notice in, exactly one injection (vacuity guard)", async () => {
    expect(await injections("reactive", NOTICE)).toBe(1);
  }, 30_000);

  // Formerly a known defect (2 injections: the "once" guard read the per-pass
  // signal ledger). Fixed by the run-scoped latch `reasoning.environmentUpdateShown`
  // in kernel/capabilities/reflect/environment-update.ts.
  it("reflexion (multi-pass): exactly one injection, not one per pass", async () => {
    expect(await injections("reflexion", NOTICE)).toBe(1);
  }, 30_000);

  it("fresh run with no notice: zero injections", async () => {
    expect(await injections("reflexion")).toBe(0);
  }, 30_000);
});
