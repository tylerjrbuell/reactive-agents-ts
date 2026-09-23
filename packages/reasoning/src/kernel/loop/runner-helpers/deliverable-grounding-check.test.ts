import { describe, it, expect } from "bun:test";
import { initialKernelState, transitionState } from "../../state/kernel-state.js";
import { makeStep } from "../../capabilities/sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { evaluateUnconsumedEvidenceGrounding, assembleDeliverable, MIN_MODEL_SYNTHESIS_LENGTH } from "./deliverable.js";

const base = () =>
  initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 10 });

const longThought = (content: string) => content.padEnd(MIN_MODEL_SYNTHESIS_LENGTH, ".");

describe("evaluateUnconsumedEvidenceGrounding (Task 3 Step 1 extraction)", () => {
  it("no unconsumed evidence, no qualifying thought", () => {
    const check = evaluateUnconsumedEvidenceGrounding(base());
    expect(check.hasUnconsumedEvidence).toBe(false);
    expect(check.lastThoughtContent).toBeUndefined();
    expect(check.grounded).toBe(false);
    expect(check.evidence).toBeUndefined();
  });

  it("unconsumed stored evidence exists but no qualifying thought", () => {
    const obs = makeStep("observation", "result body", {
      storedKey: "k1",
      observationResult: makeObservationResult("web-search", true, "result body"),
    });
    let s = transitionState(base(), { steps: [obs] });
    s = { ...s, scratchpad: new Map([["k1", "the full stored evidence text"]]) };
    const check = evaluateUnconsumedEvidenceGrounding(s);
    expect(check.hasUnconsumedEvidence).toBe(true);
    expect(check.lastThoughtContent).toBeUndefined();
    expect(check.grounded).toBe(false);
    expect(check.evidence).toBeUndefined();
  });

  it("thought does NOT contain the unconsumed evidence", () => {
    const obs = makeStep("observation", "result body", {
      storedKey: "k1",
      observationResult: makeObservationResult("web-search", true, "result body"),
    });
    const thought = makeStep("thought", longThought("A completely unrelated synthesis with no overlap"));
    let s = transitionState(base(), { steps: [obs, thought] });
    s = { ...s, scratchpad: new Map([["k1", "the full stored evidence text 42"]]) };
    const check = evaluateUnconsumedEvidenceGrounding(s);
    expect(check.hasUnconsumedEvidence).toBe(true);
    expect(check.lastThoughtContent).toBe(thought.content);
    expect(check.evidence).toBe("the full stored evidence text 42");
    expect(check.grounded).toBe(false);
  });

  it("thought DOES contain the unconsumed evidence verbatim (whitespace-normalized)", () => {
    const obs = makeStep("observation", "result body", {
      storedKey: "k1",
      observationResult: makeObservationResult("web-search", true, "result body"),
    });
    const evidenceText = "the   full\nstored evidence   text 42";
    const thought = makeStep(
      "thought",
      longThought(`Here is my synthesis: ${evidenceText} -- that concludes the answer`),
    );
    let s = transitionState(base(), { steps: [obs, thought] });
    s = { ...s, scratchpad: new Map([["k1", evidenceText]]) };
    const check = evaluateUnconsumedEvidenceGrounding(s);
    expect(check.hasUnconsumedEvidence).toBe(true);
    expect(check.grounded).toBe(true);
    expect(check.evidence).toBe(evidenceText);
  });

  it("assembleDeliverable output is unaffected by the extraction (regression pin)", () => {
    const obs1 = makeStep("observation", "result body 1", {
      storedKey: "k1",
      observationResult: makeObservationResult("web-search", true, "result body 1"),
    });
    const obs2 = makeStep("observation", "result body 2", {
      observationResult: makeObservationResult("web-search", true, "result body 2"),
    });
    const ungroundedThought = makeStep("thought", longThought("Totally invented synthesis, no overlap at all"));
    let s = transitionState(base(), {
      steps: [obs1, obs2, ungroundedThought],
      toolsUsed: new Set(["web-search"]),
    });
    s = { ...s, scratchpad: new Map([["k1", "evidence body 1 exact text"]]) };

    const d = assembleDeliverable(s);
    expect(d.source).not.toBe("model_synthesis");
  });
});
