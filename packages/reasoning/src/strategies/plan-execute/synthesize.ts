/**
 * Final synthesis for the plan-execute strategy.
 *
 * Extracted verbatim from the SATISFIED branch of the outer refinement loop in
 * `executePlanExecute`: one LLM call that renders a clean user-facing answer
 * from the plan's step results (feeding the FULL tool result, not the compressed
 * preview, so every item can be emitted), degrading to the joined step results if
 * the call fails. Appends the `[SYNTHESIS]` trace step and publishes
 * `FinalAnswerProduced`. The orchestrator adds the single LLM call to its count;
 * the spend is returned for its token/cost counters.
 */
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import { gatewayComplete } from "../../kernel/llm-gateway.js";
import { extractThinkingSafeContent } from "../../kernel/utils/stream-parser.js";
import { publishReasoningStep } from "../../kernel/utils/service-utils.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import { makeStep } from "../../kernel/capabilities/sense/step-utils.js";
import { withEnvContext } from "../../context/context-engine.js";
import type { ReasoningStep } from "../../types/index.js";
import type { Plan } from "../../types/plan.js";
import type { PlanExecuteInput } from "../plan-execute.js";
import { SYNTHESIZER_PERSONA } from "../planning/shared-personas.js";

export interface SynthesizeDeps {
  readonly plan: Plan;
  readonly goal: string;
  readonly input: Pick<PlanExecuteInput, "taskId" | "systemPrompt" | "temperature">;
  readonly llm: LLMService["Type"];
  readonly eventBus: StrategyServices["eventBus"];
  /** The run's reasoning-step trace (appended in place). */
  readonly steps: ReasoningStep[];
  /** Current refinement index (the iteration label on the published event). */
  readonly refinement: number;
  /** Spend before synthesis (the published event carries base + synthesis tokens). */
  readonly totalTokens: number;
}

export interface SynthesizeResult {
  readonly output: string;
  readonly tokens: number;
  readonly cost: number;
}

export const synthesizePlanAnswer = (
  deps: SynthesizeDeps,
): Effect.Effect<SynthesizeResult, never> =>
  Effect.gen(function* () {
    const { plan, goal, input, llm, eventBus, steps, refinement } = deps;
    // ── SYNTHESIZE: Produce a clean final answer from step results ──
    // Synthesis is the final render — feed it the FULL tool result
    // (fullResult) rather than the compressed preview (result) so it can
    // emit every item. Intermediate analysis/reflection prompts kept the
    // preview to protect local-tier context; synthesis needs the whole
    // payload, mirroring reactive's in-loop recall of the stored result.
    const synthResultTexts = plan.steps
      .filter((s) => s.result || s.fullResult)
      .map((s, idx) => `Step ${idx + 1}: ${s.fullResult ?? s.result}`);

    const synthLlmResponse = yield* gatewayComplete(llm, { purpose: "synthesize" }, {
        messages: [
          {
            role: "user",
            content: `Task: ${goal}\n\nExecution results:\n${synthResultTexts.join("\n")}\n\nSynthesize a clear, complete answer to the original task. Do NOT include internal details like tool names, JSON payloads, recipient numbers, or execution metadata — only user-facing content.\n\nEVIDENCE RULE: only state facts your tool results actually contain. If a requested attribute (a name, number, license, date, spec) is not in the results, say \"not found in sources\" for that item instead of guessing — invented specifics are worse than acknowledged gaps. Prefer fewer, verified items over a complete-looking but fabricated list.\n\nCOMPLETION CHECK: before finishing, re-read the Task and confirm every explicit requirement is addressed — each requested field, format, count, and any required meta-commentary (e.g. identifying conflicts, caveats, or unresolved items). If a requirement cannot be met from the results, state that explicitly instead of omitting it.`,
          },
        ],
        systemPrompt: withEnvContext(
          input.systemPrompt
            ? `${input.systemPrompt}\n\n${SYNTHESIZER_PERSONA}`
            : SYNTHESIZER_PERSONA,
        ),
        // GH #246: commanded temperature wins; unset keeps the 0.3 default.
        temperature: input.temperature ?? 0.3,
        ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
      })
      .pipe(
        Effect.catchAll(() =>
          Effect.succeed({
            content: synthResultTexts.join("\n\n"),
            usage: { totalTokens: 0, estimatedCost: 0 },
          }),
        ),
      );

    const totalTokens = deps.totalTokens + synthLlmResponse.usage.totalTokens;
    // Strict upgrade vs bare stripThinking: rescues synthesized answers
    // trapped inside <think> blocks (would have silently returned empty).
    const finalOutput = extractThinkingSafeContent(synthLlmResponse).content;

    steps.push(makeStep("thought", `[SYNTHESIS] ${finalOutput}`));

    yield* publishReasoningStep(eventBus, {
      _tag: "FinalAnswerProduced",
      taskId: input.taskId ?? "plan-execute",
      strategy: "plan-execute-reflect",
      answer: finalOutput,
      iteration: refinement,
      totalTokens,
      kernelPass: `plan-execute:synthesize`,
    });

    return { output: finalOutput, tokens: synthLlmResponse.usage.totalTokens, cost: synthLlmResponse.usage.estimatedCost };
  });
