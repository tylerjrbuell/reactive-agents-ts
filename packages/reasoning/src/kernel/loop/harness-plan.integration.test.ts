// Run: bun test packages/reasoning/src/kernel/loop/harness-plan.integration.test.ts --timeout 20000
//
// G1 run-start integration — the policy compiler wired into the real kernel loop
// via `.withAdaptiveHarness()` (→ KernelRunOptions.adaptiveHarness). Proves, on a
// real reactKernel run:
//
//   - OFF (default): no plan is compiled (`state.meta.harnessPlan` absent) and the
//     run is byte-identical to a control run (same status + output).
//   - ON: a HarnessPlan is compiled at run-start and cached on state.meta.
//   - horizonProfile is a PLAN OUTPUT: a long-horizon task → plan sets it "long"
//     (and mirrors it onto meta.horizonProfile); a short task leaves it unset.
//   - WITHER OVERRIDE: an explicit `.withLongHorizon()` (horizonProfile:"long")
//     forces "long" even on a short task — the plan default is overridden.

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";

// The model answers immediately — the run completes at iteration 0, after the
// run-start plan compile, so we can inspect the cached plan deterministically.
const scenario = () => TestLLMServiceLayer([{ text: "FINAL ANSWER: done." }]);

const SHORT_TASK = "What is the capital of France?";
const LONG_TASK =
  "This is a long-horizon research task: investigate the subject across many sources over many iterations.";

const run = (task: string, opts: Partial<KernelRunOptions>) =>
  Effect.runPromise(
    runPass(reactKernel, { task } as KernelInput, {
      maxIterations: 4,
      strategy: "reactive",
      kernelType: "react",
      taskId: "harness-plan-integration",
      ...opts,
    }).pipe(Effect.provide(scenario())),
  );

describe("G1 run-start — HarnessPlan compiled into the kernel loop", () => {
  it("OFF by default: no plan compiled + byte-identical to a control run", async () => {
    const control = await run(SHORT_TASK, {});
    const off = await run(SHORT_TASK, {});
    expect(off.state.meta.harnessPlan).toBeUndefined();
    // Byte-identical: same terminal status + output as the control run.
    expect(off.state.status).toBe(control.state.status);
    expect(off.state.output).toBe(control.state.output);
    // No adaptive-harness recompile signal on a non-adaptive run.
    const signals = (off.state.ledger ?? []).filter(
      (e) => e.kind === "harness-signal" && e.signal === "harness-recompiled",
    );
    expect(signals.length).toBe(0);
  });

  it("ON: a HarnessPlan is compiled at run-start and cached on state.meta", async () => {
    const on = await run(SHORT_TASK, { adaptiveHarness: true });
    expect(on.state.meta.harnessPlan).toBeDefined();
    expect(on.state.meta.harnessPlan?.source).toBe("compiled");
    // The run still terminates the same way — the plan is additive.
    expect(on.state.status).toBe("done");
  });

  it("horizonProfile is a plan OUTPUT: long task → plan sets 'long' + mirrors to meta", async () => {
    const on = await run(LONG_TASK, { adaptiveHarness: true });
    expect(on.state.meta.harnessPlan?.guard.horizonProfile).toBe("long");
    expect(on.state.meta.horizonProfile).toBe("long");
  });

  it("short task under adaptive leaves horizonProfile unset", async () => {
    const on = await run(SHORT_TASK, { adaptiveHarness: true });
    expect(on.state.meta.harnessPlan?.guard.horizonProfile).toBeUndefined();
    expect(on.state.meta.horizonProfile).toBeUndefined();
  });

  it("WITHER OVERRIDE: explicit .withLongHorizon() forces 'long' on a short task", async () => {
    const on = await run(SHORT_TASK, { adaptiveHarness: true, horizonProfile: "long" });
    // The compiled plan would leave horizonProfile unset for a short task; the
    // explicit wither override forces it on (subsumes A2's flag).
    expect(on.state.meta.harnessPlan?.guard.horizonProfile).toBe("long");
    expect(on.state.meta.horizonProfile).toBe("long");
  });
});
