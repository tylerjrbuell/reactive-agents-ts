/**
 * react-kernel-result.ts — the result one ReAct pass hands its consumer
 * (`reActResultFromState` in loop/react-kernel.ts). Moved verbatim out of
 * kernel-state.ts (LOC-pinned) and re-exported there; the `error` field is new
 * (owner decision 2026-11-10: a failed pass's cause rides `error`, never output).
 */
import type { FinalAnswerCapture } from "@reactive-agents/tools";
import type { ReasoningStep } from "../../types/index.js";
import type { KernelState } from "./kernel-state.js";

export interface ReActKernelResult {
  /** Final answer text. Empty when the pass failed: its cause is {@link error}. */
  output: string;
  /**
   * The cause of a failed pass (`state.error`). Present only when the pass
   * failed with a recorded error; `output` is then empty. The harness never
   * writes its own text into `output` (owner decision 2026-11-10), so a
   * consumer that treats `output` as the pass's work must read the failure
   * here (plan-execute marks the step failed with this cause).
   */
  error?: string;
  /** All reasoning steps (thought / action / observation) */
  steps: ReasoningStep[];
  /** Total tokens consumed across all LLM calls */
  totalTokens: number;
  /** Total estimated cost */
  totalCost: number;
  /** Distinct tool names that were called at least once */
  toolsUsed: string[];
  /** Number of iterations completed */
  iterations: number;
  /** Count of LLM calls made during the run (emitted at the kernel return
   *  site as `state.llmCalls ?? 0`; consumed by plan-execute step reporting). */
  llmCalls: number;
  /** How the loop terminated (narrowed to closed enum) */
  terminatedBy: "final_answer" | "final_answer_tool" | "max_iterations" | "end_turn" | "llm_error" | "abstained" | "guard_stop";
  /**
   * Raw `state.meta.terminatedBy` preserved verbatim as an open string channel.
   *
   * The narrowed `terminatedBy` field above collapses dynamic killswitch reasons
   * (e.g. `"budget-limit:tokens:1/0"`, `"timeout-after:30s"`,
   * `"max-iterations:5"`, `"require-approval-for:denied:TOOL"`,
   * `"watchdog:no-progress-for:Nms"`) into `"max_iterations"`. Downstream
   * propagation (AgentCompleted.terminationReason) needs the raw string;
   * this field carries it alongside the closed-enum form.
   *
   * Omitted when `state.meta.terminatedBy` is undefined — never set to
   * `undefined` explicitly so consumers can distinguish "no reason" from
   * "present but undefined". (HS-killswitch-toggle / 2026-05-24)
   */
  rawTerminatedBy?: string;
  /** Captured final-answer tool payload — present when terminatedBy === "final_answer_tool" */
  finalAnswerCapture?: FinalAnswerCapture;
  /** O3: present when terminatedBy === "abstained" — model's honest decline. */
  abstention?: { readonly reason: string; readonly missing: readonly string[] };
  /**
   * Durable HITL (Phase D): present when this sub-kernel PAUSED at an approval
   * gate. The gated call has NOT executed. A consuming strategy must treat this
   * as terminal for the whole run — see `isKernelPaused` / `finalizePausedStrategyResult`.
   */
  awaitingApprovalFor?: KernelState["meta"]["awaitingApprovalFor"];
  /** Durable pause (Task 9): mirror of {@link awaitingApprovalFor} for `request_user_input`. */
  awaitingInteractionFor?: KernelState["meta"]["awaitingInteractionFor"];
  /**
   * The signal-boundary primitive (north-star spec 2026-07-11 §1b, task #40):
   * the completion authority's verdict for this sub-run, derived at the
   * return site via `envelopeFromKernelState`. REQUIRED — before this field,
   * the wrapper dropped `meta.harnessAuthoredOutput` / `budgetTerminalPartial`
   * / `verificationWarning`, so consuming strategies (plan-execute, reflexion,
   * blueprint, code-action) re-derived "completed" from output presence and
   * the honesty markers died at this boundary. Consumers must JOIN this into
   * their own status via `capStatusToEnvelope` (downgrade allowed, upgrade
   * never — see kernel/state/completion-envelope.ts).
   */
  envelope: import("./completion-envelope.js").CompletionEnvelope;
}
