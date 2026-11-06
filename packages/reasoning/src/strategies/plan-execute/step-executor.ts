// File: src/strategies/plan-execute/step-executor.ts
/**
 * Step executor for the plan-execute-reflect strategy.
 *
 * WS-6 Phase 3 bucket C extraction (from `strategies/plan-execute.ts`).
 *
 * Dispatches a single plan step based on its type:
 *  - `tool_call`  — direct tool dispatch via `toolService.execute` (no LLM
 *                   kernel needed); strips unresolved `{{from_step:sN}}`
 *                   references, sanitizes output, then applies symmetric
 *                   structured-result compression matching the kernel act
 *                   path.
 *  - `analysis`   — one direct model call (`run.call`) with NO tools; max 4096
 *                   tokens so thinking-model num_predict budgets cover both
 *                   thinking + content.
 *  - `composite`  — one ReAct pass on the strategy substrate (`run.pass`) with
 *                   scoped tools filtered by the step's `toolHints`.
 *
 * Spend, the pass's ledger facts, its completion envelope and its raw
 * terminator are recorded by the substrate (`StrategyRun`), never carried on
 * the step result. `StepExecResult` is exported so the outer plan-execute
 * orchestrator can destructure the result (output / success / pause).
 * Input is narrowed (`StepExecutorInput`) to only the fields each step branch
 * consumes — keeps this module decoupled from the full `PlanExecuteInput`
 * shape declared in `strategies/plan-execute.ts`.
 */
import { Effect, type Ref } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { RunLedger } from "../../kernel/ledger/run-ledger.js";
import { getFileRoot } from "@reactive-agents/tools";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { LogEvent } from "@reactive-agents/observability";
import { ExecutionError } from "../../errors/errors.js";
import { resolveStepReferences } from "../../types/plan.js";
import type { Plan, PlanStep } from "../../types/plan.js";
import { buildStepExecutionPrompt } from "../planning/plan-prompts.js";
import { withOutputDestination } from "../planning/step-consumers.js";
import type { ToolSummary } from "../planning/plan-prompts.js";
import { prepareReActPass, reActResultFromState, reactKernel } from "../../kernel/loop/react-kernel.js";
import { RunEnvelope } from "../../kernel/envelope/run-envelope.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import type { StrategyPaused, StrategyRun } from "../substrate/strategy-run.js";
import { executeToolAndObserve } from "../../kernel/capabilities/act/tool-observe.js";
import { FILE_TOOL_NAMES } from "../../kernel/capabilities/act/act.js";
import type { KernelStateLike } from "@reactive-agents/core";
import type { ReasoningStep } from "../../types/index.js";
import { makeStep, reactResultPause } from "../../kernel/capabilities/sense/step-utils.js";
import { shouldGate } from "../../kernel/capabilities/decide/tool-gating.js";
import { deliverableToContent } from "@reactive-agents/core";
import type { ToolSchema } from "../../kernel/capabilities/attend/tool-formatting.js";
import { extractThinkingSafeContent } from "../../kernel/utils/stream-parser.js";
import { withEnvContext } from "../../context/context-engine.js";
import { priorResultsBudgetChars, priorResultsForPrompt } from "../planning/prior-results.js";
import {
  extractGoalText,
  sanitizeToolOutput,
  stripDeadStorageHints,
  stripFinalAnswerPrefix,
} from "../planning/plan-text.js";

export interface StepExecResult {
  output: string;
  success: boolean;
  /**
   * Full, sanitized (but UNcompressed) tool result for tool_call steps.
   * `output` carries the compressed preview that feeds intermediate
   * analysis/reflection/refinement prompts (protects local-tier context from
   * raw 50KB MCP arrays — see compression note below). `fullResult` preserves
   * the complete data so the final SYNTHESIS step can render every item
   * instead of fabricating tails past the preview cutoff. Reactive achieves
   * the same via in-loop `recall()`; plan-execute's synthesis is tool-less, so
   * the full data must be threaded explicitly. Undefined for analysis/composite
   * steps (their `output` already IS the synthesis-worthy content).
   */
  fullResult?: string;
  /**
   * Durable pause (Phase D) — set when this step stopped at an approval gate
   * (or `request_user_input`) instead of completing. The step's work did NOT
   * happen: the orchestrator stops applying the wave and ends the run paused
   * (a composite step's pause is also deferred on the substrate, which ends
   * the run at the wave checkpoint).
   */
  pause?: import("../../kernel/capabilities/sense/step-utils.js").KernelPause;
  /**
   * Canonical ledger pair for a dispatched tool_call step: the action step
   * carrying `metadata.toolCall` {id, name, arguments} plus the observation
   * step executeToolAndObserve built (toolCallId + observationResult). The
   * orchestrator MUST record these into the run's steps — isArtifactProduced's
   * toolCallId linkage (deliverable receipts, terminal gates) can only verify
   * writes recorded this way; prose "[EXEC …]" summaries made plan-execute
   * runs deliverable-blind. Undefined for analysis/composite steps.
   */
  ledgerSteps?: readonly ReasoningStep[];
}

/**
 * Narrowed input shape consumed by `executeStep`. Mirrors the subset of
 * `PlanExecuteInput` actually read by each branch.
 */
export interface StepExecutorInput {
  readonly taskDescription: string;
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly systemPrompt?: string;
  readonly taskId?: string;
  readonly resultCompression?: ResultCompressionConfig;
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly requiredTools?: readonly string[];
  /** Classifier-relevant tools — forwarded to each per-step kernel so lazy-
   *  disclosure pruning keeps planned MCP/user tools visible. */
  readonly relevantTools?: readonly string[];
  /** Consumer-intent visibility floor (withTools({ builtins: [...] })). */
  readonly builtinFloorTools?: readonly string[];
  readonly maxRequiredToolRetries?: number;
  readonly modelId?: string;
  /** Commanded LLM sampling temperature — `input.temperature ?? <pass default>`
   *  at every generation seam (GH #246). Rides `...input` spread from
   *  plan-execute's own input, which already carries the runtime command-first merge. */
  readonly temperature?: number;
  readonly synthesisConfig?: import("../../context/synthesis-types.js").SynthesisConfig;
  readonly skillsContext?: import("../../kernel/state/kernel-state.js").SkillsContext;
  // FM-I (#195): cross-cutting fields forwarded to each per-step ReAct kernel.
  // Previously omitted from this narrowed interface → Compose hooks,
  // killswitches, and calibration were dead during plan-execute steps.
  readonly harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
  readonly budgetLimits?: import("../../kernel/capabilities/decide/arbitrator.js").BudgetLimits;
  readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
  readonly auditRationale?: boolean;
  // Cascade Task 6: the HITL rails are NOT declared here. The analysis /
  // composite branches reach a kernel, and `runKernel` merges them off the
  // `RunEnvelope`; the `tool_call` branch dispatches OUTSIDE any kernel, so it
  // reads the SAME envelope directly (see the gate in `executeStep`). Neither
  // branch depends on plan-execute remembering to hand them down.
  /** #40: long-horizon guard profile — forwarded to each composite sub-kernel so
   *  the A2 pace bands (and thus the budget-terminal honest partial) can arm. */
  readonly horizonProfile?: "long";
  readonly checklistGuidance?: import("../../kernel/capabilities/reflect/checklist-reminder.js").ChecklistGuidanceOptions;
  /** P0-4 — tool-policy passed straight into the canonical primitive so a
   *  forbidden / non-allowed planned tool is blocked before dispatch. */
  readonly allowedTools?: readonly string[];
  readonly forbiddenTools?: readonly string[];
  /** C8 — the run ledger sink (`run.ledgerSink`) handed to the primitive so
   *  each direct tool dispatch mints its canonical tool-invocation +
   *  tool-result entries into the ONE run ledger the substrate owns. */
  readonly ledgerSink?: Ref.Ref<RunLedger>;
}

/**
 * Execute a single plan step based on its type:
 * - tool_call: direct tool dispatch via executeToolAndObserve (canonical primitive)
 * - analysis: one direct model call (`run.call`), NO tools
 * - composite: one ReAct pass on the substrate (`run.pass`) with scoped tools
 *
 * `run` is the strategy run this step belongs to: it accounts the step's
 * spend, absorbs a composite pass's ledger facts and envelope, and defers a
 * composite pass's pause to the wave checkpoint.
 */
export function executeStep(
  step: PlanStep,
  stepIndex: number,
  plan: Plan,
  completedSteps: PlanStep[],
  input: StepExecutorInput,
  toolSummaries: ToolSummary[],
  services: StrategyServices,
  maxKernelIter: number,
  retryErrorContext: string | undefined,
  emitLog: (event: LogEvent) => Effect.Effect<void, never>,
  // Cascade Task 6 (scope B): the `tool_call` branch below dispatches OUTSIDE
  // any kernel, so `runKernel`'s envelope merge cannot cover its approval gate.
  // Rather than hand-carry the rails on `StepExecutorInput` (the exact
  // drop-prone pattern this cascade exists to delete), the R channel is widened
  // and the branch reads the ONE run-wide carrier itself. The sole caller
  // (`plan-execute.ts`) already declares `RunEnvelope` in its own R channel, so
  // this costs nothing at the call site and a future caller that forgets the
  // envelope is a COMPILE error, not a silent unattended tool execution.
  run: StrategyRun,
): Effect.Effect<StepExecResult, ExecutionError | StrategyPaused, LLMService | RunEnvelope> {
  const { toolService } = services;

  if (step.type === "tool_call" && step.toolName && toolService._tag === "Some") {
    // Direct tool dispatch routed through the canonical executeToolAndObserve
    // primitive (no LLM kernel) — gains healing + observation.tool-result /
    // lifecycle.failure Compose tags + guaranteed observation metadata that the
    // hand-rolled dispatch lacked (#195/FM-I). Verifier + semantic-memory stay
    // OFF (parity-cheap opt-out); the result string flow is preserved via the
    // sanitize `preprocess` hook + `stripDeadStorageHints` + `fullResult`.
    return Effect.gen(function* () {
      // Durable HITL gate (Phase D) — this branch dispatches the tool DIRECTLY,
      // bypassing the kernel act phase where the gate normally fires. Without
      // this check a `requiresApproval` tool executes unattended whenever the
      // planner emits it as a `tool_call` step (2026-07-22). Same decision
      // function the kernel uses, so gating stays consistent across paths.
      // The policy comes off the run-wide envelope — the same value
      // `runKernel` merges for the kernel-backed branches.
      const gatePolicy = (yield* RunEnvelope).rails.approvalPolicy;
      const pauseSentinel = deliverableToContent({
        source: "sentinel",
        reason: "awaiting_approval",
      });
      if (
        gatePolicy?.mode === "detach" &&
        shouldGate(step.toolName!, gatePolicy, { iteration: stepIndex })
      ) {
        return {
          output: pauseSentinel,
          success: true,
          // The step did not run: the orchestrator ends the run paused.
          pause: {
            reason: "awaiting-approval" as const,
            output: pauseSentinel,
            awaitingApprovalFor: {
              gateId: crypto.randomUUID(),
              toolName: step.toolName!,
              args: resolveStepReferences(step.toolArgs ?? {}, completedSteps),
            },
          },
        };
      }

      const rawArgs = step.toolArgs ?? {};
      const resolvedArgs = resolveStepReferences(rawArgs, completedSteps);

      // Strip any remaining unresolved {{from_step:sN}} references (self-ref or
      // missing step). Rather than hard-failing the step, replace with empty string
      // and let the tool handle missing/default args. This prevents infinite retry
      // loops when the LLM generates circular step references (e.g. spawn-agent
      // with agentId={{from_step:s2}} where s2 is the current step).
      for (const [key, value] of Object.entries(resolvedArgs)) {
        if (typeof value === "string" && /\{\{from_step:s\d+\}\}/.test(value)) {
          resolvedArgs[key] = value.replace(/\{\{from_step:s\d+(?::summary|:full)?\}\}/g, "");
        }
      }

      // Synthetic KernelStateLike (CORE shape — emitToCompose's ContextFor<T>
      // requires all fields). plan-execute has no KernelState; build minimal
      // real fields from the plan/step — no cast.
      const syntheticState: KernelStateLike = {
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute",
        kernelType: "react",
        steps: completedSteps.map(() => ({ type: "observation" })),
        toolsUsed: new Set(
          completedSteps.map((s) => s.toolName).filter((n): n is string => !!n),
        ),
        iteration: stepIndex,
        tokens: 0,
        status: "acting",
        output: null,
        error: null,
        meta: {},
      };

      const observe = yield* executeToolAndObserve(
        toolService,
        {
          toolName: step.toolName!,
          args: resolvedArgs,
          ...(step.rationale && step.rationale.why
            ? {
                rationale: {
                  why: step.rationale.why,
                  ...(typeof step.rationale.confidence === "number"
                    ? { confidence: step.rationale.confidence }
                    : {}),
                },
              }
            : {}),
        },
        {
          iteration: stepIndex,
          phase: "act",
          strategy: "plan-execute",
          state: syntheticState,
          callId: `${plan.id}_${step.id}`,
        },
        {
          ...(input.resultCompression
            ? { compression: input.resultCompression }
            : { compression: { budget: 2000, previewItems: 8 } }),
          // Strip action-tool args/recipients from the compressed preview that
          // feeds tool-less downstream prompts (analysis/reflection/synthesis).
          preprocess: (raw) => sanitizeToolOutput(step.toolName!, raw, resolvedArgs),
          // Strip dead [STORED:]/recall() pointers — downstream prompts can't recall.
          stripDeadStorageHints,
          // Heal internally (the kernel pre-heals; plan-execute didn't heal at all).
          heal: {
            schemas: input.availableToolSchemas ?? [],
            fileToolNames: FILE_TOOL_NAMES,
            // Sandbox-aware root (was process.cwd() — see act.ts's healCall
            // for the full writeup of the bug this caused).
            cwd: getFileRoot(),
          },
          pipeline: input.harnessPipeline,
          eventBus: services.eventBus,
          emitToolCallEvents: true,
          taskId: input.taskId ?? "plan-execute",
          kernelPass: `plan-execute:step-${stepIndex + 1}`,
          ...(input.agentId ? { agentId: input.agentId } : {}),
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          emitLog,
          // P0-4 — inherit the tool-policy gate from the canonical primitive.
          ...(input.allowedTools !== undefined ? { allowedTools: input.allowedTools } : {}),
          ...(input.forbiddenTools !== undefined ? { forbiddenTools: input.forbiddenTools } : {}),
          // C8 — mint the canonical tool-invocation + tool-result ledger pair.
          ...(input.ledgerSink ? { ledgerSink: input.ledgerSink } : {}),
          // maxCallsPerTool for this 0-LLM dispatch (no kernel gate here).
          callBudget: run.toolCallBudget,
          // extractFactsLLM omitted (false) — parity-cheap, no LLM fact pass.
          // verifier / memoryService omitted — opt-out holds (Phase E only).
        },
      );

      return {
        output: observe.content,
        // Full sanitized data for the tool-less SYNTHESIS step. The primitive's
        // `content` is the compressed preview for intermediate prompts; synthesis
        // needs the complete data (fullResult is surfaced from executeNativeToolCall).
        fullResult: observe.fullResult ?? observe.content,
        success: observe.success,
        // No sub-kernel on this path (direct tool dispatch): no completion
        // envelope joins the run's cap, so no kernel markers are fabricated
        // (#40 rule 5).
        // Canonical ledger pair (see StepExecResult.ledgerSteps). The action's
        // toolCall.id must equal the callId executeToolAndObserve stamped on
        // obsStep.metadata.toolCallId. Arguments are the POST-heal absolute-path
        // args (D-2026-07-28-D) — same values `ToolCallCompleted`/the trace
        // record, so the replay lane's argsHash no longer diverges from its own
        // trace on path-taking tools.
        ledgerSteps: [
          makeStep("action", `[DISPATCH ${step.id}] ${step.toolName}`, {
            toolCall: {
              id: `${plan.id}_${step.id}`,
              name: step.toolName!,
              arguments: observe.healedArgs,
            },
          }),
          observe.obsStep,
        ],
      } satisfies StepExecResult;
    });
  }

  // Build prior results for analysis/composite step prompts: full data within
  // the recency budget, previews beyond it (strategies/planning/prior-results.ts).
  const priorResults = priorResultsForPrompt(completedSteps, priorResultsBudgetChars(input.modelId));

  // Scope tools for composite steps
  const scopedTools: ToolSummary[] =
    step.type === "composite" && step.toolHints
      ? toolSummaries.filter((t) => step.toolHints!.includes(t.name))
      : [];

  // Build the step execution prompt
  const stepPrompt = buildStepExecutionPrompt({
    goal: extractGoalText(input.taskDescription),
    step,
    stepIndex,
    totalSteps: plan.steps.length,
    priorResults,
    scopedTools,
    // H3 2026-11-05 defect 3: name the downstream argument this output becomes.
    ...withOutputDestination(plan.steps, step.id),
  });

  // Add retry error context if retrying
  const taskText = retryErrorContext
    ? `${stepPrompt}\n\nPREVIOUS ATTEMPT FAILED: ${retryErrorContext}\nPlease try a different approach.`
    : stepPrompt;

  // Analysis steps: single LLM call — no tool loop needed. The standard
  // budget class (4096) accommodates thinking models where num_predict covers
  // both thinking + content tokens combined.
  if (step.type === "analysis") {
    // `run.call` accounts the call (tokens, cost, one LLM call) whether or not
    // the output below survives the empty-output check.
    return run.call({ purpose: "synthesize" }, {
        messages: [{ role: "user", content: taskText }],
        systemPrompt: withEnvContext(
          input.systemPrompt ??
            "You are a precise task executor. Produce the requested content directly. Never ask questions or offer to do something — just output the finished result.",
        ),
        // GH #246: commanded temperature wins; unset keeps the 0.5 default.
        temperature: input.temperature ?? 0.5,
        // Correlate this direct (non-kernel) analysis call so the observable-LLM
        // chokepoint emits a ContextPressure keyed to the real run — analysis
        // steps bypass the kernel hooks, so without this the Cortex gauge stays
        // dark during analysis-only plan-execute runs.
        ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
      }, { message: `Analysis step ${stepIndex + 1} failed`, step: stepIndex })
      .pipe(
        Effect.flatMap((response) => {
          const output = stripFinalAnswerPrefix(
            extractThinkingSafeContent(response).content,
          );
          if (!output.trim()) {
            return Effect.fail(
              new ExecutionError({
                strategy: "plan-execute-reflect",
                message: `Analysis step ${stepIndex + 1} produced empty output (model may have exhausted token budget on thinking)`,
                step: stepIndex,
              }),
            );
          }
          // No sub-kernel on this path (single tool-less LLM call): no
          // completion envelope joins the run's cap, so no kernel markers are
          // fabricated (#40 rule 5).
          return Effect.succeed({ output, success: true } satisfies StepExecResult);
        }),
      );
  }

  // Composite steps: ReAct kernel with scoped tools
  const kernelToolSchemas =
    step.toolHints
      ? (input.availableToolSchemas ?? []).filter((t) =>
          step.toolHints!.includes(t.name),
        )
      : undefined;

  // D-2026-07-28-C: the plan is the one typed sub-goal ledger in the codebase
  // (07-08 audit). Titles of every OTHER step not yet done — pending or
  // in_progress, excluding the one this call is dispatching — recited to the
  // sub-kernel as `remainingGoals` so it can see the shape of the whole plan,
  // not just its own step.
  const remainingGoals = plan.steps
    .filter((s) => s.id !== step.id && (s.status === "pending" || s.status === "in_progress"))
    .map((s) => s.title);

  return Effect.gen(function* () {
    const { kernelInput, options } = yield* prepareReActPass({
      task: taskText,
      systemPrompt:
        input.systemPrompt ??
        "You are a precise task executor. Complete the given step.",
      availableToolSchemas: kernelToolSchemas,
      maxIterations: maxKernelIter,
      // GH #246: commanded temperature wins; unset keeps the 0.5 default.
      temperature: input.temperature ?? 0.5,
      taskId: input.taskId,
      parentStrategy: "plan-execute",
      kernelPass: `plan-execute:step-${stepIndex + 1}`,
      // The step prompt carries the OVERALL GOAL, so the files it names are the
      // plan's deliverables, not this step's: the step kernel is not held to them.
      deliveryScope: "step",
      ...(remainingGoals.length > 0 ? { remainingGoals } : {}),
      resultCompression: input.resultCompression,
      agentId: input.agentId,
      sessionId: input.sessionId,
      // A step scoped to toolHints is held only to the required tools it can
      // see; the rest belong to other steps (H3 h3-plan-only: a file-read step
      // inheriting file-write abstained before its first call).
      requiredTools: step.toolHints
        ? input.requiredTools?.filter((t) => step.toolHints!.includes(t))
        : input.requiredTools,
      relevantTools: input.relevantTools,
      builtinFloorTools: input.builtinFloorTools,
      maxRequiredToolRetries: input.maxRequiredToolRetries,
      modelId: input.modelId,
      exitOnAllToolsCalled: true,
      synthesisConfig: input.synthesisConfig,
      // FM-I (#195): forward cross-cutting fields so Compose hooks, killswitches,
      // and model calibration are live during per-step execution. prepareReActPass
      // forwards these through buildKernelInput to the kernel.
      skillsContext: input.skillsContext,
      harnessPipeline: input.harnessPipeline,
      budgetLimits: input.budgetLimits,
      calibration: input.calibration,
      auditRationale: input.auditRationale,
      // #40: arm the sub-kernel's long-horizon pace bands (see StepExecutorInput).
      ...(input.horizonProfile ? { horizonProfile: input.horizonProfile } : {}),
      ...(input.checklistGuidance ? { checklistGuidance: input.checklistGuidance } : {}),
    });
    // The substrate runs the pass: its spend, ledger facts (the real sub-kernel
    // ledger, absorbed once), completion envelope (#40: honesty markers cap the
    // plan's status) and raw terminator join the run. Only tool evidence joins
    // the run's steps; the plan narrates its own [EXEC] summary. A pause is
    // deferred so wave siblings finish; the run ends at the wave checkpoint.
    const pass = yield* run.pass(reactKernel, kernelInput, options, { deferPause: true, record: "evidence" });
    const kernelResult = reActResultFromState(pass.state);
    const pause = reactResultPause(kernelResult);
    // An abstained or errored sub-kernel did not do the step: report it failed
    // so the plan patches or skips its dependents instead of building on nothing.
    const success = kernelResult.terminatedBy !== "abstained" && kernelResult.terminatedBy !== "llm_error";
    return {
      output: success
        ? stripFinalAnswerPrefix(kernelResult.output || `[Step ${stepIndex + 1} completed]`)
        : kernelResult.abstention?.reason ?? (kernelResult.output || `[Step ${stepIndex + 1} failed: ${kernelResult.terminatedBy}]`),
      success,
      // Durable pause (Phase D): the sub-kernel stopped at an approval gate.
      // The step did NOT run; the orchestrator stops applying the wave.
      ...(pause !== undefined ? { pause } : {}),
    } satisfies StepExecResult;
  });
}
