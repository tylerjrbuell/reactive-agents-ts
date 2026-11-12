/**
 * Versioned wire protocol between Reactive Agents server endpoints and UI
 * bindings. Additive-only after v1: never remove or repurpose a _tag.
 *
 * Base tags mirror the server's AgentStreamEvent JSON shape
 * (packages/runtime/src/stream-types.ts) — re-declared here because ui-core
 * must stay dependency-free and browser-safe.
 */
export const PROTOCOL_VERSION = 1 as const;

export type UiRunStatus =
  | "idle"
  | "streaming"
  | "awaiting-interaction"
  | "awaiting-approval"
  | "completed"
  | "error"
  | "cancelled";

export interface ResultMetadataWire {
  readonly duration?: number;
  readonly cost?: number;
  readonly tokensUsed?: number;
  readonly stepsCount?: number;
  readonly [key: string]: unknown;
}

/**
 * Wire mirror of the runtime's `TrustReceipt` (`@reactive-agents/core`) —
 * re-declared structurally because ui-core stays dependency-free. Graded
 * evidence about HOW the answer was produced; NOT a truth certificate
 * (`verdict` grades the evidence trail, not factual correctness). Loose like
 * `ResultMetadataWire` so additive server-side receipt fields (e.g. the
 * optional Task 9 `signature`) pass through without a protocol bump.
 */
export interface TrustReceiptWire {
  readonly verdict: string;
  readonly method: string;
  readonly confidence: number;
  readonly toolsUsed: readonly string[];
  readonly toolCallStats: { readonly ok: number; readonly failed: number };
  readonly modelId: string;
  readonly computedAt: number;
  readonly [key: string]: unknown;
  /**
   * Durable tool-effect recovery ledger (GH #262), passed through by the
   * server from the runtime receipt. Typed here for IntelliSense although the
   * index signature already admits it; loose pass-through unchanged.
   */
  readonly effects?: ReadonlyArray<{
    readonly toolName: string;
    readonly argsJson: string;
    readonly status: "recovered" | "ambiguous-then-replayed";
    readonly effectId: string;
    readonly iteration: number;
  }>;
}

// ── Base tags (server-originated, exist today) ────────────────────────────
export interface TextDelta {
  readonly _tag: "TextDelta";
  readonly text: string;
}
export interface StreamCompleted {
  readonly _tag: "StreamCompleted";
  readonly output: string;
  readonly metadata: ResultMetadataWire;
  readonly taskId?: string;
  readonly agentId?: string;
  readonly runId?: string;
  /** False when the run (e.g. a sub-agent) finished unsuccessfully. Absent means success. */
  readonly success?: boolean;
  /** How the run's loop ended (mirrors runtime `StreamCompleted.terminatedBy`); `"abstained"` when the agent declined. */
  readonly terminatedBy?: string;
  /**
   * The failure cause when `success` is `false` (provider error, runtime veto,
   * termination reason), never the output text. A failed or abstained run's
   * `output` is `""`; show this instead.
   */
  readonly error?: string;
  /** Set when a durable run paused (`pendingApproval` / `pendingInteraction` say for what). */
  readonly status?: "awaiting-approval" | "awaiting-interaction";
  /** Per-tool call/duration rollup (mirrors runtime `AgentStreamEvent.StreamCompleted.toolSummary`). */
  readonly toolSummary?: ReadonlyArray<{
    readonly name: string;
    readonly calls: number;
    readonly avgMs: number;
  }>;
  readonly pendingApproval?: {
    readonly runId: string;
    readonly gateId: string;
    readonly toolName: string;
    readonly args: unknown;
    /** The sub-agent asking, when the gated call runs inside one. */
    readonly subAgent?: string;
  };
  readonly pendingInteraction?: PendingInteractionWire;
  readonly abstention?: { readonly reason: string; readonly missing?: readonly string[] };
  /** The schema-valid value, when the run (or turn) had an output schema (mirrors runtime `StreamCompleted.object`). */
  readonly object?: unknown;
  /** Why no schema-valid value was produced, when the run had an output schema (mirrors runtime `objectError`). */
  readonly objectError?: string;
  /** How the structured-output pipeline got `object`, or why it failed (mirrors runtime `objectReport`). */
  readonly objectReport?: StructuredOutputReportWire;
  /**
   * Full trust receipt (Arc 1 Task 8 closure) — present on terminal
   * completions when the server runtime attaches it; absent on pause
   * completions. See {@link TrustReceiptWire}.
   */
  readonly receipt?: TrustReceiptWire;
}
export interface StreamError {
  readonly _tag: "StreamError";
  readonly cause: string;
}
export interface StreamCancelled {
  readonly _tag: "StreamCancelled";
  readonly reason: string;
  readonly iterationsCompleted: number;
}
export interface IterationProgress {
  readonly _tag: "IterationProgress";
  readonly iteration: number;
  readonly maxIterations: number;
  readonly toolsCalledThisStep?: readonly string[];
  readonly status: string;
}
export interface ToolCallStarted {
  readonly _tag: "ToolCallStarted";
  readonly toolName: string;
  readonly callId: string;
  /**
   * Arguments the tool is being called with (post-heal), when the emitter
   * carries them. Lets a UI show a long-running call before it completes.
   */
  readonly args?: unknown;
}
export interface ToolCallCompleted {
  readonly _tag: "ToolCallCompleted";
  readonly toolName: string;
  readonly callId: string;
  readonly durationMs: number;
  readonly success: boolean;
  /** Arguments the tool ran with, when the emitter carries them (density "full"). */
  readonly args?: unknown;
  /** Tool output as text (capped server-side). Present on success. */
  readonly result?: string;
  /** Failure text. Present when `success` is false. */
  readonly error?: string;
  /** True iff `result`/`error` was cut by the server-side cap. */
  readonly resultTruncated?: boolean;
}
export interface ThoughtEmitted {
  readonly _tag: "ThoughtEmitted";
  readonly content: string;
  readonly iteration: number;
}
export interface ThinkingEmitted {
  readonly _tag: "ThinkingEmitted";
  readonly content: string;
  readonly iteration: number;
  readonly truncated?: boolean;
}
/**
 * How full the model's context window is, per LLM call (the prompt actually sent, not
 * cumulative spend). `tokensAvailable` is the window REMAINING after `tokensUsed`; the
 * total window is `tokensUsed + tokensAvailable`.
 */
export interface ContextPressure {
  readonly _tag: "ContextPressure";
  readonly tokensUsed: number;
  readonly tokensAvailable: number;
  readonly utilizationPct: number;
  readonly level: "low" | "medium" | "high" | "critical";
  readonly iteration?: number;
}
/**
 * Token usage for one completed LLM call. Mirrors the runtime `TokenUsage` stream
 * variant. `tokensIn` / `tokensOut` are provider-reported halves; either is absent when
 * the provider did not report it, and `estimated` says so. Cache figures are absent when
 * the provider reported none, never fabricated.
 */
export interface TokenUsage {
  readonly _tag: "TokenUsage";
  readonly callId: string;
  readonly tokensTotal: number;
  readonly tokensIn?: number;
  readonly tokensOut?: number;
  readonly estimated: boolean;
  readonly cacheReadTokensIn?: number;
  readonly cacheCreationTokensIn?: number;
  /**
   * Cache-adjusted billed tokens when the runtime reported them
   * (`(input - cacheRead) + output`). Absent means "not reported".
   */
  readonly billedTokens?: number;
  /**
   * Hidden-reasoning tokens when the provider broke them out. A SUBSET of
   * `tokensOut`, never additive. Absent means "not reported".
   */
  readonly reasoningTokens?: number;
  readonly model: string;
  readonly provider: string;
  readonly durationMs: number;
  /**
   * Time from request to the first streamed token, ms, when the runtime
   * measured it (`LLMRequestCompleted.firstTokenMs`). Absent for a non-streamed
   * call or a runtime that does not forward it; output speed is then a lower bound.
   */
  readonly firstTokenMs?: number;
  readonly costUsd: number;
  readonly iteration?: number;
}
export interface PhaseStarted {
  readonly _tag: "PhaseStarted";
  readonly phase: string;
  readonly timestamp: number;
}
export interface PhaseCompleted {
  readonly _tag: "PhaseCompleted";
  readonly phase: string;
  readonly durationMs: number;
}

/** One validation failure at a field of a structured-output extraction. */
export interface StructuredFieldErrorWire {
  /** RFC 6901 JSON Pointer to the failing field (`""` = the root value). */
  readonly path: string;
  readonly message: string;
}

/**
 * How one structured-output extraction got its value, or why it failed
 * (mirrors core `StructuredOutputReport`, re-declared structurally because
 * ui-core stays dependency-free). Layers and repair steps are open strings so
 * a newer framework's additions pass through.
 */
export interface StructuredOutputReportWire {
  readonly outcome: "success" | "failure";
  /** `native` | `prompt` | `repaired` | `coerced` | `retried`; `null` on failure. */
  readonly layer: string | null;
  /** `not-attempted` | `succeeded` | `failed` | `contract-rejected`. */
  readonly native: string;
  readonly attempts: number;
  readonly promptAttempts: number;
  readonly repairs: readonly string[];
  readonly coerced: boolean;
  readonly budgetEscalated: boolean;
  readonly fieldErrors: readonly StructuredFieldErrorWire[];
  readonly failure?: { readonly kind: string; readonly message: string };
}

/** A structured-output extraction finished (full density only). */
export interface StructuredOutputReported {
  readonly _tag: "StructuredOutputReported";
  readonly taskId: string;
  readonly strategy?: string;
  readonly report: StructuredOutputReportWire;
}

// ── New tags (this kit) ───────────────────────────────────────────────────
/** One selectable option of a choice {@link InteractionQuestionWire}. */
export interface InteractionQuestionOptionWire {
  /** Text shown to the person. */
  readonly label: string;
  /** Value reported back in the answer map when this option is picked. */
  readonly value: string;
  /** Extra explanation shown under the label. */
  readonly description?: string;
}

/**
 * One question of a structured `request_user_input` (structural copy of the runtime
 * wire shape; ui-core imports no runtime types). Answer the interaction with an
 * id-keyed map: `{ [question.id]: value }` (string, number, boolean, or string[] for
 * `multi-choice`).
 */
export interface InteractionQuestionWire {
  /** Unique within the request; the key of this question's answer. */
  readonly id: string;
  readonly prompt: string;
  readonly type: "text" | "single-choice" | "multi-choice" | "boolean" | "number";
  /** Present for the two choice types. */
  readonly options?: readonly InteractionQuestionOptionWire[];
  /** Absent means required. */
  readonly required?: boolean;
  /** Used when a non-required question is skipped. */
  readonly default?: unknown;
  /** `number`: inclusive lower bound. `multi-choice`: fewest picks. */
  readonly min?: number;
  /** `number`: inclusive upper bound. `multi-choice`: most picks. */
  readonly max?: number;
  /** `text`: longest accepted answer. */
  readonly maxLength?: number;
  /** Choice questions: a free-text value outside `options` is accepted. */
  readonly allowOther?: boolean;
}

export interface PendingInteractionWire {
  readonly runId: string;
  readonly interactionId: string;
  readonly kind: "form" | "choice" | "confirmation";
  readonly prompt: string;
  readonly schema: unknown;
  /** Typed questions of a structured call; absent for a legacy `kind` + `schema` request. */
  readonly questions?: readonly InteractionQuestionWire[];
}
export interface RunAttached {
  readonly _tag: "RunAttached";
  readonly runId: string;
  readonly status: string;
  readonly resumeCursor: number;
  readonly protocolVersion: number;
}
export interface InteractionRequested extends PendingInteractionWire {
  readonly _tag: "InteractionRequested";
}
export interface ApprovalRequested {
  readonly _tag: "ApprovalRequested";
  readonly runId: string;
  /** Identifies this request: parallel sub-agents share `runId`, so answer with `gateId` to target one. */
  readonly gateId: string;
  readonly toolName: string;
  readonly args: unknown;
  /** The sub-agent asking (its name) when the gated call runs inside one; absent for the agent's own calls. */
  readonly subAgent?: string;
}
export interface RunPaused {
  readonly _tag: "RunPaused";
  readonly runId: string;
  readonly reason: "awaiting-interaction" | "awaiting-approval";
}
export interface Abstained {
  readonly _tag: "Abstained";
  readonly reason: string;
  readonly missing?: readonly string[];
}
export interface CostDelta {
  readonly _tag: "CostDelta";
  readonly tokens: number;
  readonly usd: number;
}
export interface LimitExceeded {
  readonly _tag: "LimitExceeded";
  readonly kind: "rateLimit" | "budget" | "concurrency" | "anonymous";
  readonly retryAfterMs?: number;
}

// ── Reserved / forward-compat tags ────────────────────────────────────────
// ObjectDelta/UiTreeDelta/StepEvent: declared for forward-compat, NOT emitted
// in v1. TrustEvent graduated out of "reserved" in Arc 1 Task 8 — it IS
// emitted (alongside StreamCompleted) starting this version.
//
// WAVE 1 RECORDED DECISION (Local-Tier Reliability, 2026-10-13): the
// provider-level `thinking_delta` StreamEvent added to
// `@reactive-agents/llm-provider`'s union is DELIBERATELY NOT mirrored onto
// this wire protocol. Reason: this protocol mirrors the runtime's
// `AgentStreamEvent` (packages/runtime/src/stream-types.ts), not the
// provider's StreamEvent union — provider thinking is consumed SERVER-side by
// the reasoning kernel (think.ts `providerThinking`/`rescueFromThinking`,
// dispatch 1.3) and never crosses the SSE boundary here. Surfacing internal
// reasoning to browsers would be a separate product/privacy decision
// requiring an `AgentStreamEvent` tag first (runtime-side). The #188
// three-way-binding divergence class is pinned instead by the bindings parity
// test (packages/react/tests/stream-parity.test.tsx), which feeds the three
// bindings an identical fixture INCLUDING an unknown forward-compat tag and
// asserts they stay behaviorally equivalent — so any future wire field
// addition (thinking included) has a pre-existing divergence tripwire.
export interface ObjectDelta {
  readonly _tag: "ObjectDelta";
  readonly partial: unknown;
}
export interface UiTreeDelta {
  readonly _tag: "UiTreeDelta";
  readonly partial: unknown;
}
/**
 * Trust receipt summary (Arc 1 Task 8) — emitted alongside `StreamCompleted`
 * on every run. `verdict`/`confidence` mirror `TrustReceipt` (see
 * `@reactive-agents/core`); NOT a truth certificate — grades the evidence
 * trail, not factual correctness.
 *
 * `claimId`/`sources` are reserved for a future per-claim grounding-check
 * variant of this tag and are NOT populated by the run-level receipt event
 * shipped in v1 — kept optional so a future producer can add them without
 * another breaking shape change.
 */
export interface TrustEvent {
  readonly _tag: "TrustEvent";
  readonly verdict: string;
  readonly confidence: number;
  readonly claimId?: string;
  readonly sources?: readonly string[];
}
/**
 * Evidence behind an inferred checklist row (mirror of core `ChecklistEvidenceRef`).
 * Deterministic ledger match, never model judgment.
 */
export interface ChecklistEvidenceWire {
  /** Ledger `seq` of the evidence entry. */
  readonly seq: number;
  readonly kind: "tool-result" | "artifact" | "requirement";
  /** Short human-readable description of the matched evidence. */
  readonly detail: string;
}

/** Wire mirror of core `ChecklistRow` (structural; ui-core is dependency-free). */
export interface ChecklistRowWire {
  readonly id: string;
  readonly kind: "requirement" | "advisory";
  readonly title: string;
  readonly status: "pending" | "in_progress" | "done" | "blocked";
  readonly reason?: string;
  /**
   * Advisory rows only. `"inferred"` = marked done from ledger evidence, not by the agent/user;
   * `"plan"` = a strategy plan step whose status the harness tracks.
   * Absent (older snapshots/servers) means `"explicit"`.
   */
  readonly source?: "explicit" | "inferred" | "plan";
  /** Present only when `source === "inferred"`. */
  readonly evidence?: ChecklistEvidenceWire;
}

/** Wire mirror of core `ChecklistGroup`; `children` are sub-agent runs. */
export interface ChecklistGroupWire {
  readonly key: string;
  readonly label: string;
  readonly rows: readonly ChecklistRowWire[];
  readonly requirements: { readonly done: number; readonly total: number };
  readonly advisory: { readonly done: number; readonly total: number };
  readonly activeAdvisoryIds: readonly string[];
  readonly children: readonly ChecklistGroupWire[];
  readonly live?: boolean;
}

/** Wire mirror of core `ChecklistSnapshot`. Done-ness is `root.requirements` only. */
export interface ChecklistSnapshotWire {
  readonly root: ChecklistGroupWire;
  readonly lastSeq: number;
}

/**
 * Checklist changed (requirement gate truth + advisory todo items). Additive
 * tag: the snapshot with the highest `lastSeq` wins in `RunState.checklist`.
 */
export interface ChecklistUpdated {
  readonly _tag: "ChecklistUpdated";
  readonly checklist: ChecklistSnapshotWire;
  readonly iteration: number;
}
/**
 * The shared exit gate judged a "done" claim and did not simply accept it
 * (mirrors runtime `ExitGateDecision`). The same event for every strategy:
 * `repair` = one more attempt aimed at what is outstanding; `handoff` = the run
 * ends partial and names what is unfinished; `accept-unfinished` = accepted
 * with items still outstanding (nothing left to work with).
 */
export interface ExitGateDecision {
  readonly _tag: "ExitGateDecision";
  readonly decision: "repair" | "handoff" | "accept-unfinished";
  readonly outstanding: readonly string[];
  readonly iteration: number;
}
/** Identity of the descendant run a {@link SubAgentActivity} belongs to (mirrors runtime `SubAgentRunInfo`). */
export interface SubAgentRunInfoWire {
  /** Stable per-child key (the child's task id). Never changes mid-run; the block key. */
  readonly key: string;
  /** Best-known child run id. May differ between early and later chunks of the same child. */
  readonly runId: string;
  /** The spawner's run id (the root task id for direct children). */
  readonly parentRunId?: string;
  /** Delegation depth: 1 for a direct child of the root. */
  readonly depth: number;
  /** Child display name. */
  readonly name: string;
}
/** A descendant run's stream event wrapped once, flat on the parent stream (mirrors runtime `SubAgentActivity`). */
export interface SubAgentActivity {
  readonly _tag: "SubAgentActivity";
  readonly run: SubAgentRunInfoWire;
  readonly event: UiStreamEvent;
}
export interface StepEvent {
  readonly _tag: "StepEvent";
  readonly step: unknown;
}

export type UiStreamEvent =
  | TextDelta
  | StreamCompleted
  | StreamError
  | StreamCancelled
  | IterationProgress
  | ToolCallStarted
  | ToolCallCompleted
  | ThoughtEmitted
  | ThinkingEmitted
  | ContextPressure
  | TokenUsage
  | PhaseStarted
  | PhaseCompleted
  | RunAttached
  | InteractionRequested
  | ApprovalRequested
  | StructuredOutputReported
  | RunPaused
  | Abstained
  | CostDelta
  | LimitExceeded
  | ObjectDelta
  | UiTreeDelta
  | TrustEvent
  | ChecklistUpdated
  | ExitGateDecision
  | SubAgentActivity
  | StepEvent;

/** Journal-stamped variant: server assigns a monotonic per-run sequence. */
export type SeqStamped<E> = E & { readonly seq?: number };

const TERMINAL_TAGS: ReadonlySet<UiStreamEvent["_tag"]> = new Set([
  "StreamCompleted",
  "StreamError",
  "StreamCancelled",
  "LimitExceeded",
]);

export const isTerminalEvent = (e: UiStreamEvent): boolean => TERMINAL_TAGS.has(e._tag);

/** Parse one SSE `data:` payload. Returns null for anything not a tagged event. */
export const parseUiStreamEvent = (raw: string): UiStreamEvent | null => {
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      "_tag" in value &&
      typeof (value as { _tag: unknown })._tag === "string"
    ) {
      return value as UiStreamEvent;
    }
    return null;
  } catch {
    return null;
  }
};
