import { Effect, Context, Layer, Ref, Stream as EStream, Duration, Logger, FiberRef, Fiber } from "effect";
import type { ExecutionContext, ReactiveAgentsConfig } from "./types.js";
import { ExecutionError, type RuntimeErrors } from "./errors.js";
import { LifecycleHookRegistry } from "./hooks.js";
import type { LifecycleHook } from "./types.js";

import type { AgentStreamEvent, StreamDensity } from "./stream-types.js";
import { StreamingTextCallback, ModelOverrideRef } from "@reactive-agents/core";

// Import from other packages (type-only to avoid circular deps at runtime)
import type { Task, TaskResult } from "@reactive-agents/core";
import type { TaskError } from "@reactive-agents/core";
import type { ContextProfile } from "@reactive-agents/reasoning";
import {
  classifyToolRelevance,
  filterToolsByRelevance,
  ReasoningService,
  CurrentRunBudget,
  VERIFIER_REJECTION_PREFIX,
  VERIFIER_ESCALATION_PREFIX,
} from "@reactive-agents/reasoning";
import {
  BUILTIN_TOOL_NAMES,
  buildFinalAnswerDescription,
  buildFinalAnswerOutputDescription,
} from "@reactive-agents/tools";
import { extractOutputFormat } from "@reactive-agents/reasoning";
import { ChildDashboardRegistry, ObservableLogger, makeObservableLogger, makeStatusRenderer, effectLoggerBridgeLayer } from "@reactive-agents/observability";
import { PlanStoreService, ProceduralMemoryService } from "@reactive-agents/memory";
import { classifyTaskCategory as classifyTaskCategoryFn, skillFragmentToProceduralEntry } from "@reactive-agents/reactive-intelligence";
import { resolveModelCalibration, resolveModelCalibrationAsync } from "./calibration-resolver.js";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { literalMentionRequired } from "./classifier-bypass.js";
import { resolveSynthesisConfigForStrategy } from "./synthesis-resolve.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

// ─── Phase pipeline (W23 decomposition) ───
import { runGuardedPhase } from "./engine/pipeline.js";
import type { PhaseDeps } from "./engine/runtime-context.js";
import { audit } from "./engine/phases/audit.js";
import { bootstrap } from "./engine/phases/bootstrap.js";
import { complete } from "./engine/phases/complete.js";
import { guardrail } from "./engine/phases/guardrail.js";
import { costRoute } from "./engine/phases/cost-route.js";
import { costTrack } from "./engine/phases/cost-track.js";
import { memoryFlush } from "./engine/phases/memory-flush.js";
import { strategySelect } from "./engine/phases/strategy-select.js";
import { verify } from "./engine/phases/verify.js";
import { logVerifySummary } from "./engine/phases/verify-summary-log.js";
import { dispatchMemoryFlush } from "./engine/phases/memory-flush-dispatch.js";
import { resolveCalibration } from "./engine/phases/agent-loop/setup/calibration.js";
import { prepareReasoningToolSchemas } from "./engine/phases/agent-loop/setup/tool-schemas.js";
import { checkSemanticCache } from "./engine/phases/agent-loop/cache-check.js";
import { runVerificationThinkRetry } from "./engine/phases/agent-loop/verification-think-retry.js";
import { runReasoningHarnessHooks } from "./engine/phases/agent-loop/reasoning-harness-hooks.js";
import { runReasoningThink } from "./engine/phases/agent-loop/reasoning-think.js";
import { runReasoningPostThink } from "./engine/phases/agent-loop/reasoning-post-think.js";
import { subscribeReasoningStreamLogger } from "./engine/phases/agent-loop/reasoning-stream-logger.js";
import { runVerificationQualityGate } from "./engine/phases/agent-loop/verification-quality-gate.js";
import { runBootstrapSkillPostprocess } from "./engine/bootstrap/skill-postprocess.js";
import { runPreLoopDispatch } from "./engine/phases/agent-loop/setup/pre-loop-dispatch.js";
import { applyVerificationOutcome } from "./engine/finalize/verification-outcome.js";
import { verifyResultBoundary } from "./engine/finalize/result-verification.js";
import { makeExecuteStream } from "./engine/execute-stream.js";
import { prepareDebrief, finalizeDebriefBackground } from "./engine/finalize/debrief-synthesis.js";
import { emitTelemetryRunReport } from "./engine/finalize/telemetry-emit.js";
import { runLocalLearning } from "./engine/finalize/local-learning.js";
import { finalizeRun } from "./engine/finalize/run-finalize.js";
import { mintTraceLinkage } from "./engine/finalize/trace-linkage.js";

// ─── Execution-cluster decomposition (GH #221 W26) ───
// Verbatim cluster extractions lifted out of this file; each module's header
// doc names the cluster and the former line range.
import { bindExecutionObservability } from "./engine/execute-obs-wiring.js";
import { registerExecutionEventCollectors } from "./engine/execute-event-collectors.js";
import { resolveContractAndKillSwitch } from "./engine/execute-killswitch-bridge.js";
import { makeLifecycleGuard } from "./engine/execute-lifecycle-guard.js";
import { maybeEmitRiTelemetryNotice } from "./engine/execute-telemetry-notice.js";
import { publishAgentStarted } from "./engine/execute-agent-started.js";
import { deriveExecOutput } from "./engine/execute-output-derivation.js";
import { screenFinalOutput } from "./engine/execute-output-screens.js";
import { deriveExecutionSuccess } from "./engine/execute-success-invariants.js";
import { assembleTaskResult } from "./engine/execute-result-assembly.js";
import { emitCompletionObservability } from "./engine/execute-completion-obs.js";

// ─── Service Tag ───

export class ExecutionEngine extends Context.Tag("ExecutionEngine")<
  ExecutionEngine,
  {
    readonly execute: (
      task: Task,
    ) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>;

    readonly registerHook: (hook: LifecycleHook) => Effect.Effect<void, never>;

    readonly getContext: (
      taskId: string,
    ) => Effect.Effect<ExecutionContext | null, never>;

    readonly cancel: (taskId: string) => Effect.Effect<void, ExecutionError>;

    readonly executeStream: (
      task: Task,
      options?: {
        density?: StreamDensity;
        runController?: import("@reactive-agents/core").RunControllerLike;
        onRunId?: (runId: string) => void;
        identity?: { userId: string; orgId?: string };
      },
    ) => Effect.Effect<EStream.Stream<AgentStreamEvent, Error>>;
  }
>() {}

import { armRunBudget } from "./engine/run-budget-arm.js";

// ─── Pure helpers hoisted to engine/util.ts (W24-E step 1) ───
// Re-exported here for backward compatibility with external importers.
export { checkAllowedToolsMismatch } from "./engine/util.js";
import {
  extractTaskText,
  buildAutoMaxCallsPerTool,
  normalizeReasoningResult,
  resolveModelName,
  type TaskComplexity,
  type ExecutionReasoningResult,
  briefResolvedSkillsFromMetadata,
} from "./engine/util.js";
export { classifyComplexity, buildAutoMaxCallsPerTool, type TaskComplexity } from "./engine/util.js";

// ─── Live Implementation ───

export const ExecutionEngineLive = (config: ReactiveAgentsConfig) =>
  Layer.effect(
    ExecutionEngine,
    Effect.gen(function* () {
      const hookRegistry = yield* LifecycleHookRegistry;

      // Track running contexts (taskId -> ExecutionContext)
      const runningContexts = yield* Ref.make<Map<string, ExecutionContext>>(
        new Map(),
      );

      // Track cancelled task IDs
      const cancelledTasks = yield* Ref.make<Set<string>>(new Set());

      // (W26-A step 1) Removed duplicate `runPhase` + `runObservablePhase` closures —
      // the equivalents live in `./engine/pipeline.ts` and are reused via the local
      // `guardedPhase` wrapper at the executeCore site (which now calls into
      // `runObservablePhase` with the already-constructed `PhaseDeps`).

      let execute = (task: Task): Effect.Effect<TaskResult, RuntimeErrors> =>
        (
          Effect.gen(function* () {
            const now = new Date();
            const executionStartMs = Date.now();
            const sessionId = `session-${Date.now()}`;

            // ── Observability + EventBus acquisition, verbosity + prefix binding ──
            // Bodies extracted to engine/execute-obs-wiring.ts (GH #221 W26).
            const { obs, verbosity, isNormal, isVerbose, isDebug, logModelIO, lp, eb } =
              yield* bindExecutionObservability(config);
            /**
             * "Am I the ROOT execution?" — a sub-agent always runs through this
             * same ExecutionEngine, and `config.logPrefix` is set ONLY by
             * `sub-agent-executor.ts` when it builds a child, so a falsy prefix
             * is exactly "not a sub-agent". Named once here because three
             * separate sites need this same discriminator, and every one of them
             * guards a resource that is SHARED with every descendant (the
             * EventBus, the ChildDashboardRegistry) — where subscribing or
             * draining once per invocation instead of once per run produces
             * duplicated/fan-out output. Cf. `669f6571`.
             */
            const isRootExecution = !lp;

            // ── EventBus collectors: debrief tool/rationale logs + entropy telemetry ──
            // Bodies extracted to engine/execute-event-collectors.ts (GH #221 W26).
            const { toolCallLog, rationaleLog, entropyLog } =
              yield* registerExecutionEventCollectors({ eb, task, config });

            // ── Behavioral contract resolve + KillSwitch acquisition + maxToolCalls bridge ──
            // Bodies extracted to engine/execute-killswitch-bridge.ts (GH #221 W26).
            const { configForBehavioralContract, ks } = yield* resolveContractAndKillSwitch({
              eb,
              task,
              config,
            });

            // ── PhaseDeps bundle (W23 decomposition) ──
            // Long-lived dependency bundle threaded through every extracted phase.
            // Grows as more phases are pulled out; only fields consumed by
            // already-extracted phases are populated.
            const deps: PhaseDeps = {
              task,
              config,
              hooks: hookRegistry,
              obs,
              eb,
              ks: ks as unknown,
              guardrail: null,
              behavioral: null,
              tools: null,
              state: { cancelledTasks, runningContexts },
              isNormal,
              executionStartMs,
            };

            // Wrap entire execution in root observability span
            const executeCore = (): Effect.Effect<TaskResult, RuntimeErrors, any> =>
              Effect.gen(function* () {

                // Per-run model override (Arc 1 Task 6): `ReactiveAgent.fork()`
                // seeds this via `Effect.locally` when `opts.model` is supplied.
                // Null on every normal run — falls back to `config.defaultModel`,
                // so non-fork executions are unaffected.
                const modelOverride = yield* FiberRef.get(ModelOverrideRef);

                // Initialize context
                let ctx: ExecutionContext = {
                  taskId: task.id,
                  agentId: task.agentId,
                  sessionId,
                  phase: "bootstrap",
                  agentState: "bootstrapping",
                  iteration: 1,
                  maxIterations: config.maxIterations,
                  messages: [],
                  toolResults: [],
                  cost: 0,
                  tokensUsed: 0,
                  startedAt: now,
                  selectedModel: modelOverride ?? config.defaultModel,
                  provider: config.provider,
                  metadata: {},
                };

                // Classify task category once — used for entropy scoring and telemetry
                const taskCategory = classifyTaskCategoryFn(extractTaskText(task.input));

                // Register context as running
                yield* Ref.update(runningContexts, (m) =>
                  new Map(m).set(task.id, ctx),
                );

                // Emit execution started event
                yield* Effect.serviceOption(ObservableLogger).pipe(
                  Effect.tap((loggerOpt) => {
                    if (loggerOpt._tag === "Some") {
                      return loggerOpt.value.emit({
                        _tag: "phase_started",
                        phase: "execution",
                        timestamp: new Date(),
                      });
                    }
                    return Effect.void;
                  }),
                  Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:697", tag: errorTag(err) })),
                );

                // Emit RI telemetry notice once per process via structured log.
                // Body extracted to engine/execute-telemetry-notice.ts (GH #221 W26).
                yield* maybeEmitRiTelemetryNotice(config);

                // ── Lifecycle guard helper + guarded phase wrapper ──
                // Bodies extracted to engine/execute-lifecycle-guard.ts (GH #221 W26).
                // (W26-A step 1) The wrapper reuses runObservablePhase from
                // engine/pipeline.ts with the already-constructed PhaseDeps `deps`.
                const { guardedPhase } = makeLifecycleGuard({ ks, eb, config, deps });

                if (obs) {
                  yield* obs.info("Execution started", {
                    taskId: task.id,
                    agentId: task.agentId,
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:771", tag: errorTag(err) })));
                }

                if (eb) {
                  // Display-name resolution + ambient RunContext seed + GH #236
                  // AgentStarted emission. Body extracted to
                  // engine/execute-agent-started.ts (GH #221 W26).
                  yield* publishAgentStarted({ eb, ctx, task, config, executionStartMs });
                }

                // ── Phase 1: BOOTSTRAP ──
                // Extracted to engine/phases/bootstrap.ts (W23). The post-bootstrap
                // initialization that follows (skill application, tip injection,
                // MemorySnapshot publishing) is orchestrator-level work and stays
                // inline for now.
                ctx = yield* runGuardedPhase(bootstrap, ctx, deps);

                ctx = yield* runBootstrapSkillPostprocess({
                  ctx,
                  task,
                  config,
                  eb,
                  obs,
                  isNormal,
                  bootstrapStartedAt: now,
                });

                // ── Phase 5: AGENT_LOOP ──

                // Resolve CalibrationMode → ModelCalibration | undefined once.
                // Placed here (before Phase 2–4 dispatchers) so classifierReliability is
                // available inside the pre-loop block, and so the same resolved value can
                // be threaded into all three execute() call sites below.
                // Extracted to engine/phases/agent-loop/setup/calibration.ts (W23 step 4).
                const resolvedCalibration: ModelCalibration | undefined = yield* resolveCalibration(config);

                // ── Phases 2–4 + tool registry + classify + autoMaxCallsPerTool ──
                // Extracted to engine/phases/agent-loop/setup/pre-loop-dispatch.ts (W24-C step 2).
                // Semantic cache check stays inline because its result feeds the cacheHit
                // branch selector immediately below.
                const preLoop = yield* runPreLoopDispatch({
                  ctx,
                  task,
                  // Behavioral-contract-merged config (identical to `config`
                  // when no contract is active) — carries the reasoning arm's
                  // tightened allowedTools/forbiddenTools/maxIterations. See
                  // behavioral-contract-bridge.ts.
                  config: configForBehavioralContract,
                  deps,
                  resolvedCalibration,
                  obs,
                  isNormal,
                  guardrail,
                  costRoute,
                  strategySelect,
                });
                ctx = preLoop.ctx;
                const effectiveAllowedTools = preLoop.effectiveAllowedTools;
                const effectiveFocusedTools = preLoop.effectiveFocusedTools;
                const { effectiveRequiredTools, effectiveRequiredToolQuantities, classifiedRelevantTools } = preLoop;
                const autoMaxCallsPerTool = preLoop.autoMaxCallsPerTool;
                const cachedToolDefs = preLoop.cachedToolDefs;

                // ── Semantic cache check (before reasoning) ──
                // Extracted to engine/phases/agent-loop/cache-check.ts (W23 step 5).
                // On hit: ctx.metadata is populated with the cached response;
                // cost-track phase reads ctx.metadata.cacheHit. Behavior locked
                // in by tests/semantic-cache-hit.test.ts (step 1 regression
                // anchor).
                const cacheCheckResult = yield* checkSemanticCache({ config, task, ctx, obs, isNormal });
                ctx = cacheCheckResult.ctx;
                let cacheHit = cacheCheckResult.cacheHit;

                const reasoningOpt = yield* Effect.serviceOption(ReasoningService);

                if (reasoningOpt._tag === "Some" && !cacheHit) {
                  // ── Full reasoning path ──
                  // Reuse cached tool definitions (fetched once above)
                  const initialToolSchemas = cachedToolDefs.map((t: any) => ({
                    name: t.name as string,
                    description: t.description as string,
                    ...(t.returnType !== undefined ? { returnType: t.returnType as string } : {}),
                    parameters: (t.parameters ?? []).map((p: any) => ({
                      name: p.name as string,
                      type: p.type as string,
                      description: p.description as string,
                      required: Boolean(p.required),
                    })),
                  }));
                  const initialToolNames = cachedToolDefs.map((t: any) => t.name as string);


                  // ── Tool schema preparation: built-ins opt-in + dynamic final-answer
                  // + allowedTools prompt filter + adaptive filter ──
                  // Body extracted to engine/phases/agent-loop/setup/tool-schemas.ts (W23 step 6a-6).
                  const prepared = yield* prepareReasoningToolSchemas({
                    config: configForBehavioralContract,
                    task,
                    availableToolSchemas: initialToolSchemas,
                    availableToolNames: initialToolNames,
                    effectiveAllowedTools,
                    effectiveFocusedTools,
                    effectiveRequiredTools,
                    classifiedRelevantTools,
                    resolvedCalibration,
                    obs,
                    isNormal,
                  });
                  const availableToolSchemas = prepared.availableToolSchemas;
                  const availableToolNames = prepared.availableToolNames;
                  // F9 (2026-07-28): the kernel's `discover-tools` catalog and
                  // the blueprint planner both read `allToolSchemas`. It used to
                  // be a snapshot of the RAW registry taken above, BEFORE the
                  // builtins opt-in ran — so `builtins: ["file-write"]` was
                  // advertised as "10 tools available (now callable)" and
                  // file-read/code-execute/git-cli were reachable. Narrow it to
                  // what the caller actually permitted. Discovery still surfaces
                  // permitted-but-pruned tools (the escape hatch is intact);
                  // it can no longer surface tools that were never exposed.
                  const exposedToolSchemas = prepared.exposedToolSchemas;

                  // ── Subscribe to reasoning steps for live streaming ──
                  // Body extracted to engine/phases/agent-loop/reasoning-stream-logger.ts (W23 step 6a-7).
                  //
                  // Gated to the ROOT execution only (config.logPrefix unset). The
                  // EventBus is shared with every sub-agent (G1), so a single root
                  // subscription already observes every descendant's reasoning
                  // steps. Subscribing again per sub-agent caused each event to
                  // fire twice — once via the still-active root listener
                  // (unprefixed) and once via the child's own listener (prefixed) —
                  // since neither filtered by taskId. Root-only fixes this by
                  // construction: there is never more than one listener.
                  const unsubscribeReasoningSteps = isRootExecution
                    ? yield* subscribeReasoningStreamLogger({
                        eb, obs, logModelIO, isVerbose, isDebug,
                      })
                    : null;

                  // Body extracted to engine/phases/agent-loop/reasoning-think.ts (W23 step 6a-4).
                  ctx = yield* guardedPhase(ctx, "think", (c) =>
                    runReasoningThink(c, {
                      config: configForBehavioralContract,
                      task,
                      reasoningService: reasoningOpt.value,
                      availableToolNames,
                      availableToolSchemas,
                      allToolSchemas: exposedToolSchemas,
                      effectiveAllowedTools,
                      effectiveRequiredTools,
                      effectiveRequiredToolQuantities,
                      classifiedRelevantTools,
                      autoMaxCallsPerTool,
                      taskCategory,
                      resolvedCalibration,
                      obs,
                    }),
                  );

                  // ── Unsubscribe from reasoning step events ──
                  if (unsubscribeReasoningSteps) {
                    unsubscribeReasoningSteps();
                  }

                  // ── Harness hooks (post-think) ─────────────────────────────────────
                  // Body extracted to engine/phases/agent-loop/reasoning-harness-hooks.ts (W23 step 6a-3).
                  ctx = yield* runReasoningHarnessHooks(ctx, {
                    config,
                    task,
                    cacheHit,
                    reasoningOpt,
                    availableToolNames,
                    availableToolSchemas,
                    allToolSchemas: exposedToolSchemas,
                    effectiveRequiredTools,
                    effectiveRequiredToolQuantities,
                    classifiedRelevantTools,
                    autoMaxCallsPerTool,
                    taskCategory,
                    resolvedCalibration,
                    obs,
                  });

                  // ── Post-think bookkeeping (log summary, episodic bridge, experience,
                  // synthetic act/observe hooks, iteration update, semantic cache store) ──
                  // Body extracted to engine/phases/agent-loop/reasoning-post-think.ts (W23 step 6a-5).
                  ctx = yield* runReasoningPostThink(ctx, {
                    config,
                    task,
                    obs,
                    isNormal,
                    // This fires ONE coarse act+observe pair per reasoning()
                    // call, batching every tool the reasoning service used —
                    // the only act/observe signal for a custom or mocked
                    // ReasoningService that doesn't route through the kernel
                    // (see feature-contract.test.ts "act hook fires after
                    // reasoning when tools were used", which mocks the
                    // service and depends on exactly this). For the real
                    // kernel, act.ts ALSO fires its own act+observe pair per
                    // individual tool round (finer-grained, per-call). Both
                    // are real and intentional at different granularity —
                    // not a duplicate to remove.
                    fireActObserveHooks: (c) =>
                      Effect.gen(function* () {
                        let cc = yield* guardedPhase(c, "act", (cx) => Effect.succeed(cx));
                        cc = yield* guardedPhase(cc, "observe", (cx) => Effect.succeed(cx));
                        return cc;
                      }) as Effect.Effect<ExecutionContext, never>,
                  });
                }
                // Dead inline direct-LLM arm removed (2026-08-23) — Move 1
                // (2026-08-13) made `createRuntime()` always provide
                // `ReasoningService`, so `reasoningOpt` was already `Some` on
                // every real execution path; the `else if (!cacheHit)` branch
                // that used to run when it was `None` had been unreachable in
                // production for 10 days. Its last 10 test-only callers were
                // migrated onto the kernel arm's equivalent mechanisms
                // (reasoning-harness-hooks.ts, reasoning-think.ts) — see
                // DEBT-REGISTER D-2026-08-23-A. `runInlineThink` /
                // `runInlineAct` / `runInlineObserve` /
                // `runInlineHarnessHooks` / `iteration-guards.ts`'s
                // `runIterationGuards` were called ONLY from here and are
                // deleted alongside it (see `inline-*.ts` file removal in the
                // same commit).

                // ── Phase 6: VERIFY (optional) ── H2
                // Extracted to engine/phases/verify.ts (W23). Skip predicate
                // gates on config.enableVerification.
                ctx = yield* runGuardedPhase(verify, ctx, deps);
                yield* logVerifySummary({ ctx, config, obs, isNormal });

                // ── Verification Quality Gate ──
                // Body extracted to engine/phases/agent-loop/verification-quality-gate.ts (W23 step 6a-8).
                ctx = yield* runVerificationQualityGate(ctx, {
                  config,
                  obs,
                  fireGuardedThinkRetry: (c) =>
                    guardedPhase(c, "think", (cc) =>
                      runVerificationThinkRetry(cc, {
                        config,
                        task,
                        reasoningOpt,
                        taskCategory,
                        resolvedCalibration,
                        obs,
                        eb,
                      }),
                    ) as Effect.Effect<ExecutionContext, never>,
                  runVerifyAgain: (c) =>
                    runGuardedPhase(verify, c, deps) as Effect.Effect<ExecutionContext, never>,
                });

                // ── Phase 7: MEMORY_FLUSH ── H5
                // Dispatch body extracted to engine/phases/memory-flush-dispatch.ts (W24-A step 2).
                ctx = yield* dispatchMemoryFlush({
                  ctx,
                  entropyLog,
                  toolCallLog,
                  runMemoryFlush: (c) =>
                    runGuardedPhase(memoryFlush, c, deps) as Effect.Effect<ExecutionContext, never>,
                });

                // ── Phase 8: COST_TRACK (optional) ── H2
                // Extracted to engine/phases/cost-track.ts (W23). Reads cacheHit
                // from ctx.metadata.cacheHit (set in the agent-loop on cache hit).
                ctx = yield* runGuardedPhase(costTrack, ctx, deps);

                // ── Phase 9: AUDIT (optional) ── H2
                // Extracted to engine/phases/audit.ts (W23). Phase's own `skip` predicate
                // gates on config.enableAudit.
                ctx = yield* runGuardedPhase(audit, ctx, deps);

                // ── Phase 10: COMPLETE ──
                // Extracted to engine/phases/complete.ts (W23). Post-complete
                // orchestrator work below (TaskResult assembly, debrief, RunReport
                // telemetry, calibration/bandit/skill store updates, lifecycle
                // events) is NOT a phase — it's ctx → TaskResult assembly and
                // stays inline.
                ctx = yield* runGuardedPhase(complete, ctx, deps);

                // Build TaskResult — sanitize output to strip internal metadata
                const rr = ctx.metadata.reasoningResult;
                // Body extracted to engine/execute-output-derivation.ts (GH #221 W26).
                const { sanitizedOutput, outputForSuccess, hasSubstantiveOutput } =
                  deriveExecOutput(ctx, rr);

                // ── Behavioral contract checkOutput + guardrail final-output screen ──
                // Bodies extracted to engine/execute-output-screens.ts (GH #221 W26).
                yield* screenFinalOutput({ config, ctx, obs, eb, outputForSuccess });

                // ── terminatedBy + success bit + honesty invariants (F7/W5/M7/F1) ──
                // Body extracted to engine/execute-success-invariants.ts (GH #221 W26).
                const {
                  terminatedByRaw,
                  dialectObserved,
                  executionSucceeded,
                  emptyOutputCompletionNote,
                } = deriveExecutionSuccess({
                  ctx,
                  task,
                  config,
                  rr,
                  hasSubstantiveOutput,
                  outputForSuccess,
                });

                // ── Debrief: cheap signals inline, rich LLM synthesis FORKED ──
                // (2026-06-12 debrief-off-critical-path). prepareDebrief computes
                // the deterministic fallback + errorsFromLoop + duration on the
                // critical path; finalizeDebriefBackground (the LLM call + persist
                // + DebriefCompleted event) is forkDaemon'd so it NEVER blocks the
                // answer's return — measured 4.7s / 48% of a frontier run, ~6s
                // local (GH #143). The fallback populates result.debrief instantly;
                // ReactiveAgent.debriefRich() awaits the fiber for the rich version.
                // Extracted to engine/finalize/debrief-synthesis.ts.
                const debriefDeps = {
                  ctx,
                  task,
                  config,
                  eb,
                  rr,
                  terminatedByRaw,
                  sanitizedOutput,
                  outputForSuccess,
                  hasSubstantiveOutput,
                  toolCallLog,
                  rationaleLog,
                };
                const prepared = yield* prepareDebrief(debriefDeps);
                const { errorsFromLoop, executionDurationMs, fallbackDebrief } = prepared;
                const debrief = fallbackDebrief;

                // Fork the rich debrief + persistence into a daemon fiber on the
                // runtime scope (survives this run; joined by dispose()). Only when
                // a debrief is actually produced (reasoning path + memory enabled).
                const debriefFiber = prepared.shouldFinalize
                  ? yield* Effect.forkDaemon(finalizeDebriefBackground(debriefDeps, prepared))
                  : undefined;

                // NOTE (GH #143): debrief LLM tokens are no longer folded into
                // result.metadata.tokensUsed at return — the call is now background
                // (post-answer), so the reported total reflects the ANSWER's cost.
                // The forked debrief's tokens surface via debriefRich()/telemetry.

                // F10: apply the verification onReject policy. When the gate
                // flagged a still-rejected response for "block", the answer is
                // withheld and the run fails; "annotate" prepends a warning.
                const verificationOutcome = applyVerificationOutcome(
                  // Empty-output success with verified deliverables ships the
                  // deterministic completion note (see invariant above).
                  emptyOutputCompletionNote ?? sanitizedOutput,
                  executionSucceeded,
                  ctx.metadata as Record<string, unknown>,
                );

                // ── Result-boundary verification (2026-07-12) ──
                // The ONE place every path passes through. Strategy paths and
                // the inline loop shipped answers UNVERIFIED (rax:diagnose: "0
                // verifier verdicts" on every strategy trace). Pure + cheap;
                // authority-bounded — it never upgrades, it stamps the receipt
                // and (on reject/escalate) names itself in verificationWarning.
                // See engine/finalize/result-verification.ts.

                // Extract the kernel's specific verification reason from its error message
                // (FM-4 part 2). The kernel's verifier may reject/escalate with a specific
                // reason (e.g., "scaffold-leak") carried in state.error as "{PREFIX}{reason}",
                // preserved through the strategy result boundary and then normalized. When
                // present it becomes the prior rejection reason so the result-boundary
                // verifier doesn't overwrite it with its generic "action-success" message.
                //
                // String coupling is made durable via shared constants (VERIFIER_REJECTION_PREFIX
                // and VERIFIER_ESCALATION_PREFIX, both defined in @reactive-agents/reasoning).
                // A rename in the kernel now breaks the build instead of silently regressing receipts.
                let priorRejectionReason: string | undefined;
                if (typeof rr?.error === "string") {
                  if (rr.error.startsWith(VERIFIER_REJECTION_PREFIX)) {
                    priorRejectionReason = rr.error.slice(VERIFIER_REJECTION_PREFIX.length);
                  } else if (rr.error.startsWith(VERIFIER_ESCALATION_PREFIX)) {
                    priorRejectionReason = rr.error.slice(VERIFIER_ESCALATION_PREFIX.length);
                  }
                }

                const boundaryVerification = yield* verifyResultBoundary({
                  config,
                  taskId: String(task.id),
                  task: extractTaskText(task.input),
                  output: String(verificationOutcome.output ?? ""),
                  success: verificationOutcome.success,
                  steps: (ctx.metadata.reasoningSteps ?? []) as import("@reactive-agents/reasoning").ReasoningStep[],
                  toolsUsed: new Set(toolCallLog.filter((t) => t.success).map((t) => t.toolName)),
                  ...(ctx.metadata.rawTerminatedBy !== undefined
                    ? { terminatedBy: String(ctx.metadata.rawTerminatedBy) }
                    : {}),
                  iteration: ctx.iteration,
                  replayed: ctx.metadata.cacheHit === true,
                  ...(priorRejectionReason !== undefined
                    ? { priorRejectionReason }
                    : {}),
                });

                // W0.5 result→trace linkage: settle-flush this run's buffered
                // trace events, then mint {runId, tracePath} iff the recorder's
                // file (<traceDir>/<taskId>.jsonl, taskId IS the trace runId)
                // exists. null when tracing disabled/unrecorded; fields stay
                // honestly absent (wire-or-delete; never a phantom path).
                // W5.4 observability seam: the run-scoped budget meter's LIVE
                // total at terminal. When a budget is armed (`armRunBudget`
                // wrapped this run's execute), the ambient FiberRef carries the
                // meter every call AND every delegated child's folded spend
                // feed; expose it so cost/claim consumers can see true run
                // spend, and so budget-inheritance is directly assertable from
                // the result. Absent (wire-or-delete) on un-budgeted runs.
                const ambientRunMeter = yield* FiberRef.get(CurrentRunBudget);
                const traceLinkage = yield* mintTraceLinkage(config.traceDir, task.id);

                // ── TaskResult assembly ──
                // Body extracted to engine/execute-result-assembly.ts (GH #221 W26).
                const result = assembleTaskResult({
                  task,
                  ctx,
                  rr,
                  verificationOutcome,
                  executionDurationMs,
                  outputForSuccess,
                  toolCallLog,
                  entropyLog,
                  terminatedByRaw,
                  debrief,
                  boundaryVerification,
                  traceLinkage,
                  ambientRunMeter,
                });

                // Surface the forked rich-debrief fiber on the result (internal,
                // non-enumerable) so ReactiveAgent can expose debriefRich() and
                // join it on dispose(). Consumed at reactive-agent.ts result map.
                if (debriefFiber !== undefined) {
                  Object.defineProperty(result, "_debriefFiber", {
                    value: debriefFiber,
                    enumerable: false,
                    writable: false,
                    configurable: true,
                  });
                }

                // Completion logs + calibration provenance + final dashboard gauges.
                // Body extracted to engine/execute-completion-obs.ts (GH #221 W26).
                yield* emitCompletionObservability({
                  obs,
                  isNormal,
                  ctx,
                  task,
                  config,
                  result,
                  executionSucceeded,
                  resolvedCalibration,
                });

                // ── Record entropy metrics for dashboard + Telemetry RunReport ──
                // Extracted to engine/finalize/telemetry-emit.ts (W24-B step 2).
                yield* emitTelemetryRunReport({
                  ctx,
                  task,
                  config,
                  obs,
                  rr,
                  terminatedByRaw,
                  errorsFromLoop,
                  executionDurationMs,
                  entropyLog,
                  toolCallLog,
                  effectiveRequiredTools,
                  dialectObserved,
                });

                // ── Local Learning + Record Outcome ──
                // Extracted to engine/finalize/local-learning.ts (W24-B step 3).
                yield* runLocalLearning({
                  ctx,
                  task,
                  config,
                  terminatedByRaw,
                  errorsFromLoop,
                  entropyLog,
                  executionDurationMs,
                });

                // ── Run Finalization ──
                // Extracted to engine/finalize/run-finalize.ts (W24-B step 4).
                yield* finalizeRun({
                  ctx,
                  task,
                  config,
                  eb,
                  result,
                  executionStartMs,
                  entropyLog,
                  executionSucceeded,
                });

                return result;
              });

            // Initialize ObservableLogger
            //
            // Status-mode auto-activation uses an explicit opt-out signal so
            // the runtime never reads NODE_ENV (HS-01, 2026-05-20 sweep).
            // Tests/CI set `logging.disableStatusMode: true` or the
            // `REACTIVE_AGENTS_DISABLE_STATUS_MODE=true` env var.
            const statusModeDisabled =
              config.logging?.disableStatusMode === true ||
              process.env.REACTIVE_AGENTS_DISABLE_STATUS_MODE === "true";
            const isStatusMode =
              config.logging?.mode === "status" ||
              (config.logging?.mode !== "stream" &&
                Boolean(process.stdout.isTTY) &&
                !statusModeDisabled);

            const loggerConfig = {
              // In status mode the renderer owns all output; logger stays buffered
              live: isStatusMode ? false : (config.logging?.live ?? true),
              minLevel: config.logging?.minLevel,
              // Thread real VerbosityLevel through to ObservableLogger so "minimal"
              // can actually suppress live console output (not just dashboard output).
              // Safe to pass unconditionally; verbosity defaults to "normal" when
              // observability is not enabled, preserving original logging behavior.
              verbosity,
              // Same depth/name-tagged prefix already wrapped onto `obs.info/debug`
              // above — ObservableLogger is a SEPARATE live-print pipeline (its own
              // emit()/console.log(), not routed through `obs`), so without this a
              // sub-agent's arrow/DEBUG lines print unattributed even though its
              // structured INFO lines correctly show "│ <name> ·".
              logPrefix: lp || undefined,
            };
            const logger = yield* makeObservableLogger(loggerConfig);

            // Create renderer (no-op when not in status mode). `eb` (acquired
            // above, Phase 0.2) lets the renderer track sub-agent
            // AgentStarted/AgentCompleted events into collapsed live lines
            // (Task 7, observability unified run-tree).
            //
            // No cast: `status-renderer.ts` declares its own minimal `EbLike`
            // (only the `on` half) whose generic is constrained to the real
            // `AgentEventTag` from `@reactive-agents/core`, so this module's
            // `EbLike` (runtime-context.ts) is structurally assignable to it.
            //
            // ROOT-ONLY (`isRootExecution`), same reason as the reasoning-stream
            // subscription above: the renderer subscribes to AgentStarted/
            // AgentCompleted on the SHARED EventBus, so one root renderer already
            // observes every descendant. Constructing one per sub-agent too would
            // make each child render a spurious `spawn-agent → <itself>` line and
            // make N concurrent children each render all N siblings' lines.
            const renderer =
              isStatusMode && isRootExecution
                ? makeStatusRenderer(logger, process.stdout, eb)
                : null;

            // Start status renderer before events flow
            if (renderer) yield* renderer.start();

            // Wrap in root observability span for the full execution trace
            // The cast is required because executeCore has service requirements from Effect.gen,
            // but they will be satisfied by Effect.provide(runtime) in the builder.
            const executeCoreRaw = executeCore().pipe(
              Effect.provideService(ObservableLogger, logger),
              Effect.tapError((err) => {
                // All RuntimeErrors extend Data.TaggedError which extends Error
                const asErr = err as unknown as Error & { cause?: Error };
                const message = asErr.message ?? String(err);
                const cause = asErr.cause instanceof Error ? asErr.cause : undefined;
                return logger.emit({
                  _tag: "error",
                  message,
                  error: cause ? { name: cause.name, message: cause.message, stack: cause.stack } : undefined,
                  timestamp: new Date(),
                }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4172", tag: errorTag(err) })));
              }),
              Effect.ensuring(Effect.sync(() => { renderer?.stop(); })),
            );

            // Effect's built-in logger is REPLACED (not silenced) by a bridge
            // into ObservableLogger, which owns the structured-output channel.
            // Consumers (TTY renderer, OTLP exporter, JSONL trace) still see a
            // single ordered stream, and stdout stays quiet because an
            // ObservableLogger only prints when `live`.
            //
            // This closes audit §11 #27 (was FIX-27). The previous
            // `Logger.replace(Logger.defaultLogger, Logger.none)` bought that
            // quiet by DISCARDING every Effect.log* call in the framework —
            // including the kernel's own diagnostics, and including the
            // divergence warning ObservabilityService emits when the metrics
            // collector is misconfigured. core/src/errors tells authors to
            // prefer Effect.logWarning over console.*; that advice pointed into
            // a black hole. The records now survive.
            const executeCoreQuiet = executeCoreRaw.pipe(
              Effect.provide(
                effectLoggerBridgeLayer(logger, config.logging?.minLevel ?? "debug"),
              ),
            );

            // In status mode: additionally pipe think-stream chunks into the
            // renderer — but DEFER to any callback an outer caller already
            // installed. `runStream()` sets its own StreamingTextCallback (to feed
            // TextDelta events to the consumer's queue) before execute() runs; that
            // callback is in scope here. If status mode overwrote it, runStream's
            // deltas would be rerouted to the terminal renderer and the consumer's
            // stream would go silent. So we only install the renderer callback when
            // none exists (a plain `run()` under a TTY) — there, streaming the
            // think text to the renderer is exactly the desired behavior, and the
            // streaming branch is shape-equivalent to complete() (see inline-think
            // / kernel think), so run() output is unaffected.
            const executeCoreWithLogger = isStatusMode && renderer
              ? Effect.gen(function* () {
                  const existingCb = yield* FiberRef.get(StreamingTextCallback);
                  if (existingCb) return yield* executeCoreQuiet;
                  return yield* Effect.locally(
                    executeCoreQuiet,
                    StreamingTextCallback,
                    (text: string) => Effect.sync(() => renderer.pushThinkChunk(text)),
                  );
                })
              : executeCoreQuiet;
            if (obs) {
              const taskResult = yield* obs.withSpan(
                "execution.run",
                executeCoreWithLogger as unknown as Effect.Effect<TaskResult, RuntimeErrors>,
                { taskId: task.id, agentId: task.agentId },
              );
              // Roll up sub-agent dashboards BEFORE the root's own flush() —
              // this is the fix for a sub-agent printing its own dashboard
              // mid-stream: only the ROOT ever drains the registry and attaches,
              // so a sub-agent never does this even though it shares the
              // ExecutionEngine code path.
              if (isRootExecution) {
                const childRegistryOpt = yield* Effect.serviceOption(ChildDashboardRegistry);
                if (childRegistryOpt._tag === "Some") {
                  const children = yield* childRegistryOpt.value.drain();
                  // Always attach — even an empty array — so `childrenRef` is
                  // RESET every run, not only when this particular run happened
                  // to spawn sub-agents. `drain()` already cleared the registry
                  // for the NEXT run; skipping attachChildren([]) here would
                  // leave `attachChildren`'s Ref.set() holding whatever a PRIOR
                  // run last set, so a childless run would still render the
                  // previous run's stale sub-agent dashboards.
                  yield* obs.attachChildren(children);
                }
              }
              // Flush after the root span closes so spans are fully recorded
              yield* obs.flush().pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:4198", tag: errorTag(err) })));
              return taskResult;
            }
            return yield* executeCoreWithLogger;
          }) as Effect.Effect<TaskResult, RuntimeErrors, any>
        ).pipe(
          // Always clean up running context
          Effect.ensuring(
            Ref.update(runningContexts, (m) => {
              const next = new Map(m);
              next.delete(task.id);
              return next;
            }),
          ),
        ) as Effect.Effect<TaskResult, RuntimeErrors>;

      // Wrap execute with per-execution timeout if configured
      if (config.executionTimeoutMs) {
        const timeoutMs = config.executionTimeoutMs;
        const _base = execute;
        execute = (task2: Task) =>
          _base(task2).pipe(
            Effect.timeoutFail({
              duration: Duration.millis(timeoutMs),
              onTimeout: () =>
                new ExecutionError({
                  message: `Execution timed out after ${timeoutMs}ms`,
                  taskId: task2.id,
                  phase: "think",
                }),
            }),
          );
      }

      // Issue #232 Gap 2 — arm ONE run-scoped budget meter around the WHOLE run
      // (see `engine/run-budget-arm.ts` for the full rationale). The meter is
      // created per `execute(task)` — one per run — so the main pass AND every
      // auxiliary pass (verification retry, continuation) feed the same
      // accumulator, and each kernel inherits the run limits. Gated on
      // `config.budgetLimits` → a run without `.withBudget()` stays byte-identical.
      execute = armRunBudget(execute, config.budgetLimits);

      return {
        execute,

        registerHook: (hook) => hookRegistry.register(hook).pipe(Effect.asVoid),

        getContext: (taskId) =>
          Ref.get(runningContexts).pipe(
            Effect.map((m) => m.get(taskId) ?? null),
          ),

        cancel: (taskId) =>
          Effect.gen(function* () {
            const running = yield* Ref.get(runningContexts);
            if (!running.has(taskId)) {
              return yield* Effect.fail(
                new ExecutionError({
                  message: `Task ${taskId} is not running`,
                  taskId,
                  phase: "complete",
                }),
              );
            }
            yield* Ref.update(cancelledTasks, (s) => new Set(s).add(taskId));
          }),

        executeStream: makeExecuteStream({ config, execute }),
      };
    }),
  );
