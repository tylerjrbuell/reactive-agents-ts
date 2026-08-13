// Run: bun test packages/runtime/tests/result-boundary-verification.test.ts --timeout 20000
//
// Result-boundary verification — the verifier reaches EVERY run.
//
// Empirical origin (2026-07-11/12 probe fleet): the terminal verifier runs
// only inside the react kernel. Strategy paths (blueprint / plan-execute /
// tree-of-thought / reflexion / code-action) and the engine's inline loop
// produced ZERO verifier verdicts — `receipt.verifierVerdict` had no writer
// there, `rax:diagnose` showed "0 verifier verdicts" on every strategy trace,
// and a scaffold-leaking or harness-parroting answer shipped ungraded.
//
// The result boundary is the ONE place every path passes through. Wiring the
// pure `defaultVerifier` there gives:
//   - receipt.verifierVerdict on every run (pass/warn/reject/escalate);
//   - a receipt verdict CAP when the verifier rejects (never an upgrade —
//     mirrors the deliverable cap, e247e6b8);
//   - the VerifierVerdictEmitted event → trace → rax:diagnose.
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("result-boundary verification", () => {
  it("a clean answer gets verifierVerdict=pass on the receipt", async () => {
    const agent = await ReactiveAgents.create()
      .withTestScenario([{ text: "Paris is the capital of France." }])
      .build();
    try {
      const r = await agent.run("What is the capital of France?");
      expect(r.receipt?.verifierVerdict).toBe("pass");
      expect(r.success).toBe(true);
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("scaffold leak in the final answer is caught and caps the receipt verdict", async () => {
    // scaffold-leak is ALWAYS-ON and ~zero false-positive: an answer echoing
    // framework internals (_tool_result_N / [STORED:]) is never valid.
    const agent = await ReactiveAgents.create()
      .withTestScenario([
        { text: "The answer is in _tool_result_1 — see [STORED: key-42]." },
      ])
      .build();
    try {
      const r = await agent.run("Summarize the findings.");
      expect(r.receipt?.verifierVerdict).toBe("reject");
      // The verdict is capped — a rejected answer is never fully grounded.
      expect(r.receipt?.verdict).not.toBe("tool-grounded");
      // …and the reason is named on the result, not buried.
      //
      // OPEN FINDING (Move 1 merge triage, 2026-08-13), NOT resolved -- this
      // is FM-4/FM-7 (already filed in
      // wiki/Planning/Implementation-Plans/2026-08-12-agentic-overhaul-
      // program.md's failure-mode register: "terminal truth reconstructed
      // three times" / "requirement evidence means different things per
      // caller"), reproduced concretely here rather than a new defect. Two
      // independent verifiers run on this scenario: the KERNEL's own
      // internal verifier correctly catches scaffold-leak first (visible in
      // the log: "failed at scaffold-leak (output contains framework
      // scaffolding markers...)") and terminates the run failed. THEN
      // execution-engine.ts's separate `verifyResultBoundary` re-verifies
      // the ALREADY-failed result independently, and ITS OWN check
      // ("action-success") is what fails this time (trivially -- success is
      // already false) -- so `result.metadata.verificationWarning` reports
      // "action-success — final-answer returned success=false" instead of
      // the real, specific scaffold-leak reason the kernel already found.
      // The verdict-CAPPING mechanism this test's other two assertions check
      // still works correctly (verifierVerdict:"reject",
      // verdict!=="tool-grounded"); only the surfaced REASON text is wrong
      // -- a second, less-informative verifier is overwriting the first,
      // more specific one's explanation. Fixing this properly means the two
      // verifiers agreeing on one shared reason (FM-4/FM-7's actual fix,
      // Phase 4/5 of the governing plan) -- not a standalone patch here.
      // Left asserting the CORRECT (desired) behavior, not the current wrong
      // one -- this stays red until FM-4/FM-7 lands, by design.
      expect(
        String((r.metadata as { verificationWarning?: string }).verificationWarning ?? ""),
      ).toContain("scaffold-leak");
    } finally {
      await agent.dispose();
    }
  }, 20000);

  it("verification runs on a STRATEGY path too (plan-execute), not just the kernel", async () => {
    const agent = await ReactiveAgents.create()
      .withReasoning({ defaultStrategy: "plan-execute-reflect" })
      .withTestScenario([
        { json: { steps: [{ instruction: "answer", title: "answer", type: "analysis" }] } },
        { text: "The answer is in _tool_result_1." },
        { text: "The answer is in _tool_result_1." },
        { text: "The answer is in _tool_result_1." },
      ])
      .build();
    try {
      const r = await agent.run("Summarize the findings.");
      expect(r.receipt?.verifierVerdict).toBeDefined();
      expect(r.receipt?.verifierVerdict).toBe("reject");
    } finally {
      await agent.dispose();
    }
  }, 20000);
});
