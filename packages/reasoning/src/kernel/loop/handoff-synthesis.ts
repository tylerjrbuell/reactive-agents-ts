/**
 * handoff-synthesis.ts — the ONE synthesis a run gets when the exit gate ends
 * it as a handoff (`exit-gate.ts`: a second soft exit, or the iteration cap,
 * with items still outstanding). Plan 8 queue item 3, OSS gap G1.
 *
 * Bounded by construction:
 *   - runs only when the last gate decision is `handoff` and no deliverable
 *     decision exists yet (`pendingHandoff`); it writes the decision, so it
 *     cannot run twice;
 *   - one model call on the existing final-synthesis budget
 *     (`purpose: "synthesize"`, `budgetClass: "generous"`), no tools;
 *   - never runs when the gate accepted "done" (there is no handoff record).
 *
 * Input: the validated tool evidence (scratchpad-resolved, success-gated), the
 * run's draft text ONLY when there is no tool evidence (a draft that predates
 * the evidence is exactly the stale-text hazard), and the outstanding list.
 * Output: the best answer, then a deterministic `Unfinished:` list the harness
 * appends itself (never left to the model). The decision is `accepted: false`,
 * so the run reports `partial`: an honest handoff, never a false success and
 * never a bare failure.
 */
import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService } from "@reactive-agents/llm-provider";
import { harnessSynthesisDeliverable } from "@reactive-agents/core";
import type { KernelState } from "../state/kernel-state.js";
import { gatewayComplete } from "../llm-gateway.js";
import { extractThinkingSafeContent } from "../utils/stream-parser.js";
import { detectContinuationIntent } from "../capabilities/verify/quality-utils.js";
import { emitGuardFired } from "../utils/diagnostics.js";
import { deScaffoldRawDeliverable } from "./output-synthesis.js";
import { collectValidatedObservations, commitDeliverable } from "./runner-helpers/deliverable.js";
import { finalizeDeliverableDecision } from "./runner-helpers/deliverable-decision.js";
import { pendingHandoff, type ExitGateRecord } from "./exit-gate.js";

/** Per-observation evidence cap in the handoff prompt (bounds one call's input). */
const EVIDENCE_CHARS = 6000;

/** Marker line opening the deterministic unfinished list. */
export const UNFINISHED_HEADER = "Unfinished:";

/** Build the handoff prompt. Exported for the seam pin. */
export function buildHandoffPrompt(args: {
  readonly task: string;
  readonly evidence: readonly string[];
  readonly draft?: string;
}): string {
  const lines = [
    `The user asked: "${args.task}"`,
    "",
    "The run stopped before it finished. Write the best answer you can to the user's request, using ONLY the material below.",
  ];
  if (args.evidence.length > 0) {
    lines.push("", "Evidence gathered by tools:", "---", args.evidence.join("\n\n---\n\n"), "---");
  }
  if (args.draft !== undefined) {
    lines.push("", "Draft written during the run:", "---", args.draft, "---");
  }
  lines.push(
    "",
    "Rules: use the exact values from the evidence. Do not describe next steps, do not ask questions, do not offer to continue.",
    "Do not list unfinished work; that list is added separately.",
  );
  return lines.join("\n");
}

/** The answer followed by the harness-owned unfinished list. */
export function composeHandoffOutput(answer: string, outstanding: readonly string[]): string {
  const list = outstanding.map((o) => `- ${o}`).join("\n");
  return `${answer.trim()}\n\n${UNFINISHED_HEADER}\n${list}`;
}

/** The terminal verifier's verdict over the handoff output — RECORD ONLY. */
export interface HandoffVerdict {
  readonly verified: boolean;
  readonly failedChecks: readonly string[];
  readonly summary: string;
}

/**
 * Run the handoff synthesis over a run the exit gate ended as a handoff. A
 * no-op (same state) for every other run.
 *
 * `verify` is the terminal gate's own verifier pass over the handoff output.
 * Its verdict is RECORDED on the decision (kept separate from the gate's
 * decision, per `DeliverableDecision.verifier`) and never acted on: the
 * decision is already `accepted:false`, and re-verifying into a failure would
 * null the handoff (the bare failure G1 forbids, and no LLM re-verify loop).
 */
export function runHandoffSynthesis<R>(args: {
  readonly state: KernelState;
  readonly task: string;
  readonly taskId: string;
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  readonly verify: (state: KernelState) => Effect.Effect<HandoffVerdict, never, R>;
}): Effect.Effect<KernelState, never, R> {
  return Effect.gen(function* () {
    let state = args.state;
    const record: ExitGateRecord | undefined = pendingHandoff(state);
    if (record === undefined) return state;

    const evidence = collectValidatedObservations(state).map(
      (o) => `[${o.toolName}] ${o.content.slice(0, EVIDENCE_CHARS)}`,
    );
    const draftText = (state.output ?? "").trim();
    const draft =
      evidence.length === 0 && draftText.length > 0 && !detectContinuationIntent(draftText).isContinuation
        ? draftText
        : undefined;

    let answer = "";
    const llmOpt = yield* Effect.serviceOption(LLMService);
    if (llmOpt._tag === "Some" && (evidence.length > 0 || draft !== undefined)) {
      const resp = yield* gatewayComplete(
        llmOpt.value,
        { purpose: "synthesize", budgetClass: "generous" },
        {
          messages: [{ role: "user", content: buildHandoffPrompt({ task: args.task, evidence, ...(draft !== undefined ? { draft } : {}) }) }],
          temperature: 0.2,
          traceContext: { taskId: args.taskId, iteration: state.iteration },
        },
      ).pipe(Effect.catchAll(() => Effect.succeed({ content: "" })));
      const candidate = extractThinkingSafeContent(resp).content.trim();
      answer = detectContinuationIntent(candidate).isContinuation ? "" : candidate;
    }
    const synthesized = answer.length > 0;
    if (!synthesized) {
      answer =
        evidence.length > 0
          ? deScaffoldRawDeliverable(collectValidatedObservations(state).map((o) => o.content).join("\n\n"))
          : "No answer could be completed before the run stopped.";
    }

    state = commitDeliverable(
      state,
      harnessSynthesisDeliverable([], undefined, composeHandoffOutput(answer, record.outstanding)),
      {
        // The harness authored this deliverable (the existing honesty marker).
        harnessAuthoredOutput: true,
        outputSynthesized: synthesized,
        verificationWarning:
          `Stopped by ${record.proposedBy} before finishing; unfinished: ${record.outstanding.join("; ")}`,
      },
    );
    const verdict = yield* args.verify(state);
    state = finalizeDeliverableDecision(state, {
      accepted: false,
      verdictSummary: `handoff: ${record.outstanding.length} item(s) unfinished; ${verdict.summary}`,
      why: "handoff-synthesis",
      rejected: [],
      verifier: { verified: verdict.verified, failedChecks: verdict.failedChecks },
      exitGate: {
        proposedBy: record.proposedBy,
        gateDecision: "handoff",
        outstanding: record.outstanding,
        handoffSynthesis: synthesized,
      },
    });
    const decision = state.meta.deliverableDecision;
    yield* emitGuardFired({
      taskId: args.taskId,
      iteration: state.iteration,
      guard: "deliverable_decision",
      outcome: "block",
      reason: decision?.why ?? "handoff-synthesis",
      metadata: { chosen: decision?.chosen, accepted: false, rejected: [], terminatedBy: state.meta.terminatedBy ?? null },
    });
    yield* emitGuardFired({
      taskId: args.taskId,
      iteration: state.iteration,
      guard: "exit_gate",
      outcome: "terminate",
      reason: "handoff_synthesis",
      metadata: {
        proposedBy: record.proposedBy,
        gateDecision: "handoff",
        outstanding: record.outstanding,
        handoffSynthesis: synthesized,
      },
    });
    yield* args.emitLog({
      _tag: "warning",
      message: `The run stopped before finishing (${record.proposedBy}); the answer lists ${record.outstanding.length} unfinished item(s).`,
      context: `[exit-gate] handoff synthesis=${synthesized}`,
      timestamp: new Date(),
    });
    return state;
  });
}
