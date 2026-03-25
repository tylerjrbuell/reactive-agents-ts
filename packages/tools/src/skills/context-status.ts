// File: src/skills/context-status.ts
import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";

// ─── Tool Definition ───

export const contextStatusTool: ToolDefinition = {
  name: "context-status",
  description:
    "Quick execution state snapshot: iteration count, tokens used, tools called, and pending required tools. " +
    "For a full environment overview — tools, documents, skills, memory, entropy signal — use brief() instead.",
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
