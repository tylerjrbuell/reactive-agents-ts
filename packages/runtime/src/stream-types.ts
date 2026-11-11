import type { TrustReceipt, TerminatedBy, ChecklistSnapshot, StructuredOutputReport } from "@reactive-agents/core";
import type { AgentResultMetadata } from "./builder.js";
import type { AgentOutcome } from "./builder/agent-result.js";

/** How many event types the stream emits.
 * - `"tokens"`: TextDelta + StreamCompleted + StreamError only (minimal overhead)
 * - `"full"`: all phase/tool/thought events too (richer UI, more events)
 *
 * Default: `"tokens"` when `.withStreaming()` is called without options.
 */
export type StreamDensity = "tokens" | "full";

/**
 * Public streaming event union emitted by agent.runStream().
 * Discriminated by `_tag` — use type narrowing to handle each variant.
 */
export type AgentStreamEvent =
  // ─── Always emitted (both densities) ───
  | {
      /** A text token arrived from the LLM. High-frequency during inference. */
      readonly _tag: "TextDelta";
      readonly text: string;
    }
  | {
      /** Execution completed. Last event on a successful stream. */
      readonly _tag: "StreamCompleted";
      readonly output: string;
      readonly metadata: AgentResultMetadata;
      readonly taskId?: string;
      readonly agentId?: string;
      readonly toolSummary?: ReadonlyArray<{ readonly name: string; readonly calls: number; readonly avgMs: number }>;
      /** Durable HITL: the durable runId, present on every durable-run completion (paused or not — not approval-pause-only). */
      readonly runId?: string;
      /** Durable HITL: the paused gate descriptor, present when status is awaiting-approval. */
      readonly pendingApproval?: {
        readonly runId: string;
        readonly gateId: string;
        readonly toolName: string;
        readonly args: unknown;
      };
      /** Agentic-UI interaction rail (Task 10): the paused interaction descriptor, present when the run paused for user interaction. */
      readonly pendingInteraction?: {
        readonly runId: string;
        readonly interactionId: string;
        readonly kind: string;
        readonly prompt: string;
        readonly schema: unknown;
      };
      /** Run-level abstention surface, present when the run abstained (terminatedBy === "abstained"). */
      readonly abstention?: {
        readonly reason: string;
        readonly missing?: readonly string[];
      };
      /**
       * Full trust receipt (Arc 1 Task 8 closure) — same object attached to
       * `AgentResult.receipt` on the non-streaming path, signed when a
       * signing key is configured (Task 9). Present on every TERMINAL
       * completion; absent on pause completions (awaiting-approval /
       * awaiting-interaction — receipts belong to terminal results only).
       * NOT a truth certificate — see `TrustReceipt` in `@reactive-agents/core`.
       */
      readonly receipt?: TrustReceipt;
      /** Same as `AgentResult.success` (`false` on a paused run). Optional for backward compatibility. */
      readonly success?: boolean;
      /** Same as `AgentResult.terminatedBy`. Absent on a paused run (it has not terminated). */
      readonly terminatedBy?: TerminatedBy;
      /** Same as `AgentResult.outcome` (`success | partial | failed | abstained`). Absent on a paused run. */
      readonly outcome?: AgentOutcome;
      /**
       * Same as `AgentResult.error`: the failure cause (provider error, runtime
       * veto, termination), never the output text. Present only when
       * `success` is `false` on a terminated (not paused) run.
       */
      readonly error?: string;
      /** Same as `AgentResult.status`: set when a durable run paused (`pendingApproval` / `pendingInteraction` say for what). */
      readonly status?: "awaiting-approval" | "awaiting-interaction";
      /** Same as `AgentResult.evidenceDelta`: the run's summed assessment evidence. */
      readonly evidenceDelta?: number;
      /** Same as `AgentResult.goalAchieved`. */
      readonly goalAchieved?: boolean | null;
      /** Same as `AgentResult.object`: the schema-valid value, when the turn ran with `runStream(task, { outputSchema })`. */
      readonly object?: unknown;
      /** Same as `AgentResult.objectError`: why no schema-valid value was produced. */
      readonly objectError?: string;
      /** Same as `AgentResult.objectReport`: how the extraction pipeline got (or failed to get) `object`. */
      readonly objectReport?: StructuredOutputReport;
    }
  | {
      /** Execution failed. Last event on a failed stream. */
      readonly _tag: "StreamError";
      readonly cause: string;
    }
  | {
      /** Reports progress after each reasoning iteration. Useful for progress bars and UI updates. */
      readonly _tag: "IterationProgress";
      readonly iteration: number;
      readonly maxIterations: number;
      readonly toolsCalledThisStep?: readonly string[];
      readonly status: string;
    }
  | {
      /**
       * The run is waiting, in process, for a person to approve or deny a
       * gated tool call (`.withApprovalPolicy({ mode: "detach" })` without
       * durable runs). Answer with `agent.approveRun(runId)` /
       * `agent.denyRun(runId, reason)`; the same stream then continues.
       * Emitted at both densities.
       */
      readonly _tag: "ApprovalRequested";
      readonly runId: string;
      readonly gateId: string;
      readonly toolName: string;
      readonly args: unknown;
    }
  | {
      /**
       * The run is waiting, in process, for a person's answer to a
       * `request_user_input` call. Answer with
       * `agent.respondToInteraction(runId, interactionId, value)`; the same
       * stream then continues. Reserved: the live gate projects interaction
       * waits here, but the kernel does not yet ask the gate for
       * `request_user_input` (it pauses durably instead), so nothing emits it today.
       */
      readonly _tag: "InteractionRequested";
      readonly runId: string;
      readonly interactionId: string;
      readonly kind: string;
      readonly prompt: string;
      readonly schema: unknown;
    }
  | {
      /** Emitted when the stream is cancelled via AbortSignal. Last event when cancelled. */
      readonly _tag: "StreamCancelled";
      readonly reason: string;
      readonly iterationsCompleted: number;
    }
  // ─── Full density only ───
  | {
      /** A lifecycle phase started. Only emitted when density is "full". */
      readonly _tag: "PhaseStarted";
      readonly phase: string;
      readonly timestamp: number;
    }
  | {
      /** A lifecycle phase completed. Only emitted when density is "full". */
      readonly _tag: "PhaseCompleted";
      readonly phase: string;
      readonly durationMs: number;
    }
  | {
      /**
       * The model's own reasoning text for one kernel turn. Only emitted when
       * density is "full". Uniform across strategies: a strategy's control
       * narration (plan / reflect markers, raw plan JSON) is never a thought —
       * plans arrive as `ChecklistUpdated` plan rows, goal checks as
       * `ExitGateDecision`.
       */
      readonly _tag: "ThoughtEmitted";
      readonly content: string;
      readonly iteration: number;
    }
  | {
      /**
       * An exit gate did not simply accept the run's deliverable. Only emitted
       * when density is "full". One shape for the kernel's exit gate and every
       * strategy's delivery gate. A clean accept emits nothing.
       * - `"repair"`: the exit was denied once; the run continues on the
       *   `outstanding` items.
       * - `"handoff"`: the run stops with items unfinished. The harness never
       *   writes the answer: if the model wrote a draft, it ships as a partial
       *   (`success: false`, the draft followed by an `Unfinished:` list);
       *   otherwise the run fails, its cause in `error`, and the gathered
       *   evidence rides `metadata.extensions.unfinishedEvidence`.
       * - `"accept-unfinished"`: the run stops on its honest failure, naming
       *   what stayed outstanding.
       */
      readonly _tag: "ExitGateDecision";
      readonly decision: "repair" | "handoff" | "accept-unfinished";
      /** What the gate found unfinished (deterministic, no LLM). */
      readonly outstanding: readonly string[];
      readonly iteration: number;
    }
  | {
      /**
       * The provider's own reasoning for one LLM exchange (thinking models only).
       * Only emitted when density is "full". `truncated` = cut at the emitter's budget.
       */
      readonly _tag: "ThinkingEmitted";
      readonly content: string;
      readonly iteration: number;
      readonly truncated?: boolean;
    }
  | {
      /**
       * How full the model's context window is for one LLM call (the prompt sent,
       * not cumulative spend). Only emitted when density is "full".
       */
      readonly _tag: "ContextPressure";
      readonly tokensUsed: number;
      readonly tokensAvailable: number;
      readonly utilizationPct: number;
      readonly level: "low" | "medium" | "high" | "critical";
      readonly iteration?: number;
    }
  | {
      /**
       * Token usage for ONE completed LLM call, projected from the core bus's
       * `LLMRequestCompleted`. Emitted at call completion (not per chunk) and
       * only when density is "full".
       *
       * `tokensIn` / `tokensOut` are provider-reported halves; either is absent
       * when the provider did not report it, and `estimated` says so. Cache
       * fields are absent when the provider reported none, never fabricated.
       */
      readonly _tag: "TokenUsage";
      readonly callId: string;
      readonly tokensTotal: number;
      readonly tokensIn?: number;
      readonly tokensOut?: number;
      readonly estimated: boolean;
      readonly cacheReadTokensIn?: number;
      readonly cacheCreationTokensIn?: number;
      /** Provider-reported billed tokens (cache-adjusted), absent when the provider reported none. */
      readonly billedTokens?: number;
      /** Hidden-reasoning tokens, a SUBSET of `tokensOut`, absent when unreported. */
      readonly reasoningTokens?: number;
      readonly model: string;
      readonly provider: string;
      readonly durationMs: number;
      /**
       * Milliseconds from request start to the first streamed output token,
       * copied from `LLMRequestCompleted.firstTokenMs`. Absent for
       * non-streamed calls and streams with no output. Output rate is
       * `tokensOut / ((durationMs - firstTokenMs) / 1000)`; without it,
       * `tokensOut / durationMs` is only a lower bound.
       */
      readonly firstTokenMs?: number;
      readonly costUsd: number;
      readonly iteration?: number;
    }
  | {
      /**
       * The live checklist changed: requirement rows (gate truth) plus advisory
       * `todo` rows, grouped by delegation. Only emitted when density is "full"
       * and `observability.checklist` is not `false`. Display only.
       */
      readonly _tag: "ChecklistUpdated";
      readonly checklist: ChecklistSnapshot;
      readonly iteration: number;
    }
  | {
      /** A tool call started. Only emitted when density is "full". */
      readonly _tag: "ToolCallStarted";
      readonly toolName: string;
      readonly callId: string;
      /** Optional rationale (v0.11.x). */
      readonly rationale?: import("@reactive-agents/core").Rationale;
      /**
       * Arguments the tool is being called with (post-heal), when the emitter
       * carries them. Lets a UI show a long-running call before it completes.
       */
      readonly args?: unknown;
    }
  | {
      /**
       * A structured-output extraction finished: how the value was obtained
       * (native, prompt, repaired, coerced, retried) or why it failed. Only
       * emitted when density is "full". One per extraction, success or failure.
       */
      readonly _tag: "StructuredOutputReported";
      /** Task the extraction ran under. */
      readonly taskId: string;
      /** Strategy that requested the extraction (e.g. `"plan-execute"`). Absent when the caller is not a strategy. */
      readonly strategy?: string;
      /** The extraction's provenance report. */
      readonly report: StructuredOutputReport;
    }
  | {
      /** A tool call completed. Only emitted when density is "full". */
      readonly _tag: "ToolCallCompleted";
      readonly toolName: string;
      readonly callId: string;
      readonly durationMs: number;
      readonly success: boolean;
      /** Arguments the tool ran with (post-heal), when the emitter carries them. */
      readonly args?: unknown;
      /** Tool output as text (capped at 8,000 chars). Present on success. */
      readonly result?: string;
      /** Failure text. Present when `success` is false. */
      readonly error?: string;
      /** True iff `result`/`error` was cut by the stream cap. */
      readonly resultTruncated?: boolean;
    }
  | {
      /**
       * Trust receipt summary (Arc 1 Task 8) — emitted immediately before
       * `StreamCompleted` on every run (both densities). Mirrors the
       * corresponding fields of `AgentResult.receipt`; NOT a truth
       * certificate — `verdict` grades the evidence trail, not factual
       * correctness. See `TrustReceipt` in `@reactive-agents/core`.
       */
      readonly _tag: "TrustEvent";
      readonly verdict: "tool-grounded" | "partially-grounded" | "ungrounded" | "abstained" | "failed";
      readonly confidence: number;
    }
  | {
      /**
       * A RunLedger entry was appended (Wave C.1 slice 3 — live ledger feed).
       * Only emitted when density is "full". Projects the core `EventBus`'s
       * `LedgerEntryAppended` event (published once per batch by
       * `KernelHooks.onLedgerAppend`) onto the public stream as one chunk
       * per entry — mirrors the ToolCallStarted/PhaseStarted per-item
       * pattern rather than re-emitting the whole batch as a single chunk.
       *
       * `entry` stays structurally typed (`Record<string, unknown>`) for the
       * same reason the bus event does: `@reactive-agents/runtime` does not
       * import the reasoning package's `LedgerEntry` union. Consumers that
       * need the narrow kinds re-import `LedgerEntry` from
       * `@reactive-agents/reasoning` and narrow on `entry.kind`
       * (e.g. "tool-invocation", "tool-result", "artifact", "requirement",
       * "claim", "verdict", "harness-signal", "handoff",
       * "compaction-marker").
       *
       * `seq` is the entry's own numeric `seq` field when present, else -1.
       */
      readonly _tag: "LedgerEntry";
      readonly entry: Record<string, unknown>;
      readonly seq: number;
    }
  // ─── Full density only: descendant (sub-agent) activity ───
  | {
      /**
       * Activity from a DESCENDANT run (sub-agent, grandchild, ...) of this
       * stream's root, wrapped once around the same projections the root gets.
       * Only emitted when density is "full". Lifecycle uses the same wrapper:
       * a child's start is a wrapped `PhaseStarted` (phase `"sub-agent"`), its
       * end a wrapped `StreamCompleted` carrying the child's output, success,
       * tokens and cost. Child token text is deliberately NOT forwarded
       * (a child's run scope starts with an empty stream sink), so there are no child
       * `TextDelta`s.
       */
      readonly _tag: "SubAgentActivity";
      readonly run: SubAgentRunInfo;
      readonly event: AgentStreamEvent;
    };

/** Identity of the descendant run a `SubAgentActivity` chunk belongs to. */
export interface SubAgentRunInfo {
  /** Stable per-child key: the child's task id. Unlike `runId`, never changes mid-run. */
  readonly key: string;
  /** Best-known `RunContext.runId` of the child (see `makeRunTree` id model). */
  readonly runId: string;
  /** The spawner's run id (the root task id for direct children). */
  readonly parentRunId?: string;
  /** Delegation depth: 1 for a direct child of the root. */
  readonly depth: number;
  /** Child display name. */
  readonly name: string;
}
