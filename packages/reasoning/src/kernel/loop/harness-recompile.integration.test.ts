// Run: bun test packages/reasoning/src/kernel/loop/harness-recompile.integration.test.ts --timeout 30000
//
// G1 mid-run recompile — the adaptive lever wired into the real loop, LOGGED end
// to end. A clean, evidence-producing run (new substantive tool evidence every
// iteration, no failures) recompiles the plan at the cadence and LEANS it (sheds
// scaffolding), recording a `harness-recompiled` harness-signal on the ledger.
//
// Why the LEAN path here (deepen is covered by the pure synthetic-assessment unit
// tests in ../policy/harness-plan.test.ts): under the test provider a struggling
// run (no new evidence) is terminated by the token-delta diminishing-returns
// guard before the recompile cadence is reached — that guard is only defused
// (under the long-horizon profile) by evidenceDelta > 0, i.e. a clean run. So the
// only multi-iteration scenario that survives to the cadence is the clean one,
// which exercises LEAN. The scenario alternates two success tools with distinct
// args each turn so (a) every iteration yields NEW evidence (evidenceDelta > 0,
// defusing the token-delta guard) and (b) no single tool name repeats
// consecutively (the maxSameTool loop-guard stays quiet). A forced local tier
// gives the run-start plan a non-zero scaffolding level to lean down from.
//
// OFF (no adaptiveHarness): the identical scenario records NO harness-recompiled
// signal — the recompile block is skipped entirely (byte-identical).

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { mockToolServiceLayer } from "../../testing/tool-service-mock.js";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";
import type { RunLedger } from "../ledger/run-ledger.js";

const toolLayer = mockToolServiceLayer({
  execute: (req: { toolName: string; args?: unknown }) =>
    Effect.succeed({
      success: true,
      result: { finding: `KEY FACT from ${req.toolName}(${JSON.stringify(req.args ?? {})})` },
    }),
  getTool: (name: string) =>
    Effect.succeed({ name, description: "test", parameters: [{ name: "q", type: "string", required: true }] }),
});

const SCHEMAS = [
  { name: "alpha", description: "gather a", parameters: [{ name: "q", type: "string", required: true }] },
  { name: "beta", description: "gather b", parameters: [{ name: "q", type: "string", required: true }] },
];

// Distinct (tool, args) every turn → new evidence each iteration; alternating
// names → maxSameTool never trips on a consecutive repeat.
const scenario = () =>
  TestLLMServiceLayer([
    { toolCall: { name: "alpha", args: { q: "a1" } } },
    { toolCall: { name: "beta", args: { q: "b2" } } },
    { toolCall: { name: "alpha", args: { q: "a3" } } },
    { toolCall: { name: "beta", args: { q: "b4" } } },
    { toolCall: { name: "alpha", args: { q: "a5" } } },
    { toolCall: { name: "beta", args: { q: "b6" } } },
    { toolCall: { name: "alpha", args: { q: "a7" } } },
  ]);

// A long-horizon task so the plan sets horizonProfile "long" (defusing the
// token-delta guard on clean evidence) and gives the run guard headroom.
const LONG_TASK =
  "This is a long-horizon research task: investigate the topic across many iterations and sources.";

const run = (opts: Partial<KernelRunOptions>) =>
  Effect.runPromise(
    runPass(reactKernel, { task: LONG_TASK, availableToolSchemas: SCHEMAS } as KernelInput, {
      maxIterations: 12,
      strategy: "reactive",
      kernelType: "react",
      taskId: "harness-recompile-integration",
      modelId: "llama3.2:3b", // force local tier → non-zero base scaffolding to lean down from
      ...opts,
    }).pipe(Effect.provide(Layer.merge(scenario(), toolLayer))),
  );

const recompileSignals = (ledger: RunLedger | undefined) =>
  (ledger ?? []).filter((e) => e.kind === "harness-signal" && e.signal === "harness-recompiled");

describe("G1 mid-run recompile — adaptive LEAN on a clean run, logged to the ledger", () => {
  it("ON: a clean evidence-producing run records a harness-recompiled signal + a recompiled plan", async () => {
    const pass = await run({ adaptiveHarness: true });
    const signals = recompileSignals(pass.state.ledger);
    expect(signals.length).toBeGreaterThan(0);
    const first = signals[0];
    expect(first?.kind === "harness-signal" ? first.detail ?? "" : "").toContain("lean");
    // The recompiled plan is recorded on meta and leaner than the run-start plan.
    expect(pass.state.meta.harnessPlan?.source).toBe("recompiled");
  });

  it("OFF: the identical scenario records NO harness-recompiled signal (byte-identical)", async () => {
    const pass = await run({});
    expect(recompileSignals(pass.state.ledger).length).toBe(0);
    expect(pass.state.meta.harnessPlan).toBeUndefined();
  });
});
