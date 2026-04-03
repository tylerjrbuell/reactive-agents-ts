import type { ReasoningStep } from "../../types/index.js";

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
  const { finalAnswer, steps, entropyScores } = ctx;

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
