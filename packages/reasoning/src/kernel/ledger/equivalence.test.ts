/**
 * equivalence.test.ts — C1 containment invariant (ratified 2026-07-22,
 * wiki/Decisions/2026-07-22-c1-equivalence-invariant.md).
 *
 * The pinned relation is `projectStepsToLedger(steps) ⊆ state.ledger` — every
 * step-derived entry appears in the ledger, in seq order. It is a SUBSET, not
 * a general equality: in production the ledger is a strict SUPERSET carrying
 * non-step facts seeded through the same chokepoint via `patch.ledger`
 * (`artifact`/`requirement`/`verdict`/`claim`), which `projectStepsToLedger`
 * never emits. This test scripts a STEP-ONLY transition sequence with no
 * `patch.ledger` seeding, so for that script the extra-facts set is empty and
 * the two sides are byte-equal — the subset relation with an empty remainder,
 * NOT a claim that ledger == projection(steps) after arbitrary transitions.
 * This is the pinned form of 09-C1's "steps becomes a projection" — authority
 * lives in "no step grows without its derived entry + single write path",
 * not in a physical write-direction flip.
 *
 * Imports/harness match the sibling `run-ledger-state.test.ts` and
 * `step-projection.test.ts` (the established conventions for this module):
 * `initialKernelState`/`transitionState` from `../state/kernel-state.js`,
 * `projectStepsToLedger` from `./step-projection.js`, and a local `step()`
 * fixture using `ulid()` + `new Date()` (ReasoningStep.timestamp is a Date,
 * not a number).
 */
import { describe, expect, it } from "bun:test";
import { ulid } from "ulid";
import type { ReasoningStep } from "../../types/index.js";
import type { StepId } from "../../types/step.js";
import { initialKernelState, transitionState, type KernelState } from "../state/kernel-state.js";
import { projectStepsToLedger } from "./step-projection.js";

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

describe("C1 equivalence invariant", () => {
  it("incremental dual-emit equals from-scratch projection over the recorded (steps, iteration) script", () => {
    let state = freshState();
    const script: ReasoningStep[][] = [
      [step("thought", "think-1")],
      [
        step("action", "file-read(a.txt)", {
          toolCall: { id: "c1", name: "file-read", arguments: { path: "a.txt" } },
          toolCallId: "c1",
        }),
      ],
      [
        step("observation", "contents-of-a", {
          toolCallId: "c1",
          observationResult: {
            success: true,
            toolName: "file-read",
            displayText: "contents-of-a",
            category: "file-read",
            resultKind: "data",
            preserveOnCompaction: false,
            trustLevel: "untrusted",
          },
        }),
      ],
      [step("harness_signal", "budget-nudge")],
    ];

    let iteration = 0;
    for (const newSteps of script) {
      iteration += 1;
      state = transitionState(state, {
        steps: [...state.steps, ...newSteps],
        iteration,
      });

      // Invariant: incremental ledger ≡ full re-projection. The full-steps
      // array alone loses iteration-boundary information (every entry's
      // `iteration` field would collapse to the final iteration), so
      // "from scratch" here means replaying the recorded (steps, iteration)
      // script from an empty ledger — exactly what `transitionState`'s
      // chokepoint does incrementally, one batch at a time.
      let expected = projectStepsToLedger(undefined, script[0]!, 1);
      for (let i = 1; i < iteration; i += 1) {
        expected = projectStepsToLedger(expected, script[i]!, i + 1);
      }
      expect(state.ledger).toEqual(expected);
    }
  });

  it("red-on-cut: a steps append that bypasses derivation breaks equivalence", () => {
    // Documents WHAT drift the invariant exists to catch: steps grow but the
    // ledger does not follow (e.g. a hand-built state that mutates `steps`
    // outside `transitionState`). The production guard is the first test
    // above (which exercises the real chokepoint) + check-ledger-writes.sh.
    let state = freshState();
    state = transitionState(state, {
      steps: [
        step("action", "file-read(a.txt)", {
          toolCall: { id: "c1", name: "file-read", arguments: { path: "a.txt" } },
          toolCallId: "c1",
        }),
      ],
      iteration: 1,
    });
    const bypassed: KernelState = { ...state, steps: [...state.steps, step("action", "file-read(b.txt)")] };
    const reprojected = projectStepsToLedger(undefined, bypassed.steps, 1);
    expect(bypassed.ledger).not.toEqual(reprojected);
  });
});
