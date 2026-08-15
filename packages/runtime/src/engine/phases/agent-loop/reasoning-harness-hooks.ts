/**
 * Reasoning-path post-think harness hooks.
 *
 * Mirror of the inline-path harness hooks (inline-harness-hooks.ts) but routes
 * through ReasoningService.execute(). Implements:
 *   - withCustomTermination
 *   - withMinIterations
 *   - withVerificationStep ("reflect" mode)
 *   - withOutputValidator
 *
 * Extracted from `execution-engine.ts:1352-1600` (W23 step 6a-3) to shrink the
 * engine module without changing behavior.
 *
 * Behavior preserved verbatim — error sites
 * (`runtime/src/execution-engine.ts:NNNN`) are intentionally retained for
 * log/diagnostic compatibility with reasoning-path test files.
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { Task } from "@reactive-agents/core";
import type { ModelCalibration } from "@reactive-agents/llm-provider";
import { resolveSynthesisConfigForStrategy } from "../../../synthesis-resolve.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import type { ObsLike } from "../../runtime-context.js";
import {
  briefResolvedSkillsFromMetadata,
  extractTaskText,
  isEnforcedAbstention,
  normalizeReasoningResult,
} from "../../util.js";
import { asExecutionContextEffect } from "./as-execution-context-effect.js";
import type { ReasoningServiceLike } from "../../types-reasoning.js";
import { buildRunEnvelopeFromConfig } from "../../run-envelope-config.js";
import { absorbedLedgerMetadata } from "../../run-ledger-scope.js";

/** Parameter shape accepted by ReasoningService.execute(). */
type ReasoningExecuteRequest = Parameters<ReasoningServiceLike["execute"]>[0];

type ToolSchemaShape = NonNullable<ReasoningExecuteRequest["availableToolSchemas"]>[number];

export interface ReasoningHarnessHooksDeps {
  readonly config: ReactiveAgentsConfig;
  readonly task: Task;
  readonly cacheHit: boolean;
  readonly reasoningOpt:
    | { readonly _tag: "Some"; readonly value: ReasoningServiceLike }
    | { readonly _tag: "None" };
  readonly availableToolNames: readonly string[];
  readonly availableToolSchemas: readonly ToolSchemaShape[];
  readonly allToolSchemas: readonly ToolSchemaShape[];
  readonly effectiveRequiredTools: readonly string[] | undefined;
  readonly effectiveRequiredToolQuantities: Readonly<Record<string, number>> | undefined;
  readonly classifiedRelevantTools: readonly string[] | undefined;
  readonly autoMaxCallsPerTool: Record<string, number>;
  readonly taskCategory: string;
  readonly resolvedCalibration: ModelCalibration | undefined;
  readonly obs: ObsLike | null;
}

export const runReasoningHarnessHooks = (
  initialCtx: ExecutionContext,
  deps: ReasoningHarnessHooksDeps,
): Effect.Effect<ExecutionContext, never> => {
  const {
    config,
    task,
    cacheHit,
    reasoningOpt,
    availableToolNames,
    availableToolSchemas,
    allToolSchemas,
    effectiveRequiredTools,
    effectiveRequiredToolQuantities,
    classifiedRelevantTools,
    autoMaxCallsPerTool,
    taskCategory,
    resolvedCalibration,
    obs,
  } = deps;

  return asExecutionContextEffect(Effect.gen(function* () {
    let ctx = initialCtx;

    // Cross-cutting cascade (2026-07-22) — the run-wide envelope for the
    // continuation passes below, built through the ONE config→envelope mapper
    // (review I3), so a `.withApprovalPolicy()` / `.withContract()` /
    // `.withGrounding()` / `.withFabricationGuard()` / `.withStallPolicy()` run
    // keeps its harness when a hook re-runs reasoning. Before this,
    // `withCustomTermination` / `withMinIterations` retries ran with the
    // approval gate DISARMED — a `requiresApproval` tool could execute
    // unattended on a continuation.
    //
    // The two resume rails (`approvalDecision` / `interactionResponse`) are
    // deliberately absent — see `RunEnvelopeExtras`.
    //
    // `auxiliaryPass: true` (review C1) — a continuation REFINES an answer an
    // earlier pass already produced and grounded; it commonly re-states prose
    // without re-calling the tool. Its `steps` therefore hold no required-tool
    // evidence even on a perfectly grounded run, and judging it as the run's
    // terminal made `.withFabricationGuard("block")` + required tools +
    // `.withMinIterations()` / `.withCustomTermination()` /
    // `.withOutputValidator()` replace a good answer with the abstention
    // sentinel. The FIRST pass is the terminal, and it is judged as one.
    const continuationEnvelope = buildRunEnvelopeFromConfig(config, {
      auxiliaryPass: true,
    });

    // Common request builder for the three "continue working" style hooks.
    const buildExecuteRequest = (
      initialMessages: readonly { readonly role: "user" | "assistant"; readonly content: string }[],
    ): ReasoningExecuteRequest => {
      const request = {
      taskDescription: extractTaskText(task.input),
      taskType: task.type,
      memoryContext: String((ctx.metadata as Record<string, unknown>)?.semanticContext ?? ""),
      availableTools: availableToolNames,
      availableToolSchemas,
      allToolSchemas,
      strategy: (ctx.selectedStrategy ?? "reactive") as ReasoningExecuteRequest["strategy"],
      contextProfile: config.contextProfile,
      providerName: String(config.provider ?? ""),
      systemPrompt: config.systemPrompt,
      taskId: ctx.taskId,
      resultCompression: config.resultCompression,
      agentId: config.agentId,
      sessionId: ctx.taskId,
      requiredTools: effectiveRequiredTools,
      requiredToolQuantities: effectiveRequiredToolQuantities,
      relevantTools: classifiedRelevantTools,
      // Same consumer-intent floor the main dispatch path passes (see
      // reasoning-think.ts) — kept in sync so both entry points give the kernel
      // the same visibility guarantee.
      builtinFloorTools: Array.isArray(config.builtins) ? config.builtins : undefined,
      maxCallsPerTool: Object.keys(autoMaxCallsPerTool).length > 0 ? autoMaxCallsPerTool : undefined,
      maxRequiredToolRetries: config.requiredTools?.maxRetries,
      modelId: String(config.defaultModel ?? ""),
      taskCategory,
      metaTools: config.metaTools,
      briefResolvedSkills: briefResolvedSkillsFromMetadata(
        ctx.metadata as Record<string, unknown>,
      ),
      initialMessages,
      synthesisConfig: resolveSynthesisConfigForStrategy(
        config.reasoningOptions,
        ctx.selectedStrategy ?? "reactive",
        config.synthesisConfig,
      ),
      observationSummary: config.reasoningOptions?.observationSummary,
      auditRationale: config.reasoningOptions?.auditRationale,
      calibration: resolvedCalibration,
      harnessPipeline: config.harnessPipeline,
      envelope: continuationEnvelope,
      };
      return request as unknown as ReasoningExecuteRequest;
    };

    // withCustomTermination: re-run reasoning if predicate not satisfied
    if (config.customTermination && !cacheHit && reasoningOpt._tag === "Some") {
      const MAX_CUSTOM_RETRIES = 3;
      let customRetries = 0;
      while (customRetries < MAX_CUSTOM_RETRIES) {
        // Review C1 mirror: never "continue working" past an ENFORCED honest
        // abstention — the continuation is fenced from enforcement, so its
        // ungrounded prose would silently replace the sentinel the terminal
        // pass produced.
        if (isEnforcedAbstention(ctx.metadata.reasoningResult)) break;
        const currentOutput = String(ctx.metadata.lastResponse ?? "");
        if ((config.customTermination as (s: { output: string }) => boolean)({ output: currentOutput })) break;
        customRetries++;
        const retryOutcome = yield* Effect.exit(
          reasoningOpt.value.execute(buildExecuteRequest([
            { role: "user" as const, content: extractTaskText(task.input) },
            { role: "assistant" as const, content: currentOutput },
            { role: "user" as const, content: "Continue working towards the goal." },
          ])),
        );
        if (retryOutcome._tag === "Success") {
          const retryResult = normalizeReasoningResult(retryOutcome.value);
          if (!retryResult) break;
          ctx = {
            ...ctx,
            cost: ctx.cost + (retryResult.metadata.cost ?? 0),
            tokensUsed: ctx.tokensUsed + (retryResult.metadata.tokensUsed ?? 0),
            metadata: {
              ...ctx.metadata,
              lastResponse: String(retryResult.output ?? ""),
              reasoningResult: retryResult,
              ...absorbedLedgerMetadata(ctx.metadata, retryResult, "continuation"),
            },
          };
        } else {
          break;
        }
      }
    }

    // withMinIterations: re-run until the required floor is reached.
    // Loop (not a lone `if`): a single continuation only ever yields 2 total
    // passes regardless of minIterations. Each continuation counts as one more
    // iteration; iterationsDone strictly increases so the loop terminates, and
    // a failed / un-normalizable continuation breaks early.
    if (config.minIterations && !cacheHit && reasoningOpt._tag === "Some") {
      let iterationsDone = ctx.iteration - 1;
      while (iterationsDone < config.minIterations) {
        // Review C1 mirror — see withCustomTermination above.
        if (isEnforcedAbstention(ctx.metadata.reasoningResult)) break;
        const continuationOutcome = yield* Effect.exit(
          reasoningOpt.value.execute(buildExecuteRequest([
            { role: "user" as const, content: extractTaskText(task.input) },
            { role: "assistant" as const, content: String(ctx.metadata.lastResponse ?? "") },
            { role: "user" as const, content: "Continue — ensure thoroughness before finalizing." },
          ])),
        );
        if (continuationOutcome._tag !== "Success") break;
        const contResult = normalizeReasoningResult(continuationOutcome.value);
        if (!contResult) break;
        ctx = {
          ...ctx,
          cost: ctx.cost + (contResult.metadata.cost ?? 0),
          tokensUsed: ctx.tokensUsed + (contResult.metadata.tokensUsed ?? 0),
          metadata: {
            ...ctx.metadata,
            lastResponse: String(contResult.output ?? ""),
            reasoningResult: contResult,
            ...absorbedLedgerMetadata(ctx.metadata, contResult, "continuation"),
          },
        };
        iterationsDone++;
      }
    }

    // withVerificationStep (reflect mode): one extra LLM call to confirm
    // completeness; on a REVISE verdict, re-run once with the feedback injected.
    if (config.verificationStep?.mode === "reflect" && !cacheHit && reasoningOpt._tag === "Some") {
      const outputToVerify = String(ctx.metadata.lastResponse ?? "");
      // Review C1 mirror — an honest abstention is not an output to "revise".
      if (outputToVerify && !isEnforcedAbstention(ctx.metadata.reasoningResult)) {
        const verifyPrompt = config.verificationStep.prompt ??
          `Review this output against the task: "${extractTaskText(task.input).slice(0, 300)}"\n\nOutput:\n${outputToVerify.slice(0, 1500)}\n\nRespond PASS if the output fully addresses the task, or REVISE: [specific gap] if not.`;
        // Cross-cutting cascade (2026-07-22) — DELIBERATE EXEMPTION: this pass
        // gets NO `envelope`. It is a JUDGE call, not a continuation: its
        // "task" is `verifyPrompt` and its output is a PASS / REVISE verdict
        // that never ships as the user's deliverable. The reason that carries
        // the exemption is `taskContract`: applying the run's deliverable
        // requirements (`mustInclude`, `format`, tool coverage) to a verdict
        // string judges the wrong artifact and produces coverage redirects on
        // a pass that has no deliverable to cover. `availableTools: []` makes
        // the approval gate moot here.
        //
        // KNOWN SIDE EFFECT of this exemption: `.withFabricationGuard("warn")`
        // / `("off")` is honored on the think, continuation and retry passes
        // but NOT here — the guard resolves to its always-on "block" default
        // on this pass. (Wiring the envelope would LOOSEN the check, not
        // tighten it; `resolveFabricationGuardMode` defaults to "block"
        // regardless.) The numeric grounding guard is not a factor either way:
        // its corpus is built only from observation steps, and a tool-less
        // judge pass has none, so check 5 is skipped whether wired or not.
        //
        // The REVISE re-run below DOES carry the envelope via
        // `buildExecuteRequest` — the deliverable-producing pass is covered.
        // Do not "fix" by wiring the envelope here; the taskContract reason
        // above is the one that matters.
        const verifyOutcome = yield* Effect.exit(
          // ENVELOPE-EXEMPT: judge pass — see the block comment above. The
          // marker is what `scripts/check-cross-cutting.sh` check 4 reads; an
          // execute request with neither an `envelope` nor this marker fails CI.
          reasoningOpt.value.execute({
            taskDescription: verifyPrompt,
            taskType: "analysis",
            memoryContext: "",
            availableTools: [],
            strategy: "reactive",
            contextProfile: config.contextProfile,
            providerName: String(config.provider ?? ""),
            systemPrompt: undefined,
            taskId: ctx.taskId,
            agentId: config.agentId,
            sessionId: ctx.taskId,
            modelId: String(config.defaultModel ?? ""),
            taskCategory,
            initialMessages: [{ role: "user" as const, content: verifyPrompt }],
            synthesisConfig: undefined,
          }),
        );
        if (verifyOutcome._tag === "Success") {
          const v = verifyOutcome.value as { output?: unknown; metadata: { cost?: number; tokensUsed?: number } };
          const verifyContent = String(v.output ?? "");
          const needsRevision = verifyContent.startsWith("REVISE");
          ctx = {
            ...ctx,
            cost: ctx.cost + (v.metadata.cost ?? 0),
            tokensUsed: ctx.tokensUsed + (v.metadata.tokensUsed ?? 0),
            metadata: {
              ...ctx.metadata,
              ...(needsRevision ? { verificationFeedback: verifyContent } : {}),
            },
          };
          // WIRE (P0-8): a REVISE verdict is not just recorded — it feeds back as
          // a continuation signal. Re-run once with the verification feedback
          // injected so the final answer actually addresses the gap the verify
          // pass found. Without this consumer the extra LLM call (and the user's
          // tokens) would change nothing.
          if (needsRevision) {
            const req = buildExecuteRequest([
              { role: "user" as const, content: extractTaskText(task.input) },
              { role: "assistant" as const, content: outputToVerify },
              { role: "user" as const, content: verifyContent },
            ]);
            delete (req as Record<string, unknown>).calibration;
            const reviseOutcome = yield* Effect.exit(reasoningOpt.value.execute(req));
            if (reviseOutcome._tag === "Success") {
              const revised = normalizeReasoningResult(reviseOutcome.value);
              if (revised) {
                ctx = {
                  ...ctx,
                  cost: ctx.cost + (revised.metadata.cost ?? 0),
                  tokensUsed: ctx.tokensUsed + (revised.metadata.tokensUsed ?? 0),
                  metadata: {
                    ...ctx.metadata,
                    lastResponse: String(revised.output ?? ""),
                    reasoningResult: revised,
                    ...absorbedLedgerMetadata(ctx.metadata, revised, "continuation"),
                  },
                };
              }
            }
          }
        }
      }
    }

    // withOutputValidator: validate output, retry with injected feedback on failure
    if (config.outputValidator && !cacheHit && reasoningOpt._tag === "Some") {
      const maxRetries = (config.outputValidatorOptions?.maxRetries ?? 2);
      let validatorRetries = 0;
      while (validatorRetries < maxRetries) {
        // Review C1 mirror — see withCustomTermination above.
        if (isEnforcedAbstention(ctx.metadata.reasoningResult)) break;
        const currentOutput = String(ctx.metadata.lastResponse ?? "");
        const validation = (config.outputValidator as (o: string) => { valid: boolean; feedback?: string })(currentOutput);
        if (validation.valid) break;
        validatorRetries++;
        const feedback = validation.feedback ?? "The previous response did not meet requirements. Please revise.";
        const req = buildExecuteRequest([
          { role: "user" as const, content: extractTaskText(task.input) },
          { role: "assistant" as const, content: currentOutput },
          { role: "user" as const, content: feedback },
        ]);
        // Output-validator path historically omits `calibration` from the request.
        delete (req as Record<string, unknown>).calibration;
        const retryOutcome = yield* Effect.exit(reasoningOpt.value.execute(req));
        if (retryOutcome._tag === "Success") {
          const retryResult = normalizeReasoningResult(retryOutcome.value);
          if (!retryResult) break;
          ctx = {
            ...ctx,
            cost: ctx.cost + (retryResult.metadata.cost ?? 0),
            tokensUsed: ctx.tokensUsed + (retryResult.metadata.tokensUsed ?? 0),
            metadata: {
              ...ctx.metadata,
              lastResponse: String(retryResult.output ?? ""),
              reasoningResult: retryResult,
              ...absorbedLedgerMetadata(ctx.metadata, retryResult, "continuation"),
            },
          };
        } else {
          break;
        }
      }
    }

    return ctx;
  }));
};
