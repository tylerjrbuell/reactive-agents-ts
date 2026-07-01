// Run: bun test packages/runtime/src/__tests__/abstention-result-surface.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import type { AgentResult } from "../builder/types";
import { projectAbstention } from "../reactive-agent";

describe("result.abstention surface", () => {
  it("projects abstention from a kernel result", () => {
    const r = projectAbstention({
      terminatedBy: "abstained",
      abstention: { reason: "no grounding tool available", missing: ["tool:web-search"] },
    });
    expect(r).toEqual({ reason: "no grounding tool available", missing: ["tool:web-search"] });
  }, 15000);

  it("returns undefined when not abstained", () => {
    expect(projectAbstention({ terminatedBy: "final_answer" })).toBeUndefined();
  }, 15000);

  it("abstention is typed-optional on AgentResult (compile guard)", () => {
    const a: AgentResult["abstention"] = { reason: "x", missing: [] };
    expect(a?.reason).toBe("x");
  }, 15000);
});
