// File: src/kernel/loop/pending-batch.ts
/**
 * The pending-batch rule: what happens to tool calls the model emitted on its
 * last think when the run ends before the act phase runs them.
 *
 * A think that returns tool calls leaves them on `meta.pendingNativeToolCalls`
 * with status `acting`; the next pass's act runs them and clears the field.
 * Every way a run can end between that think and that act (the iteration cap,
 * a guard or controller exit the gate accepts or hands off, strategy-switch
 * exhaustion) used to discard the batch silently. Spike, 779 recorded runs:
 * 21 ended this way and 20 of them failed; 11 of the 21 batches wrote a
 * declared file the run still lacked.
 *
 * All of those paths leave the loop and reach the terminal pipeline, so the
 * rule runs once there, before the fences are read ({@link settlePendingBatch}):
 *
 *   - **drain** — the loop stopped on the iteration cap (status still
 *     `acting`: nothing has finalized yet) and the batch writes a declared
 *     deliverable that is still outstanding. The kernel runs ONE act on the
 *     batch (no think, no LLM call), then the cap proposal judges the run
 *     with the write in evidence.
 *   - **dropped** — any other ending with a batch still pending. Nothing runs:
 *     the exit already finalized, or the batch writes nothing the contract
 *     still needs. The run records a `pending-batch` intervention step (it
 *     reaches the receipt) and a `pending_batch` guard event naming the calls.
 *   - durable pauses (`awaiting-approval` / `awaiting-interaction`) keep the
 *     batch on purpose for the resume; the rule leaves them alone.
 */
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { ToolCallSpec } from "@reactive-agents/tools";
import {
  transitionState,
  type KernelContext,
  type KernelRunOptions,
  type KernelState,
  type ThoughtKernel,
} from "../state/kernel-state.js";
import { deliveryConditions } from "../contract/declared-deliverables.js";
import { verifyDelivery } from "../capabilities/verify/delivery-authority.js";
import { callWritesPath } from "../capabilities/verify/post-conditions.js";
import { makeStep } from "../capabilities/sense/step-utils.js";
import { authorityOf } from "../capabilities/decide/authority.js";
import { emitGuardFired } from "../utils/diagnostics.js";
import { assessAfterAct } from "./iterate-assessment-seam.js";

/** How the rule settled a finished loop's pending batch. */
export type PendingBatchSettlement = "none" | "paused" | "drained" | "dropped";

/** The model's tool calls that no act phase has run yet. */
export function pendingBatch(state: KernelState): readonly ToolCallSpec[] {
  return state.meta.pendingNativeToolCalls ?? [];
}

/**
 * Declared deliverable paths the pending batch would write that the run has
 * not produced yet (unmet `ArtifactProduced` delivery conditions). Pure apart
 * from the delivery check's own file probe.
 */
export function outstandingDeliverableWrites(state: KernelState): readonly string[] {
  const calls = pendingBatch(state);
  if (calls.length === 0) return [];
  const conditions = deliveryConditions(state.meta) ?? [];
  if (conditions.length === 0) return [];
  const { unmet } = verifyDelivery(conditions, { steps: state.steps, output: state.output ?? "", ledger: state.ledger });
  const paths: string[] = [];
  for (const c of unmet) {
    if (c.kind !== "ArtifactProduced") continue;
    if (calls.some((call) => callWritesPath(call, c.path)) && !paths.includes(c.path)) paths.push(c.path);
  }
  return paths;
}

/** The rule's decision for a finished loop (pure; {@link settlePendingBatch} applies it). */
export function pendingBatchSettlement(state: KernelState): PendingBatchSettlement {
  if (pendingBatch(state).length === 0) return "none";
  const by = state.meta.terminatedBy;
  if (by === "awaiting-approval" || by === "awaiting-interaction") return "paused";
  if (state.status === "acting" && outstandingDeliverableWrites(state).length > 0) return "drained";
  return "dropped";
}

/** `file-write(out.txt)` style labels for the record. */
function callLabels(calls: readonly ToolCallSpec[]): readonly string[] {
  return calls.map((c) => {
    const path = ["path", "file_path", "filepath", "file", "filename"]
      .map((k) => c.arguments?.[k])
      .find((v): v is string => typeof v === "string");
    return path !== undefined ? `${c.name}(${path})` : c.name;
  });
}

/**
 * Apply the pending-batch rule to a finished loop's state. Runs once, as the
 * terminal pipeline's entry (`terminal-pipeline.ts`), before the fences are
 * read and before the cap proposal.
 */
export function settlePendingBatch(
  state: KernelState,
  ctx: {
    readonly kernel: ThoughtKernel;
    readonly context: KernelContext;
    readonly currentOptions: KernelRunOptions;
  },
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    const settlement = pendingBatchSettlement(state);
    if (settlement === "none" || settlement === "paused") return state;
    const taskId = ctx.currentOptions.taskId ?? state.taskId;
    const calls = callLabels(pendingBatch(state));
    if (settlement === "drained") {
      const deliverables = outstandingDeliverableWrites(state);
      yield* emitGuardFired({
        taskId,
        iteration: state.iteration,
        guard: "pending_batch",
        outcome: "pass",
        reason: "drained",
        metadata: { calls, deliverables },
      });
      const acted = yield* ctx.kernel(state, ctx.context);
      return yield* assessAfterAct({ state: acted, currentOptions: ctx.currentOptions });
    }
    const terminatedBy = state.meta.terminatedBy ?? null;
    yield* emitGuardFired({
      taskId,
      iteration: state.iteration,
      guard: "pending_batch",
      outcome: "warn",
      reason: "dropped",
      metadata: { calls, terminatedBy, status: state.status },
    });
    const step = makeStep(
      "harness_signal",
      `pending tool batch not executed (run ended by ${terminatedBy ?? "the iteration cap"}): ${calls.join(", ")}`,
      {
        intervention: {
          actor: "pending-batch",
          authorityClass: authorityOf("pending-batch"),
          evidence: `not executed: ${calls.join(", ")}`.slice(0, 200),
          whatChanged: "pending-batch: the run ended before its last tool batch ran; the calls were not executed",
          iter: state.iteration,
        },
      },
    );
    return transitionState(state, { steps: [...state.steps, step] });
  });
}
