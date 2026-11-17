/**
 * Remembers why a chat session's runs failed, keyed by run (task) id.
 *
 * A failed run's `StreamCompleted` carries its cause on `error` (output `""`); that
 * is the cause the chat path shows. This log is the fallback for a completion that
 * reports none: the cause (e.g. the provider's "400 Your credit balance is too low")
 * is also on the bus's `ReasoningFailed.error` / `AgentCompleted.error` /
 * `TaskFailed.error`. The bus publishes `AgentCompleted` before the stream's
 * `StreamCompleted`, so the error is recorded by the time the turn ends.
 */
import type { AgentEvent } from "@reactive-agents/core";
import { isUserStopResult } from "@reactive-agents/ui-core";
import type { SubscribableAgent } from "./chat-ingest.js";

/** Runs remembered per session; older entries are dropped first. */
const MAX_RUNS = 32;
/** Stored error length cap (characters). The UI shortens it further for display. */
const MAX_ERROR_CHARS = 1_000;

/** Failed-run causes for one chat session. */
export interface RunErrorLog {
  /** The recorded cause for `runId`, or `undefined` when the run did not report one. */
  readonly errorOf: (runId: string | undefined) => string | undefined;
}

/** First non-blank line of `raw`, capped; `undefined` when blank. */
export function storedRunError(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const line = raw.split("\n").find((l) => l.trim() !== "")?.trim();
  if (!line) return undefined;
  return line.length > MAX_ERROR_CHARS ? `${line.slice(0, MAX_ERROR_CHARS)}…` : line;
}

/** Subscribe `agent`; returns the log and its unsubscribe. */
export async function recordRunErrors(
  agent: SubscribableAgent,
): Promise<{ readonly log: RunErrorLog; readonly unsubscribe: () => void }> {
  const errors = new Map<string, string>();
  const unsubscribe = await agent.subscribe((event: AgentEvent) => {
    const e = event as { readonly _tag: string } & Readonly<Record<string, unknown>>;
    // `ReasoningFailed` carries the kernel's own cause ("LLM stream failed at iteration 7: …")
    // and is published first, so it wins: a failed run's `AgentCompleted.error` can hold the
    // model's last narration instead of a cause (trace 01M73GND, runtime defect).
    if (e._tag !== "ReasoningFailed" && e._tag !== "AgentCompleted" && e._tag !== "TaskFailed") return;
    if (e._tag === "AgentCompleted" && e.success !== false) return;
    // A stop the user asked for is a partial, not a failure: its generic note is no cause.
    if (e._tag === "AgentCompleted" && isUserStopResult({ success: e.success, outcome: e.outcome, metadata: e.metadata, output: e.output, stop: e.stop, loopStop: e.loopStop })) return;
    const taskId = typeof e.taskId === "string" ? e.taskId : undefined;
    const error = storedRunError(e.error);
    if (taskId === undefined || error === undefined || errors.has(taskId)) return;
    errors.set(taskId, error);
    if (errors.size > MAX_RUNS) errors.delete(errors.keys().next().value!);
  });
  return {
    log: { errorOf: (runId) => (runId === undefined ? undefined : errors.get(runId)) },
    unsubscribe,
  };
}
