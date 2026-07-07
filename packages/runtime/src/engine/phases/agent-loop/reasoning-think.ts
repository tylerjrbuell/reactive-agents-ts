/**
 * Reasoning-path THINK phase: assembles memory context (self-improvement
 * read-back, task-context injection, session resumption from debrief + plan),
 * builds the strategy execution request, dispatches to ReasoningService, and
 * normalizes the result with strategy-fallback handling.
 *
 * Body of the `guardedPhase(ctx, "think", ...)` callback inside the reasoning
 * branch of the agent-loop. Extracted from `execution-engine.ts:1126-1325`
 * (W23 step 6a-4) to shrink the engine module without changing behavior.
 *
 * Behavior preserved verbatim — error sites use semantic anchors at the
 * actual module path for telemetry accuracy.
 */
import { Effect, FiberRef } from "effect";
import { emitErrorSwallowed, errorTag, ResumeStateRef, ApprovalDecisionRef, InteractionResponseRef } from "@reactive-agents/core";
import type { Task } from "@reactive-agents/core";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { classifyTask, deserializeKernelState } from "@reactive-agents/reasoning";
import { DebriefStoreService, PlanStoreService } from "@reactive-agents/memory";
import { resolveSynthesisConfigForStrategy } from "../../../synthesis-resolve.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import type { ObsLike } from "../../runtime-context.js";
import { asThinkContext, getSelectedModelName } from "./think-context.js";
import {
  briefResolvedSkillsFromMetadata,
  extractTaskText,
  normalizeReasoningResult,
  type ExecutionReasoningResult,
} from "../../util.js";
import type { ReasoningServiceLike } from "../../types-reasoning.js";

type ReasoningExecuteRequest = Parameters<ReasoningServiceLike["execute"]>[0];
type ToolSchemaShape = NonNullable<ReasoningExecuteRequest["availableToolSchemas"]>[number];

/**
 * Append cross-run experience tips to the memory context, capped + tier-aware.
 * Pure. Tight cap on `local` (small context budget); a touch wider elsewhere.
 * No-op when there are no tips — preserves the prior prompt byte-for-byte.
 *
 * Wires the previously-severed loop: `experienceTips` are produced in bootstrap
 * (skill-postprocess) — tier-aware, confidence≥0.5, occurrences≥2 — but were
 * written to metadata and never injected. Exported for unit testing.
 */
export function appendExperienceTips(
  memCtx: string,
  tips: readonly string[] | undefined,
  tier: string | undefined,
): string {
  if (!tips || tips.length === 0) return memCtx;
  const cap = tier === "local" ? 1 : 3;
  const shown = tips.slice(0, cap);
  if (shown.length === 0) return memCtx;
  return `${memCtx}\n\n--- Learned from prior runs ---\n${shown.map((t) => `- ${t}`).join("\n")}`;
}

export interface ReasoningThinkDeps {
  readonly config: ReactiveAgentsConfig;
  readonly task: Task;
  readonly reasoningService: ReasoningServiceLike;
  readonly availableToolNames: readonly string[];
  readonly availableToolSchemas: readonly ToolSchemaShape[];
  readonly allToolSchemas: readonly ToolSchemaShape[];
  readonly effectiveAllowedTools: readonly string[];
  readonly effectiveRequiredTools: readonly string[] | undefined;
  readonly effectiveRequiredToolQuantities: Readonly<Record<string, number>> | undefined;
  readonly classifiedRelevantTools: readonly string[] | undefined;
  readonly autoMaxCallsPerTool: Record<string, number>;
  readonly taskCategory: string;
  readonly resolvedCalibration: ModelCalibration | undefined;
  readonly obs: ObsLike | null;
}

export const runReasoningThink = (
  c: ExecutionContext,
  deps: ReasoningThinkDeps,
): Effect.Effect<ExecutionContext, never> => {
  const {
    config,
    task,
    reasoningService,
    availableToolNames,
    availableToolSchemas,
    allToolSchemas,
    effectiveAllowedTools,
    effectiveRequiredTools,
    effectiveRequiredToolQuantities,
    classifiedRelevantTools,
    autoMaxCallsPerTool,
    taskCategory,
    resolvedCalibration,
    obs,
  } = deps;

  return Effect.gen(function* () {
    // ── Self-improvement read-back: surface prior strategy outcomes ──
    let memCtx = String(asThinkContext(c).memoryContext?.semanticContext ?? "");
    const skillCatalogXml = (c.metadata as { skillCatalogXml?: string } | undefined)
      ?.skillCatalogXml;
    if (skillCatalogXml && skillCatalogXml.trim().length > 0) {
      memCtx = `${skillCatalogXml.trim()}\n\n${memCtx}`;
    }
    // Episodic rows from bootstrap must reach the LLM — previously only
    // strategy-outcome/reflexion (with enableSelfImprovement) were injected,
    // so default logEpisode "task-completed" lines were invisible (e.g. gateway
    // follow-ups after a Signal heartbeat).
    {
      const episodes = asThinkContext(c).memoryContext?.recentEpisodes;
      if (episodes && episodes.length > 0) {
        const cap = 15;
        const maxLine = 600;
        const lines: string[] = [];
        for (const e of episodes.slice(0, cap)) {
          const meta = e.metadata ?? {};
          const et = e.eventType ?? "episodic";
          let line: string;
          if (
            config.enableSelfImprovement &&
            (et === "strategy-outcome" || et === "reflexion-critique")
          ) {
            const success = meta.success ? "✓" : "✗";
            const strategy = meta.strategy ?? "unknown";
            line = `[${success} ${strategy}] ${e.content ?? ""}`;
          } else {
            let body = String(e.content ?? "").replace(/\s+/g, " ").trim();
            if (body.length > maxLine) body = `${body.slice(0, maxLine)}…`;
            line = `[${et}] ${body}`;
          }
          lines.push(line);
        }
        if (lines.length > 0) {
          memCtx = `${memCtx}\n\n--- Recent episodic memory ---\n${lines.join("\n")}`;
        }
      }
    }

    // ── Experience tips (cross-run, confidence-filtered) — wire the severed loop ──
    // `experienceTips` are computed in bootstrap (skill-postprocess.ts, gated on
    // enableExperienceLearning: tier-aware query, confidence≥0.5 + occurrences≥2)
    // but were NEVER injected — written to metadata and discarded. Inject them
    // capped + tier-aware (see appendExperienceTips).
    memCtx = appendExperienceTips(
      memCtx,
      (c.metadata as { experienceTips?: readonly string[] } | undefined)?.experienceTips,
      config.contextProfile?.tier,
    );

    // ── Task context injection ──
    if (config.taskContext && Object.keys(config.taskContext).length > 0) {
      const lines = Object.entries(config.taskContext)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
      memCtx = `--- Task Context ---\n${lines}\n\n${memCtx}`;
    }

    // ── Session resumption: surface prior debrief + active plan ──
    {
      const debriefOpt = yield* Effect.serviceOption(DebriefStoreService)
        .pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));
      if (debriefOpt._tag === "Some") {
        const recentDebriefs = yield* debriefOpt.value.listByAgent(config.agentId, 1)
          .pipe(Effect.catchAll(() => Effect.succeed([])));
        if (recentDebriefs.length > 0) {
          const last = recentDebriefs[0];
          const ageHours = (Date.now() - last.createdAt) / 3_600_000;
          if (ageHours < 72) {
            const lines: string[] = [
              `Last run (${Math.round(ageHours)}h ago): ${last.debrief.outcome}`,
              last.debrief.summary,
            ];
            if (last.debrief.lessonsLearned?.length > 0) {
              lines.push(`Lessons: ${last.debrief.lessonsLearned.join("; ")}`);
            }
            if (last.debrief.errorsEncountered?.length > 0) {
              lines.push(`Prior errors: ${last.debrief.errorsEncountered.join("; ")}`);
            }
            memCtx = `${memCtx}\n\n--- Prior Session ---\n${lines.join("\n")}`;
          }
        }
      }

      const planOpt = yield* Effect.serviceOption(PlanStoreService)
        .pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));
      if (planOpt._tag === "Some") {
        const recentPlans = yield* planOpt.value.getRecentPlans(config.agentId, 1)
          .pipe(Effect.catchAll(() => Effect.succeed([])));
        if (recentPlans.length > 0) {
          const last = recentPlans[0];
          if (last.status === "active") {
            const pending = last.steps.filter(
              (s) => s.status === "pending" || s.status === "in_progress",
            );
            if (pending.length > 0) {
              const stepsText = pending
                .map((s) => `  - [${s.status}] ${s.title}`)
                .join("\n");
              memCtx = `${memCtx}\n\n--- Incomplete Plan (resume if relevant) ---\nGoal: ${last.goal}\n${stepsText}`;
            }
          }
        }
      }
    }

    let result: ExecutionReasoningResult;
    // Build initial messages — seed the conversation thread with the task.
    // (Prior chat history is folded into the task text as a labeled reference
    // block by ReactiveAgent.run/runStream — gateway-style — to keep the native
    // FC tool thread clean. It is NOT seeded as separate assistant turns here.)
    const initialMessages: readonly { readonly role: "user" | "assistant"; readonly content: string }[] = [
      { role: "user", content: extractTaskText(task.input) },
    ];
    const effectiveStrategyName = c.selectedStrategy ?? "reactive";
    const effectiveStrategy =
      effectiveStrategyName as NonNullable<ReasoningExecuteRequest["strategy"]>;

    // HS-cleanup-2: classify ONCE per agent run at the engine layer; thread
    // through `taskClassification` so every downstream consumer (adaptive
    // heuristic, ToT cost gate, future capabilities) reads from a single
    // canonical snapshot instead of re-classifying the same task string.
    const taskClassification = classifyTask(extractTaskText(task.input));

    // Durable resume (Phase C): when ReactiveAgent.resume(runId) set the
    // ResumeStateRef to a serialized checkpoint, deserialize it here and forward
    // it as `resumeState` so the kernel continues from the restored state instead
    // of a fresh seed. Null on every normal run (zero cost).
    const resumeJson = yield* FiberRef.get(ResumeStateRef);
    const resumeState = resumeJson ? deserializeKernelState(resumeJson) : undefined;

    // Durable HITL (Phase D): a human's approval decision threaded in on a resumed
    // run (via ApprovalDecisionRef, seeded by approveRun/denyRun). Forwarded to the
    // runner, which applies it at the gate instead of re-thinking. Null on normal
    // runs (zero cost).
    const approvalDecision = (yield* FiberRef.get(ApprovalDecisionRef)) ?? undefined;

    // Agentic-UI interaction rail (Task 10): a human's response to a paused
    // request_user_input, threaded in on a resumed run via InteractionResponseRef
    // (seeded by respondToInteraction). Forwarded to the runner, which injects the
    // value + re-thinks. Null on normal runs (zero cost). Mirrors approvalDecision.
    const interactionResponse = (yield* FiberRef.get(InteractionResponseRef)) ?? undefined;

    const executeRequest = {
      taskDescription: extractTaskText(task.input),
      taskType: task.type,
      taskClassification,
      memoryContext: memCtx,
      availableTools: availableToolNames,
      availableToolSchemas,
      allToolSchemas,
      strategy: effectiveStrategy,
      contextProfile: config.contextProfile,
      providerName: String(config.provider ?? ""),
      systemPrompt: config.systemPrompt,
      taskId: c.taskId,
      resultCompression: config.resultCompression,
      agentId: config.agentId,
      sessionId: c.taskId,
      requiredTools: effectiveRequiredTools,
      requiredToolQuantities: effectiveRequiredToolQuantities,
      // Explicitly opted-in builtins (withTools({builtins:[...]})) are
      // consumer intent — union them into relevantTools so the kernel's
      // lazy-disclosure prune (RA_LAZY_TOOLS visible set = required +
      // relevant + used + meta) never hides them. Regression 2026-07-07
      // (rw-9/rw-7): a minimal requiredTools grounding set of ["file-read"]
      // plus an empty weak-tier classification left file-write invisible —
      // the model could not write prices.md / test files at all (3/3 cells,
      // was 100% when the wider requiredTools floor incidentally protected
      // it). `builtins: true` (opt-in to everything) deliberately does not
      // flood relevantTools.
      relevantTools: Array.isArray(config.builtins)
        ? [...new Set([...(classifiedRelevantTools ?? []), ...config.builtins])]
        : classifiedRelevantTools,
      maxCallsPerTool: Object.keys(autoMaxCallsPerTool).length > 0 ? autoMaxCallsPerTool : undefined,
      maxRequiredToolRetries: config.requiredTools?.maxRetries,
      strategySwitching: config.strategySwitching,
      modelId: String(getSelectedModelName(asThinkContext(c).selectedModel) ?? config.defaultModel ?? ""),
      taskCategory,
      temperature: config.contextProfile?.temperature as number | undefined,
      environmentContext: config.environmentContext as Record<string, string> | undefined,
      allowedTools: effectiveAllowedTools.length > 0 ? effectiveAllowedTools : undefined,
      metaTools: config.metaTools,
      briefResolvedSkills: briefResolvedSkillsFromMetadata(
        c.metadata as Record<string, unknown>,
      ),
      initialMessages,
      resumeState,
      approvalDecision,
      interactionResponse,
      approvalPolicy: config.approvalPolicy
        ? {
            mode: config.approvalPolicy.mode,
            tools: new Set(config.approvalPolicy.tools),
            requireFor: config.approvalPolicy.requireFor,
          }
        : undefined,
      synthesisConfig: resolveSynthesisConfigForStrategy(
        config.reasoningOptions,
        effectiveStrategyName,
        config.synthesisConfig,
      ),
      observationSummary: config.reasoningOptions?.observationSummary,
      auditRationale: config.reasoningOptions?.auditRationale,
      calibration: resolvedCalibration,
      verifier: config.verifier,
      harnessPipeline: config.harnessPipeline,
      // Issue #128 / North Star v5.0 Pillar 6 — declarative budget caps for
      // the Arbitrator pre-intent guard. Threaded through
      // `ReactiveAgentsConfig.budgetLimits` from the builder's
      // `.withBudget()`. The reasoning-service execute params shape does NOT
      // currently declare this field (kernel-warden follow-up required to add
      // `budgetLimits` to ReactiveInput + populate `kernelInput.budgetLimits`
      // in `strategies/reactive.ts`); the field is forwarded here so that
      // plumb arrives intact as soon as the reasoning leg lands.
      budgetLimits: config.budgetLimits,
      // Opt-in numeric evidence-grounding. Propagated from `.withGrounding()`.
      grounding: config.grounding,
      // Fabrication guard mode. Propagated from `.withFabricationGuard()`.
      fabricationGuard: config.fabricationGuard,
      // Stall/no-progress policy. Propagated from `.withStallPolicy()`.
      stallPolicy: config.stallPolicy,
    } as unknown as ReasoningExecuteRequest;

    const strategyEffect = reasoningService.execute(executeRequest);
    const strategyOutcome = yield* Effect.exit(strategyEffect);
    if (strategyOutcome._tag === "Success") {
      const normalizedResult = normalizeReasoningResult(strategyOutcome.value);
      if (!normalizedResult && obs) {
        yield* obs.info(
          `[engine] WARN: normalizeReasoningResult returned null — strategyFallback triggered. ` +
          `classify.required=${effectiveRequiredTools?.join(",") ?? "(none)"}`
        ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-think.ts:normalize-null-warn", tag: errorTag(err) })));
      }
      result = normalizedResult ?? {
        output: "Strategy returned an invalid result shape",
        status: "error",
        steps: [],
        metadata: { cost: 0, tokensUsed: 0, stepsCount: 0, strategyFallback: true },
      };
    } else {
      const strategyError = strategyOutcome.cause;
      if (obs) {
        yield* obs.info(`⚠ Strategy failed, using fallback: ${String(strategyError)}`).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-think.ts:strategy-failed-info", tag: errorTag(err) })));
        yield* obs.info(
          `[engine] WARN: strategy failed — strategyFallback triggered. ` +
          `classify.required=${effectiveRequiredTools?.join(",") ?? "(none)"}. ` +
          `error=${String(strategyError)}`
        ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-think.ts:strategy-fallback-warn", tag: errorTag(err) })));
      }
      result = {
        output: `Strategy execution failed: ${String(strategyError)}`,
        status: "error",
        steps: [],
        metadata: { cost: 0, tokensUsed: 0, stepsCount: 0, strategyFallback: true },
      };
    }
    // Prefer result.metadata.selectedStrategy (set by adaptive to show actual sub-strategy)
    // over result.strategy (which stays "adaptive" for API compatibility).
    const activeStrategy =
      result.metadata?.selectedStrategy ??
      result.strategy ??
      c.selectedStrategy;

    return {
      ...c,
      selectedStrategy: activeStrategy,
      cost: c.cost + (result.metadata.cost ?? 0),
      tokensUsed:
        c.tokensUsed + (result.metadata.tokensUsed ?? 0),
      metadata: {
        ...c.metadata,
        lastResponse: String(result.output ?? ""),
        isComplete: result.status === "completed",
        reasoningResult: result,
        stepsCount: result.metadata.stepsCount,
        reasoningSteps: result.steps ?? [],
      },
    };
  }) as unknown as Effect.Effect<ExecutionContext, never>;
};
