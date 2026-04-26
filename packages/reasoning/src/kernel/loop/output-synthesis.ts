/**
 * output-synthesis.ts — Canonical finalization pipeline for kernel output.
 *
 * All termination paths (model final-answer, harness stall, oracle forced, loop exit)
 * route through `finalizeOutput()`. This ensures:
 * 1. Format validation against the user's requested output format
 * 2. Synthesis/repair when raw data doesn't match (single constrained LLM call)
 * 3. Uniform `FinalizedOutput` shape for all termination reasons
 *
 * The synthesis step is optional — when LLMService is not available in the pipeline,
 * output passes through with `formatValidated: false` rather than failing.
 */
import { Effect } from "effect";
import type { OutputFormat, TaskIntent } from "../../kernel/capabilities/comprehend/task-intent.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Pre-finalization candidate produced by any termination path. */
export interface FinalAnswerCandidate {
  /** The raw output text (from assembleDeliverable, model output, or fallback). */
  readonly output: string;
  /** The detected output format hint from task intent extraction. */
  readonly formatHint: OutputFormat | null;
  /** Which termination path produced this candidate. */
  readonly source: "model" | "harness" | "oracle" | "fallback";
  /** Optional summary hint from model final-answer tool. */
  readonly summaryHint?: string;
}

/** Post-finalization result with validation metadata. */
export interface FinalizedOutput {
  /** The final output text (possibly synthesized/repaired). */
  readonly output: string;
  /** Whether the output was validated against the requested format. */
  readonly formatValidated: boolean;
  /** Whether an LLM synthesis call was made to transform the output. */
  readonly synthesized: boolean;
  /** Which termination path produced this output. */
  readonly source: "model" | "harness" | "oracle" | "fallback";
  /** If validation failed, the reason. */
  readonly validationReason?: string;
}

/** Result of format validation. */
export interface FormatValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

// ── Format Validation ────────────────────────────────────────────────────────

/**
 * Validate that output conforms to the requested format.
 * Pure function — no LLM calls.
 */
export function validateOutputFormat(
  output: string,
  format: OutputFormat | null,
): FormatValidationResult {
  if (format === null) return { valid: true };

  switch (format) {
    case "markdown":
      return validateMarkdown(output);
    case "json":
      return validateJson(output);
    case "csv":
      return validateCsv(output);
    case "html":
      return validateHtml(output);
    case "code":
      return validateCode(output);
    case "list":
      return validateList(output);
    case "prose":
      return { valid: true };
    default:
      return { valid: true };
  }
}

function validateMarkdown(output: string): FormatValidationResult {
  // Check for common markdown formatting features
  const hasHeadings = /^#{1,6}\s/m.test(output);
  const hasBold = /\*\*[^*]+\*\*/.test(output) || /__[^_]+__/.test(output);
  const hasItalic = /(?<!\*)\*(?!\*)[^*]+\*(?!\*)/.test(output) || /(?<!_)_(?!_)[^_]+_(?!_)/.test(output);
  const hasTable = output.includes("|") && (/\|[-:]+\|/.test(output) || /[-:]{3,}/.test(output.split("\n").find((l) => l.includes("---")) ?? ""));
  const hasCodeFence = /```/.test(output);
  const hasList = /^\s*[-*•]\s/m.test(output) || /^\s*\d+[.)]\s/m.test(output);
  const hasBlockquote = /^>\s/m.test(output);
  const hasLink = /\[.+?\]\(.+?\)/.test(output);
  const hasHorizontalRule = /^(?:[-*_]){3,}\s*$/m.test(output);

  if (hasHeadings || hasBold || hasItalic || hasTable || hasCodeFence || hasList || hasBlockquote || hasLink || hasHorizontalRule) {
    return { valid: true };
  }
  return { valid: false, reason: "No markdown formatting features found (headings, bold, lists, tables, code fences, etc.)" };
}

function validateJson(output: string): FormatValidationResult {
  // Try parsing directly
  try {
    JSON.parse(output.trim());
    return { valid: true };
  } catch {
    // noop — try extracting from code fence
  }
  // Try extracting from ```json ... ``` code fence
  const fenceMatch = output.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try {
      JSON.parse(fenceMatch[1].trim());
      return { valid: true };
    } catch {
      // noop
    }
  }
  return { valid: false, reason: "Output is not valid JSON" };
}

function validateCsv(output: string): FormatValidationResult {
  const lines = output.trim().split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { valid: false, reason: "CSV requires at least a header and one data row" };
  const hasCommas = lines.some((l) => l.includes(","));
  if (!hasCommas) return { valid: false, reason: "No commas found in output" };
  return { valid: true };
}

function validateHtml(output: string): FormatValidationResult {
  const hasTag = /<\w+[^>]*>/.test(output);
  if (!hasTag) return { valid: false, reason: "No HTML tags found" };
  return { valid: true };
}

function validateCode(output: string): FormatValidationResult {
  const hasCodeFence = /```/.test(output);
  const hasCodeKeywords = /\b(?:function|def|class|const|let|var|import|export|return|if|for|while)\b/.test(output);
  if (!hasCodeFence && !hasCodeKeywords) {
    return { valid: false, reason: "No code fence or recognizable code structure" };
  }
  return { valid: true };
}

function validateList(output: string): FormatValidationResult {
  const lines = output.trim().split("\n");
  const bulletLines = lines.filter((l) => /^\s*[-*•]\s/.test(l));
  const numberedLines = lines.filter((l) => /^\s*\d+[.)]\s/.test(l));
  if (bulletLines.length >= 2 || numberedLines.length >= 2) {
    return { valid: true };
  }
  return { valid: false, reason: "No bullet or numbered list structure found" };
}

// ── Content Completeness Validation ──────────────────────────────────────────

/**
 * Check whether the output mentions the entities the task explicitly named.
 *
 * Only `expectedEntities` (named items like "XRP", "ETH") drive hard validation.
 * `expectedContent` (column/field hints like "price", "source") is tracked but
 * does not trigger synthesis on its own — these are generic terms that models
 * may paraphrase legitimately.
 */
export function validateContentCompleteness(
  output: string,
  intent: TaskIntent,
): { complete: boolean; missingEntities: readonly string[]; missingContent: readonly string[] } {
  const lower = output.toLowerCase();

  const entities = intent.expectedEntities ?? [];
  const content = intent.expectedContent ?? [];

  const missingEntities = entities.filter((e) => !lower.includes(e));
  const missingContent = content.filter((c) => !lower.includes(c));

  if (entities.length === 0) {
    return { complete: true, missingEntities: [], missingContent };
  }

  const complete = missingEntities.length / entities.length < 0.5;
  if (!complete) return { complete: false, missingEntities, missingContent };

  const hasNumericalData = /\$[\d,.]+|\d+\.\d{2,}/.test(output);
  if (!hasNumericalData) {
    return {
      complete: false,
      missingEntities: [],
      missingContent: ["numerical data values"],
    };
  }

  return { complete, missingEntities, missingContent };
}

// ── Candidate Builder ────────────────────────────────────────────────────────

/**
 * Build a `FinalAnswerCandidate` from raw output and task intent.
 */
export function buildFinalAnswerCandidate(
  output: string,
  source: FinalAnswerCandidate["source"],
  intent: TaskIntent,
  summaryHint?: string,
): FinalAnswerCandidate {
  return {
    output,
    formatHint: intent.format,
    source,
    summaryHint,
  };
}

// ── Synthesis Prompt ─────────────────────────────────────────────────────────

/** Build a constrained synthesis prompt for format repair. */
export function buildSynthesisPrompt(
  rawOutput: string,
  format: OutputFormat,
  task: string,
  intent?: TaskIntent,
): string {
  const formatInstructions: Record<OutputFormat, string> = {
    markdown: "Format the data using Markdown formatting (headings, tables, lists, bold, code blocks, etc.) as appropriate for the content. If the user asked for a table, produce a proper markdown table with | separators and a header row.",
    json: "Format the data as valid JSON.",
    csv: "Format the data as CSV with a header row.",
    html: "Format the data as clean HTML.",
    code: "Provide the code in a fenced code block (```).",
    list: "Format as a bulleted or numbered list.",
    prose: "Write as flowing prose paragraphs.",
  };

  const lines = [
    `The user asked: "${task}"`,
    "",
    `They requested the output as: ${format}`,
    `Instruction: ${formatInstructions[format]}`,
  ];

  if (intent?.expectedEntities && intent.expectedEntities.length > 0) {
    lines.push(
      "",
      `REQUIRED ENTITIES — the output MUST include a data row for each of these: ${intent.expectedEntities.join(", ")}`,
    );
  }

  if (intent?.expectedContent && intent.expectedContent.length > 0) {
    lines.push(
      `REQUIRED COLUMNS/FIELDS: ${intent.expectedContent.join(", ")}`,
    );
  }

  lines.push(
    "",
    "Here is the raw data gathered by tools:",
    "---",
    rawOutput,
    "---",
    "",
    "IMPORTANT: Extract the actual data values (numbers, prices, names, dates, etc.) from the raw tool output above.",
    "Produce a professional, well-formatted response that directly answers the user's question.",
    "Produce ONLY the formatted output — no explanation, no preamble, no meta-commentary about the data source.",
  );

  return lines.join("\n");
}

// ── Finalization Pipeline ────────────────────────────────────────────────────

/**
 * Canonical finalization pipeline. All termination paths route through here.
 *
 * 1. If no format requested → pass through unchanged
 * 2. If format matches → pass through validated
 * 3. If format doesn't match → attempt LLM synthesis (if available)
 * 4. If synthesis unavailable or fails → return with formatValidated=false
 *
 * This is a pure Effect that does NOT require LLMService — synthesis is attempted
 * only when the LLM is available. Without it, output degrades gracefully.
 */
export function finalizeOutput(
  candidate: FinalAnswerCandidate,
  intent: TaskIntent,
  task: string,
): Effect.Effect<FinalizedOutput, never, never> {
  return Effect.succeed(finalizeOutputSync(candidate, intent, task));
}

/**
 * Synchronous finalization — validates format and returns result.
 * Synthesis (LLM repair) is handled separately by the caller when needed.
 */
function finalizeOutputSync(
  candidate: FinalAnswerCandidate,
  intent: TaskIntent,
  _task: string,
): FinalizedOutput {
  // Harness/oracle-assembled output is raw tool data — always needs synthesis
  // when a format is requested OR when any format cues were detected.
  if (candidate.source === "harness" || candidate.source === "oracle") {
    return {
      output: candidate.output,
      formatValidated: false,
      synthesized: false,
      source: candidate.source,
      validationReason: `Output assembled by ${candidate.source} from raw tool artifacts — synthesis required`,
    };
  }

  // Content completeness check — applies regardless of format.
  // If the task named specific entities (e.g. "XRP, XLM, ETH, Bitcoin") and
  // more than half are missing from the output, force synthesis even when the
  // structural format looks fine.
  const contentCheck = validateContentCompleteness(candidate.output, intent);

  // No format requested and model-generated → pass through unless content is incomplete
  if (!intent.format && candidate.source === "model") {
    if (!contentCheck.complete) {
      const missing = [...contentCheck.missingEntities, ...contentCheck.missingContent];
      return {
        output: candidate.output,
        formatValidated: false,
        synthesized: false,
        source: candidate.source,
        validationReason: `Output missing expected content: ${missing.join(", ")}`,
      };
    }
    return {
      output: candidate.output,
      formatValidated: true,
      synthesized: false,
      source: candidate.source,
    };
  }

  // No format requested (fallback source) → pass through
  if (!intent.format) {
    return {
      output: candidate.output,
      formatValidated: true,
      synthesized: false,
      source: candidate.source,
    };
  }

  // Validate against requested format
  const validation = validateOutputFormat(candidate.output, intent.format);

  // Even if format is structurally valid, content must be complete
  if (validation.valid && contentCheck.complete) {
    return {
      output: candidate.output,
      formatValidated: true,
      synthesized: false,
      source: candidate.source,
    };
  }

  // Format or content doesn't match — mark as not validated
  const reasons: string[] = [];
  if (!validation.valid && validation.reason) reasons.push(validation.reason);
  if (!contentCheck.complete) {
    const missing = [...contentCheck.missingEntities, ...contentCheck.missingContent];
    reasons.push(`Missing expected content: ${missing.join(", ")}`);
  }

  return {
    output: candidate.output,
    formatValidated: false,
    synthesized: false,
    source: candidate.source,
    validationReason: reasons.join("; "),
  };
}
