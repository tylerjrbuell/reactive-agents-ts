import type { AgentResultMetadata } from "./builder.js";

/** How many event types the stream emits.
 * - "tokens": TextDelta + StreamCompleted + StreamError only (minimal overhead)
 * - "full": all phase/tool/thought events too
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
      /** The LLM produced a reasoning thought. Only emitted when density is "full". */
      readonly _tag: "ThoughtEmitted";
      readonly content: string;
      readonly iteration: number;
    }
  | {
      /** A tool call started. Only emitted when density is "full". */
      readonly _tag: "ToolCallStarted";
      readonly toolName: string;
      readonly callId: string;
      /** Optional rationale (v0.11.x). */
      readonly rationale?: import("@reactive-agents/core").Rationale;
    }
  | {
      /** A tool call completed. Only emitted when density is "full". */
      readonly _tag: "ToolCallCompleted";
      readonly toolName: string;
      readonly callId: string;
      readonly durationMs: number;
      readonly success: boolean;
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
    };
