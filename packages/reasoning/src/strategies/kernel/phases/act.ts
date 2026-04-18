/**
 * Act phase — executes pending native tool calls, including meta-tools and
 * the final-answer hard gate.
 *
 * Extracted from react-kernel.ts. Introduces a MetaToolHandler registry
 * so that adding a new inline meta-tool is a one-line addition instead of
 * another 30-line if-block.
 */
import { Effect, Ref } from "effect";
import { LLMService, selectAdapter } from "@reactive-agents/llm-provider";
import { ObservableLogger } from "@reactive-agents/observability";
import type { LogEvent } from "@reactive-agents/observability";
import {
  makeFinalAnswerHandler,
  scratchpadStoreRef,
  detectCompletionGaps,
  type FinalAnswerCapture,
  buildBriefResponse,
  mergeBriefAvailableSkills,
  type BriefInput,
  buildPulseResponse,
  type PulseInput,
  type ToolCallSpec,
} from "@reactive-agents/tools";
import { makeStep } from "../utils/step-utils.js";
import { executeNativeToolCall, makeObservationResult, extractObservationFacts } from "../utils/tool-execution.js";
import {
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelMessage,
} from "../kernel-state.js";
import { planNextMoveBatches } from "../utils/tool-gating.js";
import {
  buildSuccessfulToolCallCounts,
  getMissingRequiredToolsByCount,
} from "../utils/requirement-state.js";
import { checkToolCall, defaultGuards } from "./guard.js";
import { META_TOOLS, INTROSPECTION_META_TOOLS } from "../kernel-constants.js";

const REQUIRED_TOOLS_SATISFIED_PREFIX = "Required tool calls are satisfied";

const emitLog = (event: LogEvent): Effect.Effect<void, never> =>
  Effect.serviceOption(ObservableLogger).pipe(
    Effect.flatMap((opt) =>
      opt._tag === "Some"
        ? opt.value.emit(event).pipe(Effect.catchAll(() => Effect.void))
        : Effect.void,
    ),
  );

function isGuardHardFailure(observation: string): boolean {
  return observation.includes("is not available in this run");
}

function normalizeToolCallArguments(toolCall: ToolCallSpec): ToolCallSpec {
  const args = typeof toolCall.arguments === "object" && toolCall.arguments !== null
    ? { ...(toolCall.arguments as Record<string, unknown>) }
    : {};

  if (toolCall.name === "web-search") {
    if (typeof args.query !== "string" || args.query.trim().length === 0) {
      const rawQueries = args.queries;
      const queries = Array.isArray(rawQueries)
        ? rawQueries.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : typeof rawQueries === "string" && rawQueries.trim().length > 0
          ? [rawQueries]
          : [];
      if (queries.length > 0) {
        args.query = queries.join(" OR ");
      }
    }
    delete args.queries;
  }

  if (toolCall.name === "http-get") {
    if (typeof args.url !== "string" || args.url.trim().length === 0) {
      const rawUrls = args.urls;
      const urls = Array.isArray(rawUrls)
        ? rawUrls.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : typeof rawUrls === "string" && rawUrls.trim().length > 0
          ? [rawUrls]
          : [];
      if (urls.length > 0) {
        args.url = urls[0]!;
      }
    }
    delete args.urls;
  }

  return {
    ...toolCall,
    arguments: args,
  };
}

/** Observation is a compressed preview that points at scratchpad storage — model must recall before synthesizing. */
function observationReferencesStoredOverflow(content: string): boolean {
  return (
    content.includes("[STORED:") &&
    content.includes("_tool_result_") &&
    (content.includes("full text is stored") ||
      content.includes("full data is stored") ||
      content.includes("full object is stored"))
  );
}

// ─── Meta-Tool Registry ───────────────────────────────────────────────────────

type MetaToolResult = { readonly content: string; readonly success: boolean };

type MetaToolHandler = (
  tc: ToolCallSpec,
  state: KernelState,
  context: KernelContext,
  allSteps: readonly import("../../../types/index.js").ReasoningStep[],
  newToolsUsed: Set<string>,
) => Effect.Effect<MetaToolResult, never>;

/**
 * brief — situational awareness snapshot (inline, no ToolService round-trip).
 */
function handleBriefTool(
  tc: ToolCallSpec,
  state: KernelState,
  context: KernelContext,
  _allSteps: readonly import("../../../types/index.js").ReasoningStep[],
  _newToolsUsed: Set<string>,
): Effect.Effect<MetaToolResult, never> {
  return Effect.gen(function* () {
    const { input } = context;
    const liveStore = yield* Ref.get(scratchpadStoreRef);
    const recallKeys = [...liveStore.keys()];
    const briefInput: BriefInput = {
      section: tc.arguments?.section as string | undefined,
      availableTools: input.availableToolSchemas ?? [],
      indexedDocuments: input.metaTools?.staticBriefInfo?.indexedDocuments ?? [],
      availableSkills: mergeBriefAvailableSkills(
        input.metaTools?.staticBriefInfo?.availableSkills,
        input.briefResolvedSkills,
      ),
      memoryBootstrap: input.metaTools?.staticBriefInfo?.memoryBootstrap ?? { semanticLines: 0, episodicEntries: 0 },
      recallKeys,
      tokens: state.tokens,
      tokenBudget: input.contextProfile?.maxTokens ?? 8000,
      entropy: state.meta.entropy?.latest,
      controllerDecisionLog: state.controllerDecisionLog,
      iterationCount: state.iteration,
    };
    const briefContent = buildBriefResponse(briefInput);
    return { content: briefContent, success: true };
  });
}

/**
 * pulse — reactive intelligence introspection (inline, no ToolService round-trip).
 */
function handlePulseTool(
  tc: ToolCallSpec,
  state: KernelState,
  context: KernelContext,
  allSteps: readonly import("../../../types/index.js").ReasoningStep[],
  newToolsUsed: Set<string>,
): Effect.Effect<MetaToolResult, never> {
  return Effect.gen(function* () {
    const { input } = context;
    const pulseInput: PulseInput = {
      question: tc.arguments?.question as string | undefined,
      entropy: state.meta.entropy?.latest as PulseInput["entropy"],
      controllerDecisionLog: state.controllerDecisionLog,
      steps: allSteps as import("../../../types/index.js").ReasoningStep[],
      iteration: state.iteration,
      maxIterations: (state.meta.maxIterations as number | undefined) ?? 10,
      tokens: state.tokens,
      tokenBudget: input.contextProfile?.maxTokens ?? 8000,
      task: input.task,
      allToolSchemas: input.allToolSchemas ?? input.availableToolSchemas ?? [],
      toolsUsed: newToolsUsed,
      requiredTools: input.requiredTools ?? [],
    };
    const pulseContent = JSON.stringify(buildPulseResponse(pulseInput), null, 2);
    return { content: pulseContent, success: true };
  });
}

/**
 * Open registry — new inline meta-tools are a one-line addition.
 * Tools that go through ToolService (recall, find) are NOT in this registry.
 */
const metaToolRegistry = new Map<string, MetaToolHandler>([
  ["brief", handleBriefTool],
  ["pulse", handlePulseTool],
]);

// ─── Act Phase ────────────────────────────────────────────────────────────────

export function handleActing(
  state: KernelState,
  context: KernelContext,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    const { input, profile, compression, toolService, hooks } = context;
    // profileOverrides were already merged into `profile` by kernel-runner;
    // here we only need the adapter.
    const { adapter } = selectAdapter({ supportsToolCalling: true }, profile.tier, input.modelId);

    const obsMode = input.observationSummary;
    const shouldExtract = obsMode === true
      || (obsMode !== false && (profile.tier === "local" || profile.tier === "mid"));

    // ── NATIVE FC ACTING BRANCH ─────────────────────────────────────────────
    // When the thinking phase stored pendingNativeToolCalls, execute them here
    // using the structured ToolCallSpec (pre-parsed arguments, no regex repair).
    const pendingNativeCalls = state.meta.pendingNativeToolCalls as readonly ToolCallSpec[] | undefined;
    if (pendingNativeCalls && pendingNativeCalls.length > 0) {
      const normalizedPendingCalls = pendingNativeCalls.map(normalizeToolCallArguments);
      const newToolsUsed = new Set(state.toolsUsed);
      let allSteps = [...state.steps];
      // Meta-tool dedup tracking — updated per tool call, written to state at the end.
      let lastMetaToolCall: string | undefined = state.lastMetaToolCall;
      let consecutiveMetaToolCount: number = state.consecutiveMetaToolCount ?? 0;

      // `recall` reads scratchpadStoreRef (see tool-capabilities registration). Large tool
      // results are auto-stored under `_tool_result_*` during compression — they must land in
      // that same Map, not only KernelState.scratchpad, or recall(key) returns found:false.
      const sharedScratchpad = yield* Ref.get(scratchpadStoreRef);
      for (const [k, v] of state.scratchpad) {
        sharedScratchpad.set(k, v);
      }

      const plannedBatches = planNextMoveBatches(
        normalizedPendingCalls,
        input.nextMovesPlanning,
      );
      const batchLeaderToCalls = new Map<string, readonly ToolCallSpec[]>();
      const batchFollowers = new Set<string>();
      for (const batch of plannedBatches) {
        if (batch.length <= 1) continue;
        const leader = batch[0];
        if (!leader) continue;
        batchLeaderToCalls.set(leader.id, batch);
        for (const follower of batch.slice(1)) {
          batchFollowers.add(follower.id);
        }
      }

      for (let idx = 0; idx < normalizedPendingCalls.length; idx++) {
        const tc = normalizedPendingCalls[idx]!;
        if (batchFollowers.has(tc.id)) {
          continue;
        }

        // ── Check meta-tool registry first (brief, pulse) ─────────────────────
        const metaHandler = metaToolRegistry.get(tc.name);
        if (metaHandler && (
          (tc.name === "brief" && input.metaTools?.brief) ||
          (tc.name === "pulse" && input.metaTools?.pulse)
        )) {
          const { content, success } = yield* metaHandler(tc, state, context, allSteps, newToolsUsed);
          const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          });
          const obsStep = makeStep("observation", content, {
            toolCallId: tc.id,
            observationResult: makeObservationResult(tc.name, success, content),
          });
          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
          yield* hooks.onObservation(
            transitionState(state, { steps: [...allSteps, actionStep] }),
            content,
            success,
          );
          newToolsUsed.add(tc.name);
          allSteps = [...allSteps, actionStep, obsStep];
          // Update meta-tool dedup tracking
          consecutiveMetaToolCount = tc.name === lastMetaToolCall ? consecutiveMetaToolCount + 1 : 1;
          lastMetaToolCall = tc.name;
          continue;
        }

        // ── FINAL-ANSWER HARD GATE (FC) ───────────────────────────────────────
        if (tc.name === "final-answer") {
          const hasNonMetaToolCalled = [...newToolsUsed].some((t) => !META_TOOLS.has(t));
          const requiredTools = input.requiredTools ?? [];
          const successfulToolCounts = buildSuccessfulToolCallCounts(allSteps);
          const missingRequired = getMissingRequiredToolsByCount(
            successfulToolCounts,
            requiredTools,
            input.requiredToolQuantities,
          );
          const allRequiredMet = missingRequired.length === 0;
          let canComplete = allRequiredMet && (hasNonMetaToolCalled || requiredTools.length === 0);

          // ── Dynamic task completion guard (FC) ──────────────────────────────
          let completionGapMessage: string | undefined;
          const priorFinalAnswerAttempts = allSteps.filter(
            (s) => s.type === "observation" && s.content.startsWith("\u26A0\uFE0F") && s.content.includes("final-answer"),
          ).length;
          if (canComplete && priorFinalAnswerAttempts < 1) {
            const gaps = detectCompletionGaps(
              input.task,
              newToolsUsed,
              input.allToolSchemas ?? input.availableToolSchemas ?? [],
              allSteps,
            );
            if (gaps.length > 0) {
              canComplete = false;
              completionGapMessage = `Not done yet \u2014 missing steps:\n${gaps.map((g) => `  \u2022 ${g}`).join("\n")}\nComplete these actions before calling final-answer.`;
            }
          }

          const handlerResult = yield* makeFinalAnswerHandler({
            canComplete,
            pendingTools: completionGapMessage ? [completionGapMessage] : undefined,
          })({ ...tc.arguments });
          const resultObj = handlerResult as Record<string, unknown>;

          if (resultObj.accepted === true) {
            const capture = resultObj._capture as FinalAnswerCapture;
            const finalObsContent = `\u2713 final-answer accepted: ${capture.output}`;
            const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
              toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
            });
            const finalObsStep = makeStep("observation", finalObsContent, {
              toolCallId: tc.id,
              observationResult: makeObservationResult("final-answer", true, finalObsContent),
            });

            yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
            yield* hooks.onObservation(
              transitionState(state, { steps: [...allSteps, actionStep] }),
              finalObsContent,
              true,
            );

            newToolsUsed.add(tc.name);
            return transitionState(state, {
              steps: [...allSteps, actionStep, finalObsStep],
              toolsUsed: newToolsUsed,
              status: "done",
              output: capture.output,
              iteration: state.iteration + 1,
              meta: {
                ...state.meta,
                terminatedBy: "final_answer_tool" as const,
                finalAnswerCapture: capture,
                pendingNativeToolCalls: undefined,
                lastThought: undefined,
                lastThinking: undefined,
              },
            });
          }

          // Rejected — produce error observation and continue
          const rejectionMsg = typeof resultObj.error === "string"
            ? resultObj.error
            : "final-answer rejected: conditions not yet met.";
          const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          });
          const rejectObs = `\u26A0\uFE0F ${rejectionMsg}`;
          const rejectObsStep = makeStep("observation", rejectObs, {
            toolCallId: tc.id,
            observationResult: makeObservationResult("final-answer", false, rejectObs),
          });

          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
          yield* hooks.onObservation(
            transitionState(state, { steps: [...allSteps, actionStep] }),
            rejectObs,
            false,
          );

          newToolsUsed.add(tc.name);
          allSteps = [...allSteps, actionStep, rejectObsStep];
          // final-answer is not a meta-introspection tool — reset tracking
          lastMetaToolCall = undefined;
          consecutiveMetaToolCount = 0;
          continue;
        }

        const plannedBatch = batchLeaderToCalls.get(tc.id);
        if (plannedBatch && plannedBatch.length > 1) {
          const guardCheck = checkToolCall(defaultGuards);
          const executableCalls: ToolCallSpec[] = [];

          for (const batchCall of plannedBatch) {
            const guardOutcome = guardCheck(
              batchCall,
              transitionState(state, { steps: allSteps, lastMetaToolCall, consecutiveMetaToolCount }),
              input,
            );

            if (!guardOutcome.pass) {
              const guardFailed = isGuardHardFailure(guardOutcome.observation);
              const blockedActionStep = makeStep("action", `${batchCall.name}(${JSON.stringify(batchCall.arguments)})`, {
                toolCall: { id: batchCall.id, name: batchCall.name, arguments: batchCall.arguments },
              });
              const blockedObsStep = makeStep("observation", guardOutcome.observation, {
                toolCallId: batchCall.id,
                observationResult: makeObservationResult(batchCall.name, !guardFailed, guardOutcome.observation),
              });
              yield* hooks.onAction(state, batchCall.name, JSON.stringify(batchCall.arguments));
              yield* hooks.onObservation(
                transitionState(state, { steps: [...allSteps, blockedActionStep] }),
                guardOutcome.observation,
                !guardFailed,
              );
              allSteps = [...allSteps, blockedActionStep, blockedObsStep];
              continue;
            }

            executableCalls.push(batchCall);
          }

          if (executableCalls.length === 0) {
            lastMetaToolCall = undefined;
            consecutiveMetaToolCount = 0;
            continue;
          }

          if (toolService._tag === "None") {
            for (const batchCall of executableCalls) {
              const actionStep = makeStep("action", `${batchCall.name}(${JSON.stringify(batchCall.arguments)})`, {
                toolCall: { id: batchCall.id, name: batchCall.name, arguments: batchCall.arguments },
                toolUsed: batchCall.name,
              });
              allSteps = [...allSteps, actionStep];
              newToolsUsed.add(batchCall.name);

              yield* hooks.onAction(state, batchCall.name, JSON.stringify(batchCall.arguments));
              const errContent = `[Tool "${batchCall.name}" requested but ToolService is not available]`;
              const errObsStep = makeStep("observation", errContent, {
                toolCallId: batchCall.id,
                observationResult: makeObservationResult(batchCall.name, false, errContent),
              });
              yield* hooks.onObservation(
                transitionState(state, { steps: allSteps }),
                errContent,
                false,
              );
              allSteps = [...allSteps, errObsStep];
            }

            lastMetaToolCall = undefined;
            consecutiveMetaToolCount = 0;
            continue;
          }

          const actionIndexByCallId = new Map<string, number>();
          for (const batchCall of executableCalls) {
            const actionStep = makeStep("action", `${batchCall.name}(${JSON.stringify(batchCall.arguments)})`, {
              toolCall: { id: batchCall.id, name: batchCall.name, arguments: batchCall.arguments },
              toolUsed: batchCall.name,
            });
            allSteps = [...allSteps, actionStep];
            actionIndexByCallId.set(batchCall.id, allSteps.length - 1);
            newToolsUsed.add(batchCall.name);
            yield* hooks.onAction(state, batchCall.name, JSON.stringify(batchCall.arguments));
          }

          const executionResults = yield* Effect.all(
            executableCalls.map((batchCall) =>
              Effect.gen(function* () {
                yield* emitLog({ _tag: "tool_call", tool: batchCall.name, iteration: state.iteration, timestamp: new Date() });
                const startMs = Date.now();
                const execResult = yield* executeNativeToolCall(
                  toolService.value,
                  batchCall,
                  input.agentId ?? "reasoning-agent",
                  input.sessionId ?? "reasoning-session",
                  { compression, scratchpad: sharedScratchpad },
                );
                const durationMs = Date.now() - startMs;
                yield* emitLog({
                  _tag: "tool_result",
                  tool: batchCall.name,
                  duration: durationMs,
                  status: execResult.success ? "success" : "error",
                  timestamp: new Date(),
                });
                return {
                  callId: batchCall.id,
                  toolName: batchCall.name,
                  execResult,
                  durationMs,
                };
              }),
            ),
            { concurrency: executableCalls.length },
          );

          for (const result of executionResults) {
            const actionIdx = actionIndexByCallId.get(result.callId);
            if (actionIdx !== undefined) {
              const actionStep = allSteps[actionIdx];
              if (actionStep) {
                allSteps[actionIdx] = {
                  ...actionStep,
                  metadata: { ...(actionStep.metadata ?? {}), duration: result.durationMs },
                };
              }
            }

            if (result.execResult.success) {
              for (const delegatedTool of result.execResult.delegatedToolsUsed ?? []) {
                newToolsUsed.add(delegatedTool);
              }
            }

            let obsContent = result.execResult.content;
            if (!result.execResult.success) {
              const successfulToolCounts = buildSuccessfulToolCallCounts(allSteps);
              const missingRequiredTools = getMissingRequiredToolsByCount(
                successfulToolCounts,
                input.requiredTools ?? [],
                input.requiredToolQuantities,
              );
              const recovery = adapter.errorRecovery?.({
                toolName: result.toolName,
                errorContent: result.execResult.content,
                missingTools: missingRequiredTools,
                tier: profile.tier ?? "mid",
              });
              if (recovery) {
                obsContent = `${result.execResult.content}\n\n[Recovery guidance: ${recovery}]`;
              }
            }

            // LLM fact extraction — replace noisy compressed content with distilled facts.
            // The full raw data is already in the scratchpad under _tool_result_N.
            if (result.execResult.success && shouldExtract) {
              const batchCall = executableCalls.find((c) => c.id === result.callId);
              if (batchCall) {
                const extracted = yield* extractObservationFacts(
                  result.toolName,
                  result.execResult.content,
                  batchCall.arguments as Record<string, unknown>,
                  compression.budget ?? 800,
                );
                if (extracted) {
                  obsContent = `[${result.toolName} result — key facts]\n${extracted}`;
                }
              }
            }

            const obsStep = makeStep("observation", obsContent, {
              toolCallId: result.callId,
              storedKey: result.execResult.storedKey,
              extractedFact: result.execResult.extractedFact,
              observationResult: makeObservationResult(result.toolName, result.execResult.success, obsContent, {
                delegatedToolsUsed: result.execResult.delegatedToolsUsed,
              }),
            });

            // Pass state with the action step as the last entry so
            // onObservation finds toolUsed in metadata and emits ToolCallCompleted.
            // Without this, parallel results after the first would have an observation
            // as the last step, causing ToolCallCompleted metrics to be skipped.
            const stepsForHook = actionIdx !== undefined
              ? allSteps.slice(0, actionIdx + 1)
              : allSteps;
            yield* hooks.onObservation(
              transitionState(state, { steps: stepsForHook }),
              obsContent,
              result.execResult.success,
            );
            allSteps = [...allSteps, obsStep];
          }

          lastMetaToolCall = undefined;
          consecutiveMetaToolCount = 0;
          continue;
        }

        // ── Guard pipeline (blocked / duplicate / side-effect / repetition / meta-dedup) ──
        const guardCheck = checkToolCall(defaultGuards);
        const guardOutcome = guardCheck(tc, transitionState(state, {
          steps: allSteps,
          toolsUsed: newToolsUsed,
          lastMetaToolCall,
          consecutiveMetaToolCount,
        }), input);
        if (!guardOutcome.pass) {
          const guardFailed = isGuardHardFailure(guardOutcome.observation);
          const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          });
          const guardObsStep = makeStep("observation", guardOutcome.observation, {
            toolCallId: tc.id,
            observationResult: makeObservationResult(tc.name, !guardFailed, guardOutcome.observation),
          });
          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
          yield* hooks.onObservation(
            transitionState(state, { steps: [...allSteps, actionStep] }),
            guardOutcome.observation,
            !guardFailed,
          );
          allSteps = [...allSteps, actionStep, guardObsStep];
          // Update meta-tool dedup tracking even for blocked calls (the call still happened)
          if (INTROSPECTION_META_TOOLS.has(tc.name)) {
            consecutiveMetaToolCount = tc.name === lastMetaToolCall ? consecutiveMetaToolCount + 1 : 1;
            lastMetaToolCall = tc.name;
          } else {
            lastMetaToolCall = undefined;
            consecutiveMetaToolCount = 0;
          }
          continue;
        }

        // ── Execute the tool via ToolService ──────────────────────────────────
        const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
          toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          toolUsed: tc.name,
        });
        allSteps = [...allSteps, actionStep];
        newToolsUsed.add(tc.name);

        yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));

        if (toolService._tag === "None") {
          const errContent = `[Tool "${tc.name}" requested but ToolService is not available]`;
          const errObsStep = makeStep("observation", errContent, {
            toolCallId: tc.id,
            observationResult: makeObservationResult(tc.name, false, errContent),
          });
          yield* hooks.onObservation(
            transitionState(state, { steps: allSteps }),
            errContent,
            false,
          );
          allSteps = [...allSteps, errObsStep];
          continue;
        }

        yield* emitLog({ _tag: "tool_call", tool: tc.name, iteration: state.iteration, timestamp: new Date() });
        const toolStartMs = Date.now();
        const execResult = yield* executeNativeToolCall(
          toolService.value,
          tc,
          input.agentId ?? "reasoning-agent",
          input.sessionId ?? "reasoning-session",
          { compression, scratchpad: sharedScratchpad },
        );
        const toolDurationMs = Date.now() - toolStartMs;
        yield* emitLog({
          _tag: "tool_result",
          tool: tc.name,
          duration: toolDurationMs,
          status: execResult.success ? "success" : "error",
          error: execResult.success ? undefined : execResult.content,
          timestamp: new Date(),
        });

        // Update action step with duration
        const lastActionIdx = allSteps.length - 1;
        const lastAction = allSteps[lastActionIdx];
        if (lastAction) {
          allSteps[lastActionIdx] = {
            ...lastAction,
            metadata: { ...(lastAction.metadata ?? {}), duration: toolDurationMs },
          };
        }

        if (execResult.success) {
          for (const delegatedTool of execResult.delegatedToolsUsed ?? []) {
            newToolsUsed.add(delegatedTool);
          }
        }

        // errorRecovery hook — inject guidance when a tool fails (404, timeout, etc.)
        let obsContent = execResult.content;
        if (!execResult.success) {
          const successfulToolCounts = buildSuccessfulToolCallCounts(allSteps);
          const missingRequiredTools = getMissingRequiredToolsByCount(
            successfulToolCounts,
            input.requiredTools ?? [],
            input.requiredToolQuantities,
          );
          const recovery = adapter.errorRecovery?.({
            toolName: tc.name,
            errorContent: execResult.content,
            missingTools: missingRequiredTools,
            tier: profile.tier ?? "mid",
          });
          if (recovery) {
            obsContent = `${execResult.content}\n\n[Recovery guidance: ${recovery}]`;
          }
        }

        if (execResult.success && shouldExtract) {
          const extracted = yield* extractObservationFacts(
            tc.name,
            execResult.content,
            tc.arguments as Record<string, unknown>,
            compression.budget ?? 800,
          );
          if (extracted) {
            obsContent = `[${tc.name} result — key facts]\n${extracted}`;
          }
        }

        const obsStep = makeStep("observation", obsContent, {
          toolCallId: tc.id,
          storedKey: execResult.storedKey,
          extractedFact: execResult.extractedFact,
          observationResult: makeObservationResult(tc.name, execResult.success, obsContent, {
            delegatedToolsUsed: execResult.delegatedToolsUsed,
          }),
        });

        yield* hooks.onObservation(
          transitionState(state, { steps: allSteps }),
          obsContent,
          execResult.success,
        );

        allSteps = [...allSteps, obsStep];
        lastMetaToolCall = undefined;
        consecutiveMetaToolCount = 0;
      }

      // Sync scratchpad
      const toolScratchpad = yield* Ref.get(scratchpadStoreRef);
      const mergedScratchpad = new Map(state.scratchpad);
      for (const [k, v] of toolScratchpad) {
        mergedScratchpad.set(k, v);
      }

      // ── Build conversation history entry for this round of tool calls ──────
      // Append: assistant message (thought + tool_use blocks) + tool_result messages.
      // This gives the next iteration a proper multi-turn conversation history
      // instead of a packed text blob when useNativeFC is active.
      const conversationAssembly = (() => {
        const prior = state.messages as readonly KernelMessage[];

        // Collect action/observation pairs added by this acting phase.
        // Only include steps added after the current state.steps (i.e. this turn).
        const stepsBefore = state.steps.length;
        const newStepsThisTurn = allSteps.slice(stepsBefore);

        // Build the assistant message with tool call specs
        const assistantThought = (state.meta.lastThought as string) ?? "";
        const toolCallsForHistory = normalizedPendingCalls
          .filter((tc) => {
            // Only include tool calls that were actually attempted (their action step exists)
            return newStepsThisTurn.some(
              (s) => s.type === "action" && (s.metadata?.toolCall as { id?: string } | undefined)?.id === tc.id,
            );
          })
          .map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));

        // Build tool result messages — match each tool call to its observation by toolCallId.
        // Parallel batches layout steps as [a1,a2,a3,o1,o2,o3] so positional +1 adjacency
        // doesn't work; toolCallId metadata is the stable link.
        const toolResultMessages: KernelMessage[] = normalizedPendingCalls.flatMap((tc) => {
          const obsStep = newStepsThisTurn.find(
            (s) => s.type === "observation" && s.metadata?.toolCallId === tc.id,
          );
          if (!obsStep) return [];
          const msg: KernelMessage = {
            role: "tool_result" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            content: obsStep.content,
            ...(obsStep.metadata?.storedKey ? { storedKey: obsStep.metadata.storedKey as string } : {}),
          };
          return [msg];
        });

        if (toolCallsForHistory.length === 0) {
          // No tool calls actually appended (all skipped/blocked) — don't add to history
          return { messages: prior, actReminder: undefined as string | undefined, errorRecovery: undefined as string | undefined, completionNudgeSent: false };
        }

        const assistantMsg: KernelMessage = {
          role: "assistant",
          content: assistantThought,
          toolCalls: toolCallsForHistory,
        };
        const baseMessages = [...prior, assistantMsg, ...toolResultMessages];

        // Append progress summary for reactive strategy: tells the model what it did
        // and what's left. This is critical for local/mid models that don't infer
        // next steps from conversation structure alone.
        const reqTools = input.requiredTools ?? [];
        const usedSoFar = [...newToolsUsed];
        const reqQuantities = input.requiredToolQuantities;
        const successfulToolCounts = buildSuccessfulToolCallCounts(allSteps);
        const missing = getMissingRequiredToolsByCount(
          successfulToolCounts,
          reqTools,
          reqQuantities,
        );

        if (missing.length > 0) {
          // Check if this is a research->produce transition: all search-type tools
          // satisfied, only output tools (write/file/save) remain.
          const RESEARCH_KEYWORDS = ["search", "http", "browse", "fetch", "scrape", "crawl"];
          const researchDone = usedSoFar.some((t) => RESEARCH_KEYWORDS.some((k) => t.includes(k)));
          const outputOnly = missing.every((t) => t.includes("write") || t.includes("file") || t.includes("save"));
          const observationCount = allSteps.filter((s) => s.type === "observation" &&
            (s.metadata?.observationResult as { toolName?: string } | undefined)?.toolName !== "system").length;

          const synthesisMsg = researchDone && outputOnly
            ? adapter.synthesisPrompt?.({
                toolsUsed: newToolsUsed,
                missingOutputTools: missing,
                observationCount,
                tier: profile.tier ?? "mid",
              })
            : undefined;

          const missingWithCounts = missing.map((t) => {
            const needed = reqQuantities?.[t];
            if (!needed || needed <= 1) return t;
            const actual = successfulToolCounts[t] ?? 0;
            return `${t} (${actual}/${needed} calls done)`;
          });
          const progressContent = synthesisMsg
            ?? `You must still call: ${missingWithCounts.join(", ")}. Call ${missing[0]} now with the appropriate arguments.`;

          return { messages: baseMessages, actReminder: progressContent, errorRecovery: undefined, completionNudgeSent: false };
        }

        // All required tools called — tell model to finish (but not while previews still hide data behind recall).
        // Only send this nudge ONCE per run to avoid contradictory repeated messages.
        //
        // Sequential mode (all quantities ≤ 1): the "satisfied" condition only means each
        // tool was called once — a weak signal. Skip the aggressive "FINAL ANSWER" push
        // and let the model naturally continue researching until it decides it's done.
        if (reqTools.length > 0) {
          const hasMultiQuantity = Object.values(reqQuantities ?? {}).some((n) => n > 1);

          if (hasMultiQuantity) {
            const alreadySentCompletion = state.meta.completionNudgeSent === true;
            if (!alreadySentCompletion) {
              const overflowPreview = toolResultMessages.some(
                (m) => typeof m.content === "string" && observationReferencesStoredOverflow(m.content),
              );
              const recallAvailable = (input.allToolSchemas ?? input.availableToolSchemas ?? []).some(
                (s) => s.name === "recall",
              );
              const finishText =
                overflowPreview && recallAvailable
                  ? `${REQUIRED_TOOLS_SATISFIED_PREFIX}. The observations above are compressed previews; the real command output is stored under keys like _tool_result_1. Before summarizing, call recall("<that-key>", full: true) for each key shown in the [STORED: …] header. Do not invent CLI flags, subcommands, or options — only report text you retrieved via recall.`
                  : `${REQUIRED_TOOLS_SATISFIED_PREFIX}. Review ALL of the tool results above carefully — extract the specific data points you need from each one. Then give your FINAL ANSWER using only data from these results.`;
              return { messages: baseMessages, actReminder: finishText, errorRecovery: undefined, completionNudgeSent: true };
            }

            // Completion gate already sent but this turn had errors — nudge to retry or finish.
            const thisRoundHadErrors = newStepsThisTurn.some(
              (s) => s.type === "observation" &&
                (s.metadata?.observationResult as { success?: boolean } | undefined)?.success === false,
            );
            if (thisRoundHadErrors) {
              const retryText = "One or more tool calls above failed. If you used a wrong tool name, retry with the correct tool name shown in the system prompt. If you have enough data, give your FINAL ANSWER now.";
              return { messages: baseMessages, actReminder: undefined, errorRecovery: retryText, completionNudgeSent: false };
            }
          }
        }

        return { messages: baseMessages, actReminder: undefined, errorRecovery: undefined, completionNudgeSent: false };
      })();

      const newConversationHistory = conversationAssembly.messages;
      const actGuidance: { actReminder?: string; errorRecovery?: string } = {};
      if (conversationAssembly.actReminder) actGuidance.actReminder = conversationAssembly.actReminder;
      if (conversationAssembly.errorRecovery) actGuidance.errorRecovery = conversationAssembly.errorRecovery;
      const hasActGuidance = actGuidance.actReminder !== undefined || actGuidance.errorRecovery !== undefined;

      // All native tool calls executed — transition back to thinking.
      // Any harness signals raised this round flow via pendingGuidance — think.ts
      // reads and clears them at the start of the next turn.
      return transitionState(state, {
        steps: allSteps,
        toolsUsed: newToolsUsed,
        scratchpad: mergedScratchpad,
        messages: newConversationHistory,
        status: "thinking",
        pendingGuidance: hasActGuidance ? actGuidance : undefined,
        iteration: state.iteration + 1,
        lastMetaToolCall,
        consecutiveMetaToolCount,
        meta: {
          ...state.meta,
          pendingNativeToolCalls: undefined,
          lastThought: undefined,
          lastThinking: undefined,
          ...(conversationAssembly.completionNudgeSent ? { completionNudgeSent: true } : {}),
        },
      });
    }

    // No pending native tool calls — shouldn't happen, transition back to thinking
    return transitionState(state, {
      status: "thinking",
      pendingGuidance: undefined,
      iteration: state.iteration + 1,
    });
  });
}
