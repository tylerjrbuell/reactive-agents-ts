/**
 * Pause or stop a live durable run through the framework: `agent.pauseRun(id)` /
 * `agent.stopRun(id)` end the run at its next iteration boundary and persist where it
 * was (row status `paused` / `stopped`, `stop.kind` `user-paused` / `user-stopped`), so
 * `agent.resumeRun(id)` continues it (`loop-stop-resume.ts`, `chat-resume.ts`,
 * `loop-stopped-runs.ts`). Cortex owns no interrupt logic: this reads the agent's live
 * ids (`activeRunIds()`), calls the framework, and bounds the wait so a long model call
 * cannot hold an HTTP request open. Shared by the desk runner and the chat path.
 */
import { Effect } from "effect";
import type { ReactiveAgent } from "@reactive-agents/runtime";
import type { RunId } from "../types.js";
import { CortexError } from "../errors.js";
import { cortexLog } from "../cortex-log.js";
import { durableApprovals, type ApprovalDecision } from "./durable-approvals.js";

/** What a person asked for: end the run and keep it continuable. */
export type InterruptKind = "pause" | "stop";

/** The agent surface an interrupt needs. */
export type InterruptableAgent = Pick<ReactiveAgent, "pauseRun" | "stopRun" | "activeRunIds">;

/**
 * How the request ended:
 * - `persisted`: the run ended and its stop record is saved (it can be continued);
 * - `pending`: the run is live but did not reach an iteration boundary within the grace
 *   window (the request stays registered; the caller may end the run another way);
 * - `not-live`: no live durable run in this agent (not durable, already ended), or the call failed.
 */
export type InterruptOutcome = "persisted" | "pending" | "not-live";

/** Default wait for a run to reach its next iteration boundary. */
export const INTERRUPT_GRACE_MS = 5_000;

/**
 * Ask the agent's live durable runs to pause or stop and wait up to `graceMs` for the
 * end to be persisted. Never throws.
 */
export async function interruptLiveRun(
  agent: InterruptableAgent,
  kind: InterruptKind,
  graceMs: number = INTERRUPT_GRACE_MS,
): Promise<InterruptOutcome> {
  const ids = agent.activeRunIds();
  if (ids.length === 0) return "not-live";
  const asked = Promise.all(ids.map((id) => (kind === "pause" ? agent.pauseRun(id) : agent.stopRun(id)).catch(() => false))).then(
    (done): InterruptOutcome => (done.some((d) => d) ? "persisted" : "not-live"),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<InterruptOutcome>((resolve) => {
    timer = setTimeout(() => resolve("pending"), graceMs);
  });
  try {
    return await Promise.race([asked, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** `true` when `settled` resolves within `ms`, `false` on timeout (no `settled`: `true`). */
export const settledWithin = (settled: Promise<void> | undefined, ms: number): Effect.Effect<boolean> =>
  settled
    ? Effect.race(Effect.promise(() => settled).pipe(Effect.as(true)), Effect.sleep(`${ms} millis`).pipe(Effect.as(false)))
    : Effect.succeed(true);

/** Approve/deny through the shared registry. An unknown run is a logged no-op (it may have resolved already). */
export const decideApproval = (runId: RunId, decision: ApprovalDecision, reason?: string, gateId?: string): Effect.Effect<void, CortexError> =>
  Effect.gen(function* () {
    const out = yield* Effect.promise(() => durableApprovals.decide(String(runId), decision, reason, gateId));
    if (out.ok) return;
    if (out.code === "not-found") {
      cortexLog("debug", "runner", `${decision === "approved" ? "approve" : "deny"}: run not pending approval`, { runId });
      return;
    }
    return yield* Effect.fail(
      new CortexError({ message: `${decision === "approved" ? "approveRun" : "denyRun"} failed: ${out.message}` }),
    );
  });
