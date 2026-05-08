/**
 * Tool classification setup — decides which tools are "required" (the agent
 * MUST call them) vs "relevant" (visible/usable but not enforced).
 *
 * Decision tree (preserved exactly from execution-engine.ts:957-1097):
 *
 *   1. If `wantsClassification === false`: returns config defaults unchanged
 *      (no LLM call, no work).
 *
 *   2. If `wantsClassification === true` AND `classifierReliability === "low"`:
 *      skip the LLM classifier (high false-positive rate on this model) and
 *      fall back to literal tool-name mentions in the task text.
 *
 *   3. If `wantsClassification === true` AND classifier is reliable
 *      (`classifierReliability` not "low"/"skip"):
 *      call `classifyToolRelevance` (one LLM round-trip), then:
 *      a. Sanity-check the classifier's "required" set against literal task
 *         text. Hallucinated required tools (not mentioned literally in the
 *         task) are demoted to "relevant" — visible/usable but not enforced.
 *      b. Sequential mode (`parallelToolCalls === false`): clamp per-tool
 *         quantities to 1, since the model can only act on one tool at a time.
 *      c. Merge demoted-required into the relevant set.
 *
 * **Calibration awareness:** drives directly off
 * `calibration.classifierReliability`. For small-model sub-agents whose
 * classifier is unreliable, this skips the LLM round-trip and uses the
 * literal-mention heuristic — saves tokens, prevents false positives.
 *
 * Extracted from `execution-engine.ts:957-1097` (W23 step 4b).
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { classifyToolRelevance } from "@reactive-agents/reasoning";
import { literalMentionRequired } from "../../../../classifier-bypass.js";
import { extractTaskText } from "../../../util.js";
import type { ReactiveAgentsConfig } from "../../../../types.js";
import type { ObsLike } from "../../../runtime-context.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import type { Task } from "@reactive-agents/core";
import type { LLMService } from "@reactive-agents/llm-provider";

export interface ClassifierResult {
  /** Tools the agent MUST call (gate-enforced). May be undefined if config
   *  doesn't request classification or no tools are required. */
  readonly effectiveRequiredTools: readonly string[] | undefined;
  /** Per-tool minCalls (e.g., {"web-search": 3}). Clamped to 1 in sequential mode. */
  readonly effectiveRequiredToolQuantities:
    | Readonly<Record<string, number>>
    | undefined;
  /** Tools that are visible/usable but not gate-enforced. */
  readonly classifiedRelevantTools: readonly string[] | undefined;
}

export interface ClassifyToolsParams {
  readonly config: ReactiveAgentsConfig;
  readonly task: Task;
  readonly cachedToolDefs: readonly any[];
  readonly resolvedCalibration: ModelCalibration | undefined;
  readonly obs: ObsLike | null;
  readonly isNormal: boolean;
}

/**
 * Decide tool relevance for the task. Returns a typed `ClassifierResult`;
 * caller threads the fields into the kernel input.
 */
export const classifyTools = (
  params: ClassifyToolsParams,
): Effect.Effect<ClassifierResult, never, LLMService> =>
  Effect.gen(function* () {
    const { config, task, cachedToolDefs, resolvedCalibration, obs, isNormal } = params;

    let effectiveRequiredTools: readonly string[] | undefined =
      config.requiredTools?.tools;
    let effectiveRequiredToolQuantities:
      | Readonly<Record<string, number>>
      | undefined;
    let classifiedRelevantTools: readonly string[] | undefined;

    const classifierReliability = resolvedCalibration?.classifierReliability;
    const wantsClassification =
      (config.requiredTools?.adaptive && !config.requiredTools?.tools?.length) ||
      config.adaptiveToolFiltering;
    const needsClassification =
      classifierReliability !== "low" &&
      classifierReliability !== "skip" &&
      wantsClassification;

    // Branch 1: low reliability + wants classification → literal-mention fallback
    if (
      !needsClassification &&
      classifierReliability === "low" &&
      wantsClassification
    ) {
      const taskText = extractTaskText(task.input);
      const allToolNames = (cachedToolDefs ?? []).map((t: any) => t.name as string);
      const literalMentions = literalMentionRequired(taskText, allToolNames);
      if (literalMentions.length > 0) {
        effectiveRequiredTools = [...literalMentions];
        if (obs && isNormal) {
          yield* obs
            .info(
              `◉ [classify]   skipped (reliability=low); literal mentions: ${literalMentions.join(", ")}`,
            )
            .pipe(
              Effect.catchAll((err) =>
                emitErrorSwallowed({
                  site: "runtime/src/engine/phases/agent-loop/setup/classifier.ts:low-reliability-fallback",
                  tag: errorTag(err),
                }),
              ),
            );
        }
      }
      return {
        effectiveRequiredTools,
        effectiveRequiredToolQuantities,
        classifiedRelevantTools,
      };
    }

    // Branch 2: classifier not wanted → return config defaults unchanged
    if (!needsClassification) {
      return {
        effectiveRequiredTools,
        effectiveRequiredToolQuantities,
        classifiedRelevantTools,
      };
    }

    // Branch 3: classifier wanted + reliable → call classifyToolRelevance (LLM)
    const classifyResult = yield* classifyToolRelevance({
      taskDescription: extractTaskText(task.input),
      availableTools: cachedToolDefs.map((t: any) => ({
        name: t.name as string,
        description: (t.description ?? "") as string,
        parameters: ((t.parameters ?? []) as any[]).map((p: any) => ({
          name: p.name as string,
          type: (p.type ?? "string") as string,
          description: (p.description ?? "") as string,
          required: Boolean(p.required),
        })),
        ...(t.cardinality ? { cardinality: t.cardinality } : {}),
      })),
      systemPrompt: config.systemPrompt,
    }).pipe(
      // Degrade gracefully if LLM call fails — empty arrays = no filtering
      Effect.catchAll(() =>
        Effect.succeed({
          required: [] as readonly string[],
          relevant: [] as readonly string[],
          requiredToolQuantities: {} as Readonly<Record<string, number>>,
        }),
      ),
    );

    // Sanity-check classifier "required" against task text. Hallucinated tools
    // (not literally mentioned) are demoted to "relevant" — visible/usable
    // but not enforced.
    const taskTextLower = extractTaskText(task.input);
    const literalMentions = literalMentionRequired(
      taskTextLower,
      classifyResult.required,
    );
    let effectiveRequired = classifyResult.required;
    if (
      classifyResult.required.length > 1 &&
      literalMentions.length < classifyResult.required.length
    ) {
      effectiveRequired = literalMentions;
      if (obs && isNormal) {
        const demoted = classifyResult.required.filter(
          (t) => !literalMentions.includes(t),
        );
        yield* obs
          .info(`◉ [classify]   demoted to relevant (no literal mention): ${demoted.join(", ")}`)
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({
                site: "runtime/src/engine/phases/agent-loop/setup/classifier.ts:demote-hallucinated",
                tag: errorTag(err),
              }),
            ),
          );
      }
    }

    if (effectiveRequired.length > 0 && !config.requiredTools?.tools?.length) {
      effectiveRequiredTools = [...effectiveRequired];
      effectiveRequiredToolQuantities = Object.fromEntries(
        Object.entries(classifyResult.requiredToolQuantities).filter(([t]) =>
          effectiveRequired.includes(t),
        ),
      );

      // Sequential mode: clamp per-tool quantities to 1.
      if (
        config.reasoningOptions?.parallelToolCalls === false &&
        effectiveRequiredToolQuantities
      ) {
        const clamped: Record<string, number> = {};
        for (const [tool, qty] of Object.entries(effectiveRequiredToolQuantities)) {
          clamped[tool] = Math.min(qty, 1);
        }
        effectiveRequiredToolQuantities = clamped;
      }

      if (obs && isNormal) {
        const qHint = Object.entries(effectiveRequiredToolQuantities)
          .filter(([, n]) => n > 1)
          .map(([t, n]) => `${t}×${n}`)
          .join(", ");
        yield* obs
          .info(
            `◉ [classify]   required: ${effectiveRequired.join(", ")}${qHint ? ` (${qHint})` : ""}`,
          )
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({
                site: "runtime/src/engine/phases/agent-loop/setup/classifier.ts:required-log",
                tag: errorTag(err),
              }),
            ),
          );
      }
    }

    // Merge demoted-required into the relevant set.
    const demotedRelevant = classifyResult.required.filter(
      (t) => !effectiveRequired.includes(t),
    );
    const mergedRelevant = [
      ...classifyResult.relevant,
      ...demotedRelevant.filter((t) => !classifyResult.relevant.includes(t)),
    ];
    if (mergedRelevant.length > 0) {
      classifiedRelevantTools = mergedRelevant;
      if (obs && isNormal) {
        yield* obs
          .info(`◉ [classify]   relevant: ${mergedRelevant.join(", ")}`)
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({
                site: "runtime/src/engine/phases/agent-loop/setup/classifier.ts:relevant-log",
                tag: errorTag(err),
              }),
            ),
          );
      }
    }

    return {
      effectiveRequiredTools,
      effectiveRequiredToolQuantities,
      classifiedRelevantTools,
    };
  });
