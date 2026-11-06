// File: src/strategies/planning/step-consumers.ts
/**
 * Where a plan step's output goes, derived from the plan itself.
 *
 * An analysis (or composite) step sees the OVERALL goal, so without being told
 * its consumer it answers the whole goal: H3 2026-11-05 h3-plan-only planned
 * `file-write low-stock.txt` with `content: "{{from_step:s2}}"`, and analysis
 * step s2 wrote all three files' contents, which landed verbatim in
 * low-stock.txt (qwen 4/5, cogito 5/5 failures). The plan already names the
 * consumer deterministically: every downstream tool_call argument that
 * references the step via `{{from_step:<id>}}`. This module reads those
 * references and renders one directive for the step prompt.
 */
import { fromStepRe } from "../../assembly/ref-grammar.js";
import type { PlanStep } from "../../types/plan.js";

/** One downstream tool argument that consumes a step's output. */
export interface StepConsumer {
  /** The consuming tool_call step's id. */
  readonly consumerId: string;
  readonly toolName: string;
  readonly argName: string;
  /** True when the reference IS the whole argument (the output becomes it verbatim). */
  readonly whole: boolean;
  /** The argument's template text (with the reference), when it is interpolated. */
  readonly template: string;
  /** The file the consuming call writes, when it names one (path-like literal argument). */
  readonly target?: string;
}

/** Argument names that name the file a tool call writes or reads. */
const PATH_ARGS: readonly string[] = ["path", "filePath", "file_path", "filename", "fileName", "file"];

/**
 * The literal file argument of a tool call, if any (a referenced value is not a
 * literal). Any other argument of such a call that is wholly a from_step ref is
 * that file's content (see {@link consumerDirective}; plan-refs.ts reads it too).
 */
export function literalTarget(args: Readonly<Record<string, unknown>>): { readonly argName: string; readonly path: string } | undefined {
  for (const argName of PATH_ARGS) {
    const value = args[argName];
    if (typeof value === "string" && value.trim() !== "" && !fromStepRe().test(value)) return { argName, path: value };
  }
  return undefined;
}

/**
 * Every downstream tool_call argument that references `stepId`, in plan order.
 * A step referenced only by `dependsOn` or by another step's instruction has no
 * argument consumer (its output is context, not a value).
 */
export function stepConsumers(steps: readonly PlanStep[], stepId: string): readonly StepConsumer[] {
  const out: StepConsumer[] = [];
  for (const consumer of steps) {
    if (consumer.type !== "tool_call" || consumer.toolName === undefined || consumer.toolArgs === undefined) continue;
    const target = literalTarget(consumer.toolArgs);
    for (const [argName, value] of Object.entries(consumer.toolArgs)) {
      if (typeof value !== "string") continue;
      for (const match of value.matchAll(fromStepRe())) {
        if (match[1] !== stepId) continue;
        out.push({
          consumerId: consumer.id,
          toolName: consumer.toolName,
          argName,
          whole: value.trim() === match[0],
          template: value,
          ...(target !== undefined && target.argName !== argName ? { target: target.path } : {}),
        });
      }
    }
  }
  return out;
}

/** Longest template excerpt quoted in a directive. */
const TEMPLATE_EXCERPT_CHARS = 200;

/**
 * The step-prompt directive naming where the output goes, or undefined when
 * no downstream tool argument consumes it (the prompt is then unchanged).
 */
export function consumerDirective(consumers: readonly StepConsumer[]): string | undefined {
  if (consumers.length === 0) return undefined;
  const lines = consumers.map((c) => {
    const call = `the \`${c.argName}\` argument of ${c.toolName} (step ${c.consumerId})`;
    if (c.whole) {
      return c.target !== undefined
        ? `Your entire reply becomes the content of ${c.target} (${call}). Output only that content — no file names, labels or other files.`
        : `Your entire reply becomes ${call}. Output only that value — no labels, explanations or other items.`;
    }
    const excerpt = c.template.length > TEMPLATE_EXCERPT_CHARS ? `${c.template.slice(0, TEMPLATE_EXCERPT_CHARS)}…` : c.template;
    return `Your reply fills the {{from_step}} slot in ${call}${c.target !== undefined ? ` for ${c.target}` : ""}: "${excerpt}". Output only the text for that slot.`;
  });
  return `OUTPUT DESTINATION:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

/**
 * The `outputDestination` field for `buildStepExecutionPrompt`: present only
 * when a downstream tool argument consumes `stepId` (spread it into the input).
 */
export function withOutputDestination(
  steps: readonly PlanStep[],
  stepId: string,
): { readonly outputDestination?: string } {
  const directive = consumerDirective(stepConsumers(steps, stepId));
  return directive !== undefined ? { outputDestination: directive } : {};
}
