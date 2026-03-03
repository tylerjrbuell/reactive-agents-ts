// File: src/strategies/reflexion.ts
/**
 * Reflexion Strategy — Generate → Reflect → Improve loop.
 *
 * Based on the Reflexion paper (Shinn et al., 2023).
 * The agent:
 *   1. Generates an initial response (attempt) — now via the ReAct kernel so it
 *      can call tools during generation and improvement passes.
 *   2. Self-critiques the response to identify gaps/errors (pure LLM — no tools
 *      needed for quality judgment).
 *   3. Improves the response using the critique as feedback (ReAct kernel again).
 *   4. Repeats until maxRetries reached or the critique is satisfied.
 */
import { Effect } from "effect";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { executeReActKernel } from "./shared/react-kernel.js";
import {
  resolveStrategyServices,
  compilePromptOrFallback,
  publishReasoningStep,
} from "./shared/service-utils.js";
import { makeStep, buildStrategyResult } from "./shared/step-utils.js";
import { isSatisfied, isCritiqueStagnant } from "./shared/quality-utils.js";
import type { ToolSchema } from "./shared/tool-utils.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";

interface ReflexionInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  /** Full tool schemas for tool-aware generation and improvement passes */
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly config: ReasoningConfig;
  /** Custom system prompt for steering agent behavior */
  readonly systemPrompt?: string;
  /** Task ID for event correlation */
  readonly taskId?: string;
  /** Tool result compression config */
  readonly resultCompression?: ResultCompressionConfig;
  /** Agent ID for tool execution attribution. Falls back to "reasoning-agent". */
  readonly agentId?: string;
  /** Session ID for tool execution attribution. Falls back to "reasoning-session". */
  readonly sessionId?: string;
  /** Critiques from prior reflexion runs on similar tasks — populated from episodic memory */
  readonly priorCritiques?: readonly string[];
}

/**
 * Reflexion: Generate → Self-Critique → Improve, repeating until satisfied
 * or maxRetries is reached.
 *
 * Generation and improvement passes use the ReAct kernel (tool-aware).
 * The critique pass is a pure LLM call — quality judgment needs no tools.
 */
export const executeReflexion = (
  input: ReflexionInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> =>
  Effect.gen(function* () {
    const { llm, promptService: promptServiceOpt, eventBus: ebOpt } =
      yield* resolveStrategyServices;

    const { maxRetries, selfCritiqueDepth } = input.config.strategies.reflexion;
    const steps: ReasoningStep[] = [];
    const start = Date.now();
    let totalTokens = 0;
    let totalCost = 0;
    let attempt = 0;
    let previousCritiques: string[] = input.priorCritiques
      ? [...input.priorCritiques]
      : [];

    // ── STEP 1: Initial generation (tool-aware via ReAct kernel) ──
    const genDefaultFallback = input.systemPrompt
      ? `${input.systemPrompt}\n\nYou are a thoughtful reasoning agent. Provide clear, accurate, and complete responses.`
      : buildSystemPrompt(input.taskDescription);

    const genSystemPrompt = yield* compilePromptOrFallback(
      promptServiceOpt,
      "reasoning.reflexion-generate",
      { task: input.taskDescription },
      genDefaultFallback,
    );

    const genResult = yield* executeReActKernel({
      task: buildGenerationPrompt(input, null),
      systemPrompt: genSystemPrompt,
      availableToolSchemas: input.availableToolSchemas,
      maxIterations: input.config.strategies.reflexion?.kernelMaxIterations ?? 3,
      temperature: 0.7,
      taskId: input.taskId,
      parentStrategy: "reflexion",
      resultCompression: input.resultCompression,
      agentId: input.agentId,
      sessionId: input.sessionId,
    }).pipe(
      Effect.mapError(
        (err) =>
          new ExecutionError({
            strategy: "reflexion",
            message: "Initial generation failed",
            step: 0,
            cause: err,
          }),
      ),
    );

    let currentResponse = genResult.output;
    totalTokens += genResult.totalTokens;
    totalCost += genResult.totalCost;

    steps.push(makeStep("thought", `[ATTEMPT 1] ${currentResponse}`));

    yield* publishReasoningStep(ebOpt, {
      _tag: "ReasoningStepCompleted",
      taskId: input.taskId ?? "reflexion",
      strategy: "reflexion",
      step: steps.length,
      totalSteps: maxRetries + 1,
      thought: `[ATTEMPT 1] ${currentResponse}`,
    });

    // ── LOOP: Reflect → Improve ──
    while (attempt < maxRetries) {
      attempt++;

      // ── Reflect: self-critique the current response (pure LLM — no tools) ──
      const critiqueDefaultFallback = input.systemPrompt
        ? `${input.systemPrompt}\n\nYou are a critical evaluator. Analyze responses for accuracy, completeness, and quality.`
        : "You are a critical evaluator. Analyze responses for accuracy, completeness, and quality.";

      const critiqueSystemPrompt = yield* compilePromptOrFallback(
        promptServiceOpt,
        "reasoning.reflexion-critique",
        {},
        critiqueDefaultFallback,
      );

      const critiqueResponse = yield* llm
        .complete({
          messages: [
            {
              role: "user",
              content: buildCritiquePrompt(
                input.taskDescription,
                currentResponse,
                selfCritiqueDepth,
                previousCritiques,
              ),
            },
          ],
          systemPrompt: critiqueSystemPrompt,
          maxTokens: selfCritiqueDepth === "deep" ? 600 : 300,
          temperature: 0.3, // low temp for objective critique
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "reflexion",
                message: `Self-critique failed at attempt ${attempt}`,
                step: attempt,
                cause: err,
              }),
          ),
        );

      const critique = critiqueResponse.content;
      totalTokens += critiqueResponse.usage.totalTokens;
      totalCost += critiqueResponse.usage.estimatedCost;

      steps.push(makeStep("observation", `[CRITIQUE ${attempt}] ${critique}`));

      yield* publishReasoningStep(ebOpt, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "reflexion",
        strategy: "reflexion",
        step: steps.length,
        totalSteps: maxRetries + 1,
        observation: `[CRITIQUE ${attempt}] ${critique}`,
      });

      // ── Stagnation check: exit early if critique isn't changing ──
      if (isCritiqueStagnant(previousCritiques, critique)) {
        return buildStrategyResult({
          strategy: "reflexion",
          steps,
          output: currentResponse,
          status: "partial",
          start,
          totalTokens,
          totalCost,
          extraMetadata: { confidence: 0.4, reflexionCritiques: previousCritiques },
        });
      }

      // ── Check if satisfied ──
      if (isSatisfied(critique)) {
        yield* publishReasoningStep(ebOpt, {
          _tag: "FinalAnswerProduced",
          taskId: input.taskId ?? "reflexion",
          strategy: "reflexion",
          answer: currentResponse,
          iteration: attempt,
          totalTokens,
        });
        return buildStrategyResult({
          strategy: "reflexion",
          steps,
          output: currentResponse,
          status: "completed",
          start,
          totalTokens,
          totalCost,
          extraMetadata: {
            confidence: Math.max(0.6, 1 - (attempt / 3) * 0.3),
            reflexionCritiques: previousCritiques,
          },
        });
      }

      previousCritiques.push(critique);

      // ── Improve: generate a refined response (tool-aware via ReAct kernel) ──
      const improveDefaultFallback = input.systemPrompt
        ? `${input.systemPrompt}\n\nYou are a thoughtful reasoning agent. Provide clear, accurate, and complete responses.`
        : buildSystemPrompt(input.taskDescription);

      const improveSystemPrompt = yield* compilePromptOrFallback(
        promptServiceOpt,
        "reasoning.reflexion-generate",
        { task: input.taskDescription },
        improveDefaultFallback,
      );

      const improveResult = yield* executeReActKernel({
        task: buildGenerationPrompt(input, previousCritiques),
        systemPrompt: improveSystemPrompt,
        availableToolSchemas: input.availableToolSchemas,
        maxIterations: input.config.strategies.reflexion?.kernelMaxIterations ?? 3,
        temperature: 0.6,
        taskId: input.taskId,
        parentStrategy: "reflexion",
        resultCompression: input.resultCompression,
        agentId: input.agentId,
        sessionId: input.sessionId,
      }).pipe(
        Effect.mapError(
          (err) =>
            new ExecutionError({
              strategy: "reflexion",
              message: `Improvement failed at attempt ${attempt}`,
              step: attempt,
              cause: err,
            }),
        ),
      );

      currentResponse = improveResult.output || currentResponse;
      totalTokens += improveResult.totalTokens;
      totalCost += improveResult.totalCost;

      steps.push(makeStep("thought", `[ATTEMPT ${attempt + 1}] ${currentResponse}`));

      yield* publishReasoningStep(ebOpt, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "reflexion",
        strategy: "reflexion",
        step: steps.length,
        totalSteps: maxRetries + 1,
        thought: `[ATTEMPT ${attempt + 1}] ${currentResponse}`,
      });
    }

    // Max retries reached — return the best response so far
    return buildStrategyResult({
      strategy: "reflexion",
      steps,
      output: currentResponse,
      status: "partial",
      start,
      totalTokens,
      totalCost,
      extraMetadata: { confidence: 0.4, reflexionCritiques: previousCritiques },
    });
  });

// ─── Private Helpers (reflexion-specific) ───

function buildSystemPrompt(taskDescription: string): string {
  return `You are a thoughtful reasoning agent. Your task is: ${taskDescription}\nProvide clear, accurate, and complete responses.`;
}

function buildGenerationPrompt(
  input: ReflexionInput,
  previousCritiques: string[] | null,
): string {
  const parts: string[] = [
    `Task: ${input.taskDescription}`,
    `Task Type: ${input.taskType}`,
  ];

  if (input.memoryContext) {
    parts.push(`Relevant Context:\n${input.memoryContext}`);
  }

  if (previousCritiques && previousCritiques.length > 0) {
    parts.push(
      `Previous attempts had these issues:\n${buildCompactedCritiqueHistory(previousCritiques)}\n\nPlease address all of these issues in your improved response.`,
    );
  }

  parts.push(
    "Provide a thorough and accurate response to the task above.",
  );

  return parts.join("\n\n");
}

function buildCritiquePrompt(
  taskDescription: string,
  response: string,
  depth: "shallow" | "deep",
  previousCritiques: string[],
): string {
  const deepInstructions =
    depth === "deep"
      ? "\n- Check for logical consistency and coherence\n- Identify any unsupported claims or assumptions\n- Assess whether all aspects of the task are addressed"
      : "";

  const prevCritiqueNote =
    previousCritiques.length > 0
      ? `\n\nPrevious critiques identified these issues:\n${previousCritiques.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nFocus on whether the new response adequately addresses these.`
      : "";

  return `Task: ${taskDescription}

Response to evaluate:
${response}

Critically evaluate this response. Identify:
- Factual errors or inaccuracies
- Missing information or incomplete answers
- Unclear or ambiguous statements${deepInstructions}${prevCritiqueNote}

If the response is accurate and complete, start your critique with "SATISFIED:".
Otherwise, clearly list the specific issues that need to be fixed.`;
}

/**
 * Progressive compaction for critique history.
 * Keeps last 3 critiques verbatim, summarizes older ones.
 */
function buildCompactedCritiqueHistory(critiques: string[]): string {
  if (critiques.length <= 3) {
    return critiques.map((c, i) => `${i + 1}. ${c}`).join("\n");
  }
  const older = critiques.slice(0, critiques.length - 3).map((_, i) => `${i + 1}. [addressed]`);
  const recent = critiques.slice(-3).map((c, i) => `${critiques.length - 2 + i}. ${c}`);
  return [...older, ...recent].join("\n");
}
