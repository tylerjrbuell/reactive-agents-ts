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
