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
    }
  | {
      /** A tool call completed. Only emitted when density is "full". */
      readonly _tag: "ToolCallCompleted";
      readonly toolName: string;
      readonly callId: string;
      readonly durationMs: number;
      readonly success: boolean;
    };
