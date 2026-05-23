import type { ReasoningStep } from "../../types/index.js";

// ── Framework-leak sanitization (M2 — sweep-2026-05-23) ─────────────────────
//
// Three patterns leaked into user-facing state.output across model tiers:
//   M2a — `<rationale call="N">{...}</rationale>` XML wrapper from think.ts:455
//         prompt scaffolding; small models (cogito:14b) reproduce literally
//         when no tool call follows. think.ts only strips these on the tool-call
//         path; non-tool path leaks them into thought → state.output.
//   M2b — `[CRITIQUE N] SATISFIED: ...` reflexion outer-loop control marker.
//         The strategy uses these as internal convergence signals; output
//         assembly never strips them.
//   M2c — `[find result — compressed preview]\nType: Object(...)` tool result
//         format template emitted by ToT when it ships tool observations
//         directly as final output without going through output synthesis.
//
// Evidence: 10/60 multi-tier matrix cells shipped these as user output.
// Fix point: strip at assembleOutput() boundary so every promotion path
// produces clean output regardless of strategy. Verifier output-not-harness-
// parrot check is the backstop for any patterns slipping through.

const FRAMEWORK_LEAK_PATTERNS: readonly RegExp[] = [
  // M2a — paired <rationale call="N">...</rationale> wrapper; multiline-safe.
  /<rationale\s+call="[^"]*"[^>]*>[\s\S]*?<\/rationale>/g,
  // M2a — orphan opening `<rationale call="N">...` with no close (model truncated).
  /<rationale\s+call="[^"]*"[^>]*>[\s\S]*?(?=$)/g,
  // M2a — orphan closing `</rationale>` left on its own line (open was stripped upstream).
  /<\/rationale>\s*/g,
  // M2b — `[CRITIQUE N] <ANY-STATUS>:` line at start-of-string or start-of-line.
  // Status word is alphabetic (SATISFIED/UNSATISFIED/PARTIAL/etc.) — catch all by allowing [A-Z]+.
  /(^|\n)\[CRITIQUE\s+\d+\]\s+[A-Z]+:[^\n]*(\n|$)/g,
  // M2c — `[find result — compressed preview]` template at start-of-string (em-dash or hyphen).
  /^\s*\[(?:find|search)\s+result\s+[—\-][\s\S]*$/,
];

/**
 * Strip framework-internal markup that leaked into model output.
 * Idempotent. Order-independent. Returns trimmed result with single internal
 * newline collapsing to preserve paragraph structure.
 *
 * Reference: M2 finding in `wiki/Research/Harness-Reports/cross-strategy-matrix-analysis-2026-05-23.md`.
 */
export function stripFrameworkLeaks(text: string): string {
  if (!text) return text;
  let result = text;
  for (const pattern of FRAMEWORK_LEAK_PATTERNS) {
    result = result.replace(pattern, "");
  }
  // Collapse runs of blank lines created by stripping
  result = result.replace(/\n{3,}/g, "\n\n").trim();
  return result;
}

/** Subset of EntropyScore — avoids cross-package dependency on reactive-intelligence. */
export interface EntropyScoreLike {
  readonly composite: number;
}

export interface OutputAssemblyContext {
  readonly steps: readonly ReasoningStep[];
  readonly finalAnswer: string;
  readonly terminatedBy: string;
  readonly entropyScores?: readonly EntropyScoreLike[];
}

export interface AssembledOutput {
  readonly text: string;
  readonly codeBlocks: readonly string[];
  readonly sources: readonly string[];
}

/** Extract fenced or indented code blocks from text. */
export function extractCodeBlocks(text: string): string[] {
  const fenced = [...text.matchAll(/```[\w]*\n([\s\S]*?)```/g)].map((m) => m[0]);
  if (fenced.length > 0) return fenced;
  const indented = [...text.matchAll(/(?:^|\n)((?:[ ]{4,}[^\n]+\n?)+)/g)].map((m) => m[1]!);
  return indented;
}

/** Check if text contains code blocks. */
function hasCodeBlocks(text: string): boolean {
  return extractCodeBlocks(text).length > 0;
}

/**
 * Assemble final output from execution trace.
 * If the final answer is a short summary but earlier steps contain code,
 * prepend the best code block to the final answer.
 */
export function assembleOutput(ctx: OutputAssemblyContext): AssembledOutput {
  const { steps, entropyScores } = ctx;
  // M2 sanitization (sweep-2026-05-23): strip framework-internal markup before
  // any further processing so all promotion paths produce clean output.
  const finalAnswer = stripFrameworkLeaks(ctx.finalAnswer);

  // Rule 1: Final answer already has code or is substantial → use as-is
  if (hasCodeBlocks(finalAnswer) || finalAnswer.length > 200) {
    return { text: finalAnswer, codeBlocks: extractCodeBlocks(finalAnswer), sources: ["final_answer"] };
  }

  // Rule 2: Look for code blocks in preceding thought steps
  const thoughtSteps = steps.filter((s) => s.type === "thought" && s.content);
  const stepsWithCode: Array<{ index: number; code: string[]; content: string }> = [];

  for (let i = 0; i < thoughtSteps.length; i++) {
    const content = thoughtSteps[i]!.content;
    const code = extractCodeBlocks(content);
    if (code.length > 0) {
      stepsWithCode.push({ index: i, code, content });
    }
  }

  if (stepsWithCode.length === 0) {
    // No code found anywhere → use final answer as-is
    return { text: finalAnswer, codeBlocks: [], sources: ["final_answer"] };
  }

  // Rule 3: Pick best code step — lowest entropy (highest signal) or most recent
  let bestStep = stepsWithCode[stepsWithCode.length - 1]!; // default: most recent
  if (entropyScores && entropyScores.length > 0) {
    let lowestEntropy = Infinity;
    for (const step of stepsWithCode) {
      const score = entropyScores[step.index];
      if (score && score.composite < lowestEntropy) {
        lowestEntropy = score.composite;
        bestStep = step;
      }
    }
  }

  const assembled = bestStep.code.join("\n\n") + "\n\n" + finalAnswer;
  return {
    text: assembled,
    codeBlocks: bestStep.code,
    sources: [`step_${bestStep.index}`, "final_answer"],
  };
}
