import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";

// ─── Tool Definition ───────────────────────────────────────────────────────

export const finalAnswerTool: ToolDefinition = {
  name: "final-answer",
  description:
    "Submit the final answer and terminate the task. Call this when ALL required steps " +
    "are complete. Provide the actual deliverable in 'output', its format in 'format', " +
    "and a brief summary of what was accomplished in 'summary'. " +
    "This is the preferred way to end a task — do NOT write 'FINAL ANSWER:' in text when you can call this tool.",
  parameters: [
    {
      name: "output",
      type: "string",
      description: "The actual deliverable — the answer, result, file path, JSON data, etc.",
      required: true,
    },
    {
      name: "format",
      type: "string",
      description: "Format of output: 'text', 'json', 'markdown', 'csv', or 'html'",
      required: true,
    },
    {
      name: "summary",
      type: "string",
      description: "Brief self-report of what was accomplished (2-3 sentences)",
      required: true,
    },
    {
      name: "confidence",
      type: "string",
      description: "Your confidence in the result: 'high', 'medium', or 'low'",
      required: false,
    },
  ],
  returnType: "object",
  riskLevel: "low",
  timeoutMs: 2_000,
  requiresApproval: false,
  source: "function",
};

// ─── Visibility Gating ─────────────────────────────────────────────────────

export interface FinalAnswerVisibility {
  requiredToolsCalled: ReadonlySet<string>;
  requiredTools: readonly string[];
  iteration: number;
  hasErrors: boolean;
  hasNonMetaToolCalled: boolean;
}

/**
 * Returns true when it is appropriate to show the final-answer tool in the schema.
 *
 * All four conditions must hold:
 * 1. Every required tool has been called.
 * 2. At least 2 iterations have elapsed (prevents instant completion).
 * 3. No pending errors exist.
 * 4. At least one non-meta tool has been invoked.
 */
export function shouldShowFinalAnswer(input: FinalAnswerVisibility): boolean {
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

// ─── Handler State ─────────────────────────────────────────────────────────

export interface FinalAnswerState {
  canComplete: boolean;
  pendingTools?: readonly string[];
}

// ─── Captured Result (read by react-kernel to hard-exit) ──────────────────

export interface FinalAnswerCapture {
  output: string;
  format: string;
  summary: string;
  confidence?: string;
}

// ─── Handler Factory ───────────────────────────────────────────────────────

export const makeFinalAnswerHandler =
  (state: FinalAnswerState) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, never> => {
    if (!state.canComplete) {
      const pending = state.pendingTools?.join(", ") ?? "required tools";
      return Effect.succeed({
        accepted: false,
        error: `Cannot finalize yet. Still need to call: ${pending}`,
      });
    }

    const output = String(args.output ?? "");
    const format = String(args.format ?? "text");
    const summary = String(args.summary ?? "");
    const confidence = args.confidence ? String(args.confidence) : undefined;

    // Validate format-specific constraints
    if (format === "json") {
      try {
        JSON.parse(output);
      } catch {
        return Effect.succeed({
          accepted: false,
          error: `Output format is 'json' but output contains invalid JSON. Fix the JSON or change format to 'text'.`,
        });
      }
    }

    const capture: FinalAnswerCapture = { output, format, summary, confidence };

    return Effect.succeed({
      accepted: true,
      format,
      summary,
      confidence,
      _capture: capture,
    });
  };
