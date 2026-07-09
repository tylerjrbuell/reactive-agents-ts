// Run: bun test packages/reasoning/src/kernel/loop/pace-terminal.integration.test.ts --timeout 20000
//
// E3 terminal pace-action — the audit 05-#1 fix, end-to-end.
//
// BEFORE (flag off): a run that gathers evidence and then hits the token budget
// cliff terminates `status:"failed" terminatedBy:"budget_exceeded"` and the
// transitionState invariant NULLS the output — the gathered work is DISCARDED.
//
// AFTER (long-horizon profile on): the E1 pace band flips to `terminal` at
// burnRatio ≥ 0.95, one notch before the cliff. The loop pre-empts at iteration
// start with a forced generous synthesis on the accumulated evidence and
// terminates `status:"done" terminatedBy:"budget_terminal"` with a PRESERVED,
// honestly-partial answer — never a discarded budget_exceeded failure.
//
// Both runs share the identical scenario/tools/limits; ONLY horizonProfile flips.

import { describe, it, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { reactKernel } from "./react-kernel.js";
import { runPass } from "./run-pass.js";
import { compileRunContract } from "../contract/run-contract.js";
import type { KernelInput, KernelRunOptions } from "../state/kernel-state.js";

// A gather tool the model calls to accumulate evidence (never the write path, so
// the derived report.md artifact requirement stays OUTSTANDING → non-green band).
const GATHER_SCHEMA = {
  name: "gather",
  description: "gather research data",
  parameters: [{ name: "q", type: "string", required: true }],
};

const gatherToolLayer = Layer.succeed(
  ToolService,
  ToolService.of({
    execute: (req: { toolName: string }) => {
      void req;
      return Effect.succeed({
        success: true,
        result: { finding: "KEY FACT: the topic's core metric rose 12% last quarter." },
      });
    },
    getTool: (name: string) =>
      Effect.succeed({ name, description: "test", parameters: GATHER_SCHEMA.parameters }),
    register: () => Effect.void,
    listTools: () => Effect.succeed([]),
    deregister: () => Effect.void,
  } as unknown as Parameters<typeof ToolService.of>[0]),
);

// iter 0: the task prompt (mentions report.md) → gather tool call, burning tokens.
// iter 1 synthesis pass (prompt says "professional") → the synthesized answer.
// fallback: an un-synthesized final answer the flag-OFF run ships into the cliff.
const scenario = () =>
  TestLLMServiceLayer([
    { match: "report\\.md", toolCall: { name: "gather", args: { q: "topic" } } },
    { match: "professional", text: "SYNTHESIZED REPORT: the topic's core metric rose 12% last quarter." },
    { text: "FINAL ANSWER: unsynthesized guess." },
  ]);

const TASK = "Research the topic thoroughly and write your findings to report.md.";

const baseInput = (): KernelInput => ({
  task: TASK,
  budgetLimits: { tokenLimit: 1 }, // any real token usage exceeds → burnRatio ≫ 0.95
  availableToolSchemas: [GATHER_SCHEMA],
});

const run = (opts: Partial<KernelRunOptions>) =>
  Effect.runPromise(
    runPass(reactKernel, baseInput(), {
      maxIterations: 6,
      strategy: "reactive",
      kernelType: "react",
      taskId: "pace-terminal-integration",
      ...opts,
    }).pipe(Effect.provide(Layer.merge(scenario(), gatherToolLayer))),
  );

describe("E3 pace-terminal — budget-exhaustion (audit 05-#1 before/after)", () => {
  it("the task compiles a deterministic OUTSTANDING requirement (report.md) — the band precondition", () => {
    const contract = compileRunContract(TASK, {});
    const det = contract.requirements.filter((r) => r.spec.condition !== undefined);
    expect(det.length).toBeGreaterThan(0);
    expect(det.some((r) => r.id.includes("report.md"))).toBe(true);
  });

  it("BEFORE (flag off): over-budget run hits the cliff → FAILED + budget_exceeded (no proper synthesis)", async () => {
    const pass = await run({});
    // The 05-#1 discard: the run FAILS at the cliff. Whatever raw text the model
    // last emitted is shipped under a failure (no generous synthesis of the
    // gathered evidence ever runs) — success=false, not a real deliverable.
    expect(pass.state.status).toBe("failed");
    expect(pass.state.meta.terminatedBy).toBe("budget_exceeded");
    expect(pass.state.output ?? "").not.toContain("SYNTHESIZED REPORT");
    expect(pass.state.meta.budgetTerminalPartial).toBeUndefined();
  });

  it("AFTER (horizonProfile:long): terminal band forces synthesis → done + SYNTHESIZED answer + honest partial", async () => {
    const pass = await run({ horizonProfile: "long" });

    // Not a discarded/bare budget_exceeded failure.
    expect(pass.state.status).toBe("done");
    expect(pass.state.meta.terminatedBy).toBe("budget_terminal");

    // A real, PRESERVED synthesized answer (from the generous synthesis pass).
    expect(pass.state.output).toBeTruthy();
    expect(pass.state.output ?? "").toContain("SYNTHESIZED REPORT");

    // Honest PARTIAL label — the budget ran out with report.md still outstanding.
    expect(pass.state.meta.budgetTerminalPartial).toBe(true);
    expect(pass.state.meta.verificationWarning ?? "").toContain("report.md");
  });
});
