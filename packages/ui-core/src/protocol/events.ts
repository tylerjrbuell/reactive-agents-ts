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
  };
  readonly pendingInteraction?: PendingInteractionWire;
  readonly abstention?: { readonly reason: string; readonly missing?: readonly string[] };
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
}
export interface ToolCallCompleted {
  readonly _tag: "ToolCallCompleted";
  readonly toolName: string;
  readonly callId: string;
  readonly durationMs: number;
  readonly success: boolean;
}
export interface ThoughtEmitted {
  readonly _tag: "ThoughtEmitted";
  readonly content: string;
  readonly iteration: number;
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

// ── New tags (this kit) ───────────────────────────────────────────────────
export interface PendingInteractionWire {
  readonly runId: string;
  readonly interactionId: string;
  readonly kind: "form" | "choice" | "confirmation";
  readonly prompt: string;
  readonly schema: unknown;
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
  readonly gateId: string;
  readonly toolName: string;
  readonly args: unknown;
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

// ── Reserved tags (declared for forward-compat; NOT emitted in v1) ───────
export interface ObjectDelta {
  readonly _tag: "ObjectDelta";
  readonly partial: unknown;
}
export interface UiTreeDelta {
  readonly _tag: "UiTreeDelta";
  readonly partial: unknown;
}
export interface TrustEvent {
  readonly _tag: "TrustEvent";
  readonly claimId: string;
  readonly verdict: string;
  readonly sources: readonly string[];
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
  | PhaseStarted
  | PhaseCompleted
  | RunAttached
  | InteractionRequested
  | ApprovalRequested
  | RunPaused
  | Abstained
  | CostDelta
  | LimitExceeded
  | ObjectDelta
  | UiTreeDelta
  | TrustEvent
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
