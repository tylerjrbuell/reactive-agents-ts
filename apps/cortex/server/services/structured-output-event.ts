import type { AgentEvent } from "@reactive-agents/core";

/** What a run's typed structured output (`.withOutputSchema`) produced. */
export interface StructuredOutputResult {
  readonly object?: unknown;
  readonly objectError?: string | undefined;
  /** How the pipeline got (or failed to get) the object; also live as `StructuredOutputReported`. */
  readonly objectReport?: unknown;
}

/**
 * The synthetic `StructuredOutputExtracted` event the runner and the gateway ingest after a run
 * that returned a typed object. It is Cortex's own tag, not a framework `AgentEvent` variant, so
 * the one cast to the framework union lives here instead of at each call site.
 */
export function structuredOutputExtractedEvent(
  runId: string,
  agentId: string,
  result: StructuredOutputResult,
): AgentEvent {
  return {
    _tag: "StructuredOutputExtracted",
    taskId: runId,
    agentId,
    ...(result.object !== undefined ? { object: result.object } : {}),
    ...(result.objectError !== undefined ? { objectError: result.objectError } : {}),
    ...(result.objectReport !== undefined ? { objectReport: result.objectReport } : {}),
  } as unknown as AgentEvent;
}
