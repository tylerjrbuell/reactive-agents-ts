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
  type ToolCallSpec,
  runHealingPipeline,
} from "@reactive-agents/tools";
import { metaToolRegistry } from "./meta-tool-handlers.js";
import { makeStep } from "../sense/step-utils.js";
import { executeNativeToolCall, extractObservationFacts } from "../act/tool-execution.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
// Sprint 3.2 — Verifier promotion: every effector output flows through
// defaultVerifier.verify() so the structured VerificationResult is
// attached to the observation step's metadata. Future sprints (Arbitrator
// in S3.3, Reflection in S3.4) read this signal.
import { defaultVerifier, contextFromObservation } from "../verify/verifier.js";
// Sprint 3.3 — Sole Termination Authority: the final-answer-tool path
// emits an "agent-final-answer" intent and lets the Arbitrator decide
// success/failure. The Arbitrator applies the controller-signal veto
// (CHANGE A) — if controller activity contradicts the agent's success
// claim, the Verdict converts to exit-failure.
import {
  arbitrateAndApply,
  arbitrationContextFromState,
} from "../decide/arbitrator.js";
import {
  transitionState,
  asKernelStateLike,
  type KernelState,
  type KernelContext,
  type KernelMessage,
} from "../../../kernel/state/kernel-state.js";
import { runPhaseHooks, killswitchTerminatedBy } from "../../../kernel/loop/phase-hooks.js";
import { emitToCompose } from "@reactive-agents/core";
import { planNextMoveBatches } from "../decide/tool-gating.js";
import {
  getEffectiveMissingRequiredTools,
} from "../verify/requirement-state.js";
import { assembleConversation } from "./conversation-assembly.js";
import { checkToolCall, defaultGuards } from "./guard.js";
import { META_TOOLS, INTROSPECTION_META_TOOLS } from "../../../kernel/state/kernel-constants.js";
import { emitErrorSwallowed, errorTag, type KernelMessageLike } from "@reactive-agents/core";

/** Tool names that operate on the filesystem — HealingPipeline will resolve relative paths. */
const FILE_TOOL_NAMES = new Set(["file-read", "file-write", "code-execute", "shell-execute"]);

/** Extract the text content of the last assistant message from the conversation history. */
function getLastAssistantText(messages: readonly KernelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg && msg.role === "assistant") {
      return typeof msg.content === "string" ? msg.content : "";
    }
  }
  return "";
}

const emitLog = (event: LogEvent): Effect.Effect<void, never> =>
  Effect.serviceOption(ObservableLogger).pipe(
    Effect.flatMap((opt) =>
      opt._tag === "Some"
        ? opt.value.emit(event).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/act/act.ts:64", tag: errorTag(err) })))
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

// ─── Act Phase ────────────────────────────────────────────────────────────────

export function handleActing(
  state: KernelState,
  context: KernelContext,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    const { input, profile, compression, toolService, hooks, memoryService } = context;
    // profileOverrides were already merged into `profile` by kernel-runner;
    // here we only need the adapter.
    const { adapter } = selectAdapter({ supportsToolCalling: true }, profile.tier, input.modelId);
    // Compose pipeline — used by the dead-tag emit sites below
    // (`nudge.healing-failure`, `observation.tool-result`, `lifecycle.failure`)
    // and by the later message-rewrite chokepoint. Declared once up here so
    // every emit shares the same handle.
    const pipeline = input.harnessPipeline;

    const obsMode = input.observationSummary;
    const shouldExtract = obsMode === true
      || (obsMode !== false && (profile.tier === "local" || profile.tier === "mid"));

    // ── ACTING BRANCH ──────────────────────────────────────────────────────────
    // For text-parse mode: extract tool calls from the last assistant message text
    // using the TextParseDriver's parse pipeline. For native-fc mode: use the
    // provider-parsed calls already stored in state.meta.pendingNativeToolCalls.
    const pendingNativeCalls = state.meta.pendingNativeToolCalls as readonly ToolCallSpec[] | undefined;

    // Pruned schemas shown to the model — used for extractCalls() to match model context
    const filteredToolSchemas = (input.availableToolSchemas ?? []) as readonly {
      readonly name: string;
      readonly description: string;
      readonly parameters: readonly { readonly name: string; readonly type: string; readonly description?: string; readonly required?: boolean }[];
    }[];
    // Full registry — used for HealingPipeline so fuzzy name matching works even when a tool was pruned from context
    const allHealingSchemas = (input.allToolSchemas ?? input.availableToolSchemas ?? []) as typeof filteredToolSchemas;

    let pendingCalls: readonly ToolCallSpec[];
    if (context.toolCallingDriver.mode === "text-parse") {
      const lastAssistantText = getLastAssistantText(state.messages);
      const extracted = context.toolCallingDriver.extractCalls(lastAssistantText, filteredToolSchemas);
      const textParsedCalls: readonly ToolCallSpec[] = extracted.map((e, i) => ({
        id: `text-parse-${state.iteration}-${i}`,
        name: e.name,
        arguments: e.arguments,
        ...(e.rationale ? { rationale: e.rationale } : {}),
      }));
      // Fall back to pendingNativeToolCalls when text extraction yields nothing —
      // this handles cases where think.ts populated native calls (e.g. via resolver)
      // even though the driver is in text-parse mode.
      pendingCalls = textParsedCalls.length > 0 ? textParsedCalls : (pendingNativeCalls ?? []);
    } else {
      pendingCalls = pendingNativeCalls ?? [];
    }

    if (pendingCalls.length > 0) {
      const normalizedPendingCalls = pendingCalls.map(normalizeToolCallArguments);
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
        const rawTc = normalizedPendingCalls[idx]!;

        // ── HealingPipeline — runs on every call (native-fc and text-parse) ───
        // Repairs: fuzzy tool name matching, param name aliases, path resolution,
        // type coercion. If healing fails (unrecognized tool), use the raw call
        // so the guard pipeline can produce a meaningful rejection message.
        // M7-E (spike): Apply calibration's knownToolAliases for auto-correction
        // NOTE: calibration data would come from state.calibration when Phase 2 wires it in.
        // For now, use empty dicts to indicate no calibrated aliases available.
        const healResult = runHealingPipeline(
          rawTc,
          allHealingSchemas.map((s) => ({
            name: s.name,
            description: s.description,
            parameters: s.parameters.map((p) => ({
              name: p.name,
              type: p.type,
              description: p.description,
              required: p.required,
            })),
          })),
          FILE_TOOL_NAMES,
          process.cwd(),
          {},  // M7-E: calibrated tool aliases (not yet wired from calibration state)
          {},  // M7-E: calibrated param aliases (not yet wired from calibration state)
        );
        const tc = healResult.succeeded ? healResult.call : rawTc;

        // HS-112 — lit the `nudge.healing-failure` Compose tag. The healer
        // could not repair this call (typically: no schema match for the
        // tool name). The guard pipeline below will reject it; emit first
        // so external observers see the cause before the symptom.
        if (!healResult.succeeded) {
          yield* emitToCompose(pipeline, "nudge.healing-failure",
            `healing-pipeline could not repair call to "${rawTc.name}" — no schema match in registry`,
            {
              iteration: state.iteration,
              phase: "act",
              state: asKernelStateLike(state),
              strategy: state.strategy ?? "react",
              trigger: "healing-failure",
              severity: "warn",
            },
          );
        }

        if (batchFollowers.has(tc.id)) {
          continue;
        }

        // ── allowedTools execution gate ──────────────────────────────────────────
        // Block non-allowed tools before any dispatch. META_TOOLS bypass unconditionally.
        const effectiveAllowedTools = input.allowedTools ?? [];
        if (
          effectiveAllowedTools.length > 0 &&
          !META_TOOLS.has(tc.name) &&
          !effectiveAllowedTools.includes(tc.name)
        ) {
          const blockedMsg = `[Tool "${tc.name}" is not in allowedTools — blocked. Allowed: ${effectiveAllowedTools.join(", ")}]`;
          const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          });
          const blockedObsStep = makeStep("observation", blockedMsg, {
            toolCallId: tc.id,
            observationResult: makeObservationResult(tc.name, false, blockedMsg),
          });
          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments), { callId: tc.id, rationale: tc.rationale });
          yield* hooks.onObservation(
            transitionState(state, { steps: [...allSteps, actionStep] }),
            blockedMsg,
            false,
          );
          allSteps = [...allSteps, actionStep, blockedObsStep];
          continue;
        }

        // ── Check meta-tool registry first (brief, pulse, activate-skill) ───────
        const metaHandler = metaToolRegistry.get(tc.name);
        if (metaHandler && (
          (tc.name === "brief" && input.metaTools?.brief) ||
          (tc.name === "pulse" && input.metaTools?.pulse) ||
          tc.name === "activate-skill"
        )) {
          const { content, success } = yield* metaHandler(tc, state, context, allSteps, newToolsUsed);
          const actionStep = makeStep("action", `${tc.name}(${JSON.stringify(tc.arguments)})`, {
            toolCall: { id: tc.id, name: tc.name, arguments: tc.arguments },
          });
          const obsStep = makeStep("observation", content, {
            toolCallId: tc.id,
            observationResult: makeObservationResult(tc.name, success, content),
          });
          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments), { callId: tc.id, rationale: tc.rationale });
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
          const missingRequired = getEffectiveMissingRequiredTools(
            allSteps,
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

            yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments), { callId: tc.id, rationale: tc.rationale });
            yield* hooks.onObservation(
              transitionState(state, { steps: [...allSteps, actionStep] }),
              finalObsContent,
              true,
            );

            newToolsUsed.add(tc.name);
            // Sprint 3.3 — flow through the Arbitrator. Build state with
            // the new steps + toolsUsed first, then let arbitrateAndApply
            // resolve the Verdict (which may convert to exit-failure if
            // the controller-signal veto fires).
            const stateWithSteps = transitionState(state, {
              steps: [...allSteps, actionStep, finalObsStep],
              toolsUsed: newToolsUsed,
              iteration: state.iteration + 1,
              meta: {
                ...state.meta,
                finalAnswerCapture: capture,
                pendingNativeToolCalls: undefined,
                lastThought: undefined,
                lastThinking: undefined,
              },
            });
            return arbitrateAndApply(
              stateWithSteps,
              {
                kind: "agent-final-answer",
                via: "tool",
                output: capture.output,
              },
              arbitrationContextFromState(stateWithSteps, {
                task: input.task,
                requiredTools: input.requiredTools,
              }),
            );
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

          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments), { callId: tc.id, rationale: tc.rationale });
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
              yield* hooks.onAction(state, batchCall.name, JSON.stringify(batchCall.arguments), { callId: batchCall.id, rationale: batchCall.rationale });
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

              yield* hooks.onAction(state, batchCall.name, JSON.stringify(batchCall.arguments), { callId: batchCall.id, rationale: batchCall.rationale });
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
            yield* hooks.onAction(state, batchCall.name, JSON.stringify(batchCall.arguments), { callId: batchCall.id, rationale: batchCall.rationale });
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
                  { compression, scratchpad: sharedScratchpad, memoryService, profile },
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
              const missingRequiredTools = getEffectiveMissingRequiredTools(
                allSteps,
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

            const obsResult = makeObservationResult(result.toolName, result.execResult.success, obsContent, {
              delegatedToolsUsed: result.execResult.delegatedToolsUsed,
            });
            // Sprint 3.2 — Verifier promotion: every standard tool execution
            // gets a structured VerificationResult attached. Read by Arbitrator
            // (S3.3) + Reflection (S3.4) downstream consumers.
            const verification = defaultVerifier.verify(
              contextFromObservation({
                observation: obsResult,
                task: input.task,
                priorSteps: allSteps,
                requiredTools: input.requiredTools,
                toolsUsed: newToolsUsed,
              }),
            );
            const obsStep = makeStep("observation", obsContent, {
              toolCallId: result.callId,
              storedKey: result.execResult.storedKey,
              extractedFact: result.execResult.extractedFact,
              observationResult: obsResult,
              verification,
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
          yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments), { callId: tc.id, rationale: tc.rationale });
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

        yield* hooks.onAction(state, tc.name, JSON.stringify(tc.arguments), { callId: tc.id, rationale: tc.rationale });

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
          { compression, scratchpad: sharedScratchpad, profile },
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
          const missingRequiredTools = getEffectiveMissingRequiredTools(
            allSteps,
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

        // HS-112 — lit the `observation.tool-result` Compose tag. Fires
        // once per non-meta, non-blocked tool execution so external
        // observers see every effector outcome with full payload + ctx.
        const toolResultCtx = {
          iteration: state.iteration,
          phase: "act" as const,
          state: asKernelStateLike(state),
          strategy: state.strategy ?? "react",
          toolName: tc.name,
          callId: tc.id,
          healed: healResult.succeeded && healResult.call !== rawTc,
          durationMs: toolDurationMs,
        };
        yield* emitToCompose(pipeline, "observation.tool-result", obsStep, toolResultCtx);

        // HS-112 — lit the `lifecycle.failure` Compose tag on tool error.
        // `lifecycle.failure` covers all three mid-run failure modes
        // (tool-error / llm-refusal / verifier-rejection); this is the
        // tool-error site.
        if (!execResult.success) {
          yield* emitToCompose(pipeline, "lifecycle.failure", {
            reason: "tool-error",
            errorMessage: execResult.content,
            attemptNumber: state.iteration,
            failureStreak: 1,
            currentStrategy: state.strategy ?? "react",
          }, {
            iteration: state.iteration,
            phase: "act",
            state: asKernelStateLike(state),
            strategy: state.strategy ?? "react",
          });
        }

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
      const conversationAssembly = assembleConversation({
        state,
        context,
        adapter,
        allSteps,
        normalizedPendingCalls,
        newToolsUsed,
        sharedScratchpad,
      });

      let newConversationHistory = conversationAssembly.messages;

      // 'before act' hooks — may abort iteration
      {
        const ctrl = yield* Effect.promise(() =>
          runPhaseHooks(pipeline, 'before', 'act', state.iteration, state)
        );
        if (ctrl) {
          return {
            ...state,
            status: ctrl.abort === 'terminate' ? 'failed' : 'done',
            meta: {
              ...state.meta,
              terminatedBy: killswitchTerminatedBy(ctrl),
            },
          };
        }
      }

      if (pipeline) {
        const transformed: KernelMessage[] = [];
        for (const msg of newConversationHistory) {
          if (msg.role === 'tool_result') {
            const result = yield* Effect.promise(() =>
              pipeline.transform('message.tool-result', msg as KernelMessageLike, {
                iteration: state.iteration,
                phase: 'act',
                state: asKernelStateLike(state),
                strategy: state.strategy,
                toolName: msg.toolName,
                callId: msg.toolCallId,
                healed: false,
                durationMs: 0,
              })
            );
            // Merge onto original to preserve storedKey and other KernelMessage-specific fields
            transformed.push(
              result != null && result.role === 'tool_result'
                ? { ...msg, content: result.content }
                : msg
            );
          } else {
            transformed.push(msg);
          }
        }
        newConversationHistory = transformed;
      }
      const actGuidance: { actReminder?: string; errorRecovery?: string } = {};
      if (conversationAssembly.actReminder) actGuidance.actReminder = conversationAssembly.actReminder;
      if (conversationAssembly.errorRecovery) actGuidance.errorRecovery = conversationAssembly.errorRecovery;
      const hasActGuidance = actGuidance.actReminder !== undefined || actGuidance.errorRecovery !== undefined;

      // 'after act' hooks
      {
        const ctrl = yield* Effect.promise(() =>
          runPhaseHooks(pipeline, 'after', 'act', state.iteration, state)
        );
        if (ctrl) {
          return {
            ...state,
            status: ctrl.abort === 'terminate' ? 'failed' : 'done',
            meta: {
              ...state.meta,
              terminatedBy: killswitchTerminatedBy(ctrl),
            },
          };
        }
      }

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
