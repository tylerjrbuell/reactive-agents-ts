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
  // ─── Diagnostic events (Sprint 3.6 — harness diagnostic system) ───
  | KernelStateSnapshotEvent
  | VerifierVerdictEvent
  | GuardFiredEvent
  | LLMExchangeEvent
  | HarnessSignalInjectedEvent

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

// ─── Diagnostic events (Sprint 3.6) ───────────────────────────────────────────
//
// These events make harness control-flow and model behavior visible to
// `rax diagnose` and Cortex UI without requiring developers to grep stderr or
// read kernel source. Together with the existing 12 events above, they answer:
//   - "What was the agent thinking at iteration N?" (KernelStateSnapshot)
//   - "Why did the verifier accept/reject this output?" (VerifierVerdict)
//   - "Which guard fired and why did it take this branch?" (GuardFired)
//   - "What exactly did the model see and produce?" (LLMExchange)
//   - "Where did this harness-injected step come from?" (HarnessSignalInjected)

/**
 * Snapshot of kernel state at an iteration boundary. Captures enough to
 * reconstruct what the agent saw without re-running. Sized to be replayable
 * but bounded — message and scratchpad payloads are previewed, not full.
 */
export interface KernelStateSnapshotEvent extends TraceEventBase {
  readonly kind: "kernel-state-snapshot"
  readonly status: "thinking" | "done" | "failed" | "paused"
  readonly toolsUsed: readonly string[]
  readonly scratchpadKeys: readonly string[]
  readonly stepsCount: number
  readonly stepsByType: Readonly<Record<string, number>>  // {thought:N, action:M, observation:K, ...}
  readonly outputPreview: string | null  // first 240 chars of state.output, or null
  readonly outputLen: number
  readonly messagesCount: number
  readonly tokens: number
  readonly cost: number
  readonly llmCalls: number
  readonly terminatedBy: string | undefined
  readonly pendingGuidance: Record<string, unknown> | undefined
}

/**
 * Verifier verdict on a single action's outcome. Mirrors the
 * VerificationResult type from the reasoning package without coupling to it.
 * The `checks` array preserves order so consumers can find the first failed
 * check (the "lead" reason for rejection).
 */
export interface VerifierVerdictEvent extends TraceEventBase {
  readonly kind: "verifier-verdict"
  readonly action: string                   // "final-answer" | tool name | etc
  readonly terminal: boolean                // true when verifying a candidate final output
  readonly verified: boolean
  readonly summary: string                  // human-readable verdict line
  readonly checks: readonly {
    readonly name: string
    readonly passed: boolean
    readonly reason?: string
  }[]
}

/**
 * A guard or phase decision in the reasoning loop. Captures which control-flow
 * branch fired and why, so trace consumers can answer "why did this run take
 * path A instead of path B" without reading kernel source.
 *
 * Examples:
 *   - guard="guardPrematureFinalAnswer", outcome="redirect", reason="missing tools: get-hn-posts"
 *   - guard="completion-guard", outcome="pass", reason="all required tools satisfied"
 *   - guard="loop-detector", outcome="terminate", reason="3 consecutive identical thoughts"
 */
export interface GuardFiredEvent extends TraceEventBase {
  readonly kind: "guard-fired"
  readonly guard: string
  readonly outcome: "pass" | "redirect" | "terminate" | "block" | "warn"
  readonly reason: string
  readonly metadata?: Record<string, unknown>
}

/**
 * One LLM round-trip: prompt sent and response received. Enables answering
 * "what did the model actually see" and "why did it produce that output"
 * without re-running.
 *
 * Payloads are token-budgeted to keep traces small:
 *   - systemPrompt and messages may be truncated (with `truncated: true`)
 *   - rawResponse is sampled (full text up to a soft cap; otherwise prefix)
 *
 * Tool schemas sent are recorded by name only; full schemas live in
 * KernelStateSnapshot when needed.
 */
export interface LLMExchangeEvent extends TraceEventBase {
  readonly kind: "llm-exchange"
  readonly provider: string
  readonly model: string
  readonly requestKind: "complete" | "stream" | "completeStructured"
  readonly systemPrompt: string | undefined
  readonly systemPromptTruncated?: boolean
  readonly messages: readonly {
    readonly role: "system" | "user" | "assistant" | "tool"
    readonly content: string
    readonly truncated?: boolean
  }[]
  readonly toolSchemaNames: readonly string[]
  readonly temperature?: number
  readonly maxTokens?: number
  readonly response: {
    readonly content: string
    readonly truncated?: boolean
    readonly toolCalls?: readonly { readonly name: string; readonly arguments?: unknown }[]
    readonly stopReason?: string
    readonly tokensIn?: number
    readonly tokensOut?: number
    readonly costUsd?: number
    readonly durationMs?: number
  }
}

/**
 * A harness-injected step (recovery nudge, dispatcher message, guard redirect).
 * Distinguishes harness-authored content from model-produced content in the
 * trace. Origin captures the source site (e.g. "think-guards.ts:213") so
 * trace consumers can navigate from the event to the code that emitted it.
 */
export interface HarnessSignalInjectedEvent extends TraceEventBase {
  readonly kind: "harness-signal-injected"
  readonly signalKind: "redirect" | "nudge" | "block" | "completion-gap" | "rule-violation" | "dispatcher-status" | "loop-graceful" | "other"
  readonly origin: string                   // "<file>:<line>" or named site
  readonly contentPreview: string           // first 240 chars
  readonly contentLen: number
  readonly metadata?: Record<string, unknown>
}

/** Type-narrowing helper. */
export function isTraceEvent(x: unknown): x is TraceEvent {
  return typeof x === "object" && x !== null && "kind" in x && "runId" in x
}
