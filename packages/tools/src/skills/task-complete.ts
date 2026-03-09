// File: src/skills/task-complete.ts
import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";

// ─── Tool Definition ───

export const taskCompleteTool: ToolDefinition = {
  name: "task-complete",
  description:
    "Signal that the task is fully complete with a summary of what was accomplished. " +
    "Only use this when you have completed all required steps. " +
    "FINAL ANSWER: still works as an alternative.",
  parameters: [
    {
      name: "summary",
      type: "string",
      description: "Brief summary of what was accomplished",
      required: true,
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 1_000,
  requiresApproval: false,
  source: "function",
};

// ─── Visibility Gating ───

export interface TaskCompleteVisibility {
  requiredToolsCalled: ReadonlySet<string>;
  requiredTools: readonly string[];
  iteration: number;
  hasErrors: boolean;
  hasNonMetaToolCalled: boolean;
}

/**
 * Returns true when it is appropriate to show the task-complete tool in the schema.
 *
 * All four conditions must hold:
 * 1. Every required tool has been called.
 * 2. At least 2 iterations have elapsed (prevents instant completion).
 * 3. No pending errors exist.
 * 4. At least one non-meta tool has been invoked.
 */
export function shouldShowTaskComplete(input: TaskCompleteVisibility): boolean {
  // All required tools must be called
  if (!input.requiredTools.every((t) => input.requiredToolsCalled.has(t))) return false;
  // Must be at least iteration 2
  if (input.iteration < 2) return false;
  // No pending errors
  if (input.hasErrors) return false;
  // At least one non-meta tool must have been called
  if (!input.hasNonMetaToolCalled) return false;
  return true;
}

// ─── State Shape ───

export interface TaskCompleteState {
  canComplete: boolean;
  pendingTools?: readonly string[];
}

// ─── Handler Factory ───

export const makeTaskCompleteHandler =
  (state: TaskCompleteState) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, never> => {
    if (!state.canComplete) {
      const pending = state.pendingTools?.join(", ") ?? "unknown";
      return Effect.succeed({
        error: `Cannot complete yet. Pending required tools: ${pending}`,
        canComplete: false,
      });
    }
    return Effect.succeed({
      completed: true,
      summary: args.summary as string,
    });
  };
