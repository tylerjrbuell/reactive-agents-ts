/**
 * terminal-gate.test.ts — pins the ordered pipeline + both documented
 * divergences + the named bench-regression shapes:
 *   - F1 (cogito:8b 2026-07-02): parametric guess with zero substantive
 *     grounding → redirect once, abstain second.
 *   - B1 (qwen3:14b rw-2, trace 01KWXQK2D001): correct grounded answer at
 *     iter 1, silently declined exit → redirect once names the gap, second
 *     substantive end_turn ACCEPTED.
 *   - P3 (plan-execute FM#4): SATISFIED reflection with required tools
 *     unexecuted → redirect once, ABSTAIN second (not accept).
 */
import { describe, expect, it } from "bun:test";
import {
  evaluateTerminalGate,
  PLAN_EXECUTE_SATISFIED,
  type TerminalGateInput,
} from "./terminal-gate.js";

const baseInput = (over: Partial<TerminalGateInput>): TerminalGateInput => ({
  terminatedBy: "end_turn",
  requiredTools: [],
  coveredTools: new Set<string>(),
  hasSubstantiveGrounding: true,
  redirectsSpent: { grounding: 0, coverage: 0, checker: 0 },
  coverageExhaustionPolicy: "accept",
  buildGroundingGuidance: () => "GROUNDING-GUIDANCE",
  buildCoverageGuidance: (missing) => `COVERAGE-GUIDANCE: ${missing.join(",")}`,
  ...over,
});

describe("exemption", () => {
  it.each([
    "harness_deliverable",
    "low_delta_guard",
    "loop_detected",
    "abstained",
    "awaiting-approval",
    "awaiting-interaction",
    "max_iterations",
    "dispatcher-early-stop",
  ])("accepts non-answer terminal %s untouched", (reason) => {
    const d = evaluateTerminalGate(
      baseInput({
        terminatedBy: reason,
        requiredTools: ["web-search"],
        hasSubstantiveGrounding: false,
      }),
    );
    expect(d).toEqual({ decision: "accept", check: "exemption" });
  });

  it("final_answer_tool is exempt from grounding AND coverage (Lever-8)", () => {
    const d = evaluateTerminalGate(
      baseInput({
        terminatedBy: "final_answer_tool",
        requiredTools: ["web-search", "file-write"],
        hasSubstantiveGrounding: false,
      }),
    );
    expect(d.decision).toBe("accept");
  });
});

describe("grounding (F1)", () => {
  const f1Shape = {
    terminatedBy: "end_turn",
    requiredTools: ["web-search"],
    hasSubstantiveGrounding: false,
  };

  it("cogito shape: zero substantive grounding → redirect once with guidance", () => {
    const d = evaluateTerminalGate(baseInput(f1Shape));
    expect(d).toEqual({
      decision: "redirect",
      check: "grounding",
      guidance: "GROUNDING-GUIDANCE",
      missing: ["web-search"],
    });
  });

  it("redirect spent → abstain (runner §7.5 conversion target)", () => {
    const d = evaluateTerminalGate(
      baseInput({
        ...f1Shape,
        redirectsSpent: { grounding: 1, coverage: 0, checker: 0 },
      }),
    );
    expect(d.decision).toBe("abstain");
    expect(d.check).toBe("grounding");
  });

  it("no requiredTools → grounding vacuous, accept", () => {
    const d = evaluateTerminalGate(
      baseInput({ requiredTools: [], hasSubstantiveGrounding: false }),
    );
    expect(d.decision).toBe("accept");
  });

  it("any substantive grounding skips F1 even with required tools missing (falls to coverage)", () => {
    const d = evaluateTerminalGate(
      baseInput({
        requiredTools: ["web-search", "file-write"],
        coveredTools: new Set(["web-search"]),
        hasSubstantiveGrounding: true,
      }),
    );
    expect(d.decision).toBe("redirect");
    expect(d.check).toBe("coverage");
    expect(d).toMatchObject({ missing: ["file-write"] });
  });
});

describe("coverage (B1 kernel semantics: exhaustion → accept)", () => {
  const b1Shape = {
    terminatedBy: "end_turn",
    requiredTools: ["file-read", "file-write"],
    coveredTools: new Set(["file-read"]),
    hasSubstantiveGrounding: true,
    coverageExhaustionPolicy: "accept" as const,
  };

  it("rw-2 shape: first violation names the gap (no silent wall)", () => {
    const d = evaluateTerminalGate(baseInput(b1Shape));
    expect(d).toEqual({
      decision: "redirect",
      check: "coverage",
      guidance: "COVERAGE-GUIDANCE: file-write",
      missing: ["file-write"],
    });
  });

  it("rw-2 shape: second substantive end_turn ACCEPTED (no 420s loop)", () => {
    const d = evaluateTerminalGate(
      baseInput({
        ...b1Shape,
        redirectsSpent: { grounding: 0, coverage: 1, checker: 0 },
      }),
    );
    expect(d.decision).toBe("accept");
  });

  it("all required covered → accept", () => {
    const d = evaluateTerminalGate(
      baseInput({
        ...b1Shape,
        coveredTools: new Set(["file-read", "file-write"]),
      }),
    );
    expect(d.decision).toBe("accept");
  });
});

describe("coverage (P3 plan-execute semantics: exhaustion → abstain)", () => {
  const p3Shape = {
    terminatedBy: PLAN_EXECUTE_SATISFIED,
    requiredTools: ["web-search"],
    coveredTools: new Set<string>(),
    hasSubstantiveGrounding: true, // other tools completed; required one missing
    coverageExhaustionPolicy: "abstain" as const,
  };

  it("SATISFIED with required unexecuted → redirect once", () => {
    const d = evaluateTerminalGate(baseInput(p3Shape));
    expect(d.decision).toBe("redirect");
    expect(d.check).toBe("coverage");
  });

  it("repeat violation → abstain honestly (never ships ungrounded SATISFIED)", () => {
    const d = evaluateTerminalGate(
      baseInput({
        ...p3Shape,
        redirectsSpent: { grounding: 0, coverage: 1, checker: 0 },
      }),
    );
    expect(d).toMatchObject({
      decision: "abstain",
      check: "coverage",
      missing: ["web-search"],
    });
  });
});

describe("checker slot (P6b)", () => {
  it("no checker configured → inert, accept", () => {
    const d = evaluateTerminalGate(baseInput({}));
    expect(d.decision).toBe("accept");
  });

  it("checker approves → accept with check=checker", () => {
    const d = evaluateTerminalGate(
      baseInput({ checkerVerdict: { approved: true, critique: "" } }),
    );
    expect(d).toEqual({ decision: "accept", check: "checker" });
  });

  it("checker disapproves → one redirect carrying the critique", () => {
    const d = evaluateTerminalGate(
      baseInput({ checkerVerdict: { approved: false, critique: "sum is wrong" } }),
    );
    expect(d).toEqual({
      decision: "redirect",
      check: "checker",
      guidance: "sum is wrong",
      missing: [],
    });
  });

  it("repeat disapproval → ship WITH critique recorded, never a loop", () => {
    const d = evaluateTerminalGate(
      baseInput({
        checkerVerdict: { approved: false, critique: "still wrong" },
        redirectsSpent: { grounding: 0, coverage: 0, checker: 1 },
      }),
    );
    expect(d).toEqual({
      decision: "accept",
      check: "checker",
      checkerCritique: "still wrong",
    });
  });

  it("checker runs only after grounding passes — F1 redirect wins", () => {
    const d = evaluateTerminalGate(
      baseInput({
        requiredTools: ["web-search"],
        hasSubstantiveGrounding: false,
        checkerVerdict: { approved: false, critique: "irrelevant here" },
      }),
    );
    expect(d.check).toBe("grounding");
  });
});

describe("ordering invariants", () => {
  it("grounding outranks coverage: both violated → grounding redirect first", () => {
    const d = evaluateTerminalGate(
      baseInput({
        requiredTools: ["web-search"],
        hasSubstantiveGrounding: false,
        coveredTools: new Set<string>(),
      }),
    );
    expect(d.check).toBe("grounding");
  });

  it("B1 exhaustion falls through to checker, not straight to accept", () => {
    const d = evaluateTerminalGate(
      baseInput({
        requiredTools: ["file-write"],
        coveredTools: new Set<string>(),
        redirectsSpent: { grounding: 0, coverage: 1, checker: 0 },
        coverageExhaustionPolicy: "accept",
        checkerVerdict: { approved: false, critique: "answer incomplete" },
      }),
    );
    expect(d).toMatchObject({ decision: "redirect", check: "checker" });
  });
});
