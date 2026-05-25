// File: src/kernel/loop/finalize.ts
/**
 * Shared synthesis quality gate and tool-data harvest.
 *
 * Canonical home for the DATA → FORMAT synthesis pattern. Strategies that
 * complete a multi-pass trajectory and need a final output-formatting pass
 * route through here instead of reinventing the gate locally.
 *
 * Why this lives in kernel/loop/:
 *   - `collectToolData` reads from `KernelMessage[]` because the kernel
 *     conversation thread is the canonical source of truth for tool results.
 *   - `enforceQualityGate` re-validates synthesized output against the same
 *     format detector the rest of the kernel uses (`extractOutputFormat`),
 *     keeping format detection single-sourced.
 *
 * Pattern (extracted from reflexion fix `0af217c8`):
 *   1. `decideSynthesisInput` — pure decision: skip / synthesize from draft /
 *      synthesize from tool data. Synthesis fires when format is wrong OR
 *      completeness fails (placeholder detection).
 *   2. `enforceQualityGate` — Effect-returning wrapper: invoke synthesis only
 *      when needed, revalidate result, fall back to draft if synthesis fails.
 *
 * Spec: wiki/Architecture/Design-Specs/2026-05-24-strategy-composability-design.md
 */
import { Effect } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { extractOutputFormat } from "../capabilities/comprehend/task-intent.js";
import {
  validateOutputFormat,
  validateContentCompleteness,
  buildSynthesisPrompt,
} from "./output-synthesis.js";
import {
  extractThinkingSafeContent,
  THINKING_SAFE_MIN_TOKENS,
} from "../capabilities/reason/stream-parser.js";
import { withEnvContext } from "../../context/context-engine.js";
import type { KernelMessage } from "../state/kernel-state.js";

export {
  validateOutputFormat,
  validateContentCompleteness,
  buildSynthesisPrompt,
  extractOutputFormat,
};

/**
 * Pure decision: should the output be synthesized, and from what source?
 *
 * Synthesis fires when EITHER the declared format is wrong OR semantic
 * completeness fails (e.g. format-valid markdown with unfilled placeholders
 * like "[Insert BTC Price Here]" — common reflexion failure mode).
 *
 * When tool data is available it feeds synthesis (DATA → FORMAT). When it's
 * not (pure reasoning task), synthesis falls back to the draft.
 */
export function decideSynthesisInput(
  output: string,
  taskDescription: string,
  toolData: string | undefined,
): { needsSynthesis: boolean; rawForSynthesis: string } {
  const intent = extractOutputFormat(taskDescription);
  if (!intent.format) {
    return { needsSynthesis: false, rawForSynthesis: output };
  }
  const validation = validateOutputFormat(output, intent.format);
  const completeness = validateContentCompleteness(output, intent);
  if (validation.valid && completeness.complete) {
    return { needsSynthesis: false, rawForSynthesis: output };
  }
  const rawForSynthesis = toolData && toolData.length > 0 ? toolData : output;
  return { needsSynthesis: true, rawForSynthesis };
}

/**
 * Extract raw tool_result content from a kernel conversation thread.
 *
 * Reads from `KernelMessage[]` (not `ReasoningStep[]`) because the kernel
 * conversation thread is the canonical source of truth for tool execution
 * results. Errors are filtered out so synthesis never sees failure noise.
 */
export function collectToolData(messages: readonly KernelMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    if (m.role === "tool_result" && !m.isError && m.content) {
      parts.push(`[${m.toolName}] ${m.content}`);
    }
  }
  return parts.join("\n");
}

/**
 * Effect-returning synthesis quality gate.
 *
 * Decides via `decideSynthesisInput`, fires synthesis only when needed,
 * extracts thinking-safe content (recovers answers trapped inside `<think>`),
 * revalidates against the declared format, and falls back to the original
 * draft on any failure.
 *
 * Caller passes `toolData` when it has harvested real tool results from the
 * conversation thread (preferred). When omitted, synthesis runs against the
 * draft only — appropriate for strategies whose draft already concatenates
 * raw observations (e.g. plan-execute's `[EXEC` harvest).
 */
export function enforceQualityGate(input: {
  llm: LLMService["Type"];
  taskDescription: string;
  output: string;
  toolData?: string;
}): Effect.Effect<
  { output: string; tokens: number; cost: number },
  never,
  never
> {
  const decision = decideSynthesisInput(
    input.output,
    input.taskDescription,
    input.toolData,
  );
  if (!decision.needsSynthesis) {
    return Effect.succeed({ output: input.output, tokens: 0, cost: 0 });
  }
  const intent = extractOutputFormat(input.taskDescription);
  const synthesisPrompt = buildSynthesisPrompt(
    decision.rawForSynthesis,
    intent.format!,
    input.taskDescription,
  );

  return input.llm
    .complete({
      messages: [{ role: "user", content: synthesisPrompt }],
      systemPrompt: withEnvContext(undefined),
      maxTokens: THINKING_SAFE_MIN_TOKENS,
      temperature: 0.2,
    })
    .pipe(
      Effect.map((response) => {
        const { content: safeContent } = extractThinkingSafeContent(response);
        const candidate = safeContent.trim();
        if (!candidate) {
          return {
            output: input.output,
            tokens: response.usage.totalTokens,
            cost: response.usage.estimatedCost,
          };
        }
        const revalidation = validateOutputFormat(candidate, intent.format!);
        return {
          output: revalidation.valid ? candidate : input.output,
          tokens: response.usage.totalTokens,
          cost: response.usage.estimatedCost,
        };
      }),
      Effect.catchAll(() =>
        Effect.succeed({ output: input.output, tokens: 0, cost: 0 })
      ),
    );
}
