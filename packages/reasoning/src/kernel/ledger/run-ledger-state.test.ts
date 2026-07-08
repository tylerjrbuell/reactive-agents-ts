/**
 * run-ledger-state.test.ts — the ledger ON KernelState (Wave C / task C1).
 *
 * Pins the two acceptance criteria that make the ledger a durable substrate:
 *   1. Resume/replay equivalence — a state carrying a ledger survives the
 *      durable kernel-codec round-trip (deep-equal), so crash-resume carries it.
 *   2. Dual-emit property — for a run's steps, the steps projection is
 *      byte-IDENTICAL to legacy (steps behavior UNCHANGED) AND the ledger
 *      contains the corresponding entries.
 */
import { describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import type { ReasoningStep } from "../../types/index.js";
import type { StepId } from "../../types/step.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
} from "../state/kernel-state.js";
import {
  deserializeKernelState,
  serializeKernelState,
} from "../state/kernel-codec.js";
import { appendEntry, entriesOfKind } from "./run-ledger.js";

function step(
  type: ReasoningStep["type"],
  content: string,
  metadata?: ReasoningStep["metadata"],
): ReasoningStep {
  return {
    id: ulid() as StepId,
    type,
    content,
    timestamp: new Date(),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}

function freshState(): KernelState {
  return initialKernelState({ maxIterations: 20, strategy: "reactive", kernelType: "react" });
}

describe("KernelState.ledger — durable substrate", () => {
  it("initialKernelState seeds an empty ledger", () => {
    expect(freshState().ledger).toEqual([]);
  });

  it("round-trips through the durable kernel-codec (resume/replay equivalence)", () => {
    let state = freshState();
    // Grow via a step writer (tool call + result) AND a directly-appended fact.
    state = transitionState(state, {
      steps: [step("action", 'web-search({"q":"x"})', {
        toolCall: { id: "c1", name: "web-search", arguments: { q: "x" } },
        toolCallId: "c1",
      })],
      iteration: 1,
    });
    state = transitionState(state, {
      ledger: appendEntry(state.ledger, {
        kind: "verdict",
        iteration: 1,
        gate: "terminal",
        verified: true,
        terminatedBy: "final_answer",
      }),
    });
    expect((state.ledger ?? []).length).toBe(2);

    const restored = deserializeKernelState(serializeKernelState(state));
    expect(restored.ledger).toEqual(state.ledger);
    expect(entriesOfKind(restored.ledger, "tool-invocation")[0]?.toolName).toBe("web-search");
    expect(entriesOfKind(restored.ledger, "verdict")[0]?.terminatedBy).toBe("final_answer");
  });

  it("dual-emit: steps projection is byte-identical to legacy AND ledger mirrors it", () => {
    const newSteps: ReasoningStep[] = [
      step("thought", "reasoning"),
      step("action", 'http-get({"url":"u"})', { toolCall: { id: "c2", name: "http-get", arguments: { url: "u" } }, toolCallId: "c2" }),
      step("observation", "body", {
        observationResult: {
          success: true,
          toolName: "http-get",
          displayText: "body",
          category: "http-get",
          resultKind: "data",
          preserveOnCompaction: false,
          trustLevel: "untrusted",
        },
      }),
      step("harness_signal", "⚠️ nudge"),
    ];

    const base = freshState();
    // LEGACY behavior: what steps would be WITHOUT any ledger involvement.
    const legacySteps = [...base.steps, ...newSteps];

    const next = transitionState(base, { steps: [...base.steps, ...newSteps], iteration: 1 });

    // (a) steps byte-identical to legacy — behavior UNCHANGED.
    expect(next.steps).toEqual(legacySteps);

    // (b) ledger contains the corresponding entries (thought is not a ledger fact).
    expect(entriesOfKind(next.ledger, "tool-invocation").map((e) => e.toolName)).toEqual(["http-get"]);
    expect(entriesOfKind(next.ledger, "tool-result").map((e) => e.toolName)).toEqual(["http-get"]);
    expect(entriesOfKind(next.ledger, "harness-signal").map((e) => e.signal)).toEqual(["⚠️ nudge"]);
    expect((next.ledger ?? []).map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("carrying steps forward unchanged adds NO ledger entries (no double-emit)", () => {
    let state = transitionState(freshState(), {
      steps: [step("action", "http-get({})")],
      iteration: 1,
    });
    const sizeAfterFirst = (state.ledger ?? []).length;
    // A transition that carries the SAME steps forward (e.g. a meta-only patch).
    state = transitionState(state, { steps: state.steps, iteration: 2 });
    expect((state.ledger ?? []).length).toBe(sizeAfterFirst);
  });

  it("a transition on a legacy state with no ledger field does not crash", () => {
    const legacy = { ...freshState(), ledger: undefined } as KernelState;
    const next = transitionState(legacy, { steps: [step("harness_signal", "x")], iteration: 1 });
    expect(entriesOfKind(next.ledger, "harness-signal").length).toBe(1);
  });
});
