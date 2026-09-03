// packages/trace/src/events.ts

import type { Rationale } from "./rationale.js"
import type { RunContext, LlmCallPurpose } from "@reactive-agents/core"

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
  // ─── Decision rationale events (v0.11.x — observable "why") ───
  | AssumptionRecordedEvent
  | AlternativesConsideredEvent
  | CuratorDecisionEvent
  // ─── Overhaul Phase 2 (2026-07-07 — tool-surface compiler) ───
  | ToolSurfaceResolvedEvent
  // ─── Meta-loop Phase 4a (2026-07-08 — goal compiler) ───
  | ContractCompiledEvent
  // ─── Meta-loop Phase 5a (2026-07-08 — progress estimator) ───
  | AssessmentEvent
  // ─── Meta-loop Phase 4c (2026-07-08 — projector / attention authority) ───
  | ProjectionRenderedEvent
  // ─── Meta-loop Phase 5b (2026-07-08 — control plane / action selection) ───
  | ControlResolutionEvent
  // ─── Wave C.2 slice 3 (2026-07-25 — run ledger onto the trace stream) ───
  | LedgerEntryTraceEvent

export interface TraceEventBase {
  readonly runId: string
  readonly timestamp: number          // ms since epoch
  readonly iter: number                // -1 before first iteration
  readonly seq: number                 // monotonic within a run
  // ─── Delegation-tree correlation (RunContext spine, 2026-07-20) ───
  // Optional so historical JSONL (written before the spine existed) still
  // loads: a reader treats a missing `depth` as 0 and a missing `rootRunId`
  // as equal to `runId` (a root run). New events are stamped via
  // `traceBaseFrom(ctx, iter, seq)`, which always populates them.
  /** Top-most run in this delegation tree. Absent ⇒ treat as `runId` (root). */
  readonly rootRunId?: string
  /** The run that spawned this one. Absent at the root. */
  readonly parentRunId?: string
  /** Delegation depth. Absent ⇒ 0 (root). */
  readonly depth?: number
}

/**
 * Single constructor for the correlated base of every trace event.
 *
 * Threading `RunContext` here is what makes "show me this run and everything
 * it spawned" a single JSONL filter: a sub-agent's events carry a different
 * `runId` than the parent's (correct), but share `rootRunId` and record
 * `parentRunId`/`depth` so the tree is reconstructable.
 */
export const traceBaseFrom = (
  ctx: RunContext,
  iter: number,
  seq: number,
): TraceEventBase => ({
  runId: ctx.runId,
  rootRunId: ctx.rootRunId,
  parentRunId: ctx.parentRunId,
  depth: ctx.depth,
  timestamp: Date.now(),
  iter,
  seq,
})

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
  /** Final deliverable output (capped at 64KB by the publisher; see `outputTruncated`). */
  readonly output?: string
  /** True iff `output` was clipped to the publisher's 64KB cap. */
  readonly outputTruncated?: boolean
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
  /** Optional structured rationale (v0.11.x); free-text `reason` remains source of truth. */
  readonly rationale?: Rationale
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
  /** Tool result payload (only on "tool-call-end"; may be truncated for size). */
  readonly result?: unknown
  /** True iff `result` was clipped or replaced with an unserializable marker. */
  readonly resultTruncated?: boolean
  readonly durationMs?: number
  readonly ok?: boolean
  readonly error?: string
  /** Optional rationale (v0.11.x). Only set on "tool-call-start". */
  readonly rationale?: Rationale
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
  /** Optional structured rationale (v0.11.x); free-text `reason` remains source of truth. */
  readonly rationale?: Rationale
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
  // Mirror of KernelStatus (kernel-state.ts). "paused" reserved for future explicit-pause flows.
  readonly status:
    | "thinking"
    | "acting"
    | "observing"
    | "done"
    | "failed"
    | "evaluating"
    | "paused"
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
  /** Set iff terminatedBy is set; structured rationale for the termination. */
  readonly terminationRationale?: Rationale
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
  /**
   * What this call was for. Absent on un-mediated calls (and on every trace
   * recorded before 2026-07-28) — treat absence as "unknown", never as a tier.
   * This is the field that turns "the harness costs 640%" into a per-subsystem
   * breakdown.
   */
  readonly purpose?: LlmCallPurpose
  readonly temperature?: number
  readonly maxTokens?: number
  readonly response: {
    readonly content: string
    readonly truncated?: boolean
    readonly toolCalls?: readonly { readonly name: string; readonly arguments?: unknown }[]
    readonly stopReason?: string
    readonly tokensIn?: number
    readonly tokensOut?: number
    /** Anthropic prompt-caching: tokens that wrote new cache entries (Lever 1 evidence). */
    readonly cacheCreationTokensIn?: number
    /** Anthropic prompt-caching: tokens served from cache hits (90% input discount). */
    readonly cacheReadTokensIn?: number
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

/**
 * Assumption the model made during reasoning (e.g. "user means USD because no
 * currency given"). Emitted by the think-phase assumption detector. Surfaced
 * by `rax diagnose debrief` so reviewers see what the model filled in.
 */
export interface AssumptionRecordedEvent extends TraceEventBase {
  readonly kind: "assumption-recorded"
  readonly assumption: string
  readonly rationale: Rationale
}

/**
 * Alternatives considered at a decision point (chose A, rejected B and C).
 * Captures the counterfactuals the model weighed.
 */
export interface AlternativesConsideredEvent extends TraceEventBase {
  readonly kind: "alternatives-considered"
  readonly chosen: string
  readonly alternatives: readonly {
    readonly option: string
    readonly rejectedBecause: string
  }[]
}

/**
 * Context curator action — what was kept, dropped, compressed, or flagged as
 * untrusted, and why. Pairs the curator's existing trustLevel/justification
 * with a structured rationale.
 */
export interface CuratorDecisionEvent extends TraceEventBase {
  readonly kind: "curator-decision"
  readonly action: "kept" | "dropped" | "compressed" | "marked-untrusted"
  readonly targetRef: string                  // observation / scratchpad key
  readonly rationale: Rationale
}

/**
 * Per-iteration tool-surface resolution (Overhaul Phase 2, 2026-07-07): what
 * the model could see (`visible`) and call (`callable`) this turn, plus WHY
 * each tool in the augmented set landed where it did. Replaces the debug-tap
 * workflow the rw-9 visibility regression required.
 */
export interface ToolSurfaceResolvedEvent extends TraceEventBase {
  readonly kind: "tool-surface-resolved"
  readonly visible: readonly string[]
  readonly callable: readonly string[]
  readonly reasons: readonly { readonly tool: string; readonly reason: string }[]
}

/**
 * RunContract compiled at run start (meta-loop Phase 4a, 2026-07-08): the typed
 * "what does DONE mean" object — its requirement + deliverable refs and the run
 * horizon. The goal-compiler node of the meta-loop DAG, made replayable the way
 * `tool-surface-resolved` made tool resolution replayable.
 */
export interface ContractCompiledEvent extends TraceEventBase {
  readonly kind: "contract-compiled"
  readonly requirements: readonly { readonly id: string; readonly kind: string }[]
  readonly deliverables: readonly { readonly id: string; readonly kind: string }[]
  readonly horizon: string
}

/**
 * RunAssessment recomputed at an iteration (meta-loop Phase 5a, 2026-07-08): the
 * perception node of the meta-loop DAG. Carries the run phase, pace band, the one
 * evidenceDelta progress currency, and the requirement/deliverable tallies —
 * making the contract → assessment → action chain replayable, the way
 * `contract-compiled` made the goal compiler replayable.
 */
export interface AssessmentEvent extends TraceEventBase {
  readonly kind: "assessment"
  readonly phase: string
  readonly band: string
  readonly evidenceDelta: number
  readonly requirementsSatisfied: number
  readonly requirementsOutstanding: number
  readonly deliverablesProduced: number
  readonly deliverablesMissing: number
  readonly burnRatio: number
}

/**
 * The Projector rendered the LLM window (meta-loop Phase 4c, 2026-07-08): the
 * LAST node of the meta-loop DAG. Carries the rendered section names, the refs
 * reachable from the window, the refs compaction dropped, and the total rendered
 * size — making the contract → assessment → projection chain replayable, the way
 * `assessment` made perception replayable.
 */
export interface ProjectionRenderedEvent extends TraceEventBase {
  readonly kind: "projection-rendered"
  readonly sections: readonly string[]
  readonly refs: readonly string[]
  readonly droppedRefs: readonly string[]
  readonly chars: number
  /** R4 (2026-07-30): the resolved capability window the per-result budgets came
   *  from (the budget/wire divergence signal), and each result the projector
   *  replaced with a preview+ref. Optional — absent on pre-R4 replays. */
  readonly window?: number
  readonly tier?: string
  readonly compressions?: readonly {
    readonly tool: string
    readonly rawChars: number
    readonly shownChars: number
    readonly budget: number
  }[]
}

/**
 * Control plane resolved competing proposals into ONE action (meta-loop Phase 5b,
 * 2026-07-08, task F1): the action-selection node of the meta-loop DAG. Carries
 * the proposals considered (source→action), the ONE action chosen, and why —
 * making the contract → assessment → CONTROL → action chain replayable, the way
 * `assessment` made perception replayable.
 */
export interface ControlResolutionEvent extends TraceEventBase {
  readonly kind: "control-resolution"
  readonly action: string
  readonly reason: string
  readonly proposals: readonly { readonly source: string; readonly action: string }[]
}

/**
 * A batch of run-ledger entries appended at a kernel iteration boundary
 * (Wave C.1 live tap → C.2 run-scoped ledger). Projects the `LedgerEntryAppended`
 * bus event onto the trace stream so the ledger — the run's append-only record of
 * tool invocations, results, artifacts, requirements, claims and verdicts — is no
 * longer siloed from the trace JSONL.
 *
 * Each element of `entries` carries its OWN ledger `seq` (dense/monotonic within
 * the run ledger) and `kind` (`tool-invocation` | `tool-result` | `artifact` |
 * `requirement` | `claim` | `verdict` | …), distinct from this trace event's own
 * `seq`/`iter`. A merged sub-agent entry additionally carries `pass:
 * "sub-agent:<name>"` (Wave C.2). The batch is stamped `Record<string, unknown>`
 * at the core package boundary (core cannot depend on reasoning's LedgerEntry
 * union) and reaches the trace layer unchanged.
 */
export interface LedgerEntryTraceEvent extends TraceEventBase {
  readonly kind: "ledger-entry"
  readonly entries: ReadonlyArray<Record<string, unknown>>
}

/**
 * Required (non-optional) field names per `kind`, beyond the base
 * `runId`/`timestamp`/`iter`/`seq`. Used by `isTraceEvent` to catch a
 * truncated or hand-edited JSONL line whose `kind` is a real trace-event
 * kind but whose payload doesn't match it — a gap `isTraceEvent` left open
 * (F-8 residue, 2026-08-24 external-research-convergence amendment, W7):
 * previously it checked only that `kind` and `runId` were present, so any
 * object with those two keys parsed as a valid event of whatever kind it
 * claimed. This does not validate nested shapes or field types — only that
 * the fields a reader of that `kind` will dereference actually exist.
 */
const REQUIRED_FIELDS_BY_KIND: Readonly<Record<TraceEvent["kind"], readonly string[]>> = {
  "run-started": ["task", "model", "provider", "config"],
  "run-completed": ["status", "totalTokens", "totalCostUsd", "durationMs"],
  "phase-enter": ["phase"],
  "phase-exit": ["phase"],
  "iteration-enter": [],
  "iteration-exit": [],
  "entropy-scored": ["composite", "sources"],
  "decision-evaluated": ["decisionType", "confidence", "reason"],
  "intervention-dispatched": ["decisionType", "patchKind", "cost", "telemetry"],
  "intervention-suppressed": ["decisionType", "reason"],
  "state-patch-applied": ["patchKind", "diff"],
  "tool-call-start": ["toolName"],
  "tool-call-end": ["toolName"],
  "message-appended": ["role", "tokenCount"],
  "strategy-switched": ["from", "to", "reason"],
  "kernel-state-snapshot": [
    "status", "toolsUsed", "scratchpadKeys", "stepsCount", "stepsByType",
    "outputPreview", "outputLen", "messagesCount", "tokens", "cost", "llmCalls",
  ],
  "verifier-verdict": ["action", "terminal", "verified", "summary", "checks"],
  "guard-fired": ["guard", "outcome", "reason"],
  "llm-exchange": ["provider", "model", "requestKind", "messages", "toolSchemaNames", "response"],
  "harness-signal-injected": ["signalKind", "origin", "contentPreview", "contentLen"],
  "assumption-recorded": ["assumption", "rationale"],
  "alternatives-considered": ["chosen", "alternatives"],
  "curator-decision": ["action", "targetRef", "rationale"],
  "tool-surface-resolved": ["visible", "callable", "reasons"],
  "contract-compiled": ["requirements", "deliverables", "horizon"],
  "assessment": [
    "phase", "band", "evidenceDelta", "requirementsSatisfied", "requirementsOutstanding",
    "deliverablesProduced", "deliverablesMissing", "burnRatio",
  ],
  "projection-rendered": ["sections", "refs", "droppedRefs", "chars"],
  "control-resolution": ["action", "reason", "proposals"],
  "ledger-entry": ["entries"],
}

/** Type-narrowing helper. Validates the base fields, that `kind` is a known
 * trace-event kind, and that the fields that kind's payload requires are
 * present — see `REQUIRED_FIELDS_BY_KIND`. */
export function isTraceEvent(x: unknown): x is TraceEvent {
  if (typeof x !== "object" || x === null) return false
  const record = x as Record<string, unknown>
  if (typeof record.runId !== "string") return false
  if (typeof record.timestamp !== "number") return false
  if (typeof record.iter !== "number") return false
  if (typeof record.seq !== "number") return false
  if (typeof record.kind !== "string") return false
  const required = REQUIRED_FIELDS_BY_KIND[record.kind as TraceEvent["kind"]]
  if (required === undefined) return false
  return required.every((field) => field in record)
}
