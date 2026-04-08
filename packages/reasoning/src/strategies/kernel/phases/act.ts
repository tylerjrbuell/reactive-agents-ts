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
import { checkToolCall, defaultGuards, META_TOOL_SET } from "./guard.js";

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

      for (const tc of pendingNativeCalls) {
        const META_TOOL_NAMES = new Set(["final-answer", "task-complete", "context-status", "brief", "pulse", "find", "recall"]);

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
          const META_TOOLS = new Set(["final-answer", "task-complete", "context-status", "brief", "pulse", "find", "recall"]);
          const hasNonMetaToolCalled = [...newToolsUsed].some((t) => !META_TOOLS.has(t));
          const requiredTools = input.requiredTools ?? [];
          const allRequiredMet = requiredTools.every((t) => newToolsUsed.has(t));
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

        // ── Guard pipeline (blocked / duplicate / side-effect / repetition / meta-dedup) ──
        const guardCheck = checkToolCall(defaultGuards);
        const guardOutcome = guardCheck(tc, transitionState(state, { steps: allSteps, lastMetaToolCall, consecutiveMetaToolCount }), input);
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
          { compression, scratchpad: state.scratchpad as Map<string, string> },
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
          observationResult: makeObservationResult(tc.name, execResult.success, obsContent),
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
        const missing = reqTools.filter((t) => !newToolsUsed.has(t));

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

          const progressContent = synthesisMsg
            ?? `You must still call: ${missing.join(", ")}. Call ${missing[0]} now with the appropriate arguments.`;

          const progressMsg: KernelMessage = { role: "user", content: progressContent };
          return [...prior, assistantMsg, ...toolResultMessages, progressMsg];
        }

        // All required tools called — tell model to finish
        if (reqTools.length > 0) {
          const finishMsg: KernelMessage = {
            role: "user",
            content: "All required tools have been called. Synthesize the results and provide your final answer.",
          };
          return [...prior, assistantMsg, ...toolResultMessages, finishMsg];
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
