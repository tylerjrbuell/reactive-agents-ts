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
import { ExecutionError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { runKernel } from "./shared/kernel-runner.js";
import { reactKernel } from "./shared/react-kernel.js";
import {
  resolveStrategyServices,
  compilePromptOrFallback,
  publishReasoningStep,
} from "./shared/service-utils.js";
import { makeStep, buildStrategyResult } from "./shared/step-utils.js";
import { isSatisfied, isCritiqueStagnant } from "./shared/quality-utils.js";
import { extractThinking } from "./shared/thinking-utils.js";
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
  ExecutionError,
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
      ? `${input.systemPrompt}\n\nExecute the task using the EXACT tool names and parameter values specified. Do NOT guess or substitute parameters. Complete ALL required actions.`
      : buildSystemPrompt(input.taskDescription);

    const genSystemPrompt = yield* compilePromptOrFallback(
      promptServiceOpt,
      "reasoning.reflexion-generate",
      { task: input.taskDescription },
      genDefaultFallback,
    );

    // Build priorContext with param hints — placed AFTER tool schemas, right before RULES
    const paramHints = extractToolParamHints(input.taskDescription);
    const genPriorContext = paramHints
      ? `⚠️ CRITICAL — use these EXACT values (do NOT substitute or guess):\n${paramHints}`
      : undefined;

    const genState = yield* runKernel(reactKernel, {
      task: buildGenerationPrompt(input, null),
      systemPrompt: genSystemPrompt,
      priorContext: genPriorContext,
      availableToolSchemas: input.availableToolSchemas,
      resultCompression: input.resultCompression,
      temperature: 0.7,
      agentId: input.agentId,
      sessionId: input.sessionId,
    }, {
      maxIterations: input.config.strategies.reflexion?.kernelMaxIterations ?? 3,
      strategy: "reflexion",
      kernelType: "react",
      taskId: input.taskId,
      kernelPass: "reflexion:generate",
    });

    let currentResponse = genState.output
      ?? [...genState.steps].filter((s) => s.type === "thought").pop()?.content
      ?? "";
    let lastKernelSteps = [...genState.steps]; // Track kernel steps for critique context
    let allSideEffectSteps = [...genState.steps]; // Accumulate ALL steps for side-effect tracking
    totalTokens += genState.tokens;
    totalCost += genState.cost;

    steps.push(makeStep("thought", `[ATTEMPT 1] ${currentResponse}`));

    yield* publishReasoningStep(ebOpt, {
      _tag: "ReasoningStepCompleted",
      taskId: input.taskId ?? "reflexion",
      strategy: "reflexion",
      step: steps.length,
      totalSteps: maxRetries + 1,
      thought: `[ATTEMPT 1] ${currentResponse}`,
      kernelPass: "reflexion:generate",
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
                lastKernelSteps,
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

      // Strip <think> blocks from critique. If the model put the entire
      // critique inside <think>, fall back to the thinking content so
      // satisfaction/stagnation detection still works.
      // When Ollama's think:true is active, the provider separates thinking
      // into response.thinking — content may already be empty.
      const { thinking: critiqueThinking, content: cleanCritique } =
        extractThinking(critiqueResponse.content);
      const providerThinking = (critiqueResponse as any).thinking as string | undefined;
      const critique = cleanCritique || critiqueThinking || providerThinking || critiqueResponse.content;
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
        kernelPass: `reflexion:critique-${attempt}`,
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
          kernelPass: `reflexion:improve-${attempt}`,
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
        ? `${input.systemPrompt}\n\nYour previous attempt had issues. Fix them by using the EXACT tool parameters from the task. Complete ALL required actions.`
        : buildSystemPrompt(input.taskDescription);

      const improveSystemPrompt = yield* compilePromptOrFallback(
        promptServiceOpt,
        "reasoning.reflexion-generate",
        { task: input.taskDescription },
        improveDefaultFallback,
      );

      // Build focused improvement task based on what was already done
      const completedActions = buildCompletedActionsContext(lastKernelSteps);
      const improvementTask = buildImprovementTask(input, previousCritiques, completedActions);
      const improvePriorContext = paramHints
        ? `⚠️ CRITICAL — use these EXACT values (do NOT substitute or guess):\n${paramHints}`
        : undefined;

      // Hard side-effect guard: identify tools with side effects that already
      // succeeded in ANY prior pass. The kernel will refuse to execute these.
      const blockedTools = extractSuccessfulSideEffectTools(allSideEffectSteps);

      const improveState = yield* runKernel(reactKernel, {
        task: improvementTask,
        systemPrompt: improveSystemPrompt,
        priorContext: improvePriorContext,
        availableToolSchemas: input.availableToolSchemas,
        resultCompression: input.resultCompression,
        temperature: 0.6,
        agentId: input.agentId,
        sessionId: input.sessionId,
        blockedTools,
      }, {
        maxIterations: input.config.strategies.reflexion?.kernelMaxIterations ?? 3,
        strategy: "reflexion",
        kernelType: "react",
        taskId: input.taskId,
        kernelPass: `reflexion:improve-${attempt}`,
      });

      const improveOutput = improveState.output
        ?? [...improveState.steps].filter((s) => s.type === "thought").pop()?.content
        ?? "";
      currentResponse = improveOutput || currentResponse;
      // Only replace critique evidence if improvement actually called tools;
      // otherwise keep prior evidence so critique sees what was already done.
      const improvementHadToolCalls = [...improveState.steps].some((s) => s.type === "action");
      if (improvementHadToolCalls) {
        lastKernelSteps = [...improveState.steps];
      }
      // Always accumulate all steps for side-effect tracking across passes
      allSideEffectSteps = [...allSideEffectSteps, ...improveState.steps];
      totalTokens += improveState.tokens;
      totalCost += improveState.cost;

      steps.push(makeStep("thought", `[ATTEMPT ${attempt + 1}] ${currentResponse}`));

      yield* publishReasoningStep(ebOpt, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "reflexion",
        strategy: "reflexion",
        step: steps.length,
        totalSteps: maxRetries + 1,
        thought: `[ATTEMPT ${attempt + 1}] ${currentResponse}`,
        kernelPass: `reflexion:improve-${attempt}`,
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
  return (
    `You are a task execution agent. Execute tasks exactly as specified.\n\n` +
    `CRITICAL RULES:\n` +
    `- Use the EXACT tool names and parameter values specified in the task.\n` +
    `- Do NOT substitute, guess, or hallucinate parameter values.\n` +
    `- Do NOT ask clarifying questions — all information is in the task.\n` +
    `- Complete ALL required actions (fetching data AND sending messages).\n` +
    `- Produce output directly — no offers, no "would you like me to...".\n\n` +
    `Task: ${taskDescription}`
  );
}

function buildGenerationPrompt(
  input: ReflexionInput,
  previousCritiques: string[] | null,
): string {
  const parts: string[] = [];

  // Extract any explicit tool call parameters from the task and highlight them
  const paramHints = extractToolParamHints(input.taskDescription);
  if (paramHints) {
    parts.push(`REQUIRED TOOL PARAMETERS (use these EXACT values):\n${paramHints}`);
  }

  parts.push(`TASK:\n${input.taskDescription}`);

  if (input.memoryContext) {
    parts.push(`CONTEXT:\n${input.memoryContext}`);
  }

  if (previousCritiques && previousCritiques.length > 0) {
    // Extract actionable fixes from critiques, not just the raw critique text
    const fixes = extractActionableFixes(previousCritiques);
    parts.push(
      `ISSUES FROM PREVIOUS ATTEMPTS (you MUST fix ALL of these):\n${fixes}`,
    );
  }

  parts.push(
    `Execute the task above step by step. Use the exact tool names and parameters specified.`,
  );

  return parts.join("\n\n");
}

/**
 * Extract explicit tool parameter hints from the task description.
 * Finds patterns like: tool_name(params), "owner: 'value'", "recipient 'value'"
 */
function extractToolParamHints(taskDescription: string): string | null {
  const hints: string[] = [];

  // Match patterns like: owner: 'luduscom', repo: 'ludus-next'
  const paramMatches = taskDescription.matchAll(
    /(\w+):\s*['"]([^'"]+)['"]/g,
  );
  for (const m of paramMatches) {
    hints.push(`  ${m[1]}: "${m[2]}"`);
  }

  // Match patterns like: tool/name with recipient '+12345'
  const toolWithArg = taskDescription.matchAll(
    /(\w+\/\w+)\s+with\s+(\w+)\s+['"]([^'"]+)['"]/g,
  );
  for (const m of toolWithArg) {
    hints.push(`  Tool: ${m[1]} → ${m[2]}: "${m[3]}"`);
  }

  return hints.length > 0 ? hints.join("\n") : null;
}

/**
 * Extract actionable fix instructions from critique text.
 * Turns verbose critique prose into concise bullet points.
 */
function extractActionableFixes(critiques: string[]): string {
  const lastCritique = critiques[critiques.length - 1] ?? "";
  const fixes: string[] = [];

  // Look for "should" / "needs to" / "must" statements — these are actionable
  const actionLines = lastCritique
    .split("\n")
    .filter(
      (line) =>
        /\b(should|must|needs? to|required|missing|incorrect|wrong)\b/i.test(line) &&
        line.trim().length > 10,
    )
    .slice(0, 5);

  if (actionLines.length > 0) {
    fixes.push(...actionLines.map((l) => `- ${l.trim().replace(/^[-•*\d.)\s]+/, "")}`));
  } else {
    // Fallback: use the whole critique compacted
    fixes.push(buildCompactedCritiqueHistory(critiques));
  }

  return fixes.join("\n");
}

/**
 * Build a focused improvement task that tells the kernel what was already done
 * and focuses only on fixing the specific issues identified by the critique.
 */
function buildImprovementTask(
  input: ReflexionInput,
  previousCritiques: string[],
  completedActions: string,
): string {
  const parts: string[] = [];

  if (completedActions) {
    parts.push(completedActions);
  }

  // Extract specific fixes needed
  const fixes = extractActionableFixes(previousCritiques);
  parts.push(`FIX THESE SPECIFIC ISSUES:\n${fixes}`);

  parts.push(`ORIGINAL TASK (for reference):\n${input.taskDescription}`);

  if (input.memoryContext) {
    parts.push(`CONTEXT:\n${input.memoryContext}`);
  }

  parts.push(
    `Focus ONLY on fixing the issues listed above. Do NOT re-execute actions that already succeeded.`,
  );

  return parts.join("\n\n");
}

/**
 * Build a summary of what was already accomplished from kernel steps.
 * Identifies side-effect tools (send/create/write) that should NOT be re-called.
 */
function buildCompletedActionsContext(steps?: readonly ReasoningStep[]): string {
  if (!steps || steps.length === 0) return "";

  const actions = steps.filter((s) => s.type === "action");
  const observations = steps.filter((s) => s.type === "observation");

  if (actions.length === 0) return "";

  const lines: string[] = ["ALREADY COMPLETED ACTIONS (do NOT repeat successful ones):"];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    // Check if the corresponding observation indicates success or error
    const obs = observations[i];
    const isError = obs && /\[Tool error/i.test(obs.content);
    const icon = isError ? "❌" : "✅";
    const content = action.content.length > 200
      ? action.content.slice(0, 200) + "..."
      : action.content;
    lines.push(`  ${icon} ${content}`);
  }

  // Identify side-effect tools that must NOT be called again
  const extractToolName = (step: ReasoningStep): string | undefined =>
    (step.metadata?.toolUsed as string | undefined)
    ?? step.content.match(/"tool"\s*:\s*"([^"]+)"/)?.[1]
    ?? step.content.match(/^(\S+)\(/)?.[1];

  const sideEffectActions = actions.filter((a) => {
    const toolName = extractToolName(a);
    return toolName != null && isSideEffectTool(toolName);
  });
  const successfulSideEffects = sideEffectActions.filter((a) => {
    const obs = observations[actions.indexOf(a)];
    return !obs || !/\[Tool error/i.test(obs.content);
  });

  if (successfulSideEffects.length > 0) {
    lines.push("\n⚠️ DO NOT call these tools again (they have side effects and already executed):");
    for (const t of successfulSideEffects) {
      const name = extractToolName(t);
      if (name) lines.push(`  - ${name}`);
    }
  }

  return lines.join("\n");
}

/**
 * Side-effect detection via word splitting (not regex \b which treats _ as word char).
 * Splits tool names on / _ - separators, then checks for side-effect verbs.
 */
const SIDE_EFFECT_WORDS = new Set([
  "send", "write", "create", "delete", "post", "push",
  "publish", "notify", "deploy", "upload", "remove", "update",
]);

function isSideEffectTool(toolName: string): boolean {
  const words = toolName.toLowerCase().split(/[/_\-]/);
  return words.some((w) => SIDE_EFFECT_WORDS.has(w));
}

function buildCritiquePrompt(
  taskDescription: string,
  response: string,
  depth: "shallow" | "deep",
  previousCritiques: string[],
  executionSteps?: readonly ReasoningStep[],
): string {
  const deepInstructions =
    depth === "deep"
      ? "\n- Check for logical consistency and coherence\n- Identify any unsupported claims or assumptions"
      : "";

  const prevCritiqueNote =
    previousCritiques.length > 0
      ? `\n\nPrevious critiques identified these issues:\n${previousCritiques.map((c, i) => `${i + 1}. ${c}`).join("\n")}\nWere these fixed in the latest attempt?`
      : "";

  // Build execution evidence — this is the PRIMARY evaluation input
  const executionEvidence = buildExecutionEvidence(executionSteps);

  // Extract required params for comparison
  const paramHints = extractToolParamHints(taskDescription);
  const paramCheck = paramHints
    ? `\nREQUIRED PARAMETERS (from task):\n${paramHints}`
    : "";

  return `Evaluate whether this task was COMPLETED based on the execution evidence.

ORIGINAL TASK:
${taskDescription}

EXECUTION EVIDENCE (what tools were actually called):
${executionEvidence || "No tool calls recorded."}

AGENT'S TEXT RESPONSE:
${response}
${paramCheck}
EVALUATION RULES:
1. Focus on whether the REQUIRED ACTIONS were taken — not text formatting or style.
2. If tools with side effects (send, write, create) succeeded, those actions are DONE.
3. Only mark UNSATISFIED if a required action was MISSING or used clearly wrong parameters.
4. Do NOT invent requirements not stated in the original task.
5. Minor issues (e.g., fetching 5 items instead of 10) are worth noting but don't invalidate completed work.${deepInstructions}${prevCritiqueNote}

Your FIRST LINE must be exactly one of:
SATISFIED: <what was accomplished>
UNSATISFIED: <what specific required action was not completed>

If UNSATISFIED, list ONLY the specific fixes needed (one per line). Be actionable and concise.`;
}

/**
 * Build a structured execution evidence summary from kernel steps.
 * Pairs each tool call with its result so the critique can see what happened.
 */
function buildExecutionEvidence(steps?: readonly ReasoningStep[]): string {
  if (!steps || steps.length === 0) return "No execution steps recorded.";

  const actions = steps.filter((s) => s.type === "action");
  const observations = steps.filter((s) => s.type === "observation");

  if (actions.length === 0) return "No tool calls were made.";

  const evidence: string[] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i].content;
    const obs = observations[i]?.content ?? "no result recorded";
    const isError = /\[Tool error/i.test(obs);
    const icon = isError ? "❌" : "✅";
    const actionStr = action.length > 200 ? action.slice(0, 200) + "..." : action;
    const obsStr = obs.length > 150 ? obs.slice(0, 150) + "..." : obs;
    evidence.push(`${icon} ${actionStr}\n   → ${obsStr}`);
  }

  return evidence.join("\n");
}

/**
 * Extract tool names that have side effects AND succeeded in a prior kernel pass.
 * These tools are blocked from re-execution in improvement passes to prevent
 * duplicate sends, writes, creates, etc.
 */
function extractSuccessfulSideEffectTools(
  steps?: readonly ReasoningStep[],
): readonly string[] {
  if (!steps || steps.length === 0) return [];

  const actions = steps.filter((s) => s.type === "action");
  const observations = steps.filter((s) => s.type === "observation");
  const blocked = new Set<string>();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const obs = observations[i];
    const isError = obs && /\[Tool error/i.test(obs.content);
    if (isError) continue; // Only block tools that succeeded

    // Extract tool name from action content (JSON: {"tool":"name",...})
    const toolName = action.metadata?.toolUsed as string | undefined
      ?? action.content.match(/"tool"\s*:\s*"([^"]+)"/)?.[1];
    if (!toolName) continue;

    // Check if this tool has side effects
    if (isSideEffectTool(toolName)) {
      blocked.add(toolName);
    }
  }

  return [...blocked];
}

function buildCompactedCritiqueHistory(critiques: string[]): string {
  if (critiques.length <= 3) {
    return critiques.map((c, i) => `${i + 1}. ${c}`).join("\n");
  }
  const older = critiques.slice(0, critiques.length - 3).map((_, i) => `${i + 1}. [addressed]`);
  const recent = critiques.slice(-3).map((c, i) => `${critiques.length - 2 + i}. ${c}`);
  return [...older, ...recent].join("\n");
}
