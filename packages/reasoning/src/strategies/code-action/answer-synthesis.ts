// File: src/strategies/code-action/answer-synthesis.ts
//
// The final answer of a code-action run that completed. The program's return
// value is data, not an answer: when it is an object or array, one answer-
// writing call turns it into the response the task asked for (a report, an
// explanation). It goes through the shared quality gate (`enforceQualityGate`
// in kernel/loop/finalize.ts), the same terminal synthesis call every other
// strategy uses; no code-action-only prompt.
//
// Cortex traces 01M7T7A58VBP4CHMSJPKQ516SR / 01M7T7C5JZ2K8TKZN8KE8PSNRF
// (2026-11-19, gpt-4o): the task asked for "a full analysis report" and the
// run shipped the program's raw JSON as its successful answer.
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import { decideSynthesisInput, enforceQualityGate } from "../../kernel/loop/finalize.js";
import { extractOutputFormat } from "../../kernel/capabilities/comprehend/task-intent.js";
import { NO_TOKEN_SPEND, type TokenSpend } from "../../kernel/run-budget.js";

/** Characters of program result the answer-writing call may read. */
const MAX_MATERIAL_CHARS = 16_000;

/** What a completed run's program result becomes, and whether a call is needed. */
export interface AnswerPlan {
  /** True when one answer-writing call runs. */
  readonly synthesize: boolean;
  /** The bounded program result the call reads (empty when no call runs). */
  readonly material: string;
}

/**
 * Decide, without an LLM, whether the program's result needs an answer-writing
 * call. Structured data (object or array) does, unless the task asks for the
 * data itself (JSON or CSV). Text does only when the shared quality gate would
 * synthesize it anyway (a requested format it does not meet, scaffold leaks).
 *
 * @param finalResult - the value the program returned
 * @param rawOutput - that value as the run's output text
 * @param task - the task description
 */
export function planCodeActionAnswer(finalResult: unknown, rawOutput: string, task: string): AnswerPlan {
  const format = extractOutputFormat(task).format;
  if (format === "json" || format === "csv") return { synthesize: false, material: "" };
  const structured = typeof finalResult === "object" && finalResult !== null;
  const synthesize = structured || decideSynthesisInput(rawOutput, task, undefined).needsSynthesis;
  if (!synthesize) return { synthesize: false, material: "" };
  const material = rawOutput.length > MAX_MATERIAL_CHARS
    ? `${rawOutput.slice(0, MAX_MATERIAL_CHARS)}\n[...${rawOutput.length - MAX_MATERIAL_CHARS} more characters of the program result omitted]`
    : rawOutput;
  return { synthesize: true, material };
}

/** The answer a completed run ships, and the spend of the call that wrote it. */
export type CodeActionAnswer = TokenSpend & {
  readonly output: string;
  /** True when the answer-writing call ran (its output may still fall back to the raw result). */
  readonly synthesized: boolean;
};

/**
 * The run's final answer: the raw result when no call is needed, else the
 * answer one shared synthesis call writes from the task and the bounded
 * program result. Never fails: a failed or empty call keeps the raw result.
 *
 * @param llm - the model service
 * @param input.task - the task description
 * @param input.finalResult - the value the program returned
 * @param input.rawOutput - that value as text (the fallback answer)
 * @param input.taskId - correlates the call to its run in traces
 */
export function writeCodeActionAnswer(
  llm: LLMService["Type"],
  input: { readonly task: string; readonly finalResult: unknown; readonly rawOutput: string; readonly taskId?: string },
): Effect.Effect<CodeActionAnswer, never, never> {
  const plan = planCodeActionAnswer(input.finalResult, input.rawOutput, input.task);
  if (!plan.synthesize) return Effect.succeed({ output: input.rawOutput, synthesized: false, ...NO_TOKEN_SPEND });
  return enforceQualityGate({
    llm,
    taskDescription: input.task,
    output: input.rawOutput,
    toolData: plan.material,
    force: true,
    ...(input.taskId !== undefined ? { traceContext: { taskId: input.taskId } } : {}),
  }).pipe(Effect.map((gated) => ({ ...gated, synthesized: true })));
}
