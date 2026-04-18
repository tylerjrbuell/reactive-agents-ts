// packages/trace/src/events.ts

// NOTE: LifecyclePhase lives in @reactive-agents/runtime, not @reactive-agents/core.
// To avoid a circular dependency (runtime → trace → runtime), we use string here.
// The literal union is: "bootstrap" | "guardrail" | "cost-route" | "strategy-select"
//   | "think" | "act" | "observe" | "verify" | "memory-flush" | "cost-track"
//   | "audit" | "complete"

/** Discriminated union of every observable reactive event. */
export type TraceEvent =
  | RunStartedEvent
  | RunCompletedEvent
  | PhaseBoundaryEvent
  | IterationBoundaryEvent
  | EntropyScoredEvent
  | DecisionEvaluatedEvent
  | InterventionDispatchedEvent
  | InterventionSuppressedEvent
  | StatePatchAppliedEvent
  | ToolCallEvent
  | MessageAppendedEvent
  | StrategySwitchedEvent

export interface TraceEventBase {
  readonly runId: string
  readonly timestamp: number          // ms since epoch
  readonly iter: number                // -1 before first iteration
  readonly seq: number                 // monotonic within a run
}

export interface RunStartedEvent extends TraceEventBase {
  readonly kind: "run-started"
  readonly task: string
  readonly model: string
  readonly provider: string
  readonly seed?: number
  readonly config: Record<string, unknown>
}

export interface RunCompletedEvent extends TraceEventBase {
  readonly kind: "run-completed"
  readonly status: "success" | "failure" | "cancelled"
  readonly output?: string
  readonly error?: string
  readonly totalTokens: number
  readonly totalCostUsd: number
  readonly durationMs: number
}

export interface PhaseBoundaryEvent extends TraceEventBase {
  readonly kind: "phase-enter" | "phase-exit"
  readonly phase: string               // LifecyclePhase from @reactive-agents/runtime
  readonly durationMs?: number         // only on phase-exit
}

export interface IterationBoundaryEvent extends TraceEventBase {
  readonly kind: "iteration-enter" | "iteration-exit"
}

export interface EntropyScoredEvent extends TraceEventBase {
  readonly kind: "entropy-scored"
  readonly composite: number
  readonly sources: {
    readonly token: number
    readonly structural: number
    readonly semantic: number
    readonly behavioral: number
    readonly contextPressure: number
  }
}

export interface DecisionEvaluatedEvent extends TraceEventBase {
  readonly kind: "decision-evaluated"
  readonly decisionType: string        // ControllerDecision["type"]
  readonly confidence: number
  readonly reason: string
}

export interface InterventionDispatchedEvent extends TraceEventBase {
  readonly kind: "intervention-dispatched"
  readonly decisionType: string
  readonly patchKind: string
  readonly cost: { readonly tokensEstimated: number; readonly latencyMsEstimated: number }
  readonly telemetry: Record<string, unknown>
}

export interface InterventionSuppressedEvent extends TraceEventBase {
  readonly kind: "intervention-suppressed"
  readonly decisionType: string
  readonly reason: "below-entropy-threshold" | "below-iteration-threshold"
    | "over-budget" | "max-fires-exceeded" | "mode-advisory" | "mode-off"
    | "no-handler"
}

export interface StatePatchAppliedEvent extends TraceEventBase {
  readonly kind: "state-patch-applied"
  readonly patchKind: string
  readonly diff: Record<string, unknown>
}

export interface ToolCallEvent extends TraceEventBase {
  readonly kind: "tool-call-start" | "tool-call-end"
  readonly toolName: string
  readonly args?: unknown
  readonly durationMs?: number
  readonly ok?: boolean
  readonly error?: string
}

export interface MessageAppendedEvent extends TraceEventBase {
  readonly kind: "message-appended"
  readonly role: "user" | "assistant" | "tool" | "system"
  readonly tokenCount: number
}

export interface StrategySwitchedEvent extends TraceEventBase {
  readonly kind: "strategy-switched"
  readonly from: string
  readonly to: string
  readonly reason: string
}

/** Type-narrowing helper. */
export function isTraceEvent(x: unknown): x is TraceEvent {
  return typeof x === "object" && x !== null && "kind" in x && "runId" in x
}
