/**
 * Continue as a live turn. The framework's `agent.resumeRun` has no stream: it
 * returns when the run is done. Cortex therefore follows the same agent's event bus
 * (`agent.subscribe`, the bus a normal turn's stream is projected from) while the
 * run works, and projects the events a chat thread draws (iteration progress and
 * tool calls) onto the public `AgentStreamEvent` shape. The result becomes the
 * turn's terminal event: a user Stop / Pause reads as the cancelled turn it is, any
 * other end as a completion that carries its outcome.
 *
 * The events feed a detached turn (`chat-detached-turn.ts`), so the page that pressed
 * Continue and a reloaded page attach the same way they attach to any chat turn.
 */
import type { AgentEvent } from "@reactive-agents/core";
import type { AgentResult, AgentStreamEvent, ResumeRunOptions } from "@reactive-agents/runtime";
import { isUserStopResult, userInterruptOf } from "@reactive-agents/ui-core";
import type { ChatStreamEvent } from "./chat-detached-turn.js";
import type { StrategyStepLog } from "./strategy-steps.js";
import { cancelReasonOf } from "./chat-turn-stop.js";
import { errorText } from "./loop-stop-resume.js";

/** Most characters of one tool result sent on the stream (the thread shows a preview). */
export const RESUME_TOOL_RESULT_CAP = 8_000;

/** The agent surface the stream needs: the run, and the bus when the agent has one. */
export interface ResumeStreamAgent {
  resumeRun(runId: string, options?: ResumeRunOptions): Promise<AgentResult>;
  subscribe?: (handler: (event: AgentEvent) => void) => Promise<() => void>;
}

/**
 * One bus event as a stream event, or `undefined` for events a chat thread does not draw.
 * Same fields the framework's own stream projection sends (`engine/execute-stream.ts`).
 */
export function resumeProgressEvent(event: AgentEvent): AgentStreamEvent | undefined {
  switch (event._tag) {
    case "ReasoningIterationProgress":
      return {
        _tag: "IterationProgress",
        iteration: event.iteration,
        maxIterations: event.maxIterations,
        toolsCalledThisStep: event.toolsThisStep,
        status: `iteration ${event.iteration}/${event.maxIterations}`,
      };
    case "ToolCallStarted":
      return { _tag: "ToolCallStarted", toolName: event.toolName, callId: event.callId, ...(event.args !== undefined ? { args: event.args } : {}) };
    case "ToolCallCompleted": {
      const text = typeof event.error === "string" ? event.error : event.result === undefined ? undefined : typeof event.result === "string" ? event.result : JSON.stringify(event.result);
      const cut = text !== undefined && text.length > RESUME_TOOL_RESULT_CAP;
      const body = cut ? text.slice(0, RESUME_TOOL_RESULT_CAP) : text;
      return {
        _tag: "ToolCallCompleted",
        toolName: event.toolName,
        callId: event.callId,
        durationMs: event.durationMs,
        success: event.success,
        ...(event.args !== undefined ? { args: event.args } : {}),
        ...(body !== undefined ? (typeof event.error === "string" ? { error: body } : { result: body }) : {}),
        ...(cut ? { resultTruncated: true } : {}),
      };
    }
    default:
      return undefined;
  }
}

/**
 * The terminal event of a continued run: `StreamCancelled` when the person stopped or
 * paused it, else a `StreamCompleted` carrying the result's own outcome fields.
 */
export function resumeTerminalEvent(result: AgentResult, iterationsCompleted: number): AgentStreamEvent {
  if (isUserStopResult(result)) {
    const how = userInterruptOf(result.stop);
    return { _tag: "StreamCancelled", reason: cancelReasonOf("user", how), iterationsCompleted };
  }
  return {
    _tag: "StreamCompleted",
    output: result.output,
    success: result.success,
    metadata: result.metadata,
    taskId: result.taskId,
    agentId: result.agentId,
    ...(result.terminatedBy !== undefined ? { terminatedBy: result.terminatedBy } : {}),
    ...(result.outcome !== undefined ? { outcome: result.outcome } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
    ...(result.receipt !== undefined ? { receipt: result.receipt } : {}),
    ...(result.status === "awaiting-approval" || result.status === "awaiting-interaction" ? { status: result.status } : {}),
    ...(result.pendingApproval !== undefined ? { pendingApproval: result.pendingApproval } : {}),
    ...(result.pendingInteraction !== undefined ? { pendingInteraction: result.pendingInteraction } : {}),
  };
}

/**
 * Run `agent.resumeRun` and yield its progress as stream events, then its terminal event.
 * `onSettled` gets the result (or the failure) before the terminal event is yielded, so
 * the host stores the exchange before any client sees the end. A failed resume ends with
 * `StreamError`.
 */
export async function* resumeEventStream(
  agent: ResumeStreamAgent,
  runId: string,
  options: ResumeRunOptions | undefined,
  onSettled: (outcome: { readonly result: AgentResult } | { readonly error: unknown }) => void,
  steps?: StrategyStepLog,
): AsyncGenerator<ChatStreamEvent> {
  yield* runEventStream(agent, () => agent.resumeRun(runId, options), onSettled, steps);
}

/** What a followed run ended with: its result, or the failure that stopped it. */
export type RunSettled = { readonly result: AgentResult } | { readonly error: unknown };

/**
 * Follow any durable run the framework drives without a stream (`resumeRun`, `approveRun`,
 * `denyRun`): start it with `start`, yield its bus progress, then its terminal event.
 * `onSettled` may be async; it is awaited before the terminal event is yielded.
 * `steps` is the session's strategy-step log (`strategy-steps.ts`, subscribed to the same bus): the
 * turn starts it, and its steps are yielded as `StepEvent`s ahead of each progress event and before
 * the terminal one, exactly as `chatStream` does, so the host's trace recorder folds them into the
 * stored strategy card.
 */
export async function* runEventStream(
  agent: Pick<ResumeStreamAgent, "subscribe">,
  start: () => Promise<AgentResult>,
  onSettled: (outcome: RunSettled) => void | Promise<void>,
  steps?: StrategyStepLog,
): AsyncGenerator<ChatStreamEvent> {
  const queue: AgentStreamEvent[] = [];
  let wake: (() => void) | undefined;
  let iterations = 0;
  steps?.beginTurn();
  const onEvent = (event: AgentEvent): void => {
    if (event._tag === "ReasoningStepCompleted") wake?.();
    const projected = resumeProgressEvent(event);
    if (projected === undefined) return;
    if (projected._tag === "IterationProgress") iterations = Math.max(iterations, projected.iteration);
    queue.push(projected);
    wake?.();
  };
  // The bus is best effort: without it the turn still ends with its result.
  const detach = agent.subscribe ? await agent.subscribe(onEvent).catch(() => undefined) : undefined;
  const end: { value?: RunSettled } = {};
  void start().then(
    (result) => {
      end.value = { result };
      wake?.();
    },
    (error: unknown) => {
      end.value = { error };
      wake?.();
    },
  );
  try {
    for (;;) {
      yield* steps?.drain() ?? [];
      while (queue.length > 0) yield queue.shift()!;
      if (end.value !== undefined) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        // An event or the end may have landed between the checks above and this line.
        if (queue.length > 0 || end.value !== undefined) resolve();
      });
      wake = undefined;
    }
  } finally {
    detach?.();
  }
  yield* steps?.drain() ?? [];
  while (queue.length > 0) yield queue.shift()!;
  const settled = end.value;
  await onSettled(settled);
  if ("error" in settled) yield { _tag: "StreamError", cause: errorText(settled.error) };
  else yield resumeTerminalEvent(settled.result, iterations);
}
