/** Mirrors the AgentStreamEvent union from @reactive-agents/runtime. */
export type AgentStreamEvent =
  | { readonly _tag: "TextDelta"; readonly text: string }
  | { readonly _tag: "StreamCompleted"; readonly output: string; readonly metadata: Record<string, unknown>; readonly taskId?: string; readonly agentId?: string }
  | { readonly _tag: "StreamError"; readonly cause: string }
  | { readonly _tag: "IterationProgress"; readonly iteration: number; readonly maxIterations: number; readonly status: string }
  | { readonly _tag: "StreamCancelled"; readonly reason: string; readonly iterationsCompleted: number }
  | { readonly _tag: string; readonly [key: string]: unknown };

export type AgentHookState = "idle" | "streaming" | "completed" | "error";

export interface UseAgentStreamReturn {
  /** Accumulated text output so far (grows as TextDelta events arrive). */
  text: string;
  /** All raw events received since the last run(). */
  events: AgentStreamEvent[];
  /** Current execution status. */
  status: AgentHookState;
  /** Error message if status === "error". */
  error: string | null;
  /** Full output when status === "completed". */
  output: string | null;
  /** Trigger a new run. Cancels any in-progress stream. */
  run: (prompt: string, body?: Record<string, unknown>) => void;
  /** Cancel the active stream. */
  cancel: () => void;
}

export interface UseAgentReturn {
  /** Final output when status === "completed". */
  output: string | null;
  /** Whether the agent is currently running. */
  loading: boolean;
  /** Error message if the run failed. */
  error: string | null;
  /** Trigger a run. Resolves on completion. */
  run: (prompt: string, body?: Record<string, unknown>) => Promise<string>;
}
