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
import { reactKernel } from "../kernel/loop/react-kernel.js";
import { runPass } from "../kernel/loop/run-pass.js";
import {
  iterateUntil,
  continueWith,
  terminateWith,
} from "../kernel/loop/iterate-until.js";
import type { KernelMessage } from "../kernel/state/kernel-state.js";
import {
  makeStrategyEmitLog,
  emitPhaseEnd,
  resolveStrategyServices,
  compilePromptOrFallback,
  publishReasoningStep,
} from "../kernel/utils/service-utils.js";
import { makeStep, buildStrategyResult } from "../kernel/capabilities/sense/step-utils.js";
import { isSatisfied, isCritiqueStagnant } from "../kernel/capabilities/verify/quality-utils.js";
import { getMissingRequiredToolsFromSteps } from "../kernel/capabilities/verify/requirement-state.js";
import { deriveConditions } from "../kernel/capabilities/verify/derive-conditions.js";
import {
  verify,
  describeUnmet,
  type PostCondition,
} from "../kernel/capabilities/verify/post-conditions.js";
import {
  enforceQualityGate,
  collectToolData,
  decideSynthesisInput,
} from "../kernel/loop/finalize.js";
import { runCritiquePass } from "../kernel/capabilities/verify/critique.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";
import { resolveExecutableToolCapabilities } from "../kernel/capabilities/act/tool-capabilities.js";
import { emitKernelStateSnapshot } from "../kernel/utils/diagnostics.js";
import { withEnvContext } from "../context/context-engine.js";

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
  /** Tools that MUST be called before the agent can declare success */
  readonly requiredTools?: readonly string[];
  /** Classifier-relevant tools — visible/usable in the prompt but not gate-enforced.
   *  MUST be forwarded to the kernel pass: under lazy tool disclosure the kernel's
   *  per-iteration visible set = required + relevant + used + discovered + meta. If
   *  relevant is dropped, MCP/user tools are pruned and the model is left blind
   *  (only meta-tools visible) — see spot-test GitHub-MCP regression. */
  readonly relevantTools?: readonly string[];
  /** Max redirects when required tools are missing (default: 2) */
  readonly maxRequiredToolRetries?: number;
  /** Critiques from prior reflexion runs on similar tasks — populated from episodic memory */
  readonly priorCritiques?: readonly string[];
  /** Model identifier for routing/entropy scoring */
  readonly modelId?: string;
  /** LLM temperature override */
  readonly temperature?: number;
  readonly synthesisConfig?: import("../context/synthesis-types.js").SynthesisConfig;
  readonly metaTools?: KernelMetaToolsConfig;
  readonly briefResolvedSkills?: readonly { readonly name: string; readonly purpose: string }[];
  /** HS-cleanup-2: upstream task classification snapshot (currently unused, kept for forward compat). */
  readonly taskClassification?: import("../kernel/capabilities/comprehend/task-classification.js").TaskClassification;
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

    const emitLog = makeStrategyEmitLog("reasoning/src/strategies/reflexion.ts:emitLog");

    const { maxRetries, selfCritiqueDepth } = input.config.strategies.reflexion;
    const steps: ReasoningStep[] = [];
    const start = Date.now();
    const seedCritiques: readonly string[] = input.priorCritiques
      ? [...input.priorCritiques]
      : [];
    const capabilitySnapshot = yield* resolveExecutableToolCapabilities({
      availableToolSchemas: input.availableToolSchemas,
      metaTools: input.metaTools,
    });

    yield* emitLog({ _tag: "phase_started", phase: "reflexion:generate", timestamp: new Date() });

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

    const genPass = yield* runPass(reactKernel, {
      task: buildGenerationPrompt(input, null),
      systemPrompt: genSystemPrompt,
      priorContext: genPriorContext,
      availableToolSchemas: capabilitySnapshot.availableToolSchemas,
      allToolSchemas: capabilitySnapshot.allToolSchemas,
      resultCompression: input.resultCompression,
      temperature: 0.7,
      agentId: input.agentId,
      sessionId: input.sessionId,
      requiredTools: input.requiredTools,
      relevantTools: input.relevantTools,
      maxRequiredToolRetries: input.maxRequiredToolRetries,
      synthesisConfig: input.synthesisConfig,
      metaTools: input.metaTools,
      briefResolvedSkills: input.briefResolvedSkills,
    }, {
      maxIterations: input.config.strategies.reflexion?.kernelMaxIterations ?? 3,
      strategy: "reflexion",
      kernelType: "react",
      taskId: input.taskId,
      kernelPass: "reflexion:generate",
      modelId: input.modelId,
      taskDescription: input.taskDescription,
      temperature: 0.7,
    });

    const initialResponse = genPass.output ?? "";

    yield* emitPhaseEnd({ emitLog, phase: "reflexion:generate", startedAt: start, totalTokens: genPass.tokens });

    steps.push(makeStep("thought", `[ATTEMPT 1] ${initialResponse}`));

    yield* publishReasoningStep(ebOpt, {
      _tag: "ReasoningStepCompleted",
      taskId: input.taskId ?? "reflexion",
      strategy: "reflexion",
      step: steps.length,
      totalSteps: maxRetries + 1,
      thought: `[ATTEMPT 1] ${initialResponse}`,
      kernelPass: "reflexion:generate",
    });

    // ── LOOP: Reflect → Improve (via iterateUntil combinator) ──
    //
    // State carried across iterations. Outer-scope `steps` (mutable
    // accumulator), `emitLog`, `start`, `paramHints`, `capabilitySnapshot`,
    // etc. are captured by closure — only iteration-mutating state lives in S.
    interface ReflexionIterState {
      readonly response: string;
      readonly lastKernelSteps: readonly ReasoningStep[];
      readonly allSideEffectSteps: readonly ReasoningStep[];
      readonly runningMessages: readonly KernelMessage[];
      readonly previousCritiques: readonly string[];
      readonly totalTokens: number;
      readonly totalCost: number;
    }

    const loopResult = yield* iterateUntil<ReflexionIterState, ExecutionError, LLMService>({
      initial: {
        response: initialResponse,
        lastKernelSteps: genPass.steps,
        allSideEffectSteps: genPass.steps,
        runningMessages: genPass.messages,
        previousCritiques: seedCritiques,
        totalTokens: genPass.tokens,
        totalCost: genPass.cost,
      },
      maxIters: maxRetries,
      step: (s, attempt) =>
        Effect.gen(function* () {
          yield* emitLog({
            _tag: "iteration",
            iteration: attempt,
            phase: "thought",
            summary: `Reflexion attempt ${attempt}`,
            timestamp: new Date(),
          });

          // HS-113 / E2: outer-loop snapshot at each reflexion-improve boundary.
          yield* emitKernelStateSnapshot({
            state: {
              status: "evaluating" as const,
              steps: steps.map((st) => ({ type: st.type })),
              toolsUsed: new Set<string>(),
              tokens: s.totalTokens,
              cost: s.totalCost,
            },
            taskId: input.taskId ?? "reflexion",
            iteration: attempt,
            outerLoopName: "reflexion:improve",
            outerIter: attempt,
          });

          yield* emitLog({ _tag: "phase_started", phase: "reflexion:critique", timestamp: new Date() });

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

          const critiqueResult = yield* runCritiquePass({
            llm,
            systemPrompt: critiqueSystemPrompt,
            promptBody: buildCritiquePrompt(
              input.taskDescription,
              s.response,
              selfCritiqueDepth,
              s.previousCritiques,
              s.lastKernelSteps,
            ),
            depth: selfCritiqueDepth,
            strategyName: "reflexion",
            step: attempt,
          });

          const critique = critiqueResult.content || critiqueResult.thinking || "";
          const tokensAfterCritique = s.totalTokens + critiqueResult.tokens;
          const costAfterCritique = s.totalCost + critiqueResult.cost;

          yield* emitPhaseEnd({ emitLog, phase: "reflexion:critique", startedAt: start, totalTokens: tokensAfterCritique });

          // HS-cleanup-1: framework instrumentation — tag so output-assembly +
          // arbitrator skip this step when assembling user-facing answer.
          steps.push(
            makeStep("observation", `[CRITIQUE ${attempt}] ${critique}`, {
              frameworkInstrumentation: "critique-marker",
            }),
          );

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
          if (isCritiqueStagnant(s.previousCritiques, critique)) {
            yield* emitLog({
              _tag: "warning",
              message: `Critique stagnant after ${attempt} attempts, exiting early`,
              context: "reflexion",
              timestamp: new Date(),
            });
            return terminateWith(
              { ...s, totalTokens: tokensAfterCritique, totalCost: costAfterCritique },
              { kind: "stagnant", detail: `after ${attempt} attempts` },
            );
          }

          // ── Completion gate ─────────────────────────────────────────────────
          //
          // Gate A (always): the critique judges OUTPUT TEXT quality only — it
          // cannot see whether a required side-effect tool (e.g. file-write)
          // actually fired. A task that says "create a markdown file" produces a
          // good-looking summary the critique rubber-stamps as SATISFIED while the
          // file was never written. Never accept "satisfied" while a required tool
          // is still uncalled — force another improve pass to complete the action.
          // Scoped to non-empty requiredTools so no-required tasks are unchanged.
          const missingRequired = getMissingRequiredToolsFromSteps(
            s.allSideEffectSteps,
            input.requiredTools ?? [],
          );

          // Gate B (RA_POST_CONDITIONS=1, ADDITIVE): generalized PostCondition
          // spine — checks artifact deliverables derived from the task description
          // IN ADDITION to the required-tools check above. Default OFF so the
          // behaviour when the flag is absent is byte-identical to today.
          const postConditionsEnabled =
            process.env.RA_POST_CONDITIONS === "1";
          let spineUnmet: readonly PostCondition[] = [];
          if (postConditionsEnabled && isSatisfied(critique)) {
            const conditions = deriveConditions(
              input.taskDescription,
              input.requiredTools ?? [],
            );
            if (conditions.length > 0) {
              const verifyResult = verify(
                conditions,
                s.allSideEffectSteps,
                { output: s.response },
              );
              spineUnmet = verifyResult.unmet;
              if (spineUnmet.length > 0) {
                yield* emitLog({
                  _tag: "warning",
                  message: `Critique reported SATISFIED but PostCondition spine has unmet conditions: ${describeUnmet(spineUnmet)} — forcing improve pass`,
                  context: "reflexion",
                  timestamp: new Date(),
                });
              }
            }
          }

          if (isSatisfied(critique) && missingRequired.length === 0 && spineUnmet.length === 0) {
            return terminateWith(
              { ...s, totalTokens: tokensAfterCritique, totalCost: costAfterCritique },
              { kind: "satisfied", detail: `after ${attempt} attempts` },
            );
          }
          if (isSatisfied(critique) && missingRequired.length > 0) {
            yield* emitLog({
              _tag: "warning",
              message: `Critique reported SATISFIED but required tools not yet called: ${missingRequired.join(", ")} — forcing improve pass`,
              context: "reflexion",
              timestamp: new Date(),
            });
          }

          const updatedCritiques = [...s.previousCritiques, critique];

          yield* emitLog({ _tag: "phase_started", phase: "reflexion:improve", timestamp: new Date() });

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

          const completedActions = buildCompletedActionsContext(s.lastKernelSteps);
          const improvementTask = buildImprovementTask(input, updatedCritiques, completedActions);
          const improvePriorContext = paramHints
            ? `⚠️ CRITICAL — use these EXACT values (do NOT substitute or guess):\n${paramHints}`
            : undefined;

          const blockedTools = extractSuccessfulSideEffectTools(s.allSideEffectSteps);

          const improvePass = yield* runPass(reactKernel, {
            task: improvementTask,
            systemPrompt: improveSystemPrompt,
            priorContext: improvePriorContext,
            initialMessages: s.runningMessages,
            availableToolSchemas: capabilitySnapshot.availableToolSchemas,
            allToolSchemas: capabilitySnapshot.allToolSchemas,
            resultCompression: input.resultCompression,
            temperature: 0.6,
            agentId: input.agentId,
            sessionId: input.sessionId,
            blockedTools,
            requiredTools: input.requiredTools,
            relevantTools: input.relevantTools,
            maxRequiredToolRetries: input.maxRequiredToolRetries,
            synthesisConfig: input.synthesisConfig,
            metaTools: input.metaTools,
            briefResolvedSkills: input.briefResolvedSkills,
          }, {
            maxIterations: input.config.strategies.reflexion?.kernelMaxIterations ?? 3,
            strategy: "reflexion",
            kernelType: "react",
            taskId: input.taskId,
            kernelPass: `reflexion:improve-${attempt}`,
            modelId: input.modelId,
            taskDescription: input.taskDescription,
            temperature: 0.6,
          });

          const newResponse = improvePass.output || s.response;
          // Only replace critique evidence if improvement actually called tools.
          const newLastKernelSteps = improvePass.hadToolCalls ? improvePass.steps : s.lastKernelSteps;
          const newAllSideEffectSteps = [...s.allSideEffectSteps, ...improvePass.steps];
          const tokensAfterImprove = tokensAfterCritique + improvePass.tokens;
          const costAfterImprove = costAfterCritique + improvePass.cost;

          yield* emitPhaseEnd({ emitLog, phase: "reflexion:improve", startedAt: start, totalTokens: tokensAfterImprove });

          steps.push(makeStep("thought", `[ATTEMPT ${attempt + 1}] ${newResponse}`));

          yield* publishReasoningStep(ebOpt, {
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "reflexion",
            strategy: "reflexion",
            step: steps.length,
            totalSteps: maxRetries + 1,
            thought: `[ATTEMPT ${attempt + 1}] ${newResponse}`,
            kernelPass: `reflexion:improve-${attempt}`,
          });

          return continueWith<ReflexionIterState>({
            response: newResponse,
            lastKernelSteps: newLastKernelSteps,
            allSideEffectSteps: newAllSideEffectSteps,
            runningMessages: improvePass.messages,
            previousCritiques: updatedCritiques,
            totalTokens: tokensAfterImprove,
            totalCost: costAfterImprove,
          });
        }),
    });

    // ── Single finalize path — replaces 3 duplicated build-result branches ──
    const { final, reason, iters } = loopResult;
    const gated = yield* enforceQualityGate({
      llm,
      taskDescription: input.taskDescription,
      output: final.response,
      toolData: collectToolData(final.runningMessages),
    });
    const finalTokens = final.totalTokens + gated.tokens;
    const finalCost = final.totalCost + gated.cost;

    if (reason.kind === "satisfied") {
      yield* emitLog({
        _tag: "completion",
        success: true,
        summary: `Reflexion completed successfully after ${iters} attempts`,
        timestamp: new Date(),
      });
      yield* publishReasoningStep(ebOpt, {
        _tag: "FinalAnswerProduced",
        taskId: input.taskId ?? "reflexion",
        strategy: "reflexion",
        answer: gated.output,
        iteration: iters,
        totalTokens: finalTokens,
        kernelPass: `reflexion:improve-${iters}`,
      });
    } else if (reason.kind === "max-iters") {
      yield* emitLog({
        _tag: "completion",
        success: false,
        summary: `Reflexion reached max retries (${maxRetries}) without full satisfaction`,
        timestamp: new Date(),
      });
    }
    // stagnant path already emitted its own warning inside the step body.

    const status = reason.kind === "satisfied" ? "completed" : "partial";
    const confidence =
      reason.kind === "satisfied"
        ? Math.max(0.6, 1 - (iters / 3) * 0.3)
        : 0.4;

    return buildStrategyResult({
      strategy: "reflexion",
      steps,
      output: gated.output,
      status,
      start,
      totalTokens: finalTokens,
      totalCost: finalCost,
      extraMetadata: { confidence, reflexionCritiques: final.previousCritiques },
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

  // Match patterns like: owner: 'tylerjrbuell', repo: 'reactive-agents-ts'
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
function extractActionableFixes(critiques: readonly string[]): string {
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
  previousCritiques: readonly string[],
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
  previousCritiques: readonly string[],
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

function buildCompactedCritiqueHistory(critiques: readonly string[]): string {
  if (critiques.length <= 3) {
    return critiques.map((c, i) => `${i + 1}. ${c}`).join("\n");
  }
  const older = critiques.slice(0, critiques.length - 3).map((_, i) => `${i + 1}. [addressed]`);
  const recent = critiques.slice(-3).map((c, i) => `${critiques.length - 2 + i}. ${c}`);
  return [...older, ...recent].join("\n");
}

