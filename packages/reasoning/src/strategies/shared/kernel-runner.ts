/**
 * shared/kernel-runner.ts — Universal execution loop for all reasoning strategies.
 *
 * Replaces the duplicated while-loops in reactive.ts and react-kernel.ts with a
 * single `runKernel()` function. Every strategy defines a `ThoughtKernel` (one step
 * of reasoning) and hands it to `runKernel()` which handles:
 *
 *   1. Service resolution (LLM, ToolService, EventBus via Effect.serviceOption)
 *   2. Profile merging (input.contextProfile over CONTEXT_PROFILES["mid"])
 *   3. KernelHooks construction from EventBus
 *   4. Immutable KernelContext assembly (frozen for entire execution)
 *   5. Main loop: call kernel repeatedly until done/failed/maxIterations
 *   6. Terminal hooks: onDone / onError
 */
import { Effect } from "effect";
import { LLMService, DEFAULT_CAPABILITIES } from "@reactive-agents/llm-provider";
import type { ProviderCapabilities } from "@reactive-agents/llm-provider";
import { createToolCallResolver } from "@reactive-agents/tools";
import { CONTEXT_PROFILES } from "../../context/context-profile.js";
import type { ContextProfile } from "../../context/context-profile.js";
import { resolveStrategyServices } from "./service-utils.js";
import { buildKernelHooks } from "./kernel-hooks.js";
import { makeStep } from "./step-utils.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type ThoughtKernel,
} from "./kernel-state.js";
import { evaluateStrategySwitch, buildHandoff } from "./strategy-evaluator.js";
import { ContextSynthesizerService } from "../../context/context-synthesizer.js";
import { classifyTaskPhase } from "../../context/task-phase.js";
import type { SynthesisConfig, SynthesisInput, SynthesisEntropySignals } from "../../context/synthesis-types.js";
import type { ReasoningStep } from "../../types/index.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Error strings from recent failed tool observations — feeds ICS escalation. */
function getLastErrors(steps: readonly ReasoningStep[]): readonly string[] {
  return steps
    .filter(
      (s) => s.type === "observation" && s.metadata?.observationResult?.success === false,
    )
    .slice(-3)
    .map((s) => s.metadata?.observationResult?.displayText ?? s.content.slice(0, 100));
}

/**
 * Normalize action content for comparison — parses JSON and re-serializes with
 * sorted keys so that `{"a":1,"b":2}` and `{"b":2,"a":1}` are treated as equal.
 * Falls back to trimmed string comparison on parse failure.
 */
function normalizeActionContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, Object.keys(parsed).sort());
  } catch {
    return content.trim();
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Execute a ThoughtKernel in a loop until it reaches "done", "failed", or
 * exhausts `maxIterations`.
 *
 * This is the **universal execution loop** — every reasoning strategy delegates
 * to this function instead of implementing its own while-loop.
 */
export function runKernel(
  kernel: ThoughtKernel,
  input: KernelInput,
  options: KernelRunOptions,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    // ── 1. Resolve services ──────────────────────────────────────────────────
    const services = yield* resolveStrategyServices;
    const { toolService, eventBus } = services;

    // ── Auto-inject ToolCallResolver ─────────────────────────────────────────
    // When the provider supports native FC, create a resolver and inject it
    // into the kernel input so handleThinking uses native function calling.
    let effectiveInput = input;
    if (!(input as any).toolCallResolver) {
      const llmOpt = yield* Effect.serviceOption(LLMService);
      if (llmOpt._tag === "Some" && typeof llmOpt.value.capabilities === "function") {
        const caps = yield* llmOpt.value.capabilities().pipe(
          Effect.catchAll(() => Effect.succeed(DEFAULT_CAPABILITIES)),
        );
        if (caps.supportsToolCalling) {
          const resolver = createToolCallResolver(caps);
          effectiveInput = { ...input, toolCallResolver: resolver } as KernelInput;
        }
      }
    }

    // ── 2. Build profile ─────────────────────────────────────────────────────
    const profile: ContextProfile = effectiveInput.contextProfile
      ? ({ ...CONTEXT_PROFILES["mid"], ...effectiveInput.contextProfile } as ContextProfile)
      : CONTEXT_PROFILES["mid"];

    // ── 3. Build hooks ───────────────────────────────────────────────────────
    const hooks = buildKernelHooks(eventBus);

    // ── 4. Build KernelContext ────────────────────────────────────────────────
    const context: KernelContext = {
      input: effectiveInput,
      profile,
      compression: effectiveInput.resultCompression ?? {
        budget: profile.toolResultMaxChars ?? 800,
        previewItems: 5,
        autoStore: true,
        codeTransform: true,
      },
      toolService,
      hooks,
    };

    // ── 5. Create initial state ──────────────────────────────────────────────
    const baseState = initialKernelState(options);
    // Seed messages from input.initialMessages if provided (e.g. chat history injection)
    let state = effectiveInput.initialMessages?.length
      ? transitionState(baseState, { messages: effectiveInput.initialMessages })
      : baseState;

    // Mutable scratchpad mirror — synced from state.scratchpad (ReadonlyMap) after each kernel step.
    const mutableScratchpad = new Map<string, string>(state.scratchpad);

    // ── 6. Main loop ─────────────────────────────────────────────────────────
    // Track which tools were used before this iteration to compute per-step tools.
    let prevToolsUsed = new Set<string>();
    let prevStepCount = 0;
    const loopCfg = options.loopDetection;
    const maxSameTool = loopCfg?.maxSameToolCalls ?? 3;
    const maxRepeatedThought = loopCfg?.maxRepeatedThoughts ?? 3;
    const maxConsecutiveThoughts = loopCfg?.maxConsecutiveThoughts ?? 3;

    // Required tools guard — tracks redirect attempts to prevent infinite loops
    const requiredTools = effectiveInput.requiredTools ?? [];
    const maxRequiredToolRetries = effectiveInput.maxRequiredToolRetries ?? 2;
    let requiredToolRedirects = 0;

    // Strategy switching state
    let switchCount = 0;
    const triedStrategies: string[] = [options.strategy ?? "reactive"];
    // currentOptions tracks the active strategy name for the current pass
    let currentOptions = options;
    // currentInput tracks per-pass input (may carry handoff priorContext)
    let currentInput: KernelInput = effectiveInput;
    // currentContext tracks the KernelContext (rebuilt when input changes on switch)
    let currentContext: KernelContext = context;

    while (
      state.status !== "done" &&
      state.status !== "failed" &&
      state.iteration < currentOptions.maxIterations
    ) {
      state = yield* kernel(state, currentContext);

      // Sync scratchpad: kernel may have added entries
      for (const [k, v] of state.scratchpad) {
        mutableScratchpad.set(k, v);
      }

      // ── Entropy scoring (post-kernel, pre-loop-detection) ──────────────
      if (services.entropySensor._tag === "Some") {
        const newThoughtSteps = state.steps.filter(
          (s, idx) => s.type === "thought" && idx >= prevStepCount,
        );
        if (newThoughtSteps.length > 0) {
          const latestThought = newThoughtSteps[newThoughtSteps.length - 1]!;
          const priorThoughts = state.steps
            .slice(0, prevStepCount)
            .filter((s) => s.type === "thought");
          const priorThought = priorThoughts.length > 0
            ? priorThoughts[priorThoughts.length - 1]!.content
            : undefined;

          yield* services.entropySensor.value
            .score({
              thought: latestThought.content ?? "",
              taskDescription: (state.meta.entropy as any)?.taskDescription ?? "",
              strategy: state.strategy,
              iteration: state.iteration,
              maxIterations: (state.meta.maxIterations as number) ?? 10,
              modelId: (state.meta.entropy as any)?.modelId ?? "unknown",
              temperature: (state.meta.entropy as any)?.temperature ?? 0,
              priorThought,
              logprobs: (state.meta.entropy as any)?.lastLogprobs,
              kernelState: state,
              taskCategory: (state.meta.entropy as any)?.taskCategory,
            })
            .pipe(
              Effect.tap((score: any) => {
                const entropyMeta = (state.meta as any).entropy ?? {};
                const history = entropyMeta.entropyHistory ?? [];
                history.push(score);
                (state.meta as any).entropy = { ...entropyMeta, entropyHistory: history };

                if (eventBus._tag === "Some") {
                  return eventBus.value.publish({
                    _tag: "EntropyScored",
                    taskId: state.taskId,
                    iteration: score.iteration,
                    composite: score.composite,
                    sources: score.sources,
                    trajectory: score.trajectory,
                    confidence: score.confidence,
                    modelTier: score.modelTier,
                    iterationWeight: score.iterationWeight,
                  });
                }
                return Effect.void;
              }),
              Effect.catchAll(() => Effect.void),
            );
        }
      }
      prevStepCount = state.steps.length;

      // ── Reactive Controller evaluation ──────────────────────────────────
      if (services.reactiveController._tag === "Some") {
        const entropyHistory = ((state.meta as any).entropy?.entropyHistory ?? []) as readonly any[];
        if (entropyHistory.length > 0) {
          const latestScore = entropyHistory[entropyHistory.length - 1];
          const decisions = yield* services.reactiveController.value.evaluate({
            entropyHistory,
            iteration: state.iteration,
            maxIterations: currentOptions.maxIterations,
            strategy: state.strategy,
            calibration: {
              highEntropyThreshold: 0.8,
              convergenceThreshold: 0.4,
              calibrated: false,
              sampleCount: 0,
            },
            config: (state.meta as any).entropy?.controllerConfig ?? {
              earlyStop: true,
              contextCompression: true,
              strategySwitch: true,
            },
            contextPressure: latestScore?.sources?.contextPressure ?? 0,
            behavioralLoopScore: latestScore?.sources?.behavioral ?? 0,
          });

          for (const decision of decisions) {
            // Publish ReactiveDecision event
            if (eventBus._tag === "Some") {
              yield* eventBus.value.publish({
                _tag: "ReactiveDecision",
                taskId: state.taskId,
                iteration: state.iteration,
                decision: (decision as any).decision,
                reason: (decision as any).reason,
                entropyBefore: latestScore?.composite ?? 0,
              }).pipe(Effect.catchAll(() => Effect.void));
            }
          }

          // Store all controller decisions on state so the termination oracle can consume them.
          // The oracle's reactiveControllerEarlyStopEvaluator reads state.meta.controllerDecisions
          // and signals a high-confidence exit when an early-stop decision is present.
          if (decisions.length > 0) {
            state = transitionState(state, {
              meta: { ...state.meta, controllerDecisions: decisions },
            });

            // NEW: accumulate into controllerDecisionLog for pulse tool access
            const formatted = decisions.map((d: Record<string, unknown>) => {
              const decision = String(d.decision ?? "");
              const context =
                typeof d.reason === "string" ? d.reason
                : "sections" in d && Array.isArray(d.sections) ? `sections=[${(d.sections as string[]).join(",")}]`
                : typeof d.skillName === "string" ? d.skillName
                : "";
              return context ? `${decision}: ${context}` : decision;
            });
            state = transitionState(state, {
              controllerDecisionLog: [...state.controllerDecisionLog, ...formatted],
            });
          }
        }
      }

      // ── Iteration progress hook ──────────────────────────────────────────
      // Compute which tools were called in THIS iteration (new since prev step).
      const toolsThisStep = [...state.toolsUsed].filter((t) => !prevToolsUsed.has(t));
      yield* hooks.onIterationProgress(state, toolsThisStep);
      prevToolsUsed = new Set(state.toolsUsed);

      // ── Intelligent Context Synthesis (before thinking step) ──
      // Fires on ALL iterations including iteration 0 so the orient phase
      // receives synthesized context with tool hints (GAP 1 fix).
      const synthesisCfg: SynthesisConfig = currentInput.synthesisConfig ?? { mode: "auto" };
      if (synthesisCfg.mode !== "off" && state.status === "thinking") {
        const synthesizerOpt = yield* Effect.serviceOption(ContextSynthesizerService);
        if (synthesizerOpt._tag === "Some") {
          const entropyMeta = (state.meta as Record<string, unknown>).entropy as
            | { entropyHistory?: readonly SynthesisEntropySignals[] }
            | undefined;
          const hist = entropyMeta?.entropyHistory;
          const latestEntropy =
            hist && hist.length > 0 ? (hist[hist.length - 1] as SynthesisEntropySignals) : undefined;

          const taskPhase = classifyTaskPhase({
            iteration: state.iteration,
            toolsUsed: state.toolsUsed,
            requiredTools: currentInput.requiredTools ?? [],
            steps: state.steps,
          });

          const profile = currentContext.profile;
          const synthesisInput: SynthesisInput = {
            transcript: state.messages,
            task: currentInput.task,
            taskPhase,
            requiredTools: currentInput.requiredTools ?? [],
            toolsUsed: state.toolsUsed,
            availableTools: currentInput.availableToolSchemas ?? [],
            entropy: latestEntropy,
            iteration: state.iteration,
            maxIterations: currentOptions.maxIterations,
            lastErrors: getLastErrors(state.steps),
            tier: profile.tier ?? "mid",
            tokenBudget: Math.floor(8192 * ((profile.contextBudgetPercent ?? 80) / 100)),
            synthesisConfig: synthesisCfg,
          };

          const synthesized = yield* synthesizerOpt.value
            .synthesize(synthesisInput)
            .pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (synthesized !== null) {
            yield* hooks
              .onContextSynthesized(
                synthesized,
                state.taskId,
                currentInput.agentId ?? "unknown",
              )
              .pipe(Effect.catchAll(() => Effect.void));

            state = transitionState(state, { synthesizedContext: synthesized });
          }
        }
      }

      // ── Early exit: primary scoped tools called ─────────────────────────
      // For composite steps in plan-execute, exit as soon as all primary
      // (non-utility) tools have been called. Utility tools like scratchpad
      // are optional — the agent may not need them for every step.
      if (
        currentOptions.exitOnAllToolsCalled &&
        state.status !== "done" &&
        state.status !== "failed" &&
        currentInput.availableToolSchemas &&
        currentInput.availableToolSchemas.length > 0 &&
        state.toolsUsed.size > 0
      ) {
        const UTILITY_TOOLS = new Set(["recall"]);
        const primaryTools = currentInput.availableToolSchemas
          .map((t) => t.name)
          .filter((name) => !UTILITY_TOOLS.has(name));
        // If there are primary tools, check if all were called
        // If ALL tools are utility tools, don't early-exit (let LLM finish naturally)
        if (primaryTools.length > 0) {
          const allPrimaryCalled = primaryTools.every((name) => state.toolsUsed.has(name));
          if (allPrimaryCalled) {
            const lastObs = [...state.steps].reverse().find((s) => s.type === "observation");
            state = transitionState(state, {
              status: "done",
              output: lastObs?.content ?? state.output ?? "[All tools executed successfully]",
            });
            (state.meta as any).terminatedBy = "all_tools_called";
          }
        }
      }

      // ── Loop detection ───────────────────────────────────────────────────
      // Check the most recent steps for patterns that indicate a stuck loop.
      // Only fire if the loop hasn't already terminated (status still active).
      if (state.status !== "done" && state.status !== "failed") {
        const steps = state.steps;
        let loopMsg: string | null = null;

        // (a) Repeated tool calls: same tool + same args N times in a row
        //     Filter first, then take the last N — ensures we compare actual
        //     actions, not a mix of action/thought/observation steps.
        const allActions = steps.filter((s) => s.type === "action");
        if (allActions.length >= maxSameTool) {
          const recentActions = allActions.slice(-maxSameTool);
          const firstNorm = normalizeActionContent(recentActions[0]!.content);
          const allSame = recentActions.every((s) => normalizeActionContent(s.content) === firstNorm);
          if (allSame) {
            loopMsg = `Loop detected: same tool call repeated ${maxSameTool} times`;
          }
        }

        // (b) Repeated thoughts: identical thought content N times in recent history
        //     Only flag when NO action steps are interleaved — if the model is
        //     making tool calls between identical thoughts, it is progressing
        //     (FC models often produce brief/identical reasoning text before each
        //     tool call; the real work is in the tool calls themselves).
        if (loopMsg === null) {
          const allThoughts = steps.filter((s) => s.type === "thought");
          if (allThoughts.length >= maxRepeatedThought) {
            const recentThoughts = allThoughts.slice(-maxRepeatedThought);
            const lastThought = recentThoughts[recentThoughts.length - 1]!.content;
            const allSameThought = recentThoughts.every((s) => s.content === lastThought);
            if (allSameThought) {
              const recentActions = steps.filter((s) => s.type === "action");
              const hasRecentProgress = recentActions.length > 0
                && recentActions.some((a) => {
                  const idx = steps.indexOf(a);
                  const firstThoughtIdx = steps.indexOf(recentThoughts[0]!);
                  return idx >= firstThoughtIdx;
                });
              if (!hasRecentProgress) {
                loopMsg = `Loop detected: the model repeated the same thought ${maxRepeatedThought} times without making progress.\n` +
                  `Fix: (1) Add a persona instruction like "Think step-by-step then call tools immediately", ` +
                  `(2) Use .withReasoning({ defaultStrategy: 'plan-execute-reflect' }) for multi-step tasks, ` +
                  `(3) Check that tool descriptions are clear and unambiguous.`;
              }
            }
          }
        }

        // (c) Consecutive thoughts without any action — agent is stuck thinking
        //     without making progress. Count trailing thought steps (no action between them).
        if (loopMsg === null) {
          let consecutiveThoughts = 0;
          for (let i = steps.length - 1; i >= 0; i--) {
            if (steps[i]!.type === "thought") consecutiveThoughts++;
            else break; // any non-thought (action/observation) resets the streak
          }
          if (consecutiveThoughts >= maxConsecutiveThoughts) {
            loopMsg = `Loop detected: ${consecutiveThoughts} consecutive thinking steps with no tool calls.\n` +
              `Fix: (1) Verify the model supports function calling for your provider, ` +
              `(2) Simplify the task description — the model may not know which tool to use, ` +
              `(3) For local models, try .withContextProfile({ tier: 'local' }) for stronger tool guidance.`;
          }
        }

        // ── Strategy switching ────────────────────────────────────────────
        if (loopMsg !== null) {
          const switchCfg = options.strategySwitching;
          const maxSwitches = switchCfg?.maxSwitches ?? 1;

          if (switchCfg?.enabled && switchCount < maxSwitches) {
            // Transition to "evaluating" while we decide
            state = transitionState(state, { status: "evaluating" });

            let evaluation: { shouldSwitch: boolean; recommendedStrategy: string; reasoning: string };

            if (switchCfg.fallbackStrategy) {
              // Skip LLM evaluator — use fallback directly
              evaluation = {
                shouldSwitch: true,
                recommendedStrategy: switchCfg.fallbackStrategy,
                reasoning: "fallback strategy configured",
              };
            } else {
              // Ask the LLM evaluator to pick the best alternative
              const available = switchCfg.availableStrategies ?? [];
              evaluation = yield* evaluateStrategySwitch(
                state,
                currentInput.task ?? "",
                available,
                triedStrategies,
              );
            }

            // Fire evaluated hook regardless of whether switch will happen — observability
            yield* hooks.onStrategySwitchEvaluated(state, evaluation);

            if (evaluation.shouldSwitch && evaluation.recommendedStrategy) {
              const fromStrategy = triedStrategies[triedStrategies.length - 1] ?? "unknown";
              const toStrategy = evaluation.recommendedStrategy;

              // Fire hook
              yield* hooks.onStrategySwitched(state, fromStrategy, toStrategy, evaluation.reasoning);

              // Build handoff context for the new strategy
              const handoff = buildHandoff(
                state,
                currentInput.task ?? "",
                fromStrategy,
                loopMsg,
                switchCount + 1,
              );

              const handoffSummary = [
                `Strategy Switch Handoff (switch #${handoff.switchNumber}):`,
                `Previous strategy: ${handoff.previousStrategy}`,
                `Steps completed: ${handoff.stepsCompleted}`,
                `Failure reason: ${handoff.failureReason}`,
                `Tools called: ${handoff.toolsCalled.join(", ") || "none"}`,
                `Key observations:\n${handoff.keyObservations.join("\n") || "(none)"}`,
              ].join("\n");

              // Re-init state with the new strategy
              switchCount++;
              triedStrategies.push(toStrategy);

              currentOptions = {
                ...options,
                strategy: toStrategy,
              };

              // Reset state — fresh iteration count, carry forward toolsUsed
              state = initialKernelState(currentOptions);

              // Build updated input with handoff context
              const existingPrior = currentInput.priorContext
                ? `${currentInput.priorContext}\n\n${handoffSummary}`
                : handoffSummary;

              currentInput = {
                ...currentInput,
                priorContext: existingPrior,
              };

              // Rebuild context with the updated input
              currentContext = {
                ...context,
                input: currentInput,
              };

              // Reset per-loop tracking
              prevToolsUsed = new Set<string>();
              requiredToolRedirects = 0;

              // Continue the outer while loop with fresh state
              continue;
            }
          }

          // Fall through to standard failure
          state = transitionState(state, {
            status: "failed",
            error: loopMsg,
          });
          break;
        }
      } // end if (state.status !== "done" && state.status !== "failed")

      // ── Required tools guard (in-loop) ─────────────────────────────────
      // When the kernel declares "done" but required tools haven't been called,
      // redirect back to "thinking" with a feedback step — up to the retry limit.
      if (state.status === "done" && requiredTools.length > 0) {
        const missingTools = requiredTools.filter((t) => !state.toolsUsed.has(t));
        if (missingTools.length > 0) {
          requiredToolRedirects++;
          if (requiredToolRedirects > maxRequiredToolRetries) {
            state = transitionState(state, {
              status: "failed",
              error: `Task incomplete — the model never called required tool(s): ${missingTools.join(", ")} ` +
                `(after ${maxRequiredToolRetries} redirect attempts).\n` +
                `Fix: (1) Make the task description explicitly name the expected output ` +
                `(e.g. "write the result to ./report.md"), ` +
                `(2) Add a persona instruction: "You MUST call ${missingTools[0]} as the final step", ` +
                `(3) Increase retries: .withReasoning({ maxRequiredToolRetries: 4 }).`,
            });
            break;
          }
          // Inject feedback and redirect back to thinking
          const feedbackStep = makeStep(
            "observation",
            `⚠️ Required tools not yet used: ${missingTools.join(", ")}. ` +
            `You MUST call ${missingTools.length === 1 ? "this tool" : "these tools"} before completing the task. ` +
            `(Redirect ${requiredToolRedirects}/${maxRequiredToolRetries})`,
          );
          state = transitionState(state, {
            status: "thinking",
            output: null,
            steps: [...state.steps, feedbackStep],
          });
          // Continue the loop — kernel will see the feedback in steps
        }
      }
    }

    // ── 7. Post-loop required tools check ───────────────────────────────────
    // Final safety net: if the loop exited with "done" (e.g. via bare tool call
    // guard or max iterations) but required tools still haven't been called, fail.
    if (state.status === "done" && requiredTools.length > 0) {
      const missingTools = requiredTools.filter((t) => !state.toolsUsed.has(t));
      if (missingTools.length > 0) {
        state = transitionState(state, {
          status: "failed",
          error: `Task incomplete — required tool(s) never called: ${missingTools.join(", ")}.\n` +
            `Fix: Make the task description clearly specify the deliverable ` +
            `(e.g. "write results to ./output.md"), or add a persona instruction ` +
            `explicitly requiring the tool call.`,
        });
      }
    }

    // ── 8. Terminal hooks ────────────────────────────────────────────────────
    if (state.status === "done") {
      yield* hooks.onDone(state);
    } else if (state.status === "failed") {
      yield* hooks.onError(state, state.error ?? "unknown error");
    }

    // ── 9. Return final state ────────────────────────────────────────────────
    return state;
  });
}
