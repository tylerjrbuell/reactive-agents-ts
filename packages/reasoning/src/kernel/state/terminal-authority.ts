// File: src/kernel/state/terminal-authority.ts
//
// WHO set the final status (trace-feedback item 2, audit 2026-11-03).
//
// `terminal_decision` (runner, pre-finalization) and the `TerminalOutcome`
// (strategy mint, post-caps) are written at different times; when they disagree
// a reader could not tell which mechanism decided. `deriveTerminalAuthority` is
// the ONE pure derivation of "which site/mechanism owns the terminal", from
// facts already on the kernel meta (`terminatedBy`, the deliverable-gate
// decision, the harness-deliverable site stamp) — never from model text.
//
// MEASUREMENT ONLY: nothing branches on the result; it rides the trace.
//
// Leaf module: no kernel imports beyond types.

import type { DeliverableDecision } from "../loop/runner-helpers/deliverable-decision.js";

declare module "./kernel-state.js" {
  interface KernelMeta {
    /**
     * Which post-loop/in-loop site wrote a harness deliverable terminal
     * (`stall-deliverable` | `loop-resolution`). `terminatedBy` alone
     * (`harness_deliverable`/`harness_synthesis`) cannot tell them apart.
     */
    readonly terminalSite?: string;
    /**
     * The `terminal_decision` record the runner emitted, stamped on the final
     * state so the strategy mint can compare the runtime-visible status to it
     * (a `terminal_status_override` diagnostic) without a second source of truth.
     */
    /**
     * RI early-stop patch evidence stamped when the dispatcher ends the run
     * (the evaluator's own reason string — it embeds the numbers it compared).
     * Read only by the trace emit; nothing branches on it.
     */
    readonly dispatcherEarlyStop?: { readonly reason: string; readonly iteration: number };
    readonly terminalDecision?: {
      readonly taskId: string;
      readonly iteration: number;
      readonly status: string;
      readonly authority: string;
    };
  }
}

/**
 * Authority label. Open string by design (new guards add `guard:<name>`), with
 * the documented vocabulary: `model-final | gate-verdict | abstention |
 * stall-deliverable | loop-resolution | harness-deliverable | budget |
 * strategy-exhausted | pause | user-stop | error | give-up-gate |
 * contract-coverage | delegation-cap | guard:<name> | none-recorded |
 * unclassified:<terminatedBy>`.
 */
export type TerminalAuthority = string;

const MODEL_FINAL: ReadonlySet<string> = new Set([
  "final_answer_tool", "final_answer", "final_answer_regex", "end_turn", "llm_end_turn",
  "content_stable", "entropy_converged",
]);

/** Pure. See module docs. */
export function deriveTerminalAuthority(meta: {
  readonly terminatedBy?: string;
  readonly deliverableDecision?: Pick<DeliverableDecision, "accepted">;
  readonly terminalSite?: string;
}): TerminalAuthority {
  // A deliverable the terminal gate refused: the gate's verdict owns the label.
  if (meta.deliverableDecision?.accepted === false) return "gate-verdict";
  const t = meta.terminatedBy;
  if (t === undefined) return "none-recorded";
  if (MODEL_FINAL.has(t)) return "model-final";
  switch (t) {
    case "abstained": return "abstention";
    case "harness_deliverable":
    case "harness_synthesis": return meta.terminalSite ?? "harness-deliverable";
    case "loop_graceful":
    case "loop_detected_with_veto": return "loop-resolution";
    case "low_delta_guard": return "guard:low_delta";
    case "oracle_forced": return "guard:oracle_forced";
    case "dispatcher-early-stop":
    case "dispatcher_early_stop": return "guard:dispatcher_early_stop";
    case "controller_signal_veto": return "guard:controller_signal_veto";
    case "tool_call_unresolved": return "guard:tool_call_unresolved";
    case "budget_terminal":
    case "budget_exceeded": return "budget";
    case "max_iterations":
    case "switching_exhausted": return "strategy-exhausted";
    case "kernel_error":
    case "llm_error": return "error";
    case "awaiting-approval":
    case "awaiting-interaction": return "pause";
    case "stop_requested":
    case "terminate_requested": return "user-stop";
    default:
      return t.startsWith("loop_detected") ? "loop-resolution"
        : t.startsWith("controller_early_stop") ? "guard:dispatcher_early_stop"
        : `unclassified:${t}`;
  }
}
