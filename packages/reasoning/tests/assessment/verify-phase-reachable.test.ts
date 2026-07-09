// Run: bun test packages/reasoning/tests/assessment/verify-phase-reachable.test.ts
//
// The `verify` phase was UNREACHABLE in production, and the wiring audit's
// "assess ignores verdict.verified" finding was a symptom of that, not the root.
//
// Root cause. `assess()` inferred `phase: "verify"` from exactly one signal:
//
//     const hasTerminalVerdict = entriesOfKind(ledger, "verdict")
//       .some((v) => v.gate === "terminal")
//
// `gate: "terminal"` verdicts are minted at exactly two sites, both in the
// arbitrator (`arbitrator.ts:1335` exit-success, `:1367` exit-failure), and both
// transition the run to `done`/`failed` — which ends the loop. `assess()` runs
// once per iteration INSIDE the loop (`iterate-pass.ts:468`). So at every
// assess() call the ledger provably holds no terminal verdict, `hasTerminalVerdict`
// is always false, and `phase` could never be "verify".
//
// The only test that ever produced "verify" (`assess.test.ts:181`) hand-fed a
// terminal verdict into the ledger — a state production cannot reach at
// assess-time. Unit-testing the function, not the call. Consequently
// `PHASE_PROFILES.verify` (the projector's verify emphasis) was dead render code.
//
// Meanwhile `gate: "in-loop"` — the third declared verdict gate
// (`run-ledger.ts`) — had ZERO writers. That is the missing producer: the harness
// DOES verify a proposed completion mid-loop and push back (the completion-guard
// at `think.ts:1595-1610`, the abstention-legitimacy gate at `think.ts:1284`),
// it just never recorded the verdict as a ledger fact.
//
// The fix mints in-loop verdicts in the ledger's own projection (steps[] is the
// source, `step-projection.ts` is the sanctioned minter — so
// `check-ledger-writes.sh` still holds and no guard site changes), and teaches
// `assess()` that a REJECTED in-loop verdict means the run is in verify/repair.
// That makes `verified` load-bearing for the first time.

import { describe, expect, it } from "bun:test";
import { artifactProduced, toolCalled } from "../../src/kernel/capabilities/verify/post-conditions.js";
import type { RunContract } from "../../src/kernel/contract/run-contract.js";
import { appendEntries, entriesOfKind, type RunLedger } from "../../src/kernel/ledger/run-ledger.js";
import { stepToEntries } from "../../src/kernel/ledger/step-projection.js";
import { assess, type BudgetState } from "../../src/kernel/assessment/assess.js";
import { makeStep } from "../../src/kernel/capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../src/kernel/utils/observation-helpers.js";
import { transitionState, type KernelState } from "../../src/kernel/state/kernel-state.js";
import { project } from "../../src/assembly/project.js";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import type { ReasoningStep } from "../../src/types/index.js";

const contract = (): RunContract => ({
  requirements: [
    {
      id: "tool:web-search",
      kind: "tool-coverage",
      spec: {
        description: "call web-search",
        condition: toolCalled("web-search"),
        acceptance: "deterministic",
      },
      weight: 1,
    },
    // Left UNSATISFIED on purpose: the projector renders its phase emphasis
    // inside the "Outstanding requirements:" block, so a contract with nothing
    // outstanding would render no emphasis no matter what the phase is.
    {
      id: "artifact:report.md",
      kind: "artifact-produced",
      spec: {
        description: "write report.md",
        condition: artifactProduced("report.md"),
        acceptance: "deterministic",
      },
      weight: 1,
    },
  ],
  deliverables: [],
  constraints: [],
  horizon: "long",
  acceptance: { tiers: ["deterministic"], stakes: "standard" },
  postConditions: [toolCalled("web-search")],
});

const budget = (iteration: number): BudgetState => ({
  iteration,
  maxIterations: 20,
  tokensUsed: 100,
  costUsd: 0,
});

/** A ledger where the run gathered evidence (so the baseline phase is NOT verify). */
const gathered = (): RunLedger =>
  appendEntries([], [
    { kind: "tool-invocation", iteration: 1, toolName: "web-search", args: { q: "x" }, toolCallId: "c1" },
    { kind: "tool-result", iteration: 1, toolName: "web-search", success: true, preview: "hits", toolCallId: "c1" },
  ]);

const phaseOf = (ledger: RunLedger, iteration = 2) => assess(contract(), ledger, budget(iteration)).phase;

// ─── 1. assess(): a rejected in-loop verdict means the run is verifying ───────

describe("assess — the verify phase is reachable from a MID-LOOP verdict", () => {
  it("a REJECTED in-loop verdict → phase 'verify'", () => {
    // The completion-guard said "not done yet". The run is now in verify/repair.
    // Before the fix, no in-loop verdict existed and this phase was unreachable.
    const ledger = appendEntries(gathered(), [
      { kind: "verdict", iteration: 2, gate: "in-loop", verified: false, reason: "gaps remain" },
    ]);
    expect(phaseOf(ledger)).toBe("verify");
  });

  it("an ACCEPTED in-loop verdict does NOT force verify (this is what makes `verified` load-bearing)", () => {
    // Mutation guard: if assess() reverts to reading only `.gate`, this goes RED.
    const ledger = appendEntries(gathered(), [
      { kind: "verdict", iteration: 2, gate: "in-loop", verified: true },
    ]);
    expect(phaseOf(ledger)).not.toBe("verify");
  });

  it("the LATEST in-loop verdict wins — a rejection that was later cleared exits verify", () => {
    const ledger = appendEntries(gathered(), [
      { kind: "verdict", iteration: 2, gate: "in-loop", verified: false, reason: "gaps" },
      { kind: "verdict", iteration: 3, gate: "in-loop", verified: true },
    ]);
    expect(phaseOf(ledger, 3)).not.toBe("verify");
  });

  it("a rejection AFTER an acceptance re-enters verify", () => {
    const ledger = appendEntries(gathered(), [
      { kind: "verdict", iteration: 2, gate: "in-loop", verified: true },
      { kind: "verdict", iteration: 3, gate: "in-loop", verified: false, reason: "regressed" },
    ]);
    expect(phaseOf(ledger, 3)).toBe("verify");
  });

  it("per-step verdicts do NOT drive the phase (they fire on ordinary tool observations)", () => {
    const ledger = appendEntries(gathered(), [
      { kind: "verdict", iteration: 2, gate: "per-step", verified: false },
    ]);
    expect(phaseOf(ledger)).not.toBe("verify");
  });

  it("a terminal verdict still yields verify (unchanged; the run reached the terminal gate)", () => {
    const ledger = appendEntries(gathered(), [
      { kind: "verdict", iteration: 2, gate: "terminal", verified: true },
    ]);
    expect(phaseOf(ledger)).toBe("verify");
  });
});

// ─── 2. The PRODUCER: step-projection mints the in-loop verdict ───────────────
//
// The guards already write an observation step tagged with the gate's name.
// Minting lives in the ledger's own projection, so no guard site hand-builds a
// ledger entry and `check-ledger-writes.sh` continues to hold.

const guardStep = (gate: string, ok: boolean, msg = "not done yet") =>
  makeStep("observation", msg, { observationResult: makeObservationResult(gate, ok, msg) });

describe("step-projection — mid-loop gate rejections become in-loop verdicts", () => {
  it("a completion-guard REDIRECT mints verdict{gate:'in-loop', verified:false}", () => {
    const entries = stepToEntries(guardStep("completion-guard", false), 2);
    const verdicts = entries.filter((e) => e.kind === "verdict");
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0]).toMatchObject({ kind: "verdict", gate: "in-loop", verified: false });
  });

  it("a completion-guard PASS mints verdict{gate:'in-loop', verified:true}", () => {
    const entries = stepToEntries(guardStep("completion-guard", true, "ok"), 2);
    expect(entries.filter((e) => e.kind === "verdict")[0]).toMatchObject({
      gate: "in-loop",
      verified: true,
    });
  });

  it("an abstention-legitimacy rejection mints an in-loop verdict too", () => {
    const entries = stepToEntries(guardStep("abstention-legitimacy", false), 3);
    expect(entries.filter((e) => e.kind === "verdict")[0]).toMatchObject({
      gate: "in-loop",
      verified: false,
    });
  });

  it("an ORDINARY tool observation mints NO verdict (the gate list is not a catch-all)", () => {
    const entries = stepToEntries(guardStep("web-search", true, "hits"), 1);
    expect(entries.filter((e) => e.kind === "verdict")).toHaveLength(0);
  });
});

// ─── 3. WIRING: guard step → transitionState → ledger → assess → PROMPT ───────
//
// The sections above call `stepToEntries` and `assess` directly, so they would
// stay green even if nothing in the kernel ever projected a guard step, and even
// if the assessment never reached the model. That is the exact failure this test
// file exists to catch, so the pins below drive the REAL chokepoints:
//
//   transitionState()  — the single site that grows the ledger from steps[]
//   assess()           — the perception node
//   fromKernelState/project() — the renderer that builds the system prompt
//
// The terminal observable is `request.systemPrompt`: the string the LLM receives.
// Cut ANY link (stop minting the verdict, revert assess to reading only `.gate`,
// drop the assessment from the projector) and these go RED.

const longHorizonState = (steps: readonly ReasoningStep[], ledger: RunLedger): KernelState =>
  ({
    status: "thinking",
    iteration: 2,
    steps,
    ledger,
    messages: [{ role: "user", content: "research and report" }],
    toolsUsed: new Set<string>(["web-search"]),
    scratchpad: new Map<string, string>(),
    meta: { horizonProfile: "long", runContract: contract(), maxIterations: 20 },
  }) as unknown as KernelState;

const PROFILE = { maxTokens: 32_768, tier: "mid" } as never;

/** Grow the ledger through the REAL chokepoint by appending a step. */
const afterStep = (step: ReasoningStep): KernelState => {
  const base = longHorizonState([], gathered());
  return transitionState(base, { steps: [...base.steps, step], iteration: 2 });
};

describe("WIRING: a completion-guard rejection reaches the ledger, the assessment, and the prompt", () => {
  it("transitionState projects the guard step into an in-loop verdict", () => {
    const next = afterStep(guardStep("completion-guard", false));
    const inLoop = entriesOfKind(next.ledger ?? [], "verdict").filter((v) => v.gate === "in-loop");
    expect(inLoop).toHaveLength(1);
    expect(inLoop[0]!.verified).toBe(false);
  });

  it("that verdict drives the real assess() into the verify phase", () => {
    const next = afterStep(guardStep("completion-guard", false));
    expect(assess(contract(), next.ledger ?? [], budget(2)).phase).toBe("verify");
  });

  it("and the verify phase changes the SYSTEM PROMPT the model reads", () => {
    // PHASE_PROFILES.verify was dead render code: no production ledger could
    // produce phase "verify", so this emphasis had never once been rendered.
    const next = afterStep(guardStep("completion-guard", false));
    const assessment = assess(contract(), next.ledger ?? [], budget(2));
    const withAssessment = transitionState(next, {
      meta: { ...next.meta, assessment },
    } as never);

    const { request } = project(
      fromKernelState(withAssessment, PROFILE, { system: "" }, { schemas: [] }, "research and report"),
    );
    expect(request.systemPrompt).toContain("Verify each outstanding requirement");
  });

  it("an ordinary observation leaves the run out of verify (the phase is caused by the GUARD)", () => {
    const next = afterStep(guardStep("web-search", true, "hits"));
    expect(assess(contract(), next.ledger ?? [], budget(2)).phase).not.toBe("verify");
  });
});
