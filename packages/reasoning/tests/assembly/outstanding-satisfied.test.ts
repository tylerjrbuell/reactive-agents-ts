// Run: bun test packages/reasoning/tests/assembly/outstanding-satisfied.test.ts
//
// A live steering bug, and the purest instance of the wiring audit's disease
// (2026-07-09): producer and consumer both exist and were never connected.
//
// `standing-frame.ts` renders the "Outstanding requirements:" block that the
// model reads every think turn under the long-horizon profile. It derived its
// satisfied-set from `requirement` ledger entries:
//
//     const satisfied = satisfiedRequirementIds(input.ledger)
//     const outstanding = contract.requirements.filter(r => !satisfied.has(r.id))
//
// But NOTHING in production ever mints a `requirement` entry (kind declared in
// run-ledger.ts:97, zero writers). So `satisfied` was ALWAYS empty, and the model
// was told every requirement was still outstanding — including the ones it had
// already finished. On a 50-iteration research run, "write report.md" stays in
// the prompt long after report.md was written.
//
// Meanwhile `assess()` already computes requirement satisfaction correctly, from
// post-conditions and artifact facts, every single iteration — and
// `StandingFrameInput.assessment` was already threaded through
// `from-kernel-state` → `project` → `system-prompt`. The projector simply never
// read it for this.
//
// DAG-clean: Assessment is upstream of the Projector. The frame READS the
// already-computed assessment; it does not recompute satisfaction.

import { describe, expect, it } from "bun:test";
import { renderStandingFrame } from "../../src/assembly/standing-frame.js";
import { project } from "../../src/assembly/project.js";
import { fromKernelState } from "../../src/assembly/from-kernel-state.js";
import type { KernelState } from "../../src/kernel/state/kernel-state.js";
import type { RunAssessment } from "../../src/kernel/assessment/assess.js";
import type { RunContract, TaskRequirement } from "../../src/kernel/contract/run-contract.js";

const req = (id: string, description: string): TaskRequirement => ({
  id,
  kind: "question-answered",
  spec: { description, acceptance: "deterministic" },
  weight: 1,
});

const contract = (reqs: readonly TaskRequirement[]): RunContract => ({
  requirements: reqs,
  deliverables: [],
  constraints: [],
  horizon: "long",
  acceptance: { tiers: ["deterministic"], stakes: "standard" },
  postConditions: [],
});

const assessment = (over: {
  satisfied?: readonly string[];
  outstanding?: readonly string[];
  blocked?: readonly string[];
}): RunAssessment =>
  ({
    requirements: {
      satisfied: over.satisfied ?? [],
      outstanding: over.outstanding ?? [],
      blocked: over.blocked ?? [],
    },
    deliverables: { produced: [], missing: [] },
    evidenceDelta: 0,
    phase: "gather",
    pace: { burnRatio: 0.2, projectedCompletion: 0.2, band: "green" },
    health: {
      recentFailures: 0,
      consecutiveFailures: 0,
      repeatWaste: 0,
      stuckSignals: 0,
      contradictions: 0,
      iterationsSinceEvidence: 0,
      failureArgVariety: 0,
    },
  }) as RunAssessment;

const outstandingText = (frame: { sections: readonly { name: string; text: string }[] }) =>
  frame.sections.find((s) => s.name === "outstanding")?.text;

const C = contract([req("r1", "gather the six sources"), req("r2", "write report.md")]);

describe("standing frame — outstanding must reflect what the run ACTUALLY finished", () => {
  it("BUG: a satisfied requirement must not be re-listed as outstanding", () => {
    // The assessment says r2 is done. Before the fix, `satisfied` came only from
    // (never-minted) ledger entries, so BOTH requirements were re-listed and the
    // model was told to write a report it had already written.
    const frame = renderStandingFrame({
      contract: C,
      longHorizon: true,
      assessment: assessment({ satisfied: ["r2"], outstanding: ["r1"] }),
    });
    const text = outstandingText(frame) ?? "";
    expect(text).toContain("gather the six sources");
    expect(text).not.toContain("write report.md");
  });

  it("all requirements satisfied → no outstanding section at all", () => {
    const frame = renderStandingFrame({
      contract: C,
      longHorizon: true,
      assessment: assessment({ satisfied: ["r1", "r2"], outstanding: [] }),
    });
    expect(outstandingText(frame)).toBeUndefined();
  });

  it("nothing satisfied → both still listed (the steer still works)", () => {
    const frame = renderStandingFrame({
      contract: C,
      longHorizon: true,
      assessment: assessment({ outstanding: ["r1", "r2"] }),
    });
    const text = outstandingText(frame) ?? "";
    expect(text).toContain("gather the six sources");
    expect(text).toContain("write report.md");
  });

  it("the section's refs list only the still-outstanding ids", () => {
    const frame = renderStandingFrame({
      contract: C,
      longHorizon: true,
      assessment: assessment({ satisfied: ["r2"], outstanding: ["r1"] }),
    }) as { sections: readonly { name: string; refs?: readonly string[] }[] };
    const refs = frame.sections.find((s) => s.name === "outstanding")?.refs;
    expect(refs).toEqual(["r1"]);
  });

  it("no assessment → no outstanding section (the profile that shows it is assessment-selected)", () => {
    // `selectProfile` keys off `assessment.phase`; absent an assessment the
    // default profile applies and the section is not rendered at all. So the
    // fix cannot regress a run that has no assessment — there is nothing to
    // render for it.
    const frame = renderStandingFrame({ contract: C, longHorizon: true });
    expect(outstandingText(frame)).toBeUndefined();
  });

  it("without the long-horizon profile there is no outstanding section (default path unchanged)", () => {
    const frame = renderStandingFrame({
      contract: C,
      assessment: assessment({ satisfied: ["r2"], outstanding: ["r1"] }),
    });
    expect(outstandingText(frame)).toBeUndefined();
  });
});

// ─── The WIRING, at the boundary the model actually sees ─────────────────────
//
// The tests above pin `renderStandingFrame`. They would still pass if the
// projector stopped handing it the assessment. This one drives the real
// `fromKernelState → project` chain and asserts on the assembled systemPrompt —
// the string the LLM receives.

const PROFILE = { maxTokens: 32_768, tier: "mid" } as never;

const stateWith = (a: RunAssessment): KernelState =>
  ({
    status: "thinking",
    iteration: 3,
    steps: [],
    messages: [{ role: "user", content: "research and report" }],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    meta: { horizonProfile: "long", runContract: C, assessment: a, maxIterations: 40 },
  }) as unknown as KernelState;

describe("WIRING: a finished requirement disappears from the real system prompt", () => {
  it("the prompt names only what is still outstanding", () => {
    const { request } = project(
      fromKernelState(
        stateWith(assessment({ satisfied: ["r2"], outstanding: ["r1"] })),
        PROFILE,
        { system: "" },
        { schemas: [] },
        "research and report",
      ),
    );
    expect(request.systemPrompt).toContain("Outstanding requirements:");
    expect(request.systemPrompt).toContain("gather the six sources");
    // The model must NOT be told to write a report it already wrote.
    expect(request.systemPrompt).not.toContain("write report.md");
  });

  it("with nothing satisfied, the prompt still names both", () => {
    const { request } = project(
      fromKernelState(
        stateWith(assessment({ outstanding: ["r1", "r2"] })),
        PROFILE,
        { system: "" },
        { schemas: [] },
        "research and report",
      ),
    );
    expect(request.systemPrompt).toContain("gather the six sources");
    expect(request.systemPrompt).toContain("write report.md");
  });
});
