// File: src/strategies/blueprint.ts
/**
 * blueprint Strategy — ReWOO-style PLAN → VERIFY → EXECUTE → SOLVE.
 *
 * blueprint is research-validated single-pass DAG plan-execute (the canonical
 * 4th single-agent pattern alongside ReAct / Plan-Execute / Reflexion). It
 * beats ReAct on tool tasks at ~2 LLM calls (plan + solve) vs plan-execute's
 * ~9 (per-step kernels + reflect/refine), because the EXECUTE phase runs the
 * whole tool DAG with NO LLM in the loop.
 *
 * Architecture (PACT-shaped — the "VERIFY" is the small-model lever):
 *  1. PLAN    — ONE schema/grammar-enforced LLM call: extractStructuredOutput
 *               (LLMPlanOutputSchema) + hydratePlan. The schema constraint
 *               FORCES a valid DAG shape so even weak/local models — unreliable
 *               freeform planners — produce a structurally sound plan. The
 *               planner prompt is tier-aware (buildPlanGenerationPrompt) and
 *               carries experience-tips (input.memoryContext).
 *  2. VERIFY  — deterministic, 0-LLM (verifyPlan): valid DAG, tools exist, refs
 *               resolve, required tools/quantities present. Repairs the fixable
 *               (heal tool names, inject synthetic required-tool steps); on an
 *               UNFIXABLE plan (cycle / dangling ref / unknown tool) it DEGRADES
 *               to reactive rather than execute a broken observation-free plan.
 *  3. EXECUTE — 0-LLM parallel DAG worker (executeBlueprintWorker). Concurrency
 *               is tier/capability-branched: capable + native-FC → parallel;
 *               local "partial" → 2; sequential-only / text-parse / fallback
 *               capability source → 1.
 *  4. SOLVE   — ONE LLM call synthesizing the final answer from worker step
 *               results (mirrors plan-execute synthesis). Short-circuited when a
 *               single substantive step already produced a complete answer.
 *
 * Differences from plan-execute (deliberate): NO reflect/refine loop, NO
 * per-step ReAct sub-kernels (the worker dispatches tools directly), PLUS the
 * deterministic VERIFY gate and the tier/capability concurrency branch.
 */
import { Effect } from "effect";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { LLMPlanOutputSchema, hydratePlan } from "../types/plan.js";
import type { Plan } from "../types/plan.js";
import { extractStructuredOutput } from "../structured-output/pipeline.js";
import { buildPlanGenerationPrompt } from "./planning/plan-prompts.js";
import type { ToolSummary } from "./planning/plan-prompts.js";
import {
  resolveStrategyServices,
  publishReasoningStep,
  makeStrategyEmitLog,
  emitPhaseEnd,
} from "../kernel/utils/service-utils.js";
import { makeStep, buildStrategyResult } from "../kernel/capabilities/sense/step-utils.js";
import { resolveProfile } from "../context/profile-resolver.js";
import { gatewayComplete } from "../kernel/llm-gateway.js";
import { extractThinkingSafeContent } from "../kernel/utils/stream-parser.js";
import { extractGoalText } from "./planning/plan-text.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { withEnvContext } from "../context/context-engine.js";
import { executeBlueprintWorker } from "./blueprint/worker.js";
import { verifyPlan } from "./blueprint/plan-verify.js";
import { executeReactive } from "./reactive.js";
import { patchPlan } from "./planning/plan-mutation.js";
import { formatPlanListing } from "./blueprint/progress-format.js";
import { SYNTHESIZER_PERSONA } from "./planning/shared-personas.js";

const STRATEGY = "blueprint" as const;

// ── Input ──────────────────────────────────────────────────────────────────
//
// Mirrors PlanExecuteInput's shape (the registry widens via `as unknown as
// StrategyFn`, so the extra fields beyond the base StrategyFn input are safe).

interface BlueprintInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly allToolSchemas?: readonly ToolSchema[];
  readonly config: ReasoningConfig;
  readonly systemPrompt?: string;
  readonly taskId?: string;
  readonly resultCompression?: ResultCompressionConfig;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly requiredTools?: readonly string[];
  readonly relevantTools?: readonly string[];
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
  readonly modelId?: string;
  readonly temperature?: number;
  readonly harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
  /** Budget killswitch limits — bounds total LLM calls (plan + solve). */
  readonly budgetLimits?: import("../kernel/capabilities/decide/arbitrator.js").BudgetLimits;
  /** Pre-resolved model calibration — drives the concurrency tier branch. */
  readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
}

// ── Concurrency tier/capability branch ───────────────────────────────────────
//
// Capable models with reliable native function-calling fan out the DAG worker;
// weaker tool-callers are capped or linearized so a parallel batch of tool
// calls a model can't reliably emit/track never executes concurrently.

function resolveWorkerConcurrency(input: BlueprintInput): number {
  const tier = resolveProfile(input.modelId ?? "mid").tier;
  const cal = input.calibration;

  // Hard cap to 1 when the model cannot reliably batch/parse tool calls:
  //  - parallelCallCapability "sequential-only"
  //  - toolCallDialect not native function-calling (text-parsed)
  // (A "fallback" capability source would also force 1, but ModelCalibration
  //  carries no source field — toolCallDialect/parallelCallCapability are the
  //  available signals; dialect "none" is treated as non-native → 1.)
  if (cal) {
    if (cal.parallelCallCapability === "sequential-only") return 1;
    if (cal.toolCallDialect && cal.toolCallDialect !== "native-fc") return 1;
    if (cal.parallelCallCapability === "partial") return 2;
  }

  // No calibration → fall back to the tier heuristic.
  switch (tier) {
    case "frontier":
    case "large":
    case "mid":
      return 4;
    case "local":
      // Local without calibration is the risky one-shot-planner case — cap to 2.
      return 2;
    default:
      return 1;
  }
}

export const executeBlueprint = (
  input: BlueprintInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> =>
  Effect.gen(function* () {
    const services = yield* resolveStrategyServices;
    const { llm, eventBus } = services;

    const emitLog = makeStrategyEmitLog("reasoning/src/strategies/blueprint.ts:emitLog");

    const steps: ReasoningStep[] = [];
    const start = Date.now();
    let totalTokens = 0;
    let totalCost = 0;
    // Self-budget: blueprint makes at most plan(1) + solve(1) LLM calls — the
    // worker is 0-LLM and there is no re-plan/reflect loop, so the ~2-call
    // ceiling is structural. The only discretionary call is the SOLVE pass; we
    // skip it (joining raw worker results instead) when the declared token
    // budget is already crossed. budgetLimits absent → no extra gating.
    const tokenLimit = input.budgetLimits?.tokenLimit;
    let llmCalls = 0;

    const goal = extractGoalText(input.taskDescription);
    const taskId = input.taskId ?? "blueprint";

    // blueprint plans the WHOLE tool-DAG up front with NO mid-course tool
    // discovery — so the planner must see EVERY dispatchable tool, not the
    // relevance-pruned `availableToolSchemas` subset. Planning over the pruned
    // set made the model invent tools it never saw. Prefer the full
    // `allToolSchemas` catalog; fall back to the available subset only when the
    // full catalog wasn't supplied. Carry tool + param semantics through so the
    // planner sees real argument shapes (not just `name(params)`) — without these
    // it invents arg names (e.g. file-write(filename) instead of file-write(path),
    // the root of the gh-cli invalid-command failure).
    const planningToolSchemas =
      input.allToolSchemas && input.allToolSchemas.length > 0
        ? input.allToolSchemas
        : (input.availableToolSchemas ?? []);
    const toolSummaries: ToolSummary[] = planningToolSchemas.map((t) => ({
      name: t.name,
      signature: `(${t.parameters.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ")})`,
      ...(t.description ? { description: t.description } : {}),
      ...(t.parameters.length > 0
        ? {
            params: t.parameters.map((p) => ({
              name: p.name,
              type: p.type,
              ...(p.required !== undefined ? { required: p.required } : {}),
              ...(p.description ? { description: p.description } : {}),
            })),
          }
        : {}),
    }));

    // ── PLAN ──────────────────────────────────────────────────────────────────
    yield* emitLog({ _tag: "phase_started", phase: "blueprint:plan", timestamp: new Date() });

    const planTier = resolveProfile(input.modelId ?? "mid").tier;

    // memoryContext carries experience-tips (wired upstream) — feed them to the
    // planner as past patterns so the model bootstraps from what worked before.
    const pastPatterns =
      input.memoryContext && input.memoryContext.trim().length > 0
        ? [input.memoryContext.trim()]
        : [];

    const planPrompt = buildPlanGenerationPrompt({
      goal,
      tools: toolSummaries,
      pastPatterns,
      modelTier: planTier,
      ...(input.requiredToolQuantities
        ? { requiredToolQuantities: input.requiredToolQuantities }
        : {}),
    });

    const planResult = yield* extractStructuredOutput({
      schema: LLMPlanOutputSchema,
      prompt: planPrompt,
      systemPrompt: input.systemPrompt
        ? `${input.systemPrompt}\nYou are a planning agent. Decompose the goal into a structured tool plan.`
        : "You are a planning agent. Decompose the goal into a structured tool plan.",
      maxRetries: 2,
      temperature: 0.4,
      maxTokens: 4096,
      ...(input.taskId ? { traceContext: { taskId } } : {}),
    }).pipe(
      Effect.mapError(
        (err) =>
          new ExecutionError({
            strategy: STRATEGY,
            message: `Plan generation failed: ${err.message}`,
            step: 0,
            cause: err,
          }),
      ),
    );
    llmCalls += 1;
    totalTokens +=
      Math.ceil(planResult.raw.length / 4) + Math.ceil(planPrompt.length / 4);

    let plan: Plan = hydratePlan(planResult.data, {
      taskId,
      agentId: input.agentId ?? "reasoning-agent",
      goal,
      planMode: "dag",
    });

    yield* emitPhaseEnd({ emitLog, phase: "blueprint:plan", startedAt: start, totalTokens });

    steps.push(
      makeStep(
        "thought",
        `[PLAN] ${plan.steps.map((s) => `${s.id}: ${s.title} (${s.type}${s.toolName ? ` → ${s.toolName}` : ""})`).join(", ")}`,
      ),
    );
    yield* publishReasoningStep(eventBus, {
      _tag: "ReasoningStepCompleted",
      taskId,
      strategy: STRATEGY,
      step: steps.length,
      totalSteps: plan.steps.length,
      // Surface the WHOLE plan live so the user sees every step the agent
      // intends to take, not just a count.
      thought: `[PLAN] ${plan.steps.length}-step plan:\n${formatPlanListing(plan)}`,
      kernelPass: "blueprint:plan",
    });

    // ── VERIFY ────────────────────────────────────────────────────────────────
    yield* emitLog({ _tag: "phase_started", phase: "blueprint:verify", timestamp: new Date() });

    // VERIFY must validate against every DISPATCHABLE tool, not the pruned
    // relevance subset (`input.availableTools`). The planner is shown
    // `availableToolSchemas` (→ toolSummaries) and the worker dispatches via the
    // ToolService, which can call ANY registered tool (`allToolSchemas`). Using
    // only the relevance subset would falsely reject a legitimately-planned tool
    // (e.g. file-write pruned from the subset) and degrade to reactive. Union all
    // known sources so verify rejects ONLY genuinely-unknown tools.
    const availableToolNames = Array.from(
      new Set<string>([
        ...input.availableTools,
        ...toolSummaries.map((t) => t.name),
        ...(input.allToolSchemas ?? []).map((t) => t.name),
      ]),
    );

    const verification = verifyPlan(plan, {
      ...(input.requiredTools ? { requiredTools: input.requiredTools } : {}),
      ...(input.requiredToolQuantities
        ? { requiredToolQuantities: input.requiredToolQuantities }
        : {}),
      availableToolNames,
    });

    steps.push(
      makeStep(
        "observation",
        `[VERIFY] ${verification.status}${verification.reasons.length > 0 ? ` — ${verification.reasons.join("; ")}` : ""}`,
      ),
    );
    yield* publishReasoningStep(eventBus, {
      _tag: "ReasoningStepCompleted",
      taskId,
      strategy: STRATEGY,
      step: steps.length,
      totalSteps: plan.steps.length,
      observation: `[VERIFY] ${verification.status}`,
      kernelPass: "blueprint:verify",
    });
    yield* emitPhaseEnd({ emitLog, phase: "blueprint:verify", startedAt: start });

    // Degrade: an unfixable plan would execute observation-free garbage. Fall
    // back to reactive (it has mid-course observation) on the SAME input.
    if (verification.status === "invalid") {
      yield* emitLog({
        _tag: "metric",
        name: "blueprint_degraded_to_reactive",
        value: 1,
        unit: "count",
        timestamp: new Date(),
      });
      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId,
        strategy: STRATEGY,
        step: steps.length,
        totalSteps: plan.steps.length,
        thought: `[DEGRADE] Plan invalid (${verification.reasons.join("; ")}) — falling back to reactive`,
        kernelPass: "blueprint:degrade",
      });
      return yield* executeReactive(input);
    }

    plan = verification.plan;

    // ── EXECUTE (parallel DAG worker — tool_calls 0-LLM, analysis/composite via shared executor) ──
    yield* emitLog({ _tag: "phase_started", phase: "blueprint:execute", timestamp: new Date() });

    const concurrency = resolveWorkerConcurrency(input);

    const workerCtx = {
      taskId,
      // Carry goal + system prompt so the worker can execute intermediate
      // analysis steps inline (a downstream tool depending on an analysis step's
      // output via {{from_step}}).
      taskDescription: input.taskDescription,
      ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
      ...(input.agentId ? { agentId: input.agentId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      // Full catalog (not the pruned subset) so the worker's healing pass and
      // any composite sub-kernel know every planned tool's real schema —
      // e.g. file-write(path, content) for arg-name repair.
      ...(planningToolSchemas.length > 0
        ? { availableToolSchemas: planningToolSchemas }
        : {}),
      ...(input.resultCompression
        ? { resultCompression: input.resultCompression }
        : {}),
      ...(input.harnessPipeline ? { harnessPipeline: input.harnessPipeline } : {}),
      emitLog,
    };

    let workerResult = yield* executeBlueprintWorker(
      plan,
      services,
      workerCtx,
      { concurrency },
    );

    // Canonical ledger pairs, merged across the patch retry below: a retry
    // worker never re-dispatches preserved completed steps, so their ledger
    // entries only exist in the FIRST worker's map — losing them would make a
    // pre-retry file-write invisible to the deliverable receipt again.
    const toolLedger = new Map(workerResult.ledger);

    // ── PATCH RETRY (bounded, on execution failure) ───────────────────────────
    // A structurally-valid plan can still fail at EXECUTE when the tool ARGS are
    // wrong (the tool errors, not the plan shape — VERIFY can't catch that). Feed
    // the failure back through the EXISTING patchPlan helper ONCE and re-run the
    // (idempotent) worker, instead of silently shipping empty output. The happy
    // path is untouched — this branch only runs when a step failed; a failure
    // costs at most +1 LLM call before degrading. Mirrors plan-execute's inline
    // patch; the worker's completed-step guard keeps the re-run from re-executing
    // (or double-charging) steps that already succeeded.
    if (!workerResult.allSucceeded) {
      const statusById = new Map(workerResult.steps.map((s) => [s.id, s]));
      const statusSteps = plan.steps.map((s) => statusById.get(s.id) ?? s);
      const firstFailedIdx = statusSteps.findIndex((s) => s.status === "failed");

      if (firstFailedIdx >= 0) {
        const statusPlan: Plan = { ...plan, steps: statusSteps };
        const patch = yield* patchPlan(
          statusPlan,
          firstFailedIdx,
          {
            taskDescription: input.taskDescription,
            // Enrich the recovery prompt with the FULL tool catalog so the patch
            // isn't tool-blind (else it re-invents tool names/arg shapes — the
            // same root cause the retry exists to fix).
            ...(planningToolSchemas.length > 0
              ? { availableToolSchemas: planningToolSchemas }
              : {}),
          },
          llm,
          totalTokens,
        ).pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (patch) {
          totalTokens += patch.tokens;
          llmCalls += 1;
          const preservedCompleted = workerResult.steps.filter(
            (s) => s.status === "completed" && s.result !== undefined,
          );
          const retryPlan: Plan = {
            ...plan,
            steps: [...preservedCompleted, ...patch.steps],
            version: plan.version + 1,
          };
          yield* publishReasoningStep(eventBus, {
            _tag: "ReasoningStepCompleted",
            taskId,
            strategy: STRATEGY,
            step: steps.length,
            totalSteps: retryPlan.steps.length,
            thought: `[PATCH] Retrying ${patch.steps.length} step(s) after execution error`,
            kernelPass: "blueprint:patch",
          });
          workerResult = yield* executeBlueprintWorker(
            retryPlan,
            services,
            workerCtx,
            { concurrency },
          );
          for (const [id, entries] of workerResult.ledger) {
            toolLedger.set(id, entries);
          }
        }
      }
    }

    for (const s of workerResult.steps) {
      // Dispatched tool steps land as their canonical ledger pair (action step
      // with metadata.toolCall + the primitive's observation step with
      // toolCallId/observationResult) — the ONLY shape isArtifactProduced's
      // linkage scan can verify, so deliverable receipts tell the truth for
      // blueprint runs. The observation keeps the legacy "[EXEC sN] ✓ <output>"
      // prose (log greppability) — only its metadata is new. Prose-only
      // summaries remain for analysis steps and never-dispatched failures.
      const ledgerEntries = toolLedger.get(s.id);
      if (ledgerEntries && ledgerEntries.length > 0) {
        steps.push(
          ...ledgerEntries.map((ls) =>
            ls.type === "observation"
              ? {
                  ...ls,
                  content: `[EXEC ${s.id}] ${s.status === "completed" ? "✓" : "✗"} ${s.result ?? s.error ?? ""}`,
                }
              : ls,
          ),
        );
      } else {
        steps.push(
          makeStep(
            s.status === "completed" ? "observation" : "thought",
            `[EXEC ${s.id}] ${s.status === "completed" ? "✓" : "✗"} ${s.result ?? s.error ?? ""}`,
          ),
        );
      }
    }

    yield* publishReasoningStep(eventBus, {
      _tag: "ReasoningStepCompleted",
      taskId,
      strategy: STRATEGY,
      step: steps.length,
      totalSteps: workerResult.steps.length,
      observation: `[EXEC] ${workerResult.steps.filter((s) => s.status === "completed").length}/${workerResult.steps.length} steps completed (concurrency ${concurrency})`,
      kernelPass: "blueprint:execute",
    });
    yield* emitPhaseEnd({ emitLog, phase: "blueprint:execute", startedAt: start, totalTokens });

    // Step results to solve over — feed FULL result (uncompressed) like
    // plan-execute synthesis so the solver renders every item.
    const completed = workerResult.steps.filter(
      (s) => s.status === "completed" && (s.fullResult ?? s.result),
    );

    // Degrade: if EXECUTE (after the bounded patch retry) produced zero usable
    // step results, there is nothing to solve over — fall back to reactive,
    // which has mid-course observation, on the SAME input rather than ship empty
    // output. (A partial result — some steps completed — still goes to SOLVE.)
    if (completed.length === 0 && workerResult.steps.length > 0) {
      yield* emitLog({
        _tag: "metric",
        name: "blueprint_degraded_to_reactive",
        value: 1,
        unit: "count",
        timestamp: new Date(),
      });
      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId,
        strategy: STRATEGY,
        step: steps.length,
        totalSteps: workerResult.steps.length,
        thought: `[DEGRADE] Execution produced no usable results after patch retry — falling back to reactive`,
        kernelPass: "blueprint:degrade",
      });
      return yield* executeReactive(input);
    }

    const stepResultTexts = completed.map(
      (s, idx) => `Step ${idx + 1} (${s.title}): ${s.fullResult ?? s.result}`,
    );

    // ── SOLVE ───────────────────────────────────────────────────────────────────
    // Single-substantive-step short-circuit (mirrors plan-execute.ts:415): when
    // exactly one step succeeded its result already IS the answer; skip the
    // extra solver LLM call.
    //
    // BUT only when the plan didn't declare synthesis work. A plan with an
    // analysis/composite step (e.g. "format the commits into a numbered list")
    // is explicitly asking for the raw tool result to be TRANSFORMED — the tool
    // output is NOT the final answer. Honour the plan: run SOLVE so the declared
    // synthesis actually happens, instead of shipping raw tool JSON.
    let finalOutput: string | null = null;
    // #40 rule 5 — blueprint runs NO sub-kernel (the EXECUTE worker is 0-LLM
    // tool dispatch + inline analysis calls; the degrade paths return
    // executeReactive's result verbatim, which is already envelope-honest).
    // Its completion envelope is therefore derived per-path from the
    // strategy's own DETERMINISTIC evidence:
    //   - normal path: worker step statuses (allSucceeded) — unchanged;
    //   - budget-capped path (flag below): the token budget forced SOLVE to be
    //     skipped and the HARNESS joined the raw worker results — the model
    //     never authored the deliverable and the run terminated by budget, not
    //     by evidence. That is precisely the budgetTerminalPartial /
    //     harnessAuthoredOutput class, backed by this code path itself (no
    //     kernel markers are fabricated — the evidence IS the branch taken).
    let budgetCappedJoin = false;

    const overBudget =
      tokenLimit !== undefined && totalTokens >= tokenLimit;

    const planDeclaredSynthesis = plan.steps.some(
      (s) => s.type === "analysis" || s.type === "composite",
    );

    if (completed.length === 1 && !planDeclaredSynthesis) {
      finalOutput = completed[0]!.fullResult ?? completed[0]!.result ?? null;
      steps.push(makeStep("thought", `[SOLVE] single-step short-circuit`));
    } else if (stepResultTexts.length > 0 && !overBudget) {
      yield* emitLog({ _tag: "phase_started", phase: "blueprint:solve", timestamp: new Date() });

      const solveResponse = yield* gatewayComplete(llm, { purpose: "synthesize" }, {
          messages: [
            {
              role: "user",
              content: `Task: ${goal}\n\nExecution results:\n${stepResultTexts.join("\n")}\n\nSynthesize a clear, complete answer to the original task. Do NOT include internal details like tool names, JSON payloads, or execution metadata — only user-facing content.`,
            },
          ],
          systemPrompt: withEnvContext(
            input.systemPrompt
              ? `${input.systemPrompt}\n\n${SYNTHESIZER_PERSONA}`
              : SYNTHESIZER_PERSONA,
          ),
          temperature: 0.3,
          ...(input.taskId ? { traceContext: { taskId } } : {}),
        })
        .pipe(
          Effect.catchAll(() =>
            Effect.succeed({
              content: stepResultTexts.join("\n\n"),
              usage: { totalTokens: 0, estimatedCost: 0 },
            }),
          ),
        );

      llmCalls += 1;
      totalTokens += solveResponse.usage.totalTokens;
      totalCost += solveResponse.usage.estimatedCost;
      finalOutput = extractThinkingSafeContent(solveResponse).content;

      steps.push(makeStep("thought", `[SOLVE] ${finalOutput}`));
      yield* emitPhaseEnd({ emitLog, phase: "blueprint:solve", startedAt: start, totalTokens });
    } else if (stepResultTexts.length > 0) {
      // Over budget — no solver call; join the raw worker results.
      finalOutput = stepResultTexts.join("\n\n");
      budgetCappedJoin = true;
      steps.push(makeStep("thought", `[SOLVE] budget-capped — joined worker results`));
    }

    yield* publishReasoningStep(eventBus, {
      _tag: "FinalAnswerProduced",
      taskId,
      strategy: STRATEGY,
      answer: finalOutput ?? "",
      iteration: 0,
      totalTokens,
      kernelPass: "blueprint:solve",
    });

    // Surface blueprint's core efficiency claim: ~2 LLM calls (plan + solve).
    yield* emitLog({
      _tag: "metric",
      name: "blueprint_llm_calls",
      value: llmCalls,
      unit: "count",
      timestamp: new Date(),
    });
    yield* emitLog({
      _tag: "completion",
      success: !!finalOutput,
      summary: finalOutput
        ? "blueprint completed (plan→verify→execute→solve)"
        : "blueprint produced no output",
      timestamp: new Date(),
    });

    return buildStrategyResult({
      strategy: STRATEGY,
      steps,
      output: finalOutput,
      // #40: an unverified ship never reads as completed. The budget-capped
      // join is a partial regardless of worker success (see envelope comment
      // above); otherwise the worker's deterministic step evidence governs.
      status: finalOutput
        ? budgetCappedJoin
          ? "partial"
          : workerResult.allSucceeded
            ? "completed"
            : "partial"
        : "partial",
      start,
      totalTokens,
      totalCost,
      ...(budgetCappedJoin
        ? {
            extraMetadata: {
              // H5/#40 honesty markers for the budget-capped harness join —
              // same fields reactive's honestPartialMetadata ships, derived
              // here from blueprint's own deterministic branch evidence.
              budgetTerminalPartial: true,
              harnessAuthoredOutput: true,
              verificationWarning:
                "Token budget exhausted before SOLVE: output is the harness-joined worker step results, not a model-synthesized answer.",
            },
          }
        : {}),
    });
  });
