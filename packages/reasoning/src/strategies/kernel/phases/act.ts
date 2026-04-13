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
import { executeNativeToolCall, makeObservationResult } from "../utils/tool-execution.js";
import {
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelMessage,
} from "../kernel-state.js";
import { planNextMoveBatches } from "../utils/tool-utils.js";
import { checkToolCall, defaultGuards, META_TOOL_SET } from "./guard.js";

const REQUIRED_TOOLS_SATISFIED_PREFIX = "Required tool calls are satisfied";

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
      tokenBudget: (input.contextProfile as any)?.maxTokens ?? 8000,
      entropy: ((state.meta as any).entropy?.latest) as { composite: number; shape: string; momentum: number } | undefined,
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
      entropy: ((state.meta as any).entropy?.latest) as { composite: number; shape: string; momentum: number; history?: readonly number[] } | undefined,
      controllerDecisionLog: state.controllerDecisionLog,
      steps: allSteps as import("../../../types/index.js").ReasoningStep[],
      iteration: state.iteration,
      maxIterations: (state.meta.maxIterations as number | undefined) ?? 10,
      tokens: state.tokens,
      tokenBudget: (input.contextProfile as any)?.maxTokens ?? 8000,
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
    const adapter = selectAdapter({ supportsToolCalling: true }, profile.tier);

    // ── NATIVE FC ACTING BRANCH ─────────────────────────────────────────────
    // When the thinking phase stored pendingNativeToolCalls, execute them here
    // using the structured ToolCallSpec (pre-parsed arguments, no regex repair).
    const pendingNativeCalls = state.meta.pendingNativeToolCalls as readonly ToolCallSpec[] | undefined;
    if (pendingNativeCalls && pendingNativeCalls.length > 0) {
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
        pendingNativeCalls,
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

      for (let idx = 0; idx < pendingNativeCalls.length; idx++) {
        const tc = pendingNativeCalls[idx]!;
        if (batchFollowers.has(tc.id)) {
          continue;
        }

        const META_TOOL_NAMES = new Set(["final-answer", "task-complete", "context-status", "brief", "pulse", "find", "recall", "checkpoint"]);

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
          const META_TOOLS = new Set(["final-answer", "task-complete", "context-status", "brief", "pulse", "find", "recall", "checkpoint"]);
          const hasNonMetaToolCalled = [...newToolsUsed].some((t) => !META_TOOLS.has(t));
          const requiredTools = input.requiredTools ?? [];
          const quantities = input.requiredToolQuantities ?? {};
          const allRequiredMet = requiredTools.every((t) => {
            if (!newToolsUsed.has(t)) return false;
            const needed = quantities[t] ?? 1;
            if (needed <= 1) return true;
            const actual = allSteps.filter((s) => {
              if (s.type !== "action") return false;
              return (s.metadata?.toolCall as { name?: string } | undefined)?.name === t;
            }).length;
            return actual >= needed;
          });
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
              const blockedActionStep = makeStep("action", `${batchCall.name}(${JSON.stringify(batchCall.arguments)})`, {
                toolCall: { id: batchCall.id, name: batchCall.name, arguments: batchCall.arguments },
              });
              const blockedObsStep = makeStep("observation", guardOutcome.observation, {
                observationResult: makeObservationResult(batchCall.name, true, guardOutcome.observation),
              });
              yield* hooks.onAction(state, batchCall.name, JSON.stringify(batchCall.arguments));
              yield* hooks.onObservation(
                transitionState(state, { steps: [...allSteps, blockedActionStep] }),
                guardOutcome.observation,
                true,
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
                const startMs = Date.now();
                const execResult = yield* executeNativeToolCall(
                  toolService.value,
                  batchCall,
                  input.agentId ?? "reasoning-agent",
                  input.sessionId ?? "reasoning-session",
                  { compression, scratchpad: sharedScratchpad },
                );
                const durationMs = Date.now() - startMs;
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
              const recovery = adapter.errorRecovery?.({
                toolName: result.toolName,
                errorContent: result.execResult.content,
                missingTools: (input.requiredTools ?? []).filter((t) => !newToolsUsed.has(t)),
                tier: profile.tier ?? "mid",
              });
              if (recovery) {
                obsContent = `${result.execResult.content}\n\n[Recovery guidance: ${recovery}]`;
              }
            }

            const obsStep = makeStep("observation", obsContent, {
              storedKey: result.execResult.storedKey,
              observationResult: makeObservationResult(result.toolName, result.execResult.success, obsContent, {
                delegatedToolsUsed: result.execResult.delegatedToolsUsed,
              }),
            });

            yield* hooks.onObservation(
              transitionState(state, { steps: allSteps }),
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
          const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          });
          const guardObsStep = makeStep("observation", guardOutcome.observation, {
            observationResult: makeObservationResult(tc.name, true, guardOutcome.observation),
          });
          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments));
          yield* hooks.onObservation(
            transitionState(state, { steps: [...allSteps, actionStep] }),
            guardOutcome.observation,
            true,
          );
          allSteps = [...allSteps, actionStep, guardObsStep];
          // Update meta-tool dedup tracking even for blocked calls (the call still happened)
          if (META_TOOL_SET.has(tc.name)) {
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

        const toolStartMs = Date.now();
        const execResult = yield* executeNativeToolCall(
          toolService.value,
          tc,
          input.agentId ?? "reasoning-agent",
          input.sessionId ?? "reasoning-session",
          { compression, scratchpad: sharedScratchpad },
        );
        const toolDurationMs = Date.now() - toolStartMs;

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
          const recovery = adapter.errorRecovery?.({
            toolName: tc.name,
            errorContent: execResult.content,
            missingTools: (input.requiredTools ?? []).filter((t) => !newToolsUsed.has(t)),
            tier: profile.tier ?? "mid",
          });
          if (recovery) {
            obsContent = `${execResult.content}\n\n[Recovery guidance: ${recovery}]`;
          }
        }

        const obsStep = makeStep("observation", obsContent, {
          storedKey: execResult.storedKey,
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
        // Normal task tools reset meta-tool dedup tracking
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
      const newConversationHistory: readonly KernelMessage[] = (() => {
        const prior = state.messages as readonly KernelMessage[];

        // Collect action/observation pairs added by this acting phase.
        // Only include steps added after the current state.steps (i.e. this turn).
        const stepsBefore = state.steps.length;
        const newStepsThisTurn = allSteps.slice(stepsBefore);

        // Build the assistant message with tool call specs
        const assistantThought = (state.meta.lastThought as string) ?? "";
        const toolCallsForHistory = pendingNativeCalls
          .filter((tc) => {
            // Only include tool calls that were actually attempted (their action step exists)
            return newStepsThisTurn.some(
              (s) => s.type === "action" && (s.metadata?.toolCall as { id?: string } | undefined)?.id === tc.id,
            );
          })
          .map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));

        // Build tool result messages — one per tool call that has an observation
        const toolResultMessages: KernelMessage[] = pendingNativeCalls.flatMap((tc) => {
          // Find the observation step that follows the action step for this tool call
          const actionIdx = newStepsThisTurn.findIndex(
            (s) => s.type === "action" && (s.metadata?.toolCall as { id?: string } | undefined)?.id === tc.id,
          );
          if (actionIdx < 0) return [];
          const obsStep = newStepsThisTurn[actionIdx + 1];
          if (!obsStep || obsStep.type !== "observation") return [];
          return [{
            role: "tool_result" as const,
            toolCallId: tc.id,
            toolName: tc.name,
            content: obsStep.content,
          }];
        });

        if (toolCallsForHistory.length === 0) {
          // No tool calls actually appended (all skipped/blocked) — don't add to history
          return prior;
        }

        const assistantMsg: KernelMessage = {
          role: "assistant",
          content: assistantThought,
          toolCalls: toolCallsForHistory,
        };

        // Append progress summary for reactive strategy: tells the model what it did
        // and what's left. This is critical for local/mid models that don't infer
        // next steps from conversation structure alone.
        const reqTools = input.requiredTools ?? [];
        const usedSoFar = [...newToolsUsed];
        const reqQuantities = input.requiredToolQuantities ?? {};
        const missing = reqTools.filter((t) => {
          if (!newToolsUsed.has(t)) return true;
          const needed = reqQuantities[t] ?? 1;
          if (needed <= 1) return false;
          const actual = allSteps.filter((s) => {
            if (s.type !== "action") return false;
            return (s.metadata?.toolCall as { name?: string } | undefined)?.name === t;
          }).length;
          return actual < needed;
        });

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
            const needed = reqQuantities[t];
            if (!needed || needed <= 1) return t;
            const actual = allSteps.filter((s) => {
              if (s.type !== "action") return false;
              return (s.metadata?.toolCall as { name?: string } | undefined)?.name === t;
            }).length;
            return `${t} (${actual}/${needed} calls done)`;
          });
          const progressContent = synthesisMsg
            ?? `You must still call: ${missingWithCounts.join(", ")}. Call ${missing[0]} now with the appropriate arguments.`;

          const progressMsg: KernelMessage = { role: "user", content: progressContent };
          return [...prior, assistantMsg, ...toolResultMessages, progressMsg];
        }

        // All required tools called — tell model to finish (but not while previews still hide data behind recall).
        // Only send this nudge ONCE per run to avoid contradictory repeated messages.
        if (reqTools.length > 0) {
          const alreadySentCompletion = prior.some(
            (m) => m.role === "user" && typeof m.content === "string" &&
              m.content.startsWith(REQUIRED_TOOLS_SATISFIED_PREFIX),
          );
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
                : `${REQUIRED_TOOLS_SATISFIED_PREFIX}. If you have all the data needed to answer the task, give your FINAL ANSWER now. If any data is still missing, gather it first — then give your FINAL ANSWER.`;
            const finishMsg: KernelMessage = { role: "user", content: finishText };
            return [...prior, assistantMsg, ...toolResultMessages, finishMsg];
          }

          // Completion gate already sent but this turn had errors — nudge to retry or finish.
          const thisRoundHadErrors = newStepsThisTurn.some(
            (s) => s.type === "observation" &&
              (s.metadata?.observationResult as { success?: boolean } | undefined)?.success === false,
          );
          if (thisRoundHadErrors) {
            const retryMsg: KernelMessage = {
              role: "user",
              content: "One or more tool calls above failed. If you used a wrong tool name, retry with the correct tool name shown in the system prompt. If you have enough data, give your FINAL ANSWER now.",
            };
            return [...prior, assistantMsg, ...toolResultMessages, retryMsg];
          }
        }

        return [...prior, assistantMsg, ...toolResultMessages];
      })();

      // All native tool calls executed — transition back to thinking
      return transitionState(state, {
        steps: allSteps,
        toolsUsed: newToolsUsed,
        scratchpad: mergedScratchpad,
        messages: newConversationHistory,
        status: "thinking",
        iteration: state.iteration + 1,
        lastMetaToolCall,
        consecutiveMetaToolCount,
        meta: {
          ...state.meta,
          pendingNativeToolCalls: undefined,
          lastThought: undefined,
          lastThinking: undefined,
        },
      });
    }

    // No pending native tool calls — shouldn't happen, transition back to thinking
    return transitionState(state, {
      status: "thinking",
      iteration: state.iteration + 1,
    });
  });
}
