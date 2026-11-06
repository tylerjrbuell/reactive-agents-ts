// File: src/strategies/reflexion.ts
/**
 * Reflexion Strategy — Generate → Reflect → Improve loop.
 *
 * Based on the Reflexion paper (Shinn et al., 2023).
 * The agent:
 *   1. Generates an initial response (attempt) — now via the ReAct kernel so it
 *      can call tools during generation and improvement passes.
 *   2. Self-critiques the response to identify gaps/errors (pure LLM — no tools
 *      needed for quality judgment).
 *   3. Improves the response using the critique as feedback (ReAct kernel again).
 *   4. Repeats until maxRetries reached or the critique is satisfied.
 */
import { Effect } from "effect";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import { ExecutionError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { reactKernel } from "../kernel/loop/react-kernel.js";
import {
  buildKernelInput,
  type CrossCuttingInput,
} from "../kernel/state/build-kernel-input.js";
import type { PassResult } from "../kernel/loop/run-pass.js";
import { runStrategy, type StrategyPaused } from "./substrate/strategy-run.js";
import {
  iterateUntil,
  continueWith,
  terminateWith,
} from "../kernel/loop/iterate-until.js";
import type { KernelMessage, SkillsContext } from "../kernel/state/kernel-state.js";
import {
  emitPhaseEnd,
  resolveStrategyServices,
  compilePromptOrFallback,
  publishReasoningStep,
} from "../kernel/utils/service-utils.js";
import { makeStep } from "../kernel/capabilities/sense/step-utils.js";
import type { JudgedReasoningResult } from "../kernel/capabilities/sense/finalize-result.js";
import { RunEnvelope } from "../kernel/envelope/run-envelope.js";
import { isSatisfied, isCritiqueStagnant } from "../kernel/capabilities/verify/quality-utils.js";
import {
  evaluateTerminalGate,
  REFLEXION_SATISFIED,
} from "../kernel/capabilities/decide/terminal-gate.js";
import {
  missingRequired,
  toolEvidence,
  deriveRequirementEvidence,
} from "../kernel/capabilities/verify/requirement-state.js";
import { describeUnmet, type PostCondition } from "../kernel/capabilities/verify/post-conditions.js";
import { judgeStrategyDelivery } from "../kernel/capabilities/verify/strategy-delivery.js";
import { openStrategyContract } from "../kernel/contract/strategy-contract.js";
import {
  enforceQualityGate,
  collectToolData,
} from "../kernel/loop/finalize.js";
import { runCritiquePass } from "../kernel/capabilities/verify/critique.js";
import { extractThinkingSafeContent } from "../kernel/utils/stream-parser.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";
import { resolveExecutableToolCapabilities } from "../kernel/capabilities/act/tool-capabilities.js";
import { emitKernelStateSnapshot } from "../kernel/utils/diagnostics.js";
import { withEnvContext } from "../context/context-engine.js";

interface ReflexionInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  /** Full tool schemas for tool-aware generation and improvement passes */
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly config: ReasoningConfig;
  /** Custom system prompt for steering agent behavior */
  readonly systemPrompt?: string;
  /** Task ID for event correlation */
  readonly taskId?: string;
  /** Tool result compression config */
  readonly resultCompression?: ResultCompressionConfig;
  /** Agent ID for tool execution attribution. Falls back to "reasoning-agent". */
  readonly agentId?: string;
  /** Session ID for tool execution attribution. Falls back to "reasoning-session". */
  readonly sessionId?: string;
  /** Tools that MUST be called before the agent can declare success */
  readonly requiredTools?: readonly string[];
  /** Classifier-relevant tools — visible/usable in the prompt but not gate-enforced.
   *  MUST be forwarded to the kernel pass: under lazy tool disclosure the kernel's
   *  per-iteration visible set = required + relevant + used + discovered + meta. If
   *  relevant is dropped, MCP/user tools are pruned and the model is left blind
   *  (only meta-tools visible) — see spot-test GitHub-MCP regression. */
  readonly relevantTools?: readonly string[];
  /** Consumer-intent visibility floor (withTools({ builtins: [...] })). */
  readonly builtinFloorTools?: readonly string[];
  /** Max redirects when required tools are missing (default: 2) */
  readonly maxRequiredToolRetries?: number;
  /** Critiques from prior reflexion runs on similar tasks — populated from episodic memory */
  readonly priorCritiques?: readonly string[];
  /** Model identifier for routing/entropy scoring */
  readonly modelId?: string;
  /** Provider name for entropy-based modelTier resolution */
  readonly providerName?: string;
  /** LLM temperature override */
  readonly temperature?: number;
  readonly synthesisConfig?: import("../context/synthesis-types.js").SynthesisConfig;
  readonly metaTools?: KernelMetaToolsConfig;
  readonly briefResolvedSkills?: readonly { readonly name: string; readonly purpose: string }[];
  readonly skillsContext?: SkillsContext;
  /** HS-cleanup-2: upstream task classification snapshot (currently unused, kept for forward compat). */
  readonly taskClassification?: import("../kernel/capabilities/comprehend/task-classification.js").TaskClassification;
  // FM-I (#195): cross-cutting fields that MUST reach every kernel sub-pass.
  // Previously absent from this interface → reflexion silently dropped them →
  // Compose hooks, killswitches, and model calibration were dead under reflexion.
  /** Compose harness pipeline — drives `.on/.tap/.before/.after` + all tags. */
  readonly harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
  /** Budget killswitch limits (budgetLimit/watchdog). */
  readonly budgetLimits?: import("../kernel/capabilities/decide/arbitrator.js").BudgetLimits;
  /** Pre-resolved model calibration — drives steering channel selection. */
  readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
  /** Opt-in per-tool-call rationale auditing. */
  readonly auditRationale?: boolean;
  /**
   * #40: long-horizon guard profile — threaded to the generate + improve
   * kernel passes so the A2 pace bands, and therefore the budget-terminal
   * honest partial, can arm inside reflexion exactly like reactive /
   * tree-of-thought (7b6e1ad1).
   */
  readonly horizonProfile?: "long";
  readonly checklistGuidance?: import("../kernel/capabilities/reflect/checklist-reminder.js").ChecklistGuidanceOptions;
}

/**
 * Reflexion: Generate → Self-Critique → Improve, repeating until satisfied
 * or maxRetries is reached.
 *
 * Generation and improvement passes use the ReAct kernel (tool-aware).
 * The critique pass is a pure LLM call — quality judgment needs no tools.
 */
export const executeReflexion = (
  input: ReflexionInput,
): Effect.Effect<
  JudgedReasoningResult,
  ExecutionError,
  LLMService | RunEnvelope
> =>
  Effect.gen(function* () {
    const { llm, promptService: promptServiceOpt, eventBus: ebOpt, toolService } =
      yield* resolveStrategyServices;
    // D9: the run contract, compiled once by the shared strategy primitive (the delivery spine judges against it).
    const runContract = yield* openStrategyContract({ task: input.taskDescription, taskId: input.taskId ?? "reflexion",
      requiredTools: input.requiredTools ?? [], toolSchemas: input.availableToolSchemas, toolService });

    // Finding 2 (harness-control-surface final fix wave): resolve the envelope
    // here so its `harness` can reach `resolveExecutableToolCapabilities`
    // below — without it, the capability resolver falls back to a fresh
    // `resolveHarnessConfig()` re-read of the environment, silently ignoring
    // any per-agent `.withHarness({ toolDiscovery: ... })` config.
    const envelope = yield* RunEnvelope;

    const { maxRetries, selfCritiqueDepth } = input.config.strategies.reflexion;
    const seedCritiques: readonly string[] = input.priorCritiques ? [...input.priorCritiques] : [];
    const capabilitySnapshot = yield* resolveExecutableToolCapabilities({
      availableToolSchemas: input.availableToolSchemas,
      metaTools: input.metaTools,
      harness: envelope.harness,
      task: input.taskDescription,
    });

    // FM-I (#195): build the run-wide cross-cutting bundle ONCE and feed it to
    // every kernel pass via buildKernelInput. This is the canonical assembly
    // point — a dropped cross-cutting field is now a compile error, not a
    // silent runtime gap. `verifier` is intentionally absent: reflexion's own
    // critique loop is its verification; threading a terminal verifier into
    // each sub-pass would change behaviour.
    // Cascade Task 6: the HITL rails + policy fields are NOT spread onto the
    // sub-kernels below. `runKernel` merges them off the `RunEnvelope` at the
    // kernel entry, so EVERY reflexion pass (generate, improve, and any future
    // one) is covered by construction rather than by remembering to spread.
    const crossCutting: CrossCuttingInput = {
      resultCompression: input.resultCompression,
      agentId: input.agentId,
      sessionId: input.sessionId,
      requiredTools: input.requiredTools,
      relevantTools: input.relevantTools,
      builtinFloorTools: input.builtinFloorTools,
      maxRequiredToolRetries: input.maxRequiredToolRetries,
      synthesisConfig: input.synthesisConfig,
      metaTools: input.metaTools,
      briefResolvedSkills: input.briefResolvedSkills,
      skillsContext: input.skillsContext,
      modelId: input.modelId,
      harnessPipeline: input.harnessPipeline,
      budgetLimits: input.budgetLimits,
      calibration: input.calibration,
      auditRationale: input.auditRationale,
    };

    // The substrate owns the trajectory: one run ledger across generate and
    // improve passes (an earlier pass's file-write stays in it), spend and call
    // accounting, the worst-of envelope cap over every pass, the pause terminal
    // and the claim rule (final_answer iff completed; an abstention still wins).
    // This body is reflexion's control flow: generate, critique, improve.
    return yield* runStrategy(
      {
        strategy: "reflexion",
        taskId: input.taskId ?? "reflexion",
        requiredTools: input.requiredTools ?? [],
        logSite: "reasoning/src/strategies/reflexion.ts:emitLog",
      },
      (run) => Effect.gen(function* () {
    const emitLog = run.emitLog;
    const start = run.start;

    yield* emitLog({ _tag: "phase_started", phase: "reflexion:generate", timestamp: new Date() });

    // ── STEP 1: Initial generation (tool-aware via ReAct kernel) ──
    const genDefaultFallback = input.systemPrompt
      ? `${input.systemPrompt}\n\nExecute the task using the EXACT tool names and parameter values specified. Do NOT guess or substitute parameters. Complete ALL required actions.`
      : buildSystemPrompt(input.taskDescription);

    const genSystemPrompt = yield* compilePromptOrFallback(
      promptServiceOpt,
      "reasoning.reflexion-generate",
      { task: input.taskDescription },
      genDefaultFallback,
    );

    // Build priorContext with param hints — placed AFTER tool schemas, right before RULES
    const paramHints = extractToolParamHints(input.taskDescription);
    const genPriorContext = paramHints
      ? `⚠️ CRITICAL — use these EXACT values (do NOT substitute or guess):\n${paramHints}`
      : undefined;

    // A paused generate pass ends the run inside `run.pass` (the gated call has
    // not executed; the critique/improve loop must not run around it).
    const genPass = yield* run.pass(reactKernel, {
      ...buildKernelInput(crossCutting, {
        task: buildGenerationPrompt(input, null),
        systemPrompt: genSystemPrompt,
        priorContext: genPriorContext,
        availableToolSchemas: capabilitySnapshot.availableToolSchemas,
        allToolSchemas: capabilitySnapshot.allToolSchemas,
        // GH #246: commanded temperature wins (`input.temperature` already
        // carries the runtime's command-first merge); unset keeps the 0.7 default.
        temperature: input.temperature ?? 0.7,
      }),
      ...(input.checklistGuidance ? { checklistGuidance: input.checklistGuidance } : {}),
    }, {
      maxIterations: input.config.strategies.reflexion?.kernelMaxIterations ?? 3,
      strategy: "reflexion",
      kernelType: "react",
      taskId: input.taskId,
      kernelPass: "reflexion:generate",
      modelId: input.modelId,
      providerName: input.providerName,
      taskDescription: input.taskDescription,
      temperature: input.temperature ?? 0.7,
      // #40: arm the A2 long-horizon pace bands in the generate sub-kernel.
      ...(input.horizonProfile ? { horizonProfile: input.horizonProfile } : {}),
    }, { record: "evidence" });

    let initialResponse = genPass.output ?? "";

    // ── Empty-generate backfill (gpt-4o-mini bug, trace 01KTAV0MVG) ──
    // The generate sub-pass can terminate with NO model-authored answer: when the
    // model spends its (capped) iteration budget on meta-tools (brief/find) the
    // dispatcher early-stops before any synthesis, and the kernel honestly commits
    // an empty/sentinel deliverable. An empty initialResponse then poisons the
    // entire reflect→improve loop (critique critiques nothing, improve has no base)
    // and ships a 0-char final result — the cell fails despite a capable model.
    // Force one direct synthesis from the accumulated generate context so the loop
    // is always seeded with a real answer. If synthesis also yields nothing, the
    // M7 empty-output→failed invariant still holds downstream (no false success).
    if (initialResponse.trim() === "") {
      // Build a CLEAN single-turn synthesis prompt. Do NOT reuse genPass.messages:
      // the empty generate is typically caused by meta-tool (brief/find) churn, and
      // that raw provider thread (assistant tool_calls + tool results) is exactly
      // what trips native-FC providers like OpenAI into rejecting a fresh completion
      // (the original improve-phase llm_error came from the same malformed thread).
      // Instead, digest any gathered observation text so tool-grounded tasks keep
      // their evidence, then ask for the final answer in one self-contained turn.
      const observationDigest = genPass.steps
        .filter((st) => st.type === "observation" && st.content.trim().length > 0)
        .map((st) => st.content)
        .join("\n")
        .slice(0, 4000);
      const synthPrompt = observationDigest
        ? `Task: ${input.taskDescription}\n\nInformation gathered so far:\n${observationDigest}\n\nUsing the information above, write your complete, final answer to the task now. Output only the answer.`
        : `Task: ${input.taskDescription}\n\nWrite your complete, final answer to the task now. Output only the answer.`;
      const synthResponse = yield* run.call({ purpose: "synthesize", budgetClass: "provider-default" }, {
          messages: [{ role: "user", content: synthPrompt }],
          systemPrompt:
            input.systemPrompt ??
            "You are completing a task. Produce the complete, final answer directly — no preamble, no offers.",
          // GH #246: commanded temperature wins; unset keeps the 0.7 default.
          temperature: input.temperature ?? 0.7,
        }, { message: "Generate produced empty output and the synthesis fallback failed", step: 0 });
      const synthText = extractThinkingSafeContent(synthResponse).content || synthResponse.content || "";
      initialResponse = synthText;
      yield* emitLog({
        _tag: "warning",
        message: "Generate pass produced empty output — used synthesis fallback to seed the reflect loop",
        context: "reflexion",
        timestamp: new Date(),
      });
    }

    yield* emitPhaseEnd({ emitLog, phase: "reflexion:generate", startedAt: start, totalTokens: run.spend().tokens });

    run.record(makeStep("thought", `[ATTEMPT 1] ${initialResponse}`));

    yield* publishReasoningStep(ebOpt, {
      _tag: "ReasoningStepCompleted",
      taskId: input.taskId ?? "reflexion",
      strategy: "reflexion",
      step: run.steps().length,
      totalSteps: maxRetries + 1,
      thought: `[ATTEMPT 1] ${initialResponse}`,
      kernelPass: "reflexion:generate",
    });

    // ── LOOP: Reflect → Improve (via iterateUntil combinator) ──
    //
    // State carried across iterations. Outer-scope `steps` (mutable
    // accumulator), `emitLog`, `start`, `paramHints`, `capabilitySnapshot`,
    // etc. are captured by closure — only iteration-mutating state lives in S.
    interface ReflexionIterState {
      readonly response: string;
      readonly lastKernelSteps: readonly ReasoningStep[];
      readonly allSideEffectSteps: readonly ReasoningStep[];
      readonly runningMessages: readonly KernelMessage[];
      readonly previousCritiques: readonly string[];
      /**
       * The last kernel pass that shipped this response (generate seed, or the
       * most recent improve pass). The substrate relays its terminatedBy raw
       * channel and abstention; the worst-of envelope over EVERY pass is the
       * substrate's, so the critique can never bless a harness-authored or
       * budget-terminal partial.
       */
      readonly lastPass: PassResult;
    }

    const loopResult = yield* iterateUntil<ReflexionIterState, ExecutionError | StrategyPaused, LLMService>({
      initial: {
        response: initialResponse,
        lastKernelSteps: genPass.steps,
        allSideEffectSteps: genPass.steps,
        runningMessages: genPass.messages,
        previousCritiques: seedCritiques,
        lastPass: genPass,
      },
      maxIters: maxRetries,
      step: (s, attempt) =>
        Effect.gen(function* () {
          yield* emitLog({
            _tag: "iteration",
            iteration: attempt,
            phase: "thought",
            summary: `Reflexion attempt ${attempt}`,
            timestamp: new Date(),
          });

          // HS-113 / E2: outer-loop snapshot at each reflexion-improve boundary.
          yield* emitKernelStateSnapshot({
            state: {
              status: "evaluating" as const,
              steps: run.steps().map((st) => ({ type: st.type })),
              toolsUsed: new Set<string>(),
              tokens: run.spend().tokens,
              cost: run.spend().cost,
            },
            taskId: input.taskId ?? "reflexion",
            iteration: attempt,
            outerLoopName: "reflexion:improve",
            outerIter: attempt,
          });

          yield* emitLog({ _tag: "phase_started", phase: "reflexion:critique", timestamp: new Date() });

          // ── Reflect: self-critique the current response (pure LLM — no tools) ──
          const critiqueDefaultFallback = input.systemPrompt
            ? `${input.systemPrompt}\n\nYou are a critical evaluator. Analyze responses for accuracy, completeness, and quality.`
            : "You are a critical evaluator. Analyze responses for accuracy, completeness, and quality.";

          const critiqueSystemPrompt = yield* compilePromptOrFallback(
            promptServiceOpt,
            "reasoning.reflexion-critique",
            {},
            critiqueDefaultFallback,
          );

          const critiqueResult = yield* runCritiquePass({
            llm,
            systemPrompt: critiqueSystemPrompt,
            promptBody: buildCritiquePrompt(
              input.taskDescription,
              s.response,
              selfCritiqueDepth,
              s.previousCritiques,
              s.lastKernelSteps,
            ),
            depth: selfCritiqueDepth,
            strategyName: "reflexion",
            step: attempt,
            ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
          });

          const critique = critiqueResult.content || critiqueResult.thinking || "";
          // The critique is one direct model call through its own primitive.
          run.account({ tokens: critiqueResult.tokens, cost: critiqueResult.cost, llmCalls: 1 });
          // Honest trace when the critique LLM call failed and degraded to a
          // no-op (the run continues with the current answer rather than dying).
          if (critiqueResult.degraded) {
            run.record(
              makeStep(
                "observation",
                `[CRITIQUE ${attempt}] skipped — ${critiqueResult.degraded.reason}`,
                { frameworkInstrumentation: "critique-marker" },
              ),
            );
          }
          yield* emitPhaseEnd({ emitLog, phase: "reflexion:critique", startedAt: start, totalTokens: run.spend().tokens });

          // HS-cleanup-1: framework instrumentation — tag so output-assembly +
          // arbitrator skip this step when assembling user-facing answer.
          run.record(
            makeStep("observation", `[CRITIQUE ${attempt}] ${critique}`, {
              frameworkInstrumentation: "critique-marker",
            }),
          );

          yield* publishReasoningStep(ebOpt, {
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "reflexion",
            strategy: "reflexion",
            step: run.steps().length,
            totalSteps: maxRetries + 1,
            observation: `[CRITIQUE ${attempt}] ${critique}`,
            kernelPass: `reflexion:critique-${attempt}`,
          });

          // ── Stagnation check: exit early if critique isn't changing ──
          if (isCritiqueStagnant(s.previousCritiques, critique)) {
            yield* emitLog({
              _tag: "warning",
              message: `Critique stagnant after ${attempt} attempts, exiting early`,
              context: "reflexion",
              timestamp: new Date(),
            });
            return terminateWith(s, { kind: "stagnant", detail: `after ${attempt} attempts` });
          }

          // ── Completion gate ─────────────────────────────────────────────────
          //
          // Gate A (always): the critique judges OUTPUT TEXT quality only — it
          // cannot see whether a required side-effect tool (e.g. file-write)
          // actually fired. A task that says "create a markdown file" produces a
          // good-looking summary the critique rubber-stamps as SATISFIED while the
          // file was never written. Never accept "satisfied" while a required tool
          // is still uncalled — force another improve pass to complete the action.
          // Scoped to non-empty requiredTools so no-required tasks are unchanged.
          const runEvidence = toolEvidence(yield* run.ledger()); // every pass's calls: a run-wide answer
          const missingRequiredTools = missingRequired(
            runEvidence,
            input.requiredTools ?? [],
          );

          // Delivery spine — the run contract's deliverables, judged by the ONE
          // shared strategy judge (D9; was a local deriveConditions + verifyDelivery)
          // IN ADDITION to the required-tools check above. Unconditional.
          let spineUnmet: readonly PostCondition[] = [];
          if (isSatisfied(critique)) {
            spineUnmet = judgeStrategyDelivery(runContract, { steps: s.allSideEffectSteps, output: s.response }).unmet;
            if (spineUnmet.length > 0) {
              yield* emitLog({
                _tag: "warning",
                message: `Critique reported SATISFIED but PostCondition spine has unmet conditions: ${describeUnmet(spineUnmet)} — forcing improve pass`,
                context: "reflexion",
                timestamp: new Date(),
              });
            }
          }

          // Phase 3: the coverage DECISION lives in the kernel terminal gate.
          // Reflexion semantics: uncapped redirect (every SATISFIED-with-missing
          // forces another improve pass; the outer maxRetries loop is the
          // bound), so redirectsSpent.coverage stays 0 — the exhaustion policy
          // is unreachable here by construction.
          const gateDecision = evaluateTerminalGate({
            terminatedBy: REFLEXION_SATISFIED,
            requiredTools: input.requiredTools ?? [],
            // Step 3c (09 §6.5) — the same run evidence `missingRequiredTools`
            // above reads, so the two answers cannot disagree.
            coveredTools: deriveRequirementEvidence(runEvidence, input.requiredTools ?? [])
              .coveredTools,
            hasSubstantiveGrounding: true,
            redirectsSpent: { grounding: 0, coverage: 0, checker: 0 },
            coverageExhaustionPolicy: "abstain",
            buildGroundingGuidance: () => "",
            buildCoverageGuidance: (missing) => missing.join(", "),
          });
          if (isSatisfied(critique) && gateDecision.decision === "accept" && spineUnmet.length === 0) {
            return terminateWith(s, { kind: "satisfied", detail: `after ${attempt} attempts` });
          }
          if (isSatisfied(critique) && gateDecision.decision === "redirect") {
            yield* emitLog({
              _tag: "warning",
              message: `Critique reported SATISFIED but required tools not yet called: ${missingRequiredTools.join(", ")} — forcing improve pass`,
              context: "reflexion",
              timestamp: new Date(),
            });
          }

          const updatedCritiques = [...s.previousCritiques, critique];

          yield* emitLog({ _tag: "phase_started", phase: "reflexion:improve", timestamp: new Date() });

          // ── Improve: generate a refined response (tool-aware via ReAct kernel) ──
          const improveDefaultFallback = input.systemPrompt
            ? `${input.systemPrompt}\n\nYour previous attempt had issues. Fix them by using the EXACT tool parameters from the task. Complete ALL required actions.`
            : buildSystemPrompt(input.taskDescription);

          const improveSystemPrompt = yield* compilePromptOrFallback(
            promptServiceOpt,
            "reasoning.reflexion-generate",
            { task: input.taskDescription },
            improveDefaultFallback,
          );

          const completedActions = buildCompletedActionsContext(s.lastKernelSteps);
          const improvementTask = buildImprovementTask(input, updatedCritiques, completedActions);
          const improvePriorContext = paramHints
            ? `⚠️ CRITICAL — use these EXACT values (do NOT substitute or guess):\n${paramHints}`
            : undefined;

          const blockedTools = extractSuccessfulSideEffectTools(s.allSideEffectSteps);

          // A paused improve pass ends the run inside `run.pass`.
          const improvePass = yield* run.pass(reactKernel, {
            ...buildKernelInput(crossCutting, {
              task: improvementTask,
              systemPrompt: improveSystemPrompt,
              priorContext: improvePriorContext,
              initialMessages: s.runningMessages,
              availableToolSchemas: capabilitySnapshot.availableToolSchemas,
              allToolSchemas: capabilitySnapshot.allToolSchemas,
              // GH #246: commanded temperature wins; unset keeps the 0.6 default.
              temperature: input.temperature ?? 0.6,
            }),
            ...(input.checklistGuidance ? { checklistGuidance: input.checklistGuidance } : {}),
            // Per-pass extra outside the cross-cutting/per-pass Picks; spread
            // AFTER the builder (not cross-cutting, so no drop risk).
            blockedTools,
          }, {
            maxIterations: input.config.strategies.reflexion?.kernelMaxIterations ?? 3,
            strategy: "reflexion",
            kernelType: "react",
            taskId: input.taskId,
            kernelPass: `reflexion:improve-${attempt}`,
            modelId: input.modelId,
            providerName: input.providerName,
            taskDescription: input.taskDescription,
            // GH #246: commanded temperature wins; unset keeps the 0.6 default.
            temperature: input.temperature ?? 0.6,
            // #40: arm the A2 long-horizon pace bands in improve sub-kernels.
            ...(input.horizonProfile ? { horizonProfile: input.horizonProfile } : {}),
          }, { record: "evidence", continues: true }); // same task: adopt the run contract and ledger

          const newResponse = improvePass.output || s.response;
          // Only replace critique evidence if improvement actually called tools.
          const newLastKernelSteps = improvePass.hadToolCalls ? improvePass.steps : s.lastKernelSteps;
          const newAllSideEffectSteps = [...s.allSideEffectSteps, ...improvePass.steps];

          yield* emitPhaseEnd({ emitLog, phase: "reflexion:improve", startedAt: start, totalTokens: run.spend().tokens });

          run.record(makeStep("thought", `[ATTEMPT ${attempt + 1}] ${newResponse}`));

          yield* publishReasoningStep(ebOpt, {
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "reflexion",
            strategy: "reflexion",
            step: run.steps().length,
            totalSteps: maxRetries + 1,
            thought: `[ATTEMPT ${attempt + 1}] ${newResponse}`,
            kernelPass: `reflexion:improve-${attempt}`,
          });

          return continueWith<ReflexionIterState>({
            response: newResponse,
            lastKernelSteps: newLastKernelSteps,
            allSideEffectSteps: newAllSideEffectSteps,
            runningMessages: improvePass.messages,
            previousCritiques: updatedCritiques,
            // The improve pass is the newest answering pass (the substrate
            // already joined its envelope into the run's worst-of cap).
            lastPass: improvePass,
          });
        }),
    });

    // ── Single finalize path — replaces 3 duplicated build-result branches ──
    // A durable pause never reaches here: it ended the run inside `run.pass`,
    // so the quality gate never burns a call on a pause sentinel.
    const { final, reason, iters } = loopResult;

    const gated = yield* enforceQualityGate({
      llm,
      taskDescription: input.taskDescription,
      output: final.response,
      toolData: collectToolData(final.runningMessages),
      ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
    });
    run.account({ tokens: gated.tokens, cost: gated.cost });

    if (reason.kind === "satisfied") {
      yield* emitLog({
        _tag: "log",
        level: "debug",
        source: "framework",
        message: `Reflexion completed successfully after ${iters} attempts`,
        timestamp: new Date(),
      });
      yield* publishReasoningStep(ebOpt, {
        _tag: "FinalAnswerProduced",
        taskId: input.taskId ?? "reflexion",
        strategy: "reflexion",
        answer: gated.output,
        iteration: iters,
        totalTokens: run.spend().tokens,
        kernelPass: `reflexion:improve-${iters}`,
      });
    } else if (reason.kind === "max-iters") {
      yield* emitLog({
        _tag: "log",
        level: "debug",
        source: "framework",
        message: `Reflexion reached max retries (${maxRetries}) without full satisfaction`,
        timestamp: new Date(),
      });
    }
    // stagnant path already emitted its own warning inside the step body.

    // The critique's SATISFIED verdict is reflexion's own authority: it may
    // downgrade (max-iters / stagnant -> partial). The substrate caps it under
    // the worst-of envelope of every pass, relays the answering pass's raw
    // terminatedBy and abstention, ties `final_answer` to a completed status,
    // and forwards the one run ledger (every pass's tool evidence included:
    // passes record evidence steps as they run).
    const satisfied = reason.kind === "satisfied";
    return {
      _tag: "Result" as const,
      output: gated.output,
      status: satisfied ? ("completed" as const) : ("partial" as const),
      basedOn: final.lastPass,
      // The answering sub-kernel's meta carries the durable rails and the
      // kernel verdict the mint reads.
      kernelMeta: final.lastPass.state.meta,
      extraMetadata: {
        confidence: satisfied ? Math.max(0.6, 1 - (iters / 3) * 0.3) : 0.4,
        reflexionCritiques: final.previousCritiques,
      },
    };
      }),
    );
  });

// ─── Private Helpers (reflexion-specific) ───

function buildSystemPrompt(taskDescription: string): string {
  return (
    `You are a task execution agent. Execute tasks exactly as specified.\n\n` +
    `CRITICAL RULES:\n` +
    `- Use the EXACT tool names and parameter values specified in the task.\n` +
    `- Do NOT substitute, guess, or hallucinate parameter values.\n` +
    `- Do NOT ask clarifying questions — all information is in the task.\n` +
    `- Complete ALL required actions (fetching data AND sending messages).\n` +
    `- Produce output directly — no offers, no "would you like me to...".\n\n` +
    `Task: ${taskDescription}`
  );
}

function buildGenerationPrompt(
  input: ReflexionInput,
  previousCritiques: string[] | null,
): string {
  const parts: string[] = [];

  // Extract any explicit tool call parameters from the task and highlight them
  const paramHints = extractToolParamHints(input.taskDescription);
  if (paramHints) {
    parts.push(`REQUIRED TOOL PARAMETERS (use these EXACT values):\n${paramHints}`);
  }

  parts.push(`TASK:\n${input.taskDescription}`);

  if (input.memoryContext) {
    parts.push(`CONTEXT:\n${input.memoryContext}`);
  }

  if (previousCritiques && previousCritiques.length > 0) {
    // Extract actionable fixes from critiques, not just the raw critique text
    const fixes = extractActionableFixes(previousCritiques);
    parts.push(
      `ISSUES FROM PREVIOUS ATTEMPTS (you MUST fix ALL of these):\n${fixes}`,
    );
  }

  parts.push(
    `Execute the task above step by step. Use the exact tool names and parameters specified.`,
  );

  return parts.join("\n\n");
}

/**
 * Extract explicit tool parameter hints from the task description.
 * Finds patterns like: tool_name(params), "owner: 'value'", "recipient 'value'"
 */
function extractToolParamHints(taskDescription: string): string | null {
  const hints: string[] = [];

  // Match patterns like: owner: 'tylerjrbuell', repo: 'reactive-agents-ts'
  const paramMatches = taskDescription.matchAll(
    /(\w+):\s*['"]([^'"]+)['"]/g,
  );
  for (const m of paramMatches) {
    hints.push(`  ${m[1]}: "${m[2]}"`);
  }

  // Match patterns like: tool/name with recipient '+12345'
  const toolWithArg = taskDescription.matchAll(
    /(\w+\/\w+)\s+with\s+(\w+)\s+['"]([^'"]+)['"]/g,
  );
  for (const m of toolWithArg) {
    hints.push(`  Tool: ${m[1]} → ${m[2]}: "${m[3]}"`);
  }

  return hints.length > 0 ? hints.join("\n") : null;
}

/**
 * Extract actionable fix instructions from critique text.
 * Turns verbose critique prose into concise bullet points.
 */
function extractActionableFixes(critiques: readonly string[]): string {
  const lastCritique = critiques[critiques.length - 1] ?? "";
  const fixes: string[] = [];

  // Look for "should" / "needs to" / "must" statements — these are actionable
  const actionLines = lastCritique
    .split("\n")
    .filter(
      (line) =>
        /\b(should|must|needs? to|required|missing|incorrect|wrong)\b/i.test(line) &&
        line.trim().length > 10,
    )
    .slice(0, 5);

  if (actionLines.length > 0) {
    fixes.push(...actionLines.map((l) => `- ${l.trim().replace(/^[-•*\d.)\s]+/, "")}`));
  } else {
    // Fallback: use the whole critique compacted
    fixes.push(buildCompactedCritiqueHistory(critiques));
  }

  return fixes.join("\n");
}

/**
 * Build a focused improvement task that tells the kernel what was already done
 * and focuses only on fixing the specific issues identified by the critique.
 */
function buildImprovementTask(
  input: ReflexionInput,
  previousCritiques: readonly string[],
  completedActions: string,
): string {
  const parts: string[] = [];

  if (completedActions) {
    parts.push(completedActions);
  }

  // Extract specific fixes needed
  const fixes = extractActionableFixes(previousCritiques);
  parts.push(`FIX THESE SPECIFIC ISSUES:\n${fixes}`);

  parts.push(`ORIGINAL TASK (for reference):\n${input.taskDescription}`);

  if (input.memoryContext) {
    parts.push(`CONTEXT:\n${input.memoryContext}`);
  }

  parts.push(
    `Focus ONLY on fixing the issues listed above. Do NOT re-execute actions that already succeeded.`,
  );

  return parts.join("\n\n");
}

/**
 * Build a summary of what was already accomplished from kernel steps.
 * Identifies side-effect tools (send/create/write) that should NOT be re-called.
 */
function buildCompletedActionsContext(steps?: readonly ReasoningStep[]): string {
  if (!steps || steps.length === 0) return "";

  const actions = steps.filter((s) => s.type === "action");
  const observations = steps.filter((s) => s.type === "observation");

  if (actions.length === 0) return "";

  const lines: string[] = ["ALREADY COMPLETED ACTIONS (do NOT repeat successful ones):"];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    // Check if the corresponding observation indicates success or error
    const obs = observations[i];
    const isError = obs && /\[Tool error/i.test(obs.content);
    const icon = isError ? "❌" : "✅";
    const content = action.content.length > 200
      ? action.content.slice(0, 200) + "..."
      : action.content;
    lines.push(`  ${icon} ${content}`);
  }

  // Identify side-effect tools that must NOT be called again
  const extractToolName = (step: ReasoningStep): string | undefined =>
    (step.metadata?.toolUsed as string | undefined)
    ?? step.content.match(/"tool"\s*:\s*"([^"]+)"/)?.[1]
    ?? step.content.match(/^(\S+)\(/)?.[1];

  const sideEffectActions = actions.filter((a) => {
    const toolName = extractToolName(a);
    return toolName != null && isSideEffectTool(toolName);
  });
  const successfulSideEffects = sideEffectActions.filter((a) => {
    const obs = observations[actions.indexOf(a)];
    return !obs || !/\[Tool error/i.test(obs.content);
  });

  if (successfulSideEffects.length > 0) {
    lines.push("\n⚠️ DO NOT call these tools again (they have side effects and already executed):");
    for (const t of successfulSideEffects) {
      const name = extractToolName(t);
      if (name) lines.push(`  - ${name}`);
    }
  }

  return lines.join("\n");
}

/**
 * Side-effect detection via word splitting (not regex \b which treats _ as word char).
 * Splits tool names on / _ - separators, then checks for side-effect verbs.
 */
const SIDE_EFFECT_WORDS = new Set([
  "send", "write", "create", "delete", "post", "push",
  "publish", "notify", "deploy", "upload", "remove", "update",
]);

function isSideEffectTool(toolName: string): boolean {
  const words = toolName.toLowerCase().split(/[/_\-]/);
  return words.some((w) => SIDE_EFFECT_WORDS.has(w));
}

function buildCritiquePrompt(
  taskDescription: string,
  response: string,
  depth: "shallow" | "deep",
  previousCritiques: readonly string[],
  executionSteps?: readonly ReasoningStep[],
): string {
  const deepInstructions =
    depth === "deep"
      ? "\n- Check for logical consistency and coherence\n- Identify any unsupported claims or assumptions"
      : "";

  const prevCritiqueNote =
    previousCritiques.length > 0
      ? `\n\nPrevious critiques identified these issues:\n${previousCritiques.map((c, i) => `${i + 1}. ${c}`).join("\n")}\nWere these fixed in the latest attempt?`
      : "";

  // Build execution evidence — this is the PRIMARY evaluation input
  const executionEvidence = buildExecutionEvidence(executionSteps);

  // Extract required params for comparison
  const paramHints = extractToolParamHints(taskDescription);
  const paramCheck = paramHints
    ? `\nREQUIRED PARAMETERS (from task):\n${paramHints}`
    : "";

  return `Evaluate whether this task was COMPLETED based on the execution evidence.

ORIGINAL TASK:
${taskDescription}

EXECUTION EVIDENCE (what tools were actually called):
${executionEvidence || "No tool calls recorded."}

AGENT'S TEXT RESPONSE:
${response}
${paramCheck}
EVALUATION RULES:
1. Focus on whether the REQUIRED ACTIONS were taken — not text formatting or style.
2. If tools with side effects (send, write, create) succeeded, those actions are DONE.
3. Only mark UNSATISFIED if a required action was MISSING or used clearly wrong parameters.
4. Do NOT invent requirements not stated in the original task.
5. Minor issues (e.g., fetching 5 items instead of 10) are worth noting but don't invalidate completed work.${deepInstructions}${prevCritiqueNote}

Your FIRST LINE must be exactly one of:
SATISFIED: <what was accomplished>
UNSATISFIED: <what specific required action was not completed>

If UNSATISFIED, list ONLY the specific fixes needed (one per line). Be actionable and concise.`;
}

/**
 * Build a structured execution evidence summary from kernel steps.
 * Pairs each tool call with its result so the critique can see what happened.
 */
function buildExecutionEvidence(steps?: readonly ReasoningStep[]): string {
  if (!steps || steps.length === 0) return "No execution steps recorded.";

  const actions = steps.filter((s) => s.type === "action");
  const observations = steps.filter((s) => s.type === "observation");

  if (actions.length === 0) return "No tool calls were made.";

  const evidence: string[] = [];

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i].content;
    const obs = observations[i]?.content ?? "no result recorded";
    const isError = /\[Tool error/i.test(obs);
    const icon = isError ? "❌" : "✅";
    const actionStr = action.length > 200 ? action.slice(0, 200) + "..." : action;
    const obsStr = obs.length > 150 ? obs.slice(0, 150) + "..." : obs;
    evidence.push(`${icon} ${actionStr}\n   → ${obsStr}`);
  }

  return evidence.join("\n");
}

/**
 * Extract tool names that have side effects AND succeeded in a prior kernel pass.
 * These tools are blocked from re-execution in improvement passes to prevent
 * duplicate sends, writes, creates, etc.
 */
function extractSuccessfulSideEffectTools(
  steps?: readonly ReasoningStep[],
): readonly string[] {
  if (!steps || steps.length === 0) return [];

  const actions = steps.filter((s) => s.type === "action");
  const observations = steps.filter((s) => s.type === "observation");
  const blocked = new Set<string>();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const obs = observations[i];
    const isError = obs && /\[Tool error/i.test(obs.content);
    if (isError) continue; // Only block tools that succeeded

    // Extract tool name from action content (JSON: {"tool":"name",...})
    const toolName = action.metadata?.toolUsed as string | undefined
      ?? action.content.match(/"tool"\s*:\s*"([^"]+)"/)?.[1];
    if (!toolName) continue;

    // Check if this tool has side effects
    if (isSideEffectTool(toolName)) {
      blocked.add(toolName);
    }
  }

  return [...blocked];
}

function buildCompactedCritiqueHistory(critiques: readonly string[]): string {
  if (critiques.length <= 3) {
    return critiques.map((c, i) => `${i + 1}. ${c}`).join("\n");
  }
  const older = critiques.slice(0, critiques.length - 3).map((_, i) => `${i + 1}. [addressed]`);
  const recent = critiques.slice(-3).map((c, i) => `${critiques.length - 2 + i}. ${c}`);
  return [...older, ...recent].join("\n");
}

