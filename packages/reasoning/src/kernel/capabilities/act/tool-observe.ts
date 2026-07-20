/**
 * tool-observe.ts — Canonical "execute one tool, observe the result" primitive.
 *
 * THE single way a single tool call is executed-and-observed in the reasoning
 * package. Wraps the existing `executeNativeToolCall` core plus every
 * cross-cutting observation capability (compress, fact-extract, build obs step,
 * emit ToolCall* events, emit Compose tags), each config-gated so callers opt
 * into exactly what they need:
 *   - kernel act single path: pipeline (compose) + errorRecovery + LLM-facts,
 *     pre-healed upstream, hooks emit ToolCall* events (NOT this primitive).
 *   - plan-execute tool_call: pipeline (compose) + heal-internally + preprocess
 *     (sanitize) + emitToolCallEvents; no LLM-facts, no verifier/memory.
 *
 * Verifier + semantic-memory are intentionally NOT here yet — see Phase E of
 * the canonical-tool-execution plan (they unify a pre-existing kernel
 * single/batch asymmetry as a separate, visible behavior change).
 */
import { Effect, Ref } from "effect";
import { ObservableLogger, type LogEvent } from "@reactive-agents/observability";
import { runHealingPipeline, type ToolCallSpec } from "@reactive-agents/tools";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import {
  emitToCompose,
  emitErrorSwallowed,
  errorTag,
  type HarnessPipeline,
  type KernelStateLike,
} from "@reactive-agents/core";
import { LLMService } from "@reactive-agents/llm-provider";
import { executeNativeToolCall, extractObservationFacts } from "./tool-execution.js";
import { makeStep } from "../sense/step-utils.js";
import { META_TOOLS } from "../../state/kernel-constants.js";
import { type RunLedger } from "../../ledger/run-ledger.js";
import { recordToolDispatch } from "../../ledger/emit.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { publishReasoningStep } from "../../utils/service-utils.js";
import type { StrategyServices } from "../../utils/service-utils.js";
import {
  contextFromObservation,
  type VerificationContext,
  type VerificationResult,
} from "../verify/verifier.js";
import type { ContextProfile } from "../../../context/context-profile.js";
import type { ReasoningStep } from "../../../types/index.js";
import type {
  MaybeService,
  MemoryServiceInstance,
  ToolServiceInstance,
} from "../../state/kernel-state.js";

/** Lightweight tool-schema shape accepted by the internal healing step. */
export interface ToolSchemaLite {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: string;
    readonly description?: string;
    readonly required?: boolean;
  }[];
}

export interface ToolObserveContext {
  readonly iteration: number;
  readonly phase: "act";
  readonly strategy: string;
  /** kernel: asKernelStateLike(state); plan-execute: synthetic minimal view. */
  readonly state: KernelStateLike;
  readonly callId: string;
  /** Set by callers that pre-heal upstream (kernel). When a `heal` config is
   *  supplied instead, the primitive computes this itself. */
  readonly healed?: boolean;
  /** The model's ACTUAL toolbox this turn (filtered prompt schemas). Recovery
   *  hints may only name tools present here — the registry also lists
   *  built-ins the schema withheld. Absent ⇒ hints name no tool. */
  readonly schemas?: readonly ToolSchemaLite[];
}

export interface ToolObserveHealConfig {
  readonly schemas: readonly ToolSchemaLite[];
  readonly fileToolNames: ReadonlySet<string>;
  readonly cwd: string;
}

export interface ToolObserveConfig {
  readonly compression?: ResultCompressionConfig;
  readonly profile?: ContextProfile;
  /** Present ⇒ compressed result auto-stored under its key; absent ⇒ no store. */
  readonly scratchpad?: Map<string, string>;
  /** plan-execute's sanitizeToolOutput, applied pre-normalize/compress. */
  readonly preprocess?: (raw: string) => string;
  /** Strip [STORED:]/recall() dead pointers from compressed display content. */
  readonly stripDeadStorageHints?: (content: string, toolName: string) => string;
  /** Run the LLM fact-extraction pass (kernel shouldExtract); off for plan-execute. */
  readonly extractFactsLLM?: boolean;
  /** Compose pipeline. Absent ⇒ tag emission is a no-op (obs step still built). */
  readonly pipeline?: HarnessPipeline;
  /** Adapter error-recovery (kernel binds adapter+missingTools; plan-execute omits). */
  readonly errorRecovery?: (toolName: string, errorContent: string) => string | undefined;
  /** Present ⇒ primitive heals internally + computes ctx.healed (plan-execute). */
  readonly heal?: ToolObserveHealConfig;
  /** Emit ToolCallStarted/Completed (plan-execute has no hooks; kernel keeps false). */
  readonly emitToolCallEvents?: boolean;
  readonly eventBus?: StrategyServices["eventBus"];
  readonly taskId?: string;
  readonly kernelPass?: string;
  readonly agentId?: string;
  readonly sessionId?: string;
  /** Caller's own emitLog (kernel + plan-execute share the same shape). When
   *  omitted the primitive resolves ObservableLogger itself. */
  readonly emitLog?: (event: LogEvent) => Effect.Effect<void, never>;
  /**
   * Phase E (E2) — when present WITH `verifierContext`, the primitive attaches a
   * structured `VerificationResult` to the obsStep metadata (mirrors the kernel
   * batch path). `verify()` is sync + pure (no LLM). Single path opts in only
   * under `RA_TOOL_OBSERVE_SYMMETRY=1`. Absent ⇒ no verification (byte-identical).
   */
  readonly verifier?: { readonly verify: (ctx: VerificationContext) => VerificationResult };
  /** Inputs the verifier consults — built from kernel state by the caller. */
  readonly verifierContext?: {
    readonly task: string;
    readonly priorSteps: readonly ReasoningStep[];
    readonly requiredTools?: readonly string[];
    readonly toolsUsed: ReadonlySet<string>;
  };
  /**
   * Phase E (E2) — when present, passed straight through to
   * `executeNativeToolCall` so successful tool results are forked into semantic
   * memory (it already forks a daemon store). Absent ⇒ no memory write.
   */
  readonly memoryService?: MaybeService<MemoryServiceInstance>;
  /**
   * Tool-policy enforcement (P0-4, a SAFETY gate). When either field is present
   * the primitive BLOCKS a violating tool BEFORE dispatch — returning a normal
   * `ToolObserveResult` with `success:false` and the blocked observation
   * (mirrors act.ts:378-392), never widening the `never` error channel. This is
   * THE single choke point every hand-rolled strategy (plan-execute / blueprint
   * / any inline caller) inherits, so a forbidden or hallucinated tool arriving
   * via a planned step can no longer execute. META_TOOLS always bypass.
   * BOTH absent ⇒ no policy check (byte-identical — the kernel act path enforces
   * upstream via `evaluateToolPolicy` and passes no policy here).
   */
  readonly allowedTools?: readonly string[];
  readonly forbiddenTools?: readonly string[];
  /**
   * RunLedger sink (C8). When present, the primitive appends the canonical
   * `tool-invocation` + `tool-result` ledger entries for THIS executed call —
   * byte-identical to what the kernel's `transitionState` step-projection mints
   * (the tool-result is derived from the built obsStep via `stepToEntries`) — so
   * plan-execute / blueprint get queryable tool-usage + deliverable receipts.
   * The kernel path passes NO sink (it already projects steps→ledger at the
   * transition chokepoint), so there is no double-mint. Absent ⇒ no ledger mint
   * (byte-identical).
   */
  readonly ledgerSink?: Ref.Ref<RunLedger>;
}

export interface ToolObserveResult {
  readonly obsStep: ReasoningStep;
  readonly content: string;
  /** Pre-compression, post-preprocess/normalize content. plan-execute synthesis
   *  renders the complete data here, not the compressed `content` preview. */
  readonly fullResult?: string;
  readonly success: boolean;
  readonly storedKey?: string;
  readonly delegatedToolsUsed?: readonly string[];
  readonly extractedFact?: string;
  readonly durationMs: number;
  readonly healed: boolean;
}

const defaultEmitLog = (event: LogEvent): Effect.Effect<void, never> =>
  Effect.serviceOption(ObservableLogger).pipe(
    Effect.flatMap((opt) =>
      opt._tag === "Some"
        ? opt.value
            .emit(event)
            .pipe(
              Effect.catchAll((err) =>
                emitErrorSwallowed({
                  site: "reasoning/src/kernel/capabilities/act/tool-observe.ts:emitLog",
                  tag: errorTag(err),
                }),
              ),
            )
        : Effect.void,
    ),
  );

// ─── Tool-policy gate (P0-4) — ONE decision shared by act.ts + the primitive ──

/** Allow/deny policy the tool-observe gate enforces. Both fields optional. */
export interface ToolPolicy {
  readonly allowedTools?: readonly string[];
  readonly forbiddenTools?: readonly string[];
}

/** A policy verdict: blocked (with the observation message) or permitted. */
export type ToolPolicyDecision =
  | { readonly blocked: true; readonly message: string }
  | { readonly blocked: false };

/**
 * Pure tool-policy decision (P0-4). The SINGLE gate the kernel act path and the
 * canonical primitive both delegate to — so there are not two independent
 * allow/deny implementations to drift (boundary-first). Rules:
 *   - META_TOOLS always pass (mirrors act.ts:367 unconditional bypass).
 *   - `forbiddenTools` (the contract deny-list) beats everything.
 *   - a non-empty `allowedTools` is a hard whitelist.
 * The `allowedTools` block message is BYTE-IDENTICAL to the legacy act.ts:375
 * text so the kernel path's observable behavior is unchanged.
 */
export function evaluateToolPolicy(toolName: string, policy: ToolPolicy): ToolPolicyDecision {
  if (META_TOOLS.has(toolName)) return { blocked: false };
  const forbidden = policy.forbiddenTools ?? [];
  if (forbidden.includes(toolName)) {
    return {
      blocked: true,
      message: `[Tool "${toolName}" is forbidden by contract — blocked.]`,
    };
  }
  const allowed = policy.allowedTools ?? [];
  if (allowed.length > 0 && !allowed.includes(toolName)) {
    return {
      blocked: true,
      message: `[Tool "${toolName}" is not in allowedTools — blocked. Allowed: ${allowed.join(", ")}]`,
    };
  }
  return { blocked: false };
}

export function executeToolAndObserve(
  toolService: MaybeService<ToolServiceInstance>,
  call: {
    readonly toolName: string;
    readonly args: Record<string, unknown>;
    readonly rationale?: { readonly why: string; readonly confidence?: number };
  },
  ctx: ToolObserveContext,
  config: ToolObserveConfig,
): Effect.Effect<ToolObserveResult, never, LLMService> {
  const emitLog = config.emitLog ?? defaultEmitLog;

  return Effect.gen(function* () {
    // ── 1. Heal (only when caller asked for internal healing) ────────────────
    let toolName = call.toolName;
    let args = call.args;
    let healed = ctx.healed ?? false;
    if (config.heal) {
      const rawTc: ToolCallSpec = { id: ctx.callId, name: call.toolName, arguments: call.args };
      const healResult = runHealingPipeline(
        rawTc,
        config.heal.schemas.map((s) => ({
          name: s.name,
          description: s.description,
          parameters: s.parameters.map((p) => ({
            name: p.name,
            type: p.type,
            description: p.description,
            required: p.required,
          })),
        })),
        config.heal.fileToolNames,
        config.heal.cwd,
        {},
        {},
      );
      if (healResult.succeeded) {
        const healedCall = healResult.call;
        healed = healedCall.name !== rawTc.name || healedCall.arguments !== rawTc.arguments;
        toolName = healedCall.name;
        args = (healedCall.arguments as Record<string, unknown>) ?? {};
      } else {
        // Unrepairable — surface the cause before the tool fails.
        yield* emitToCompose(config.pipeline, "nudge.healing-failure",
          `healing-pipeline could not repair call to "${call.toolName}" — no schema match in registry`,
          {
            iteration: ctx.iteration,
            phase: "act",
            state: ctx.state,
            strategy: ctx.strategy,
            trigger: "healing-failure",
            severity: "warn",
          },
        );
      }
    }

    // ── 1b. Tool-policy gate (P0-4) — THE single choke point ─────────────────
    // Enforce allowed/forbidden HERE so every caller inherits the same gate.
    // A block is NOT an error: return a normal failed ToolObserveResult carrying
    // the blocked observation (mirrors act.ts:378-392), keeping the `never`
    // error channel. Checked against the post-heal `toolName` (what would
    // actually run). The kernel act path blocks upstream via `evaluateToolPolicy`
    // and passes no policy, so a blocked tool never reaches here on that path.
    if (config.allowedTools !== undefined || config.forbiddenTools !== undefined) {
      const decision = evaluateToolPolicy(toolName, {
        ...(config.allowedTools !== undefined ? { allowedTools: config.allowedTools } : {}),
        ...(config.forbiddenTools !== undefined ? { forbiddenTools: config.forbiddenTools } : {}),
      });
      if (decision.blocked) {
        const obsStep = makeStep("observation", decision.message, {
          toolCallId: ctx.callId,
          observationResult: makeObservationResult(toolName, false, decision.message),
        });
        return {
          obsStep,
          content: decision.message,
          success: false,
          durationMs: 0,
          healed,
        } satisfies ToolObserveResult;
      }
    }

    // ── 2. ToolService unavailable → failed observation (parity with act.ts) ─
    if (toolService._tag === "None") {
      const content = `[Tool "${toolName}" requested but ToolService is not available]`;
      const obsStep = makeStep("observation", content, {
        toolCallId: ctx.callId,
        observationResult: makeObservationResult(toolName, false, content),
      });
      return {
        obsStep,
        content,
        success: false,
        durationMs: 0,
        healed,
      } satisfies ToolObserveResult;
    }

    // ── 3. Emit ToolCallStarted (plan-execute path only) ─────────────────────
    if (config.emitToolCallEvents && config.eventBus) {
      yield* publishReasoningStep(config.eventBus, {
        _tag: "ToolCallStarted",
        taskId: config.taskId ?? "reasoning",
        toolName,
        callId: ctx.callId,
        ...(call.rationale && call.rationale.why
          ? {
              rationale: {
                why: call.rationale.why,
                ...(typeof call.rationale.confidence === "number"
                  ? { confidence: call.rationale.confidence }
                  : {}),
              },
            }
          : {}),
        ...(config.kernelPass ? { kernelPass: config.kernelPass } : {}),
      });
    }

    // ── 4. Execute + observe (shared core) ───────────────────────────────────
    yield* emitLog({ _tag: "tool_call", tool: toolName, iteration: ctx.iteration, timestamp: new Date() });
    const startMs = Date.now();
    const exec = yield* executeNativeToolCall(
      toolService.value,
      { id: ctx.callId, name: toolName, arguments: args },
      config.agentId ?? "reasoning-agent",
      config.sessionId ?? "reasoning-session",
      {
        ...(config.compression ? { compression: config.compression } : {}),
        ...(config.scratchpad ? { scratchpad: config.scratchpad } : {}),
        ...(config.profile ? { profile: config.profile } : {}),
        ...(config.preprocess ? { preprocess: config.preprocess } : {}),
        ...(config.memoryService ? { memoryService: config.memoryService } : {}),
        // The model's ACTUAL toolbox this turn. A recovery hint may name a tool
        // only if it is here — the registry lists built-ins the schema withheld.
        // Absent schemas ⇒ empty set ⇒ hints name no tool, which is the safe
        // direction (see getRecoveryHint).
        exposedToolNames: new Set((ctx.schemas ?? []).map((s) => s.name)),
      },
    );
    const durationMs = Date.now() - startMs;
    yield* emitLog({
      _tag: "tool_result",
      tool: toolName,
      duration: durationMs,
      status: exec.success ? "success" : "error",
      ...(exec.success ? {} : { error: exec.content.slice(0, 120) }),
      timestamp: new Date(),
    });

    // ── 5. Emit ToolCallCompleted (plan-execute path only) ───────────────────
    if (config.emitToolCallEvents && config.eventBus) {
      yield* publishReasoningStep(config.eventBus, {
        _tag: "ToolCallCompleted",
        taskId: config.taskId ?? "reasoning",
        toolName,
        callId: ctx.callId,
        durationMs,
        success: exec.success,
        ...(config.kernelPass ? { kernelPass: config.kernelPass } : {}),
        args,
        ...(exec.success ? { result: exec.content } : { error: exec.content }),
      });
    }

    // ── 6. Error-recovery guidance (config-bound) ────────────────────────────
    let obsContent = exec.content;
    if (!exec.success && config.errorRecovery) {
      const recovery = config.errorRecovery(toolName, exec.content);
      if (recovery) obsContent = `${exec.content}\n\n[Recovery guidance: ${recovery}]`;
    }

    // ── 7. LLM fact extraction (kernel shouldExtract path) ───────────────────
    if (exec.success && config.extractFactsLLM) {
      const extracted = yield* extractObservationFacts(
        toolName,
        exec.content,
        args,
        config.compression?.budget ?? 800,
        config.taskId ? { taskId: config.taskId } : undefined,
      );
      if (extracted) obsContent = `[${toolName} result — key facts]\n${extracted}`;
    }

    // ── 8. strip dead storage hints (plan-execute display path) ──────────────
    const displayContent = config.stripDeadStorageHints
      ? config.stripDeadStorageHints(obsContent, toolName)
      : obsContent;

    // ── 9. Build the observation step — metadata guaranteed ──────────────────
    const obsResult = makeObservationResult(toolName, exec.success, displayContent, {
      ...(exec.delegatedToolsUsed ? { delegatedToolsUsed: exec.delegatedToolsUsed } : {}),
    });
    // Phase E (E2) — attach a structured VerificationResult when the caller
    // opted in (kernel single path under RA_TOOL_OBSERVE_SYMMETRY=1). Mirrors
    // the batch path's `defaultVerifier.verify(contextFromObservation(...))`.
    // verify() is sync + pure; no LLM call. Absent ⇒ undefined (byte-identical).
    const verification =
      config.verifier && config.verifierContext
        ? config.verifier.verify(
            contextFromObservation({
              observation: obsResult,
              task: config.verifierContext.task,
              priorSteps: config.verifierContext.priorSteps,
              ...(config.verifierContext.requiredTools
                ? { requiredTools: config.verifierContext.requiredTools }
                : {}),
              toolsUsed: config.verifierContext.toolsUsed,
            }),
          )
        : undefined;
    const obsStep = makeStep("observation", displayContent, {
      toolCallId: ctx.callId,
      ...(exec.storedKey ? { storedKey: exec.storedKey } : {}),
      ...(exec.extractedFact ? { extractedFact: exec.extractedFact } : {}),
      observationResult: obsResult,
      ...(verification ? { verification } : {}),
    });

    // ── 9b. RunLedger mint (C8) — config-gated sink ──────────────────────────
    // Append the canonical tool-invocation + tool-result pair for this executed
    // call. The tool-result is derived from `obsStep` via `stepToEntries`, so
    // preview / storedKey / extractedFact are IDENTICAL to the kernel's
    // transitionState projection. Only fires when a caller passes a sink; the
    // kernel passes none (it projects via transitionState → no double-mint).
    if (config.ledgerSink) {
      yield* Ref.update(config.ledgerSink, (led) =>
        recordToolDispatch(led, {
          toolName,
          args,
          toolCallId: ctx.callId,
          iteration: ctx.iteration,
          obsStep,
        }),
      );
    }

    // ── 10. Compose tags ─────────────────────────────────────────────────────
    yield* emitToCompose(config.pipeline, "observation.tool-result", obsStep, {
      iteration: ctx.iteration,
      phase: "act",
      state: ctx.state,
      strategy: ctx.strategy,
      toolName,
      callId: ctx.callId,
      healed,
      durationMs,
    });
    if (!exec.success) {
      yield* emitToCompose(config.pipeline, "lifecycle.failure", {
        reason: "tool-error",
        errorMessage: exec.content,
        attemptNumber: ctx.iteration,
        failureStreak: 1,
        currentStrategy: ctx.strategy,
      }, {
        iteration: ctx.iteration,
        phase: "act",
        state: ctx.state,
        strategy: ctx.strategy,
      });
    }

    return {
      obsStep,
      content: displayContent,
      ...(exec.fullContent !== undefined ? { fullResult: exec.fullContent } : {}),
      success: exec.success,
      ...(exec.storedKey ? { storedKey: exec.storedKey } : {}),
      ...(exec.delegatedToolsUsed ? { delegatedToolsUsed: exec.delegatedToolsUsed } : {}),
      ...(exec.extractedFact ? { extractedFact: exec.extractedFact } : {}),
      durationMs,
      healed,
    } satisfies ToolObserveResult;
  });
}
