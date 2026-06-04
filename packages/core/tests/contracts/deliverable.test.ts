// File: tests/contracts/deliverable.test.ts
import { describe, it, expect } from "bun:test";
import {
  deliverableToContent,
  modelSynthesisDeliverable,
  toolArtifactDeliverable,
  harnessSynthesisDeliverable,
  sentinelDeliverable,
} from "../../src/contracts/deliverable.js";
import type {
  Deliverable,
  ValidatedObservation,
  ThoughtStepRef,
} from "../../src/contracts/deliverable.js";

describe("Deliverable — typed channel into state.output", () => {
  it("model_synthesis carries the thought + chars", () => {
    const thought: ThoughtStepRef = {
      type: "thought",
      content: "The answer is 42.",
      iteration: 3,
    };
    const d: Deliverable = modelSynthesisDeliverable(thought);
    expect(d.source).toBe("model_synthesis");
    if (d.source === "model_synthesis") {
      expect(d.chars).toBe(thought.content.length);
      expect(deliverableToContent(d)).toBe("The answer is 42.");
    }
  });

  it("tool_artifact requires the ValidatedObservation success invariant", () => {
    const obs: ValidatedObservation = {
      _validated: "tool-success",
      toolName: "file-read",
      callId: "c1",
      content: "report content",
      invariant: { success: true, toolInState: true },
    };
    const d: Deliverable = { source: "tool_artifact", observation: obs };
    expect(deliverableToContent(d)).toBe("report content");
  });

  it("harness_synthesis joins multiple validated observations + records synthesis call", () => {
    const obs = (i: number): ValidatedObservation => ({
      _validated: "tool-success",
      toolName: "file-read",
      callId: `c${i}`,
      content: `chunk ${i}`,
      invariant: { success: true, toolInState: true },
    });
    const d: Deliverable = {
      source: "harness_synthesis",
      assembled: [obs(1), obs(2), obs(3)],
      synthesisCall: { callId: "synth-1" },
    };
    expect(deliverableToContent(d)).toBe("chunk 1\n\nchunk 2\n\nchunk 3");
  });

  it("toolArtifactDeliverable constructs a tool_artifact from a validated observation", () => {
    const obs: ValidatedObservation = {
      _validated: "tool-success",
      toolName: "file-read",
      callId: "c1",
      content: "report content",
      invariant: { success: true, toolInState: true },
    };
    const d: Deliverable = toolArtifactDeliverable(obs);
    expect(d.source).toBe("tool_artifact");
    if (d.source === "tool_artifact") {
      expect(d.observation).toBe(obs);
    }
    expect(deliverableToContent(d)).toBe("report content");
  });

  it("harnessSynthesisDeliverable joins assembled observations + records synthesis call", () => {
    const obs = (i: number): ValidatedObservation => ({
      _validated: "tool-success",
      toolName: "file-read",
      callId: `c${i}`,
      content: `chunk ${i}`,
      invariant: { success: true, toolInState: true },
    });
    const d: Deliverable = harnessSynthesisDeliverable(
      [obs(1), obs(2)],
      { callId: "synth-1" },
    );
    expect(d.source).toBe("harness_synthesis");
    if (d.source === "harness_synthesis") {
      expect(d.synthesisCall.callId).toBe("synth-1");
      expect(d.assembled).toHaveLength(2);
    }
    expect(deliverableToContent(d)).toBe("chunk 1\n\nchunk 2");
  });

  it("harnessSynthesisDeliverable omits synthesisCall for the raw-concat (no-LLM) path", () => {
    const obs = (i: number): ValidatedObservation => ({
      _validated: "tool-success",
      toolName: "file-read",
      callId: `c${i}`,
      content: `chunk ${i}`,
      invariant: { success: true, toolInState: true },
    });
    const d: Deliverable = harnessSynthesisDeliverable([obs(1), obs(2)]);
    expect(d.source).toBe("harness_synthesis");
    if (d.source === "harness_synthesis") {
      expect(d.synthesisCall).toBeUndefined();
      expect(d.assembled).toHaveLength(2);
    }
    expect(deliverableToContent(d)).toBe("chunk 1\n\nchunk 2");
  });

  it("harness_synthesis returns LLM-synthesized prose when present (S11 — truthful tag, not model_synthesis)", () => {
    const obs = (i: number): ValidatedObservation => ({
      _validated: "tool-success",
      toolName: "file-read",
      callId: `c${i}`,
      content: `raw chunk ${i}`,
      invariant: { success: true, toolInState: true },
    });
    const d: Deliverable = harnessSynthesisDeliverable(
      [obs(1), obs(2)],
      { callId: "synth-1" },
      "Cleaned synthesized prose.",
    );
    expect(d.source).toBe("harness_synthesis");
    if (d.source === "harness_synthesis") {
      expect(d.synthesized).toBe("Cleaned synthesized prose.");
      expect(d.synthesisCall?.callId).toBe("synth-1");
    }
    // Returns the synthesized prose, NOT the joined raw bodies.
    expect(deliverableToContent(d)).toBe("Cleaned synthesized prose.");
  });

  it("sentinel deliverables render structured markers", () => {
    expect(deliverableToContent(sentinelDeliverable("no_substantive_output"))).toBe("Task complete.");
    expect(
      deliverableToContent(sentinelDeliverable("max_iterations_no_artifacts")),
    ).toBe("Task did not converge within the iteration budget.");
  });

  it("ValidatedObservation cannot be widened from a dispatch-rejection observation (compile-time)", () => {
    // The _validated discriminator pins this — a dispatch-rejection has no
    // _validated field. TypeScript blocks assignment without explicit cast.
    // This test is the runtime witness: only canonical ValidatedObservations
    // satisfy the shape; anything else is a structural mismatch.
    const valid: ValidatedObservation = {
      _validated: "tool-success",
      toolName: "x",
      callId: "y",
      content: "z",
      invariant: { success: true, toolInState: true },
    };
    expect(valid._validated).toBe("tool-success");

    // A would-be rejection-shaped value (no _validated) is structurally
    // distinct. If you saw this in code: it cannot become a Deliverable.
    const rejection = {
      kind: "tool-rejection" as const,
      content: "Tool call used unavailable name(s): code-execute",
    };
    expect("_validated" in rejection).toBe(false);
  });
});
