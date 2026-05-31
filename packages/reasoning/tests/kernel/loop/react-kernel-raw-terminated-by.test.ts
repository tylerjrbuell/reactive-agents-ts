/**
 * react-kernel-raw-terminated-by.test.ts
 *
 * Regression test for the killswitch-toggle propagation chain (2026-05-24).
 *
 * The chain is:
 *   phase-hooks abort → state.meta.terminatedBy = "<raw reason>"
 *     → react-kernel.ts derives narrowed `terminatedBy` (closed 5-value enum)
 *       AND preserves raw value as `rawTerminatedBy`
 *         → reactive.ts adapter / plan-execute consumers
 *           → runtime ctx.metadata.rawTerminatedBy
 *             → AgentCompleted.terminationReason
 *
 * BEFORE this fix, the narrowing site in `executeReActKernel` collapsed any
 * unknown raw reason (including all dynamic killswitch reasons like
 * `"budget-limit:tokens:1/0"`, `"timeout-after:30s"`, etc.) into the closed
 * enum value `"max_iterations"`. The raw open-string channel was lost.
 *
 * The fix introduces a parallel `rawTerminatedBy?: string` channel on
 * `ReActKernelResult` (and a pure `deriveTerminatedBy()` helper). The narrowed
 * `terminatedBy` field's semantics are unchanged — `rawTerminatedBy` is purely
 * additive.
 *
 * Assertions:
 *   1. Synthetic state `meta.terminatedBy="budget-limit:tokens:1/0"` + status="done"
 *      → narrowed `terminatedBy === "final_answer"` (raw is not in the enum
 *      whitelist, so falls through to the `status === "done" ? "final_answer"`
 *      branch) AND `rawTerminatedBy === "budget-limit:tokens:1/0"` (preserved).
 *   2. Synthetic state `meta.terminatedBy="final_answer_tool"`
 *      → both fields hold "final_answer_tool".
 *   3. Synthetic state with no `meta.terminatedBy` → `rawTerminatedBy` is
 *      OMITTED from the returned object (not `{ rawTerminatedBy: undefined }`),
 *      so spread-based consumers don't pollute downstream metadata.
 *   4. Additional coverage: each killswitch reason family narrows to
 *      `"max_iterations"` (status !== "done") while raw is preserved.
 */
import { describe, it, expect } from "bun:test";
import { deriveTerminatedBy } from "../../../src/kernel/loop/react-kernel.js";
import type { KernelState } from "../../../src/kernel/state/kernel-state.js";

/**
 * Build a minimal state-shaped object for the helper. The helper only reads
 * `state.meta.terminatedBy` and `state.status`, so we don't need to construct
 * a fully-populated KernelState — a structural subset suffices.
 */
function syntheticState(opts: {
  terminatedBy?: string;
  status: KernelState["status"];
}): { meta: { terminatedBy?: unknown }; status: KernelState["status"] } {
  return {
    meta: opts.terminatedBy !== undefined ? { terminatedBy: opts.terminatedBy } : {},
    status: opts.status,
  };
}

describe("deriveTerminatedBy() — rawTerminatedBy parallel open-string channel", () => {
  it("preserves dynamic killswitch reason; narrows to end_turn NOT final_answer (status=done, DEFECT 3)", () => {
    const result = deriveTerminatedBy(
      syntheticState({ terminatedBy: "budget-limit:tokens:1/0", status: "done" }),
    );
    // DEFECT 3 (2026-05-31): a killswitch cut-off is NOT a model final answer.
    // The old catch-all `done → final_answer` was a codified lie (→ goalAchieved
    // true on a forced stop). Truthful: catch-all done → end_turn (goalAchieved null).
    expect(result.terminatedBy).toBe("end_turn");
    // Raw: preserved verbatim for downstream observability (unchanged contract).
    expect(result.rawTerminatedBy).toBe("budget-limit:tokens:1/0");
  });

  it("preserves canonical 'final_answer_tool' on both fields", () => {
    const result = deriveTerminatedBy(
      syntheticState({ terminatedBy: "final_answer_tool", status: "done" }),
    );
    expect(result.terminatedBy).toBe("final_answer_tool");
    expect(result.rawTerminatedBy).toBe("final_answer_tool");
  });

  it("OMITS rawTerminatedBy (does not set to undefined) when meta.terminatedBy is absent", () => {
    const result = deriveTerminatedBy(syntheticState({ status: "done" }));
    // DEFECT 3: an unclassifiable done with no reason is honest "unknown" (end_turn
    // → goalAchieved null), never an asserted final_answer.
    expect(result.terminatedBy).toBe("end_turn");
    // The field must be ABSENT, not explicitly undefined — guards against
    // spread-based consumers polluting downstream metadata.
    expect("rawTerminatedBy" in result).toBe(false);
  });

  // ── DEFECT 3 (2026-05-31): terminatedBy must be truthful ──────────────────
  // The catch-all `done → final_answer` mislabeled EVERY harness/give-up done
  // reason as a model answer → deriveGoalAchieved returned true on failed runs
  // (success:false + goalAchieved:true incoherence). Fix = whitelist genuine
  // model-answer reasons → final_answer; all other done reasons → end_turn.
  describe("DEFECT 3 — harness/give-up done reasons are NOT final_answer", () => {
    const giveUpDoneReasons = [
      "controller_early_stop:dispatcher_early_stop",
      "dispatcher-early-stop",
      "low_delta_guard",
      "switching_exhausted",
      "oracle_forced",
      "harness_deliverable",
      "harness_synthesis",
      "loop_graceful",
      "controller_signal_veto",
    ];
    for (const reason of giveUpDoneReasons) {
      it(`'${reason}' (status=done) → end_turn, NOT final_answer`, () => {
        const result = deriveTerminatedBy(syntheticState({ terminatedBy: reason, status: "done" }));
        expect(result.terminatedBy).toBe("end_turn");
        expect(result.rawTerminatedBy).toBe(reason);
      });
    }

    const genuineAnswerReasons = ["final_answer", "final_answer_regex", "content_stable", "entropy_converged"];
    for (const reason of genuineAnswerReasons) {
      it(`'${reason}' (status=done) → final_answer (genuine model answer, whitelisted)`, () => {
        const result = deriveTerminatedBy(syntheticState({ terminatedBy: reason, status: "done" }));
        expect(result.terminatedBy).toBe("final_answer");
        expect(result.rawTerminatedBy).toBe(reason);
      });
    }
  });

  it("preserves all five killswitch reason families verbatim while narrowing to max_iterations when status != done", () => {
    // These are the dynamic reasons documented in killswitch-reason-preserved.test.ts:
    //   - budget-limit:tokens:N/M
    //   - timeout-after:Wms
    //   - max-iterations:N
    //   - require-approval-for:denied:TOOL
    //   - watchdog:no-progress-for:Nms
    const reasons = [
      "budget-limit:tokens:1000/512",
      "timeout-after:30s",
      "max-iterations:5",
      "require-approval-for:denied:web_search",
      "watchdog:no-progress-for:5000ms",
    ];
    for (const reason of reasons) {
      const result = deriveTerminatedBy(
        syntheticState({ terminatedBy: reason, status: "thinking" }),
      );
      expect(result.terminatedBy).toBe("max_iterations");
      expect(result.rawTerminatedBy).toBe(reason);
    }
  });

  it("maps 'final_answer_regex' raw value to 'final_answer' narrowed (existing semantics) with raw preserved", () => {
    const result = deriveTerminatedBy(
      syntheticState({ terminatedBy: "final_answer_regex", status: "done" }),
    );
    expect(result.terminatedBy).toBe("final_answer");
    expect(result.rawTerminatedBy).toBe("final_answer_regex");
  });

  it("maps 'llm_end_turn' raw value to 'end_turn' narrowed (existing semantics) with raw preserved", () => {
    const result = deriveTerminatedBy(
      syntheticState({ terminatedBy: "llm_end_turn", status: "done" }),
    );
    expect(result.terminatedBy).toBe("end_turn");
    expect(result.rawTerminatedBy).toBe("llm_end_turn");
  });

  it("'llm_error' raw value preserves on both fields", () => {
    const result = deriveTerminatedBy(
      syntheticState({ terminatedBy: "llm_error", status: "failed" }),
    );
    expect(result.terminatedBy).toBe("llm_error");
    expect(result.rawTerminatedBy).toBe("llm_error");
  });
});
