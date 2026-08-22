import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

// Verifies the builder → runtime-config → executeRequest → ReactiveInput →
// kernelInput.fabricationGuard → verifier rail end-to-end via the deterministic
// test provider. The model's final answer asserts fabricated benchmark numbers
// ("150 ms → 90 ms, 40% faster") that no tool produced; the always-on guard
// must reject them by default, and `.withFabricationGuard("off")` must disable.
const FABRICATED =
  "FINAL ANSWER: The optimized sort runs in 90 ms versus 150 ms originally — a 40% improvement.";

function agent(mode: "off" | "block" | undefined) {
  let b = ReactiveAgents.create()
    .withName("fab-rail")
    .withModel("test-model")
    .withReasoning()
    .withVerification()
    .withTestScenario([{ text: FABRICATED }]);
  if (mode) b = b.withFabricationGuard(mode);
  return b.build();
}

describe("fabrication-guard builder rail (deterministic test provider)", () => {
  it("guard=off → fabricated answer ships successfully (rail carries the disable)", async () => {
    const a = await agent("off");
    const r = await a.run("optimize the sort and give before/after benchmarks");
    expect(r.success).toBe(true);
    expect(r.output).toContain("40%");
  });

  it("default (block) → guard rejects the fabricated answer (run fails the terminal gate)", async () => {
    const a = await agent(undefined);
    const r = await a.run("optimize the sort and give before/after benchmarks");
    // Same fabricated answer + same provider as the off case — the ONLY
    // difference is the guard default, so a failed run isolates the guard.
    expect(r.success).toBe(false);
  });
});

// End-to-end reproduction of the 2026-08-21 cortex live false-positive (run
// 01M0KB5MTA4NJP907V93RHKFGK): a legitimate summary report — numbered bold
// category headers the model synthesized itself, plus a Date/Action summary
// table — was hard-failed by the (then newly-added) fabricated-listed-
// entities check in the DEFAULT block mode. Exercises the exact same builder
// → verifier rail as the suite above, proving the fix holds through the full
// stack, not just the verifier unit.
const LEGITIMATE_SUMMARY_REPORT =
  "FINAL ANSWER: # Activity Summary\n\n" +
  "1.  **Improved Onboarding & Clarity:** Overhauled the README.\n" +
  "2.  **Stability & Reliability:** Fixed provider deprecation bugs.\n\n" +
  "| Date | Key Action | Impact |\n| :--- | :--- | :--- |\n" +
  "| **Aug 17** | Memory Tier Docs Update | Improved documentation clarity. |\n" +
  "| **Aug 16** | README/Site Overhaul | Massive DX boost. |";

describe("fabricated-listed-entities never hard-fails a legitimate synthesis report (2026-08-21 cortex incident)", () => {
  it("default (block) mode → legitimate summary report still ships successfully", async () => {
    const a = await ReactiveAgents.create()
      .withName("fab-listed-entities-rail")
      .withModel("test-model")
      .withReasoning()
      .withVerification()
      .withTestScenario([{ text: LEGITIMATE_SUMMARY_REPORT }])
      .build();
    const r = await a.run("summarize the last 10 commits in a markdown report");
    expect(r.success).toBe(true);
    expect(r.output).toContain("Improved Onboarding");
  });
});
