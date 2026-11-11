/**
 * A chat turn waiting LIVE on an approval (no durable runs): the run stays open
 * and its stream sends `ApprovalRequested` (runtime HumanGate). The turn shows an
 * Approve / Deny card until the run moves on. Pure.
 *
 * Approve / Deny go to `POST /api/runs/:runId/approve|deny`, the shared registry
 * that also answers durable pauses (server `durable-approvals.ts`), so the card,
 * the app-wide toast and the run view stay one decision.
 */
import { writable } from "svelte/store";
import type { UiStreamEvent } from "@reactive-agents/ui-core";
import { CORTEX_SERVER_URL } from "./constants.js";
import type { PendingApprovalWire } from "./waiting-on-you.js";

/** The approval a streaming chat turn is waiting on. */
export interface LiveApproval {
  readonly runId: string;
  readonly gateId: string;
  readonly toolName: string;
  readonly args: unknown;
}

/** Events that mean the run moved past its wait (answered, refused, or ended). */
const MOVED_ON: ReadonlySet<UiStreamEvent["_tag"]> = new Set([
  "ToolCallStarted",
  "ToolCallCompleted",
  "IterationProgress",
  "TextDelta",
  "StreamCompleted",
  "StreamError",
  "StreamCancelled",
]);

/**
 * The turn's live approval after `event`: set by `ApprovalRequested`, cleared
 * once the run moves on, unchanged otherwise (the same reference, so callers
 * can skip a patch).
 */
export function liveApprovalAfter(current: LiveApproval | undefined, event: UiStreamEvent): LiveApproval | undefined {
  if (event._tag === "ApprovalRequested") {
    return { runId: event.runId, gateId: event.gateId, toolName: event.toolName, args: event.args };
  }
  return current !== undefined && MOVED_ON.has(event._tag) ? undefined : current;
}

/** The key a chat approval card is hidden under (one gate of one run). */
export const approvalCardKey = (a: { readonly runId: string; readonly gateId: string }): string => `${a.runId}|${a.gateId}`;

/**
 * Approval cards the user dismissed in this browser session. Dismiss hides the
 * card only: the approval stays pending and reachable (run view header, Runs
 * "Waiting on you").
 */
export const hiddenApprovalCards = writable<ReadonlySet<string>>(new Set());

/** Hide one approval card (Dismiss). */
export function hideApprovalCard(a: { readonly runId: string; readonly gateId: string }): void {
  hiddenApprovalCards.update((s) => new Set([...s, approvalCardKey(a)]));
}

/**
 * The live approvals of an open chat that no streaming turn shows: a wait the
 * app-wide list knows for `sessionId` (e.g. after a reload, when the turn's stream
 * is gone) that is neither a held durable pause (`durableRunIds`, its own card)
 * nor a streaming turn's `liveApproval` (`streamingRunIds`), and not hidden.
 */
export function orphanChatApprovals(
  sessionId: string,
  pending: readonly PendingApprovalWire[],
  durableRunIds: ReadonlySet<string>,
  streamingRunIds: ReadonlySet<string>,
  hidden: ReadonlySet<string>,
): LiveApproval[] {
  return pending
    .filter(
      (p) =>
        p.chatSessionId === sessionId &&
        !durableRunIds.has(p.runId) &&
        !streamingRunIds.has(p.runId) &&
        !hidden.has(approvalCardKey(p)),
    )
    .map((p) => ({ runId: p.runId, gateId: p.gateId, toolName: p.toolName, args: p.args }));
}

/** Approve or deny a live wait. `ok: false` carries the reason it was not delivered. */
export async function decideLiveApproval(
  runId: string,
  verb: "approve" | "deny",
  reason?: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetchFn(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/${verb}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(verb === "deny" ? { reason: reason?.trim() ? reason.trim() : "Denied in Cortex chat." } : {}),
    });
    if (!res.ok) return { ok: false, error: `Server returned ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
