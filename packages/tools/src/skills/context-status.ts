// File: src/skills/context-status.ts
import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";

// ─── Tool Definition ───

export const contextStatusTool: ToolDefinition = {
  name: "context-status",
  description:
    "Check your current execution state: iteration count, tools already called, pending required tools, " +
    "scratchpad keys stored, and tokens used so far. Call this when you feel lost or need to verify your progress.",
  parameters: [],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 1_000,
  requiresApproval: false,
  source: "function",
};

// ─── State Shape ───

export interface ContextStatusState {
  iteration: number;
  maxIterations: number;
  toolsUsed: ReadonlySet<string>;
  requiredTools?: readonly string[];
  storedKeys?: readonly string[];
  tokensUsed?: number;
}

// ─── Handler Factory ───

export const makeContextStatusHandler =
  (state: ContextStatusState) =>
  (_args: Record<string, unknown>): Effect.Effect<unknown, never> =>
    Effect.succeed({
      iteration: state.iteration,
      maxIterations: state.maxIterations,
      remaining: state.maxIterations - state.iteration,
      toolsUsed: [...state.toolsUsed],
      toolsPending: (state.requiredTools ?? []).filter((t) => !state.toolsUsed.has(t)),
      storedKeys: state.storedKeys ?? [],
      tokensUsed: state.tokensUsed ?? 0,
    });
