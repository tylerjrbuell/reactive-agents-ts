/**
 * task-shape.ts — Pre-execution structural-need inference (APC-1).
 *
 * Derives the structural requirements of a task — does it need tools? multi-step
 * reasoning? citation? a structured output? — from a pure regex/keyword pass.
 *
 * Consumed by the Adaptive Prompt Composer (APC-2) to gate which prompt
 * sections to include. Trivial shape → skip rules/observations/progress
 * sections; tool/multi-step shape → keep full scaffold.
 *
 * Conservative-default contract:
 *   - When inference is uncertain, predicates return TRUE (include the section).
 *   - "trivial" verdicts require high-confidence signals from upstream
 *     `TaskComplexityClassification` AND no tool/citation cues.
 *
 * Reference: APC-0 discriminator bench (2026-05-27) — RA_MINIMAL_PROMPT=1
 * globally regressed quality (-1 task, +24% aggregate tokens) but improved
 * trivial subset (-14 to -25%). Shape-gating is the empirically-validated
 * approach: strip scaffold ONLY when shape proves it isn't load-bearing.
 */
import type { TaskComplexityClassification } from "./task-complexity.js";
import type { TaskIntent } from "./task-intent.js";

/** Inputs to {@link inferTaskShape} — the two sibling classifications. */
export interface TaskShapeInput {
  readonly complexity: TaskComplexityClassification;
  readonly intent: TaskIntent;
}

// ── TaskShape — structural requirements of a single task ─────────────────────

/** Form of output the task expects. Drives output-shape predicates. */
export type ExpectedOutputForm =
  | "fact"             // single fact, short answer ("Paris", "42")
  | "list-trivial"     // simple enumeration ("RGB colors", "days of week")
  | "explanation"      // prose explanation, no enumeration
  | "synthesis"        // multi-source synthesis (requires citation/grounding)
  | "code"             // code block as primary deliverable
  | "structured";      // JSON / CSV / HTML / markdown table (machine-parseable)

export interface TaskShape {
  /** Complexity verdict (passthrough from TaskComplexityClassification). */
  readonly complexity: "trivial" | "moderate" | "complex";
  /** Tool calls likely required to satisfy task. */
  readonly needsTools: boolean;
  /** Sequential reasoning required ("first X, then Y"). */
  readonly needsMultiStep: boolean;
  /** Output must cite external sources or be grounded in tool observations. */
  readonly needsCitation: boolean;
  /** Output must conform to machine-parseable structure (JSON/CSV/table). */
  readonly needsStructuredOutput: boolean;
  /** Form of the deliverable. */
  readonly expectedOutputForm: ExpectedOutputForm;
  /** Whether shape inference had high confidence (≥0.7). */
  readonly highConfidence: boolean;
  /** One-line reason — for telemetry + debugging. */
  readonly reason: string;
}

// ── Cue patterns ─────────────────────────────────────────────────────────────

const TOOL_CUES: readonly RegExp[] = [
  /\b(?:fetch|download|search|lookup|look\s*up|google|query|retrieve)\b/i,
  /\b(?:call|hit|request)\s+(?:the\s+)?(?:api|endpoint|url)\b/i,
  /\b(?:write|save|create|append)\s+(?:to\s+)?(?:a\s+|the\s+)?(?:file|document)\b/i,
  /\b(?:read|open|load|cat)\s+(?:the\s+|a\s+)?(?:file|document)/i,
  /\b(?:calculat\w*|compute|evaluate|solve)\b.*\b\d+/i,
  /\b\d+\s*[\+\-\*x×÷\/]\s*\d+/,
  /\b\d+\s+(?:plus|minus|times|multiplied|divided|added)\b/i,
  /\buse\s+(?:the\s+)?\w+\s+tool\b/i,
];

const MULTI_STEP_CUES: readonly RegExp[] = [
  /\b(?:then|after that|once you've|next|finally|subsequently)\b/i,
  /\b(?:first(?:ly)?[,]?\s+(?:then|next)|second(?:ly)?[,]?\s+(?:then|next))\b/i,
  /\b(?:plan|design|architect|implement|refactor|debug)\s+(?:a|an|the)\b/i,
  /\bmulti(?:-|\s)step\b/i,
  /\b(?:and\s+then|followed\s+by|after\s+(?:which|that))\b/i,
];

const CITATION_CUES: readonly RegExp[] = [
  /\b(?:cite|citation|source|reference|attribution)\b/i,
  /\baccording\s+to\b/i,
  /\b(?:with\s+sources?|with\s+citations?)\b/i,
  /\b(?:link|url)\s+to\s+(?:the\s+)?source\b/i,
];

const STRUCTURED_OUTPUT_FORMATS = new Set(["json", "csv", "html"]);

// ── Output-form inference ────────────────────────────────────────────────────

function inferOutputForm(
  classification: TaskShapeInput,
  needsTools: boolean,
  needsCitation: boolean,
): ExpectedOutputForm {
  const fmt = classification.intent.format;
  if (fmt === "code") return "code";
  if (fmt === "json" || fmt === "csv" || fmt === "html") return "structured";
  if (fmt === "markdown") return "structured";

  // MOVE-9b: `list` intent on trivial+no-tools is recall-style enumeration
  // (e.g. "List the seven days of the week"), eligible for terse identity.
  // On moderate/complex shape, lists imply analytical enumeration and stay
  // "structured" so the model keeps reasoning bias.
  if (fmt === "list") {
    return classification.complexity.complexity === "trivial" && !needsTools
      ? "list-trivial"
      : "structured";
  }

  if (needsCitation) return "synthesis";

  // Trivial + no tools + no citation = single fact
  if (classification.complexity.complexity === "trivial" && !needsTools) {
    return "fact";
  }

  return "explanation";
}

// ── Main inference ───────────────────────────────────────────────────────────

/**
 * Infer the TaskShape from a TaskClassification + raw task text.
 *
 * Pure, deterministic, no LLM call. Conservative on uncertainty — when
 * signals are mixed or low-confidence, returns shape that includes MORE
 * prompt sections (safer for quality).
 *
 * @param classification - The canonical TaskClassification from classifyTask()
 * @param task           - Raw task text (cue patterns matched directly)
 */
export function inferTaskShape(
  classification: TaskShapeInput,
  task: string,
): TaskShape {
  const normalized = task.trim();
  if (normalized.length === 0) {
    return {
      complexity: "moderate",
      needsTools: false,
      needsMultiStep: false,
      needsCitation: false,
      needsStructuredOutput: false,
      expectedOutputForm: "explanation",
      highConfidence: false,
      reason: "empty-task",
    };
  }

  const needsTools = TOOL_CUES.some((p) => p.test(normalized));
  const needsMultiStep =
    MULTI_STEP_CUES.some((p) => p.test(normalized)) ||
    classification.complexity.complexity === "complex";
  const needsCitation = CITATION_CUES.some((p) => p.test(normalized));
  const needsStructuredOutput =
    classification.intent.format !== null &&
    STRUCTURED_OUTPUT_FORMATS.has(classification.intent.format);

  const expectedOutputForm = inferOutputForm(
    classification,
    needsTools,
    needsCitation,
  );

  // High-confidence trivial shape requires:
  //   - upstream complexity verdict "trivial" (≥0.7 confidence)
  //   - NO tool cues
  //   - NO multi-step cues
  //   - NO citation cues
  //   - NO structured output requirement
  const trivialLockedIn =
    classification.complexity.complexity === "trivial" &&
    classification.complexity.confidence >= 0.7 &&
    !needsTools &&
    !needsMultiStep &&
    !needsCitation &&
    !needsStructuredOutput;

  // High-confidence complex shape requires explicit upstream complex verdict.
  const complexLockedIn =
    classification.complexity.complexity === "complex" &&
    classification.complexity.confidence >= 0.7;

  const highConfidence = trivialLockedIn || complexLockedIn || needsTools;

  const reasonParts: string[] = [
    `complexity:${classification.complexity.complexity}`,
  ];
  if (needsTools) reasonParts.push("tools");
  if (needsMultiStep) reasonParts.push("multi-step");
  if (needsCitation) reasonParts.push("citation");
  if (needsStructuredOutput) reasonParts.push(`fmt:${classification.intent.format}`);
  reasonParts.push(`form:${expectedOutputForm}`);

  return {
    complexity: classification.complexity.complexity,
    needsTools,
    needsMultiStep,
    needsCitation,
    needsStructuredOutput,
    expectedOutputForm,
    highConfidence,
    reason: reasonParts.join("/"),
  };
}
