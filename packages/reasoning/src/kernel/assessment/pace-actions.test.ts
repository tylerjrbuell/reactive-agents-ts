// File: src/kernel/assessment/pace-actions.test.ts
//
// E3 — the pace-band actuator selectors. Each is OPT-IN behind the long-horizon
// profile: with `horizonActive = false` EVERY selector returns its neutral value
// (undefined / false) so the actuator keeps its byte-identical legacy path. These
// tests pin BOTH: (a) flag-off is always neutral, and (b) flag-on reads the
// correct band + names the outstanding requirements.

import { describe, expect, it } from "bun:test";
import type { PaceBand, RunAssessment } from "./assess.js";
import type { RunContract, TaskRequirement } from "../contract/run-contract.js";
import {
  downshiftBudgetBand,
  outstandingDescriptions,
  shouldForceTerminalSynthesis,
  triageSteerText,
} from "./pace-actions.js";

function assessment(overrides: {
  band?: PaceBand;
  burnRatio?: number;
  outstanding?: readonly string[];
}): RunAssessment {
  return {
    requirements: { satisfied: [], outstanding: overrides.outstanding ?? [], blocked: [] },
    deliverables: { produced: [], missing: [] },
    evidenceDelta: 0,
    phase: "gather",
    pace: {
      burnRatio: overrides.burnRatio ?? 0,
      projectedCompletion: 0,
      band: overrides.band ?? "green",
    },
    health: {
      recentFailures: 0,
      consecutiveFailures: 0,
      repeatWaste: 0,
      stuckSignals: 0,
      contradictions: 0,
      iterationsSinceEvidence: 0,
      failureArgVariety: 0,
    },
  };
}

// A real, actionable requirement (deterministic acceptance) — the kind triage/
// terminal steering should name. The self-critique floor is exercised separately.
function req(id: string, description: string): TaskRequirement {
  return {
    id,
    kind: "question-answered",
    spec: { description, acceptance: "deterministic" },
    weight: 1,
  };
}

// The always-outstanding self-critique "answer" floor (F3): assess() can never
// mark a condition-less requirement met, so it must be EXCLUDED from steer text.
function selfCritiqueReq(id: string, description: string): TaskRequirement {
  return {
    id,
    kind: "question-answered",
    spec: { description, acceptance: "self-critique" },
    weight: 1,
  };
}

function contract(requirements: readonly TaskRequirement[]): RunContract {
  return {
    requirements,
    deliverables: [],
    constraints: [],
    horizon: "long",
    acceptance: { tiers: ["self-critique"], stakes: "standard" },
    postConditions: [],
  };
}

describe("pace-actions — flag OFF is always neutral (byte-identical legacy path)", () => {
  const c = contract([req("r1", "answer question one")]);
  const terminal = assessment({ band: "terminal", burnRatio: 0.97, outstanding: ["r1"] });
  const triage = assessment({ band: "triage", burnRatio: 0.85, outstanding: ["r1"] });
  const economize = assessment({ band: "economize", burnRatio: 0.7, outstanding: ["r1"] });

  it("downshiftBudgetBand OFF → undefined for every band", () => {
    expect(downshiftBudgetBand(false, economize)).toBeUndefined();
    expect(downshiftBudgetBand(false, triage)).toBeUndefined();
    expect(downshiftBudgetBand(false, terminal)).toBeUndefined();
  });
  it("triageSteerText OFF → undefined", () => {
    expect(triageSteerText(false, c, triage)).toBeUndefined();
  });
  it("shouldForceTerminalSynthesis OFF → false", () => {
    expect(shouldForceTerminalSynthesis(false, terminal)).toBe(false);
  });
  it("undefined assessment OFF → neutral everywhere", () => {
    expect(downshiftBudgetBand(false, undefined)).toBeUndefined();
    expect(triageSteerText(false, c, undefined)).toBeUndefined();
    expect(shouldForceTerminalSynthesis(false, undefined)).toBe(false);
  });
});

describe("downshiftBudgetBand — economize actuator (ON)", () => {
  it("green band → undefined (no downshift below the economize threshold)", () => {
    expect(downshiftBudgetBand(true, assessment({ band: "green" }))).toBeUndefined();
  });
  it("economize band → 'economize'", () => {
    expect(downshiftBudgetBand(true, assessment({ band: "economize" }))).toBe("economize");
  });
  it("triage band → 'triage' (economize-or-worse keeps conserving)", () => {
    expect(downshiftBudgetBand(true, assessment({ band: "triage" }))).toBe("triage");
  });
  it("terminal band → 'terminal'", () => {
    expect(downshiftBudgetBand(true, assessment({ band: "terminal" }))).toBe("terminal");
  });
  it("undefined assessment ON → undefined", () => {
    expect(downshiftBudgetBand(true, undefined)).toBeUndefined();
  });
});

describe("triageSteerText — triage actuator (ON)", () => {
  const c = contract([req("r1", "answer question one"), req("r2", "produce ./report.md")]);

  it("triage band + outstanding → names the outstanding requirement DESCRIPTIONS", () => {
    const steer = triageSteerText(
      true,
      c,
      assessment({ band: "triage", burnRatio: 0.85, outstanding: ["r1", "r2"] }),
    );
    expect(steer).toBeDefined();
    expect(steer).toContain("answer question one");
    expect(steer).toContain("produce ./report.md");
    // Reports burn context so the model understands the urgency.
    expect(steer).toContain("85%");
  });

  it("fires ONLY in the triage band (economize/terminal → undefined)", () => {
    expect(
      triageSteerText(true, c, assessment({ band: "economize", outstanding: ["r1"] })),
    ).toBeUndefined();
    expect(
      triageSteerText(true, c, assessment({ band: "terminal", outstanding: ["r1"] })),
    ).toBeUndefined();
  });

  it("triage band with NOTHING outstanding → undefined (no empty steer)", () => {
    expect(
      triageSteerText(true, c, assessment({ band: "triage", outstanding: [] })),
    ).toBeUndefined();
  });

  it("an outstanding id with no matching requirement falls back to the raw id", () => {
    const steer = triageSteerText(
      true,
      c,
      assessment({ band: "triage", burnRatio: 0.9, outstanding: ["r1", "ghost"] }),
    );
    expect(steer).toContain("answer question one");
    expect(steer).toContain("ghost");
  });
});

describe("shouldForceTerminalSynthesis — terminal actuator (ON)", () => {
  it("terminal band → true", () => {
    expect(shouldForceTerminalSynthesis(true, assessment({ band: "terminal" }))).toBe(true);
  });
  it("triage/economize/green band → false", () => {
    expect(shouldForceTerminalSynthesis(true, assessment({ band: "triage" }))).toBe(false);
    expect(shouldForceTerminalSynthesis(true, assessment({ band: "economize" }))).toBe(false);
    expect(shouldForceTerminalSynthesis(true, assessment({ band: "green" }))).toBe(false);
  });
});

describe("outstandingDescriptions — shared pure helper", () => {
  const c = contract([req("r1", "answer question one"), req("r2", "produce ./report.md")]);
  it("maps outstanding ids to their contract descriptions in order", () => {
    expect(
      outstandingDescriptions(c, assessment({ outstanding: ["r2", "r1"] })),
    ).toEqual(["produce ./report.md", "answer question one"]);
  });

  it("F3: excludes the self-critique answer floor, keeps real requirements", () => {
    const withFloor = contract([
      req("r2", "produce ./report.md"),
      selfCritiqueReq("answer", "produce a substantive answer that addresses the task"),
    ]);
    // The floor is always outstanding; it must NOT appear in the steer text.
    expect(
      outstandingDescriptions(withFloor, assessment({ outstanding: ["r2", "answer"] })),
    ).toEqual(["produce ./report.md"]);
  });

  it("F3: an unmatched id still falls back to the raw id (no signal dropped)", () => {
    expect(
      outstandingDescriptions(c, assessment({ outstanding: ["r1", "ghost"] })),
    ).toEqual(["answer question one", "ghost"]);
  });
});
