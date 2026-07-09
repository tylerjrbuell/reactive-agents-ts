import { describe, it, expect } from "bun:test";
import {
  renderStandingFrame,
  selectProfile,
  DEFAULT_PROFILE,
  PHASE_PROFILES,
  type StandingFrameInput,
} from "../../src/assembly/standing-frame.js";
import type { RunContract } from "../../src/kernel/contract/run-contract.js";
import type { RunLedger } from "../../src/kernel/ledger/run-ledger.js";
import type { RunAssessment, RunPhase } from "../../src/kernel/assessment/assess.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const contract: RunContract = {
  requirements: [
    { id: "r1", kind: "question-answered", spec: { description: "Answer Q1", acceptance: "checker" }, weight: 1 },
    { id: "r2", kind: "artifact-produced", spec: { description: "Write report.md", acceptance: "deterministic" }, weight: 2 },
  ],
  deliverables: [],
  constraints: [],
  horizon: "long",
  acceptance: { tiers: ["checker"], stakes: "standard" },
  postConditions: [],
};

const handoffLedger: RunLedger = [
  {
    seq: 0,
    iteration: 3,
    kind: "handoff",
    from: "reactive",
    to: "reflexion",
    summary: "Strategy Switch Handoff (switch #1):\nPrevious strategy: reactive\nKey observations:\nweb-search found X is 42",
  },
];

function assessment(phase: RunPhase): RunAssessment {
  return {
    requirements: { satisfied: [], outstanding: ["r1", "r2"], blocked: [] },
    deliverables: { produced: [], missing: [] },
    evidenceDelta: 0,
    phase,
    pace: { burnRatio: 0.1, projectedCompletion: 0.2, band: "green" },
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

// ── priorContext: byte-identical to the retired H1 block ─────────────────────

describe("standing-frame — priorContext (retired H1 patch, byte-identical)", () => {
  it("renders the exact pre-D1 priorContext part text", () => {
    const { sections } = renderStandingFrame({ priorContext: "carry me forward" });
    expect(sections).toHaveLength(1);
    expect(sections[0]!.name).toBe("priorContext");
    // The EXACT pre-D1 text pushed by systemPromptStage (leading \n included).
    expect(sections[0]!.text).toBe("\nPrior context (from earlier work on this task):\ncarry me forward");
  });

  it("no section when priorContext is blank/absent", () => {
    expect(renderStandingFrame({ priorContext: "   " }).sections).toHaveLength(0);
    expect(renderStandingFrame({}).sections).toHaveLength(0);
  });
});

// ── handoff: the D1 witness (switch-blindness) ───────────────────────────────

describe("standing-frame — handoff renders FROM the ledger (audit 03-F5)", () => {
  it("renders a handoff section carrying the summary + ledger provenance", () => {
    const { sections } = renderStandingFrame({ ledger: handoffLedger });
    const handoff = sections.find((s) => s.name === "handoff");
    expect(handoff).toBeDefined();
    expect(handoff!.text).toContain("web-search found X is 42");
    expect(handoff!.text).toContain("reactive → reflexion");
    // Provenance: the ref resolves back to the ledger entry seq.
    expect(handoff!.refs).toEqual(["ledger://handoff/0"]);
  });

  it("DORMANT when the ledger carries no handoff (byte-identical pre-D1)", () => {
    const empty: RunLedger = [{ seq: 0, iteration: 0, kind: "harness-signal", signal: "x" }];
    expect(renderStandingFrame({ ledger: empty }).sections.find((s) => s.name === "handoff")).toBeUndefined();
  });
});

// ── contract.outstanding: gated behind the long-horizon profile ──────────────

describe("standing-frame — contract.outstanding goal frame (profile-gated)", () => {
  it("DEFAULT profile does NOT render outstanding (byte-identical)", () => {
    const input: StandingFrameInput = { contract, assessment: assessment("gather"), longHorizon: false };
    expect(renderStandingFrame(input).sections.find((s) => s.name === "outstanding")).toBeUndefined();
  });

  it("long-horizon profile renders outstanding requirements as the standing frame", () => {
    const input: StandingFrameInput = { contract, assessment: assessment("gather"), longHorizon: true };
    const out = renderStandingFrame(input).sections.find((s) => s.name === "outstanding");
    expect(out).toBeDefined();
    expect(out!.text).toContain("Outstanding requirements:");
    expect(out!.text).toContain("[r1] Answer Q1");
    expect(out!.text).toContain("[r2] Write report.md");
    expect(out!.refs).toEqual(["r1", "r2"]);
  });

  it("drops requirements the ledger records as satisfied", () => {
    const ledger: RunLedger = [
      { seq: 0, iteration: 1, kind: "requirement", requirementId: "r1", status: "satisfied", evidenceRef: "_tool_result_1" },
    ];
    const out = renderStandingFrame({ contract, assessment: assessment("synthesize"), longHorizon: true, ledger }).sections.find(
      (s) => s.name === "outstanding",
    );
    expect(out!.refs).toEqual(["r2"]);
    expect(out!.text).not.toContain("[r1]");
  });

  it("synthesize phase steers toward producing deliverables", () => {
    const out = renderStandingFrame({ contract, assessment: assessment("synthesize"), longHorizon: true }).sections.find(
      (s) => s.name === "outstanding",
    );
    expect(out!.text).toContain("Synthesize NOW");
  });
});

// ── profile selection ─────────────────────────────────────────────────────────

describe("standing-frame — selectProfile", () => {
  it("default profile without the long-horizon flag", () => {
    expect(selectProfile({ assessment: assessment("gather"), longHorizon: false })).toBe(DEFAULT_PROFILE);
    expect(selectProfile({ assessment: assessment("gather") })).toBe(DEFAULT_PROFILE);
  });
  it("phase profile under the long-horizon flag", () => {
    expect(selectProfile({ assessment: assessment("verify"), longHorizon: true })).toBe(PHASE_PROFILES.verify);
  });
  it("default profile under long-horizon but no assessment", () => {
    expect(selectProfile({ longHorizon: true })).toBe(DEFAULT_PROFILE);
  });
});
