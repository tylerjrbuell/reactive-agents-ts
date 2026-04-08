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
import { classifyToolRelevance } from "../../structured-output/infer-required-tools.js";

/** Meta-tool names — not counted as "real work" for reclassification triggers. */
const RUNNER_META_TOOLS = new Set(["final-answer", "task-complete", "context-status", "brief", "pulse", "find", "recall"]);

// ── Harness deliverable assembly ──────────────────────────────────────────────

/**
 * Assemble a deliverable from accumulated tool results.
 *
 * When the harness determines the model is spinning but has already gathered
 * useful data, this function extracts all successful non-meta tool observations
 * and joins them as the final output. The harness owns task completion —
 * it doesn't depend on the model calling `final-answer`.
 *
 * Filters out guard-blocked observations (which are marked success=true but
 * contain warning markers) by requiring the tool to be in `state.toolsUsed`
 * (only actually-executed tools are added to that set) and excluding known
 * guard-block text patterns.
 */
export function assembleDeliverable(state: KernelState): string {
  const artifacts: string[] = [];
  for (const step of state.steps) {
    if (step.type !== "observation") continue;
    const r = step.metadata?.observationResult as
      { success?: boolean; toolName?: string } | undefined;
    if (!r?.success || !r.toolName) continue;
    if (RUNNER_META_TOOLS.has(r.toolName)) continue;
    if (!state.toolsUsed.has(r.toolName)) continue;
    const content = (step.content ?? "").trim();
    // Skip guard-block observations that leaked through as success=true
    if (content.startsWith("\u26A0\uFE0F") || content.includes("[Already done")) continue;
    if (content.length > 20) artifacts.push(content);
  }

  if (artifacts.length > 0) return artifacts.join("\n\n");

  // Fallback: use the last substantive thought
  const lastThought = [...state.steps]
    .reverse()
    .find((s) => s.type === "thought" && (s.content ?? "").length > 20);
  return lastThought?.content ?? "Task complete.";
}

// ── Token-delta guard ─────────────────────────────────────────────────────────

/**
 * Guard: exit when model stops making progress (2 consecutive low-delta iterations).
 *
 * Conditions that must ALL be true to trigger early exit:
 * - iteration >= 3 (give the model at least a few steps before judging)
 * - tokenDelta < 500 (this iteration added very few tokens — model is stalling)
 * - consecutiveLowDeltaCount >= 2 (two consecutive low-delta iterations in a row)
 */
export function shouldExitOnLowDelta(opts: {
  iteration: number
  tokenDelta: number
  consecutiveLowDeltaCount: number
}): boolean {
  const { iteration, tokenDelta, consecutiveLowDeltaCount } = opts
  return iteration >= 3 && tokenDelta < 500 && consecutiveLowDeltaCount >= 2
}

// ── Oracle hard gate ──────────────────────────────────────────────────────────

/**
 * Guard: force exit when the pulse oracle has said readyToAnswer=true but the
 * model has ignored it for 2 consecutive iterations (Stage 2).
 *
 * Stage 1 (nudgeCount < 2): caller should inject a mandatory steering nudge and
 * increment readyToAnswerNudgeCount.
 * Stage 2 (nudgeCount >= 2): return true → caller terminates with "oracle_forced".
 */
export function shouldForceOracleExit(opts: {
  oracleReady: boolean
  readyToAnswerNudgeCount: number
}): boolean {
  return opts.oracleReady && opts.readyToAnswerNudgeCount >= 2
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the readyToAnswer flag from the most recent pulse observation step.
 * Returns false when there is no pulse observation or the JSON cannot be parsed.
 */
function getLastPulseReadyToAnswer(state: KernelState): boolean {
  const pulseObs = [...state.steps]
    .reverse()
    .find(
      (s) =>
        s.type === "observation" &&
        s.metadata?.observationResult?.toolName === "pulse",
    );
  if (!pulseObs) return false;
  try {
    const parsed = JSON.parse(pulseObs.content ?? "");
    return parsed?.readyToAnswer === true;
  } catch {
    return false;
  }
}

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

    // Dynamic tool reclassification state
    // When the model is stuck (gate-blocked tools, no progress), re-classify
    // which tools are required/relevant based on what the agent has learned so far.
    let reclassifyCount = 0;
    const maxReclassifications = 2;
    let noProgressIterations = 0;
    const hasInitialClassification =
      (effectiveInput.requiredTools?.length ?? 0) > 0 ||
      (effectiveInput.relevantTools?.length ?? 0) > 0;
    let currentContext: KernelContext = context;

    // Harness stall tracking — counts consecutive iterations with no new non-meta tool results.
    // When the model has gathered artifacts but stalls, the harness delivers accumulated data.
    let consecutiveStalled = 0;

    while (
      state.status !== "done" &&
      state.status !== "failed" &&
      state.iteration < currentOptions.maxIterations
    ) {
      const prevTokens = state.tokens;
      state = yield* kernel(state, currentContext);

      // ── Token-delta diminishing-returns guard ────────────────────────────
      // Track consecutive iterations where the model adds fewer than 500 tokens.
      // After 2 such iterations (starting from iteration 3), exit early to prevent
      // wasted iterations on a stalled model.
      // Guard is skipped when no LLM calls have been made (e.g. test/mock kernels
      // that emit 0 tokens) to avoid false positives in non-LLM scenarios.
      const tokenDelta = state.tokens - prevTokens;
      if (state.tokens > 0 || prevTokens > 0) {
        const lowDelta = tokenDelta < 500;
        const newConsecutiveLowDelta = lowDelta ? (state.consecutiveLowDeltaCount ?? 0) + 1 : 0;
        state = transitionState(state, { consecutiveLowDeltaCount: newConsecutiveLowDelta });

        // Only fire the guard when there are remaining iterations to save
        // (if we're already at the last iteration, the loop exits naturally).
        const hasRemainingIterations = state.iteration < currentOptions.maxIterations - 1;
        if (
          hasRemainingIterations &&
          state.status !== "done" &&
          state.status !== "failed" &&
          shouldExitOnLowDelta({ iteration: state.iteration, tokenDelta, consecutiveLowDeltaCount: newConsecutiveLowDelta })
        ) {
          yield* Effect.log(`[token-delta-guard] Early exit: 2 consecutive iterations with <500 token delta (delta=${tokenDelta}, iter=${state.iteration})`);
          state = transitionState(state, {
            status: "done",
            meta: { ...state.meta, terminatedBy: "low_delta_guard" },
          });
          break;
        }
      }

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

      // ── Harness artifact stall tracking ─────────────────────────────────
      // Track whether this iteration produced new non-meta tool results.
      // The harness owns completion: when the model stalls but has gathered
      // useful data, it assembles and delivers the accumulated artifacts.
      const nonMetaGains = toolsThisStep.filter((t) => !RUNNER_META_TOOLS.has(t));
      consecutiveStalled = nonMetaGains.length > 0 ? 0 : consecutiveStalled + 1;

      const totalArtifacts = [...state.toolsUsed].filter((t) => !RUNNER_META_TOOLS.has(t)).length;
      if (
        totalArtifacts > 0 &&
        consecutiveStalled >= 2 &&
        state.iteration >= 2 &&
        state.status !== "done" &&
        state.status !== "failed"
      ) {
        yield* Effect.log(
          `[harness-deliverable] Assembling output from ${totalArtifacts} tool artifacts after ${consecutiveStalled} stalled iterations`,
        );
        state = transitionState(state, {
          status: "done",
          output: assembleDeliverable(state),
          meta: { ...state.meta, terminatedBy: "harness_deliverable" },
        });
        break;
      }

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

      // ── Dynamic tool reclassification ──────────────────────────────────
      // When the model is struggling with the current tool set (gate-blocked
      // attempts, or no new non-meta tools used for 2+ iterations), re-run
      // classification with enriched context — the original task PLUS what
      // the model has learned, attempted, and been blocked from doing.
      // This allows the visible tool set to evolve with the agent's
      // exploration instead of being locked to the initial classification.
      // Guard: only reclassify when there are enough tools to warrant it
      // (>3 non-meta tools); trivial tool sets don't benefit from reclassification.
      const availableSchemaCount = currentInput.availableToolSchemas?.length ?? 0;
      if (
        state.status !== "done" &&
        state.status !== "failed" &&
        reclassifyCount < maxReclassifications &&
        hasInitialClassification &&
        availableSchemaCount > 3 &&
        state.iteration >= 1
      ) {
        const newNonMetaTools = toolsThisStep.filter((t) => !RUNNER_META_TOOLS.has(t));
        noProgressIterations = newNonMetaTools.length === 0 ? noProgressIterations + 1 : 0;

        const gateBlocked = (state.meta.gateBlockedTools as readonly string[] | undefined) ?? [];
        const shouldReclassify =
          gateBlocked.length > 0 || noProgressIterations >= 2;

        if (shouldReclassify) {
          // Build enriched task description with current execution context
          const toolsSoFar = [...state.toolsUsed].filter((t) => !RUNNER_META_TOOLS.has(t));
          const recentObs = state.steps
            .filter((s) => s.type === "observation")
            .slice(-3)
            .map((s) => (s.content ?? "").slice(0, 200))
            .join("\n");
          const lastThought = (state.meta.lastThought as string) ?? "";

          const enrichedTask = [
            `Original task: ${currentInput.task}`,
            toolsSoFar.length > 0 ? `Tools already used successfully: ${toolsSoFar.join(", ")}` : "",
            gateBlocked.length > 0 ? `Model attempted tools that were blocked: ${gateBlocked.join(", ")}` : "",
            recentObs ? `Recent observations:\n${recentObs}` : "",
            lastThought ? `Model's current reasoning: ${lastThought.slice(0, 300)}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          const toolSummaries = (currentInput.availableToolSchemas ?? []).map((t) => ({
            name: t.name,
            description: t.description ?? "",
            parameters: (t.parameters ?? []).map((p) => ({
              name: p.name,
              type: p.type ?? "string",
              description: p.description ?? "",
              required: Boolean(p.required),
            })),
          }));

          const reclassResult = yield* classifyToolRelevance({
            taskDescription: enrichedTask,
            availableTools: toolSummaries,
            systemPrompt: currentInput.systemPrompt,
          }).pipe(
            Effect.catchAllCause(() =>
              Effect.succeed({ required: [] as readonly string[], relevant: [] as readonly string[] }),
            ),
          );

          if (reclassResult.required.length > 0 || reclassResult.relevant.length > 0) {
            // Merge: preserve original required tools, union with new classification
            const prevRequired = currentInput.requiredTools ?? [];
            const newRequired = [...new Set([...prevRequired, ...reclassResult.required])];
            const newRelevant = [...new Set([
              ...reclassResult.relevant,
              ...(currentInput.relevantTools ?? []),
            ])];

            currentInput = {
              ...currentInput,
              requiredTools: newRequired,
              relevantTools: newRelevant,
            };
            currentContext = { ...currentContext, input: currentInput };
            reclassifyCount++;

            // Clear gateBlockedTools since we've incorporated the feedback
            state = transitionState(state, {
              meta: { ...state.meta, gateBlockedTools: undefined },
            });
            noProgressIterations = 0;

            yield* Effect.log(
              `[reclassify] Updated tool classification (attempt ${reclassifyCount}/${maxReclassifications}): ` +
                `required=[${newRequired.join(", ")}], relevant=[${newRelevant.join(", ")}]`,
            );
          }
        }
      }

      // ── Oracle hard gate (pulse readyToAnswer two-stage escalation) ──────
      // When the pulse tool has reported readyToAnswer=true but the model
      // has not called final-answer, escalate in two stages:
      //   Stage 1: inject a mandatory steering nudge, increment nudge count.
      //   Stage 2: after 2 ignored nudges, force-exit with "oracle_forced".
      if (state.status !== "done" && state.status !== "failed") {
        const oracleReady = getLastPulseReadyToAnswer(state);
        const nudgeCount = state.readyToAnswerNudgeCount ?? 0;

        if (shouldForceOracleExit({ oracleReady, readyToAnswerNudgeCount: nudgeCount })) {
          // Stage 2: force exit — model has been nudged twice and still hasn't called final-answer
          yield* Effect.log(`[oracle-gate] Forcing exit after ${nudgeCount} ignored readyToAnswer signals`);
          const forcedOutput = state.output ?? state.steps.filter((s) => s.type === "thought").slice(-1)[0]?.content ?? "Task complete.";
          state = transitionState(state, {
            status: "done",
            output: forcedOutput,
            meta: { ...state.meta, terminatedBy: "oracle_forced" },
          });
        } else if (oracleReady) {
          // Stage 1: inject mandatory steering nudge, increment count
          const mandatoryNudge = "You are ready to answer. Call `final-answer` now with your complete response. This is mandatory.";
          state = transitionState(state, {
            readyToAnswerNudgeCount: nudgeCount + 1,
            steeringNudge: mandatoryNudge,
          });
          yield* Effect.log(`[oracle-gate] Stage 1 nudge injected (nudgeCount now ${nudgeCount + 1})`);
        } else if (nudgeCount > 0) {
          // Oracle no longer ready — reset nudge count
          state = transitionState(state, { readyToAnswerNudgeCount: 0 });
        }
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
              noProgressIterations = 0;
              reclassifyCount = 0;
              consecutiveStalled = 0;

              // Continue the outer while loop with fresh state
              continue;
            }
          }

          // Before failing: if the model has gathered artifacts, succeed with them.
          // Loops with data → deliver. Loops without data → fail.
          const loopArtifactCount = [...state.toolsUsed].filter((t) => !RUNNER_META_TOOLS.has(t)).length;
          if (loopArtifactCount > 0) {
            yield* Effect.log(
              `[harness-deliverable] Loop detected but ${loopArtifactCount} artifacts gathered — delivering instead of failing`,
            );
            state = transitionState(state, {
              status: "done",
              output: assembleDeliverable(state),
              meta: { ...state.meta, terminatedBy: "harness_deliverable" },
            });
            break;
          }

          // No artifacts — genuine failure
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
    // Exception: harness_deliverable exits are deliberate — the harness determined
    // enough data was gathered despite some tools not being called.
    if (state.status === "done" && requiredTools.length > 0 && state.meta.terminatedBy !== "harness_deliverable") {
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
