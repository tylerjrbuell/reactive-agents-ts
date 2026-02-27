// File: src/strategies/reflexion.ts
/**
 * Reflexion Strategy — Generate → Reflect → Improve loop.
 *
 * Based on the Reflexion paper (Shinn et al., 2023).
 * The agent:
 *   1. Generates an initial response (attempt)
 *   2. Self-critiques the response to identify gaps/errors
 *   3. Improves the response using the critique as feedback
 *   4. Repeats until maxRetries reached or the critique is satisfied
 */
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import type { StepId } from "../types/step.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { PromptService } from "@reactive-agents/prompts";
import { EventBus } from "@reactive-agents/core";

interface ReflexionInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
  /** Custom system prompt for steering agent behavior */
  readonly systemPrompt?: string;
  /** Task ID for event correlation */
  readonly taskId?: string;
}

/**
 * Reflexion: Generate → Self-Critique → Improve, repeating until satisfied
 * or maxRetries is reached.
 */
export const executeReflexion = (
  input: ReflexionInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const promptServiceOptRaw = yield* Effect.serviceOption(PromptService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const promptServiceOpt = promptServiceOptRaw as PromptServiceOpt;
    const ebOptRaw = yield* Effect.serviceOption(EventBus).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const ebOpt = ebOptRaw as typeof ebOptRaw;
    const { maxRetries, selfCritiqueDepth } = input.config.strategies.reflexion;
    const steps: ReasoningStep[] = [];
    const start = Date.now();
    let totalTokens = 0;
    let totalCost = 0;
    let attempt = 0;
    let previousCritiques: string[] = [];

    // ── STEP 1: Initial generation ──
    const genDefaultFallback = input.systemPrompt
      ? `${input.systemPrompt}\n\nYou are a thoughtful reasoning agent. Provide clear, accurate, and complete responses.`
      : buildSystemPrompt(input.taskDescription);

    const genSystemPrompt = yield* compilePromptOrFallback(
      promptServiceOpt,
      "reasoning.reflexion-generate",
      { task: input.taskDescription },
      genDefaultFallback,
    );
    const initialResponse = yield* llm
      .complete({
        messages: [
          {
            role: "user",
            content: buildGenerationPrompt(input, null),
          },
        ],
        systemPrompt: genSystemPrompt,
        maxTokens: selfCritiqueDepth === "deep" ? 800 : 500,
        temperature: 0.7,
      })
      .pipe(
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

    let currentResponse = initialResponse.content;
    totalTokens += initialResponse.usage.totalTokens;
    totalCost += initialResponse.usage.estimatedCost;

    steps.push({
      id: ulid() as StepId,
      type: "thought",
      content: `[ATTEMPT 1] ${currentResponse}`,
      timestamp: new Date(),
    });

    if (ebOpt._tag === "Some") {
      yield* ebOpt.value.publish({
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "reflexion",
        strategy: "reflexion",
        step: steps.length,
        totalSteps: maxRetries + 1,
        thought: `[ATTEMPT 1] ${currentResponse}`,
      }).pipe(Effect.catchAll(() => Effect.void));
    }

    // ── LOOP: Reflect → Improve ──
    while (attempt < maxRetries) {
      attempt++;

      // ── Reflect: self-critique the current response ──
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

      steps.push({
        id: ulid() as StepId,
        type: "observation",
        content: `[CRITIQUE ${attempt}] ${critique}`,
        timestamp: new Date(),
      });

      if (ebOpt._tag === "Some") {
        yield* ebOpt.value.publish({
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "reflexion",
          strategy: "reflexion",
          step: steps.length,
          totalSteps: maxRetries + 1,
          observation: `[CRITIQUE ${attempt}] ${critique}`,
        }).pipe(Effect.catchAll(() => Effect.void));
      }

      // ── Stagnation check: exit early if critique isn't changing ──
      if (isCritiqueStagnant(previousCritiques, critique)) {
        return buildResult(steps, currentResponse, "partial", start, totalTokens, totalCost, attempt);
      }

      // ── Check if satisfied ──
      if (isSatisfied(critique)) {
        if (ebOpt._tag === "Some") {
          yield* ebOpt.value.publish({
            _tag: "FinalAnswerProduced",
            taskId: input.taskId ?? "reflexion",
            strategy: "reflexion",
            answer: currentResponse,
            iteration: attempt,
            totalTokens,
          }).pipe(Effect.catchAll(() => Effect.void));
        }
        return buildResult(
          steps,
          currentResponse,
          "completed",
          start,
          totalTokens,
          totalCost,
          attempt,
        );
      }

      previousCritiques.push(critique);
      // Cap critique history to last 3 entries to prevent prompt explosion
      if (previousCritiques.length > 3) {
        previousCritiques = previousCritiques.slice(-3);
      }

      // ── Improve: generate a refined response ──
      const improveDefaultFallback = input.systemPrompt
        ? `${input.systemPrompt}\n\nYou are a thoughtful reasoning agent. Provide clear, accurate, and complete responses.`
        : buildSystemPrompt(input.taskDescription);

      const improveSystemPrompt = yield* compilePromptOrFallback(
        promptServiceOpt,
        "reasoning.reflexion-generate",
        { task: input.taskDescription },
        improveDefaultFallback,
      );
      const improvedResponse = yield* llm
        .complete({
          messages: [
            {
              role: "user",
              content: buildGenerationPrompt(input, previousCritiques),
            },
          ],
          systemPrompt: improveSystemPrompt,
          maxTokens: selfCritiqueDepth === "deep" ? 800 : 500,
          temperature: 0.6,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "reflexion",
                message: `Improvement generation failed at attempt ${attempt}`,
                step: attempt,
                cause: err,
              }),
          ),
        );

      currentResponse = improvedResponse.content;
      totalTokens += improvedResponse.usage.totalTokens;
      totalCost += improvedResponse.usage.estimatedCost;

      steps.push({
        id: ulid() as StepId,
        type: "thought",
        content: `[ATTEMPT ${attempt + 1}] ${currentResponse}`,
        timestamp: new Date(),
      });

      if (ebOpt._tag === "Some") {
        yield* ebOpt.value.publish({
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "reflexion",
          strategy: "reflexion",
          step: steps.length,
          totalSteps: maxRetries + 1,
          thought: `[ATTEMPT ${attempt + 1}] ${currentResponse}`,
        }).pipe(Effect.catchAll(() => Effect.void));
      }
    }

    // Max retries reached — return the best response so far
    return buildResult(
      steps,
      currentResponse,
      "partial",
      start,
      totalTokens,
      totalCost,
      attempt,
    );
  });

// ─── Prompt compilation helper ───

type PromptServiceOpt =
  | { _tag: "Some"; value: { compile: (id: string, vars: Record<string, unknown>) => Effect.Effect<{ content: string }, unknown> } }
  | { _tag: "None" };

function compilePromptOrFallback(
  promptServiceOpt: PromptServiceOpt,
  templateId: string,
  variables: Record<string, unknown>,
  fallback: string,
): Effect.Effect<string, never> {
  if (promptServiceOpt._tag === "None") {
    return Effect.succeed(fallback);
  }
  return promptServiceOpt.value
    .compile(templateId, variables)
    .pipe(
      Effect.map((compiled: { content: string }) => compiled.content),
      Effect.catchAll(() => Effect.succeed(fallback)),
    );
}

// ─── Private Helpers ───

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

function isSatisfied(critique: string): boolean {
  return /^SATISFIED:/i.test(critique.trim());
}

/**
 * Detects stagnant critiques — if the new critique is substantially the same
 * as the most recent one, further retries won't improve the response.
 * Uses normalized substring matching.
 */
function isCritiqueStagnant(previousCritiques: string[], newCritique: string): boolean {
  if (previousCritiques.length === 0) return false;
  const lastCritique = previousCritiques[previousCritiques.length - 1]!;
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  const a = normalize(lastCritique);
  const b = normalize(newCritique);
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length > 20 && longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.8)))) {
    return true;
  }
  return false;
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

function buildResult(
  steps: readonly ReasoningStep[],
  output: string,
  status: "completed" | "partial",
  startMs: number,
  tokensUsed: number,
  cost: number,
  iterations: number,
): ReasoningResult {
  // Confidence is higher when fewer iterations were needed
  const maxNormal = 3;
  const confidence =
    status === "completed"
      ? Math.max(0.6, 1 - (iterations / maxNormal) * 0.3)
      : 0.4;

  return {
    strategy: "reflexion",
    steps: [...steps],
    output,
    metadata: {
      duration: Date.now() - startMs,
      cost,
      tokensUsed,
      stepsCount: steps.length,
      confidence,
    },
    status,
  };
}
