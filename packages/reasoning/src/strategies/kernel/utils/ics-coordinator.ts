/**
 * ICS Coordinator — prepares synthesized context between kernel iterations.
 *
 * Calls ContextSynthesizerService when enabled, classifies the current task phase,
 * and returns a state with synthesizedContext set for the next think phase.
 *
 * Fires on ALL iterations including iteration 0 so the orient phase receives
 * synthesized context with tool hints (GAP 1 fix).
 *
 * Extracted from kernel-runner.ts to keep the main loop focused on iteration logic.
 */
import { Effect } from "effect";
import { ContextSynthesizerService } from "../../../context/context-synthesizer.js";
import { classifyTaskPhase } from "../../../context/task-phase.js";
import type { SynthesisConfig, SynthesisInput, SynthesisEntropySignals } from "../../../context/synthesis-types.js";
import { transitionState } from "../kernel-state.js";
import type { KernelState, KernelInput, KernelRunOptions, KernelContext, KernelHooks } from "../kernel-state.js";
import type { ReasoningStep } from "../../../types/index.js";

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
 * Run the Intelligent Context Synthesis coordination block.
 *
 * Called after each kernel iteration (when state.status === "thinking") to produce
 * a synthesized context hint for the next think phase.
 *
 * Returns the state unchanged if:
 * - synthesisConfig.mode === "off"
 * - status !== "thinking"
 * - ContextSynthesizerService is not in the Effect environment
 */
export function coordinateICS(
  state: KernelState,
  currentInput: KernelInput,
  currentOptions: KernelRunOptions,
  currentContext: KernelContext,
  hooks: KernelHooks,
): Effect.Effect<KernelState, never> {
  return Effect.gen(function* () {
    const synthesisCfg: SynthesisConfig = currentInput.synthesisConfig ?? { mode: "auto" };
    if (synthesisCfg.mode === "off" || state.status !== "thinking") {
      return state;
    }

    const synthesizerOpt = yield* Effect.serviceOption(ContextSynthesizerService);
    if (synthesizerOpt._tag !== "Some") {
      return state;
    }

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

      return transitionState(state, { synthesizedContext: synthesized });
    }

    return state;
  });
}
