import { Effect } from "effect";
import type { ToolDefinition } from "../types.js";

// ─── Tool Definition ───────────────────────────────────────────────────────

export const finalAnswerTool: ToolDefinition = {
  name: "final-answer",
  description:
    "Submit the final answer and terminate the task. Call this when ALL required steps " +
    "are complete. Provide the actual deliverable in 'output', its format in 'format', " +
    "and a brief summary of what was accomplished in 'summary'. " +
    "This is the preferred way to end a task — do NOT write 'FINAL ANSWER:' in text when you can call this tool. " +
    "When your task involves code generation, your output field MUST contain the actual complete code — not a description of the code or a reference to code you wrote earlier. " +
    "When your task involves writing a summary, report, paragraph, or any prose content, your output field MUST contain the actual prose itself — NOT a file path, NOT a reference to a file you wrote, NOT a description of what you wrote. The user wants the content, not its location.",
  parameters: [
    {
      name: "output",
      type: "string",
      description:
        "The actual substantive deliverable the user asked for. " +
        "If they asked for a summary, this is the summary text. If they asked for code, this is the code. " +
        "If they asked for an analysis, this is the analysis. " +
        "Return a file path here ONLY when the task explicitly asked you to report a path " +
        "(e.g. 'create a file at X and tell me where it is'). " +
        "When the task asks for content (prose, code, data), the content goes here directly — not in a separate file.",
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

// ─── Dynamic description composition ──────────────────────────────────────
//
// The static `finalAnswerTool.description` includes guidance clauses for
// every task shape (prose, code, JSON, etc.). Most clauses are noise for
// any individual task. `buildFinalAnswerDescription()` composes a
// task-aware description that includes only the clauses relevant to the
// detected output format / required tools, reducing prompt size and
// preventing models from latching onto irrelevant guidance.
//
// Empirical motivation (2026-05-06): cogito:14b on T5 ("write a markdown
// report") parroted the file-path-as-deliverable example before the
// static description was tightened. Even after that fix, a prose task
// still saw the code-generation clause and vice versa. Dynamic
// composition shrinks the description and keeps guidance pointed.

/**
 * Hints driving dynamic final-answer description composition. Source layer
 * is responsible for inferring task signals (output format, required-tools
 * state) and threading model-trait signals from `ModelCalibration`.
 *
 * Multi-signal composition: each field is independent and additive —
 * present signals append targeted guidance; absent signals fall through
 * to the static base description with no narrowing.
 */
export interface FinalAnswerDescriptionContext {
  /**
   * Detected output format from the task text. `null` when the task
   * doesn't explicitly specify a shape — falls back to a generic
   * description with no shape-specific clauses.
   */
  readonly outputFormat?: "markdown" | "json" | "csv" | "html" | "code" | "list" | "prose" | null;
  /**
   * Whether the agent has user-required data tools wired. When false
   * (pure-synthesis tasks), drops the "ALL required steps complete"
   * preamble — the agent's job is just to answer.
   */
  readonly hasRequiredTools?: boolean;
  /**
   * From `ModelCalibration.systemPromptAttention`. When `"weak"`, the
   * model is known to drop system-prompt rules after a few turns; the
   * builder restates the most critical clause near the END of the
   * description (recency-bias counter). When `"strong"`, no restate.
   */
  readonly systemPromptAttention?: "strong" | "moderate" | "weak";
  /**
   * From `ModelCalibration.observationHandling`. When
   * `"needs-inline-facts"`, append guidance emphasizing that the output
   * must contain actual values from prior tool results, not references.
   * When `"hallucinate-risk"`, even stronger anti-fabrication hint.
   */
  readonly observationHandling?: "uses-recall" | "needs-inline-facts" | "hallucinate-risk";
  /**
   * From `ModelCalibration.toolCallDialect`. When `"text-parse"`, show
   * a text-call example since the model emits text-syntax tool calls,
   * not native FC. When `"native-fc"`, no example needed.
   */
  readonly toolCallDialect?: "native-fc" | "text-parse" | "none";
}

const PROSE_CLAUSE =
  "When your task involves writing a summary, report, paragraph, or any prose content, your output field MUST contain the actual prose itself — NOT a file path, NOT a reference to a file you wrote, NOT a description of what you wrote. The user wants the content, not its location.";

const CODE_CLAUSE =
  "When your task involves code generation, your output field MUST contain the actual complete code — not a description of the code or a reference to code you wrote earlier.";

/**
 * Compose a task-aware description for the final-answer tool.
 *
 * **Additive, not replacement.** Empirical evidence from cogito:14b probes
 * (2026-05-06, two runs) showed that selecting a single shape-specific
 * clause based on intent classification REGRESSED quality vs the full
 * static description (94% → 87% average; T3 100% → 78%; T4 100% → 92%).
 * Hypothesis: cogito-class models use the static description's full clause
 * list as a checklist; removing clauses removes structural guidance the
 * model relied on.
 *
 * Revised approach: always emit the full static description as the base,
 * then APPEND targeted format-specific guidance when intent is detected.
 * This preserves the pre-Path-C empirical baseline and only adds value
 * (never removes) when the classifier has a confident signal.
 *
 * Returns the static base description when no signals are available so
 * callers can invoke this unconditionally.
 */
export function buildFinalAnswerDescription(
  ctx: FinalAnswerDescriptionContext = {},
): string {
  const fmt = ctx.outputFormat ?? null;

  // ── Calibration-driven LENGTH pruning (Experiment 2, 2026-05-07) ────────
  // Empirical refutation (Path C(d) cogito:8b: 60% → 46%, n=1) showed that
  // ADDING calibration-driven text to descriptions regresses small models.
  // Inverted hypothesis: calibration should drive what to REMOVE, not what
  // to add. Cogito-class models with moderate/weak attention have a limited
  // capacity for tool-description guidance; a shorter description should
  // free attention for the actual task. Strong-attention models keep the
  // full checklist.
  //
  // Pruning policy by `systemPromptAttention`:
  //   - "weak":   preamble + fixed clause ONLY (no shape guidance).
  //   - "moderate": preamble + fixed clause + one format-relevant clause
  //                 (or PROSE_CLAUSE as default for unknown formats).
  //   - "strong" / undefined: full static description (the empirically
  //                 validated baseline for stronger models).

  const preamble =
    "Submit the final answer and terminate the task. Call this when ALL required steps are complete. Provide the actual deliverable in 'output', its format in 'format', and a brief summary of what was accomplished in 'summary'.";
  const fixedClause =
    "This is the preferred way to end a task — do NOT write 'FINAL ANSWER:' in text when you can call this tool.";

  // Format-relevant clause selection (used by moderate-attention pruning).
  const formatRelevantClause =
    fmt === "code"
      ? CODE_CLAUSE
      : fmt === "prose" || fmt === "markdown" || fmt === "list" || fmt === null
      ? PROSE_CLAUSE
      : null; // json / csv / html — no specific clause; minimal guidance

  switch (ctx.systemPromptAttention) {
    case "weak":
      // Minimum viable description for known-weak attention. Trust the
      // parameter descriptions to carry shape guidance.
      return [preamble, fixedClause].join(" ");

    case "moderate":
      // Medium length — fixed clause + one most-relevant shape clause.
      return [preamble, fixedClause, formatRelevantClause]
        .filter(Boolean)
        .join(" ");

    case "strong":
    default:
      // Full static description — the empirically validated baseline.
      // Includes BOTH prose and code clauses so the model has the complete
      // checklist (cogito:14b T4 regressed when this was stripped to one
      // clause; full checklist behavior preserved here).
      return [preamble, fixedClause, CODE_CLAUSE, PROSE_CLAUSE].join(" ");
  }
}

/**
 * Compose a task-aware description for the `output` parameter on the
 * final-answer tool. Mirrors `buildFinalAnswerDescription` shape-routing.
 */
export function buildFinalAnswerOutputDescription(
  ctx: FinalAnswerDescriptionContext = {},
): string {
  const fmt = ctx.outputFormat ?? null;
  if (fmt === "code") {
    return "The actual complete code the user asked for. Put the code itself here as a string — not a description of the code, not a path to a file containing it.";
  }
  if (fmt === "prose" || fmt === "markdown" || fmt === "list") {
    return "The actual prose / markdown / list content the user asked for. Put the synthesized text itself here — NOT a file path, NOT a reference to a file you wrote.";
  }
  if (fmt === "json") {
    return "The actual JSON literal the user asked for. Put the JSON value here as a string — not a description, not a file path.";
  }
  if (fmt === "csv" || fmt === "html") {
    return `The actual ${fmt.toUpperCase()} content the user asked for. Put the content here literally — not a file path or description.`;
  }
  // Generic fallback (no detected format).
  return [
    "The actual substantive deliverable the user asked for.",
    "If they asked for a summary, this is the summary text. If they asked for code, this is the code. If they asked for an analysis, this is the analysis.",
    "Return a file path here ONLY when the task explicitly asked you to report a path (e.g. 'create a file at X and tell me where it is').",
    "When the task asks for content (prose, code, data), the content goes here directly — not in a separate file.",
  ].join(" ");
}

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
 * Conditions:
 * 1. Every required tool has been called.
 * 2. At least 1 iteration has elapsed (prevents instant completion on first thought).
 * 3. At least one non-meta tool has been invoked.
 * 4. No pending errors exist — BUT after iteration 4, errors are forgiven
 *    (the agent has had enough time to recover; blocking it causes spinning).
 */
export function shouldShowFinalAnswer(input: FinalAnswerVisibility): boolean {
  // All required tools must be called
  if (!input.requiredTools.every((t) => input.requiredToolsCalled.has(t))) return false;
  // Must be at least iteration 1 (agent has done at least one tool call cycle)
  if (input.iteration < 1) return false;
  // At least one non-meta tool must have been called
  if (!input.hasNonMetaToolCalled) return false;
  // Errors block early completion but are forgiven after iteration 4
  if (input.hasErrors && input.iteration < 4) return false;
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
