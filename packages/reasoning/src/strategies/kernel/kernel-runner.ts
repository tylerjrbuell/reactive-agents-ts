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
import { resolveStrategyServices } from "./utils/service-utils.js";
import { buildKernelHooks } from "./kernel-hooks.js";
import { makeStep } from "./utils/step-utils.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type ThoughtKernel,
} from "./kernel-state.js";
import { evaluateStrategySwitch, buildHandoff } from "./utils/strategy-evaluator.js";
import { coordinateICS } from "./utils/ics-coordinator.js";
import { runReactiveObserver } from "./utils/reactive-observer.js";
import { detectLoop, checkAllToolsCalled } from "./utils/loop-detector.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Error strings from recent failed tool observations — feeds ICS nudge content. */
function getLastErrors(state: KernelState): readonly string[] {
  return state.steps
    .filter(
      (s) => s.type === "observation" && s.metadata?.observationResult?.success === false,
    )
    .slice(-2)
    .map((s) => (s.metadata?.observationResult?.error as string | undefined) ?? "unknown error")
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

      // ── Entropy scoring + Reactive Controller evaluation ────────────────
      ({ state, prevStepCount } = yield* runReactiveObserver(
        state, services, eventBus, prevStepCount, currentOptions,
      ));

      // ── Iteration progress hook ──────────────────────────────────────────
      // Compute which tools were called in THIS iteration (new since prev step).
      const toolsThisStep = [...state.toolsUsed].filter((t) => !prevToolsUsed.has(t));
      yield* hooks.onIterationProgress(state, toolsThisStep);
      prevToolsUsed = new Set(state.toolsUsed);

      // ── Intelligent Context Synthesis (before thinking step) ──
      // Produces a steering nudge appended to the FC thread — never replaces it.
      const icsResult = yield* coordinateICS(state, {
        task: currentInput.task,
        requiredTools: currentInput.requiredTools ?? [],
        toolsUsed: state.toolsUsed,
        availableTools: (currentInput.availableToolSchemas ?? []) as readonly { name: string; description: string; parameters: unknown[] }[],
        tier: profile.tier ?? "mid",
        iteration: state.iteration,
        maxIterations: (state.meta.maxIterations as number) ?? 10,
        lastErrors: getLastErrors(state),
      });
      if (icsResult.steeringNudge) {
        state = transitionState(state, { steeringNudge: icsResult.steeringNudge });
      }

      // ── Early exit: primary scoped tools called ─────────────────────────
      // For composite steps in plan-execute, exit as soon as all primary
      // (non-utility) tools have been called.
      state = checkAllToolsCalled(state, currentInput, currentOptions);

      // ── Loop detection + strategy switching ─────────────────────────────
      // Check the most recent steps for patterns that indicate a stuck loop.
      // Only fire if the loop hasn't already terminated (status still active).
      if (state.status !== "done" && state.status !== "failed") {
        const loopMsg = detectLoop(
          state.steps,
          maxSameTool,
          maxRepeatedThought,
          maxConsecutiveThoughts,
        );

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
