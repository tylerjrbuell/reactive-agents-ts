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
