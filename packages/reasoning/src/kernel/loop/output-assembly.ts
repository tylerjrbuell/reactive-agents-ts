import type { ReasoningStep } from "../../types/index.js";

// HS-cleanup-1 (2026-05-23) — canonical root-fix.
//
// Prior shape (HS-105): regex catalog stripped 3 framework-emitted patterns
// at 4 enforcement points (output-assembly, runtime sanitizeOutput,
// normalizeReasoningResult, verifier backstop). Every new model leak required
// a new pattern. The problem was at the producers — framework scaffolding was
// flowing into model-visible step content with no audience tag.
//
// New shape:
//   1. Rationale wrapper stripped at parse time in `think.ts` (the producer).
//   2. Reflexion / ToT instrumentation steps carry
//      `step.metadata.frameworkInstrumentation = "<kind>"`.
//   3. Output assembly + runtime empty-output fallback filter on the tag.
//   4. Verifier `output-not-harness-parrot` keeps known patterns as a producer-
//      regression alarm — fail-loud, not fix-silent.
//
// `stripFrameworkLeaks` retained as an identity shim during the migration so
// runtime callers don't need to change in lockstep; it will be deleted in the
// follow-up cleanup commit.

/** Subset of EntropyScore — avoids cross-package dependency on reactive-intelligence.
 *  Carries `composite` + `trajectory` (the shape the reactive-controller's
 *  evaluate() contract requires) plus the richer optional fields the
 *  reactive-observer reads off live RI scores (sources/token/…/modelTier). */
export interface EntropyScoreLike {
  readonly composite: number;
  readonly trajectory: {
    readonly shape: string;
    readonly derivative: number;
    readonly momentum: number;
  };
  readonly token?: number;
  readonly structural?: number;
  readonly semantic?: number;
  readonly behavioral?: number;
  readonly modelTier?: string;
  readonly sources?: {
    readonly contextPressure?: number;
    readonly behavioral?: number;
  };
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

/** Predicate: is the step framework-internal scaffolding (not a user-output candidate)? */
function isFrameworkInstrumentation(step: ReasoningStep): boolean {
  return typeof step.metadata?.frameworkInstrumentation === "string" &&
    step.metadata.frameworkInstrumentation.length > 0;
}

/**
 * Assemble final output from execution trace.
 *
 * Filters steps tagged `metadata.frameworkInstrumentation` before considering
 * them as user-output candidates — these are framework control markers (e.g.
 * `[CRITIQUE N]`, `[TOT depth=2]`) that exist for the model's benefit during
 * reasoning but must never surface as the answer.
 */
export function assembleOutput(ctx: OutputAssemblyContext): AssembledOutput {
  const { steps, entropyScores } = ctx;
  const finalAnswer = ctx.finalAnswer;

  // Rule 1: Final answer already has code or is substantial → use as-is
  if (hasCodeBlocks(finalAnswer) || finalAnswer.length > 200) {
    return { text: finalAnswer, codeBlocks: extractCodeBlocks(finalAnswer), sources: ["final_answer"] };
  }

  // Rule 2: Look for code blocks in preceding thought steps (skip instrumentation)
  const thoughtSteps = steps.filter(
    (s) => s.type === "thought" && s.content && !isFrameworkInstrumentation(s),
  );
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
