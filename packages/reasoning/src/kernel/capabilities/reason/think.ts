/**
 * Think phase — calls the LLM and understands what it decided to do.
 *
 * Extracted verbatim from react-kernel.ts. Handles:
 * - Dynamic final-answer tool injection
 * - Harness skill injection
 * - System prompt + context assembly (static + guidance sections)
 * - LLM stream consumption with text delta emission
 * - Native FC tool call parsing + required-tool gating
 * - Termination oracle evaluation
 * - Fast-path trivial task exit
 */
import { Effect, Stream, FiberRef, Either, Ref } from "effect";
import { discoveredToolsStoreRef } from "@reactive-agents/tools";
import { ExecutionError } from "../../../errors/errors.js";
import { LLMService, selectAdapter } from "@reactive-agents/llm-provider";
import { gatewayStream } from "../../llm-gateway.js";
import { downshiftBudgetBand } from "../../assessment/pace-actions.js";
import type { StopReason } from "@reactive-agents/llm-provider";
import {
  toProviderMessage,
  sanitizeToolName,
  buildSanitizedReverseMap,
} from "../attend/context-utils.js";
import { resolveToolSurface } from "./tool-surface.js";
import { forbiddenTools } from "../../contract/run-contract.js";
import { emitToolSurfaceResolved, emitProjectionRendered } from "../../utils/diagnostics.js";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import { project } from "../../../assembly/project.js";
import { fromKernelState } from "../../../assembly/from-kernel-state.js";
import type { ContextProfile } from "../../../context/context-profile.js";
import type { Projection } from "../../../assembly/project.js";
import { toLLMMessages } from "../../../assembly/to-llm-messages.js";
import { recordCompactionMarker, recordCompactionNoShrink } from "../../ledger/emit.js";
import { StreamingTextCallback } from "@reactive-agents/core";
import {
  finalAnswerTool,
  shouldShowFinalAnswer,
  parseRationaleBlocks,
  stripRationaleBlocks,
  requestUserInputTool,
  type ToolCallSpec,
  type ResolverInput,
} from "@reactive-agents/tools";
import {
  guardRequiredToolsBlock,
  guardPrematureFinalAnswer,
  guardCompletionGaps,
  guardQualityCheck,
  guardDiminishingReturns,
  guardEvidenceGrounding,
  filterRecallByOverflow,
  recallGateEnabled,
} from "./think-guards.js";

import type { ToolSchema } from "../attend/tool-formatting.js";
import {
  hasFinalAnswer,
  extractFinalAnswer,
  stripPreamble,
} from "../../utils/tool-parsing.js";
import {
  gateNativeToolCallsForRequiredTools,
  shouldInjectDriverInstructions,
} from "../decide/tool-gating.js";
import {
  buildSuccessfulToolCallCounts,
  getMissingRequiredToolsFromSteps,
} from "../verify/requirement-state.js";
import {
  evaluateTermination,
  defaultEvaluators,
  arbitrateAndApply,
  arbitrationContextFromState,
  type TerminationContext,
} from "../decide/arbitrator.js";
import { assembleOutput } from "../../../kernel/loop/output-assembly.js";
import { resolveHorizonProfile } from "../../../kernel/loop/runner-helpers/horizon-profile.js";
import { terminate } from "../../../kernel/loop/terminate.js";
import { extractThinking, rescueFromThinking } from "../../utils/stream-parser.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import {
  transitionState,
  asKernelStateLike,
  type KernelState,
  type KernelContext,
  type KernelMessage,
} from "../../../kernel/state/kernel-state.js";
import { buildGuidanceText, type GuidanceContext } from "../../../context/guidance.js";

import { META_TOOLS as META_TOOL_SET } from "../../../kernel/state/kernel-constants.js";
import { emitErrorSwallowed, errorTag, sentinelDeliverable } from "@reactive-agents/core";
import { ABSTAIN_TOOL_NAME } from "../act/meta-tool-handlers.js";
import { shouldOfferAbstain } from "./abstain-gate.js";
import { explainProviderError } from "./provider-error-explain.js";
import { surfaceAssumptions } from "./assumption-surfacing.js";
import { checkAbstentionLegitimacy } from "../verify/abstention-legitimacy.js";

/** Per-tier context pressure thresholds — local models get narrowed earlier. */
export const CONTEXT_PRESSURE_THRESHOLDS: Record<string, number> = {
  local: 0.80,
  mid: 0.85,
  large: 0.90,
  frontier: 0.95,
};

/** Returns true when token pressure is critical — only final-answer should be offered. */
export function shouldNarrowToFinalAnswerOnly(opts: {
  estimatedTokens: number
  maxTokens: number
  tier?: string
}): boolean {
  const threshold = CONTEXT_PRESSURE_THRESHOLDS[opts.tier ?? "mid"] ?? 0.85;
  return opts.estimatedTokens / opts.maxTokens >= threshold
}

/**
 * Heuristic: does this thought look like a model's actual answer (vs. an
 * intermediate planning thought)? Used to auto-promote substantive thoughts
 * to final-answer when the model produces a complete response but never
 * calls the final-answer tool — common pattern on local models.
 *
 * Conservative — false negatives (treat real answer as planning) just
 * keep the loop going, costing one extra iteration. False positives (treat
 * planning as answer) are caught by the arbitrator's grounding check.
 */
// computePromptSchemas moved to tool-surface.ts (Overhaul Phase 2) — the
// resolver composes it with the pressure and gate-narrow stages. Re-exported
// here so existing consumers/tests keep their import path.
export { computePromptSchemas } from "./tool-surface.js";

export function looksLikeFinalAnswer(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 100) return false;

  // Strong negative signals — these are planning patterns, not answers.
  // Use word-boundary matches so the heuristic doesn't fire on substring
  // mentions like "I should explain..." in a real answer.
  const planningPatterns = [
    /\b(?:i (?:should|need to|will|am going to|'ll|'m going to) (?:call|use|invoke|fetch|search|look up|check)\b)/i,
    /\b(?:let me (?:call|use|invoke|fetch|try|check|verify|search)\b)/i,
    /\bnext (?:step|i'll|i will|i should)\b/i,
    /\b(?:i (?:don't|do not) have (?:enough|the)) (?:information|data|context)\b/i,
    /^(?:thinking|reasoning|planning|analysis)\b/i,
  ];
  if (planningPatterns.some((re) => re.test(trimmed))) return false;

  // Positive signals — structural indicators that this IS the answer.
  const positiveSignals = [
    /^#{1,3}\s+\w/m,                          // markdown header at line start
    /^\s*\d+\.\s+\w/m,                         // numbered list
    /^\s*[-*]\s+\w/m,                          // bulleted list
    /^\s*\|.+\|/m,                             // markdown table row
    /```/,                                     // code block
    /\b(?:final answer|in (?:summary|conclusion)|here (?:is|are)|the (?:result|answer|output) is)\b/i,
  ];
  return positiveSignals.some((re) => re.test(trimmed));
}

/**
 * Assemble the think-phase ProviderRequest via the canonical project() seam.
 *
 * The system-prompt tool reference (buildToolReference / buildRules, rendered
 * inside systemPromptStage) MUST display the SAME sanitized tool name that the
 * native-FC tools array carries. Outbound, the FC array sanitizes canonical MCP
 * names (e.g. `github/list_commits` → `github_list_commits`, see the llmTools
 * map in handleThinking) to satisfy the provider name regex. If the prompt text
 * instead shows the raw slash name, weak models (qwen3:14b BENCH N=5: 0/5
 * emission on the slash name, 5/5 on the underscore) read the slash name, emit a
 * <rationale> citing it, then emit NO native call for the underscore FC name →
 * empty turn → loop to max_iterations. Fix = the prompt shows the sanitized name.
 *
 * Display-only: the canonical `promptSchemas` are mapped to fresh spread copies
 * with sanitized names ONLY for the project() `{ schemas }` arg. The caller still
 * feeds the untouched surface (resolveToolSurface's callable set) to the FC
 * array, and the inbound de-sanitization map is built from the canonical
 * schemas — so FC names and registry lookup are byte-identical to before.
 */
export function buildThinkProviderRequest(
  state: KernelState,
  profile: ContextProfile,
  systemPrompt: string,
  promptSchemas: readonly ToolSchema[],
  task: string,
  /** H1: KernelInput.priorContext — rendered by systemPromptStage (03-F1). */
  priorContext?: string,
): Projection {
  const displaySchemas = promptSchemas.map((ts) => ({
    ...ts,
    name: sanitizeToolName(ts.name),
  }));
  return project(
    fromKernelState(state, profile, { system: systemPrompt }, { schemas: displaySchemas }, task, priorContext),
  );
}

export function handleThinking(
  state: KernelState,
  context: KernelContext,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;
    const { input, profile, hooks } = context;
    const strategy = state.strategy;
    const temp = input.temperature ?? profile.temperature ?? 0.7;

    const maxIter = (state.meta.maxIterations as number) ?? 10;

    // ── Dynamic meta-tool injection (final-answer) ───────────────────────────
    // When all required tools have been called and the agent is ready to complete,
    // inject the final-answer tool into the available tool schemas so the LLM
    // can discover and use it as the preferred termination mechanism.
    const hasNonMetaToolCalledForThink = [...state.toolsUsed].some(
      (t) => t !== "final-answer" && t !== "task-complete" && t !== "context-status" && t !== "brief" && t !== "pulse" && t !== "find" && t !== "recall",
    );
    // When no required tools are specified, scratchpad usage alone satisfies the
    // "has done real work" condition — matches the hard gate logic at line ~680.
    const hasAnyToolWork = hasNonMetaToolCalledForThink
      || ((input.requiredTools ?? []).length === 0 && state.toolsUsed.size > 0);
    const hasErrorsForThink = state.steps.some(
      (s) => s.type === "observation" && s.metadata?.observationResult?.success === false,
    );
    const finalAnswerVisible = shouldShowFinalAnswer({
      requiredToolsCalled: state.toolsUsed,
      requiredTools: [...(input.requiredTools ?? [])],
      iteration: state.iteration,
      hasErrors: hasErrorsForThink,
      hasNonMetaToolCalled: hasAnyToolWork,
    });

    // O3: abstain tool schema — offered only when metaTools.abstain === true.
    // Do NOT offer at iteration 0; the model should attempt the task first.
    const abstainToolSchema: ToolSchema = {
      name: ABSTAIN_TOOL_NAME,
      description:
        "Decline to answer when you cannot ground a response in available evidence or a " +
        "required tool/input is unavailable. State the reason and what was missing. " +
        "Do NOT use this to skip work you can still attempt.",
      parameters: [
        { name: "reason", type: "string", description: "Why you cannot answer", required: true },
        {
          name: "missing",
          type: "array",
          description: "Tool names or inputs that were needed but unavailable (e.g. 'tool:web-search')",
          required: false,
          items: { type: "string" },
        },
      ],
    };

    const augmentedToolSchemas: readonly ToolSchema[] = [
      ...(input.availableToolSchemas ?? []),
      ...(finalAnswerVisible ? [{ name: finalAnswerTool.name, description: finalAnswerTool.description, parameters: finalAnswerTool.parameters }] : []),
      ...(shouldOfferAbstain({
        enabled: input.metaTools?.abstain === true,
        iteration: state.iteration,
        requiredToolUnavailable: false,
        toolsAttempted: state.toolsUsed.size,
      }) ? [abstainToolSchema] : []),
      // Agentic-UI (Task 9): offer request_user_input whenever
      // metaTools.userInteraction === true. Unlike abstain there is NO
      // iteration gate — the model may ask for human input on iteration 0.
      ...(input.metaTools?.userInteraction === true
        ? [{ name: requestUserInputTool.name, description: requestUserInputTool.description, parameters: requestUserInputTool.parameters }]
        : []),
    ] as readonly ToolSchema[];

    // ── Context pressure hard gate ───────────────────────────────────────────
    // When token budget is exhausted beyond the tier-specific threshold, the
    // model has nothing useful to reason with. Narrow available tools to only
    // final-answer so the model's next action is a clean exit.
    //
    // Important: never narrow while required tools are still pending — doing so
    // hides the very tools the harness is demanding, creating an unsatisfiable
    // state (model sees only `final-answer` but is told it must call `web-search`).
    const missingRequiredForPressure = getMissingRequiredToolsFromSteps(
      state.steps,
      input.requiredTools ?? [],
      input.requiredToolQuantities,
    );
    const pressureCritical =
      missingRequiredForPressure.length === 0 &&
      shouldNarrowToFinalAnswerOnly({
        estimatedTokens: state.tokens,
        maxTokens: profile.maxTokens ?? Number.MAX_SAFE_INTEGER,
        tier: profile.tier,
      });

    // When lazy mode is active (default) the disclosure filter owns visibility
    // (the visible set already includes state.toolsUsed so the model can
    // re-invoke tools it's already used). Pressure-narrowing-to-final-answer-
    // only induces panic dumps on local models when fired prematurely, so the
    // resolver applies it only on the non-lazy arm.
    const lazyMode = process.env.RA_LAZY_TOOLS !== "0";

    // ── Tool surface resolution (Overhaul Phase 2) ───────────────────────────
    // One resolver computes the entire per-iteration surface — classification
    // pruning (attention-load reduction: e.g. 38 GitHub MCP tools → 3, only
    // when the set is > 15 since small-set classifier output is incomplete),
    // RA_LAZY_TOOLS per-iteration disclosure (default-on since 2026-04-26,
    // visible = required + relevant + used + discovered + meta; the rest is
    // reachable via discover-tools), and the required-tools gate FC narrowing
    // — plus a per-tool reason map surfaced as the `tool-surface-resolved`
    // trace event. See tool-surface.ts for the invariants.
    const PRUNE_MIN_TOOLS = 15;
    const classifiedRequired = input.requiredTools ?? [];
    const classifiedRelevant = input.relevantTools ?? [];
    const hasClassification = classifiedRequired.length > 0 || classifiedRelevant.length > 0;
    const discovered = yield* Ref.get(discoveredToolsStoreRef);
    const gateBlockedTools =
      (state.meta.gateBlockedTools as readonly string[] | undefined) ?? [];
    const toolSurface = resolveToolSurface({
      augmented: augmentedToolSchemas,
      finalAnswerSchema: {
        name: finalAnswerTool.name,
        description: finalAnswerTool.description,
        parameters: finalAnswerTool.parameters,
      } as ToolSchema,
      lazyMode,
      pressureCritical,
      hasClassification,
      requiredTools: classifiedRequired,
      relevantTools: classifiedRelevant,
      allowedTools: input.allowedTools ?? [],
      // The contract's declared deny-list — the read path for
      // `constraints.forbidden-tool`. Empty without a contract, so the default
      // surface is unchanged.
      forbiddenTools: forbiddenTools(state.meta.runContract),
      toolsUsed: state.toolsUsed,
      discovered,
      // The FULL catalog discover-tools lists from (tool-capabilities.ts
      // registers the handler with `catalog = input.allToolSchemas`).
      // Discovered names resolve their schema here when the engine's
      // pre-filtered availableToolSchemas withheld it — without this,
      // discovery was a dead-end for catalog-only built-ins (live
      // regression 01KX6KY8ANMXC1BSQ1SNJN3DAP: 4 consecutive
      // discover-tools calls, surface never changed).
      catalog: input.allToolSchemas ?? [],
      gateBlockedTools,
      // Same missing-required computation the pressure gate used above — the
      // gate narrowing keys off the identical unsatisfied set.
      missingRequiredTools: missingRequiredForPressure,
      pruneMinTools: PRUNE_MIN_TOOLS,
    });
    const promptSchemas = toolSurface.visible;

    // ── Harness skill injection ──────────────────────────────────────────────
    const harnessContent = input.metaTools?.harnessContent;
    const isNonTrivial =
      input.task.length >= 80 ||
      (input.requiredTools?.length ?? 0) > 0 ||
      (input.metaTools?.staticBriefInfo?.indexedDocuments.length ?? 0) > 0;
    const rawSystemPrompt =
      harnessContent && isNonTrivial && (input.metaTools?.brief || input.metaTools?.pulse)
        ? `${harnessContent}\n\n${input.systemPrompt ?? ""}`
        : input.systemPrompt;
    const pipeline = input.harnessPipeline;
    const effectiveSystemPrompt = pipeline
      ? (yield* Effect.promise(() =>
          pipeline.transform('prompt.system', rawSystemPrompt ?? "", {
            iteration: state.iteration,
            phase: 'think',
            state: asKernelStateLike(state),
            strategy,
          })
        )) ?? rawSystemPrompt
      : rawSystemPrompt;

    // ── Context assembly: canonical project() is the sole path ────────────────
    // Sprint-1 A2 (2026-06-02): canonical assembly is the only assembler.
    // project() walks the append-only EventLog + ResultStore to emit a
    // pure ProviderRequest. Think.ts supplies promptSchemas (classification-
    // pruned) and the effective system prompt body (harness-skill-wrapped
    // when active). profileOverrides were already merged into `profile` by
    // kernel-runner; here we only need the adapter.
    const { adapter } = selectAdapter({ supportsToolCalling: true }, profile.tier, input.modelId);

    // Read pending guidance signals, clear from state before LLM call.
    const pending = state.pendingGuidance;
    state = transitionState(state, { pendingGuidance: undefined });
    let guidance: GuidanceContext = {
      requiredToolsPending: pending?.requiredToolsPending ?? [],
      loopDetected: pending?.loopDetected ?? false,
      icsGuidance: pending?.icsGuidance,
      oracleGuidance: pending?.oracleGuidance,
      triageSteer: pending?.triageSteer,
      errorRecovery: pending?.errorRecovery,
      actReminder: pending?.actReminder,
      qualityGateHint: pending?.qualityGateHint,
      evidenceGap: pending?.evidenceGap,
      gatherDedup: pending?.gatherDedup,
    };
    if (guidance.loopDetected && pipeline) {
      const defaultNudge = "Loop detected: you are repeating the same tool calls. Try a different approach or synthesize what you have.";
      const nudgeResult = yield* Effect.promise(() =>
        pipeline.transform('nudge.loop-detected', defaultNudge, {
          iteration: state.iteration,
          phase: 'think',
          state: asKernelStateLike(state),
          strategy,
          trigger: 'loop-detector',
          severity: 'warn',
        })
      );
      guidance = { ...guidance, loopDetectedMessage: nudgeResult ?? defaultNudge };
    }

    // ── Native FC: convert tool schemas to LLM ToolDefinition format ──────
    // The resolver already narrowed `callable` to missing-required + meta
    // while the required-tools gate is blocking — forcing models like
    // cogito:14b (no tool_choice support) to select the right tool instead of
    // stubbornly re-selecting a previously successful one. `callable` ⊆
    // `visible`, so FC definitions never offer a tool the prompt can't see.
    const filteredToolSchemas = toolSurface.callable;

    // ContextCurator (S2.5): sole authority for the per-iteration prompt.
    // - Slice A: port + default wrapper (byte-identical with ContextManager).
    // - Slice B: curator owns the trust-aware "Recent tool observations" section.
    // - Slice C: profile.recentObservationsLimit threads through here so agents
    //   can opt-in via profileOverrides without touching kernel internals.
    //   Defaults to 0 across all tiers → off by default, preserves prior shape.
    // RA_ASSEMBLY: canonical context-assembly seam — DEFAULT-ON, opt-out only
    // via RA_ASSEMBLY=0. Sources systemPrompt+messages from project(); the
    // opt-out (=0) falls back to the legacy byte-identical curate() path (kept
    // reachable as a killswitch — deletion deferred). The tools/recall-gate path
    // below is shared by BOTH arms so they differ only on the context-assembly
    // variable. Cleared the default-on bar by the hardened cross-tier A/B grid
    // (N=3, 2 tiers, faithfulness-graded:
    // wiki/Research/Harness-Reports/assembly-ab-grid-hardened-2026-05-31.md):
    // project() deterministic 1.0/1.0/1.0 section-coverage both tiers vs legacy
    // 0.82–0.91 + a hard runaway, −57% local tokens on compact, and terminates
    // final_answer_tool everywhere (legacy had end_turn/goalAchieved:null
    // coherence gaps on mid). No cell regresses. Mirrors recallGateEnabled().
    // Canonical assembly is the SOLE path (Sprint-1 A2, 2026-06-02). The
    // legacy defaultContextCurator else-branch + the assemblyEnabled gate were
    // deleted after cross-tier finalbase cleared the equal-or-better invariant
    // on every tier:
    //   local (qwen3.5):    project 75% / 100% rel  vs legacy 58% / 76%
    //   mid (haiku-4-5):    project 50% / 100% rel  vs legacy 50% / 100%  (TIED)
    //   frontier (sonnet):  project 58% / 76%  rel  vs legacy 58% / 76%   (TIED)
    // See: wiki/Research/Harness-Reports/sprint1-canonical-collapse/
    //      finalbase-{local,mid,frontier}.json + frontier-final.json.
    const { request, trace } = buildThinkProviderRequest(
      state,
      profile,
      effectiveSystemPrompt ?? "",
      promptSchemas,
      input.task,
      input.priorContext,
    );
    const systemPromptText: string = request.systemPrompt;
    const conversationMessages: LLMMessage[] = toLLMMessages(request.messages);

    // ── C4: record the compaction-marker fact (audit 03-F4) ───────────────────
    // project() re-projected the window with protected classes; when it dropped
    // exchanges, persist the dropped-ref enumeration as a `compaction-marker`
    // ledger fact (append via patch.ledger — the C1-owned chokepoint appends).
    // De-dup lives in the emitter. A compaction that could not shrink (all
    // protected) records a `compaction-no-shrink` harness-signal instead of a
    // silent no-op.
    if (trace.compaction) {
      if (trace.compaction.droppedRefs.length > 0) {
        state = transitionState(state, {
          ledger: recordCompactionMarker(
            state.ledger,
            trace.compaction.droppedRefs,
            state.iteration,
            "recency-window overflow",
          ),
        });
      }
      if (trace.compaction.noShrinkEvent) {
        state = transitionState(state, {
          ledger: recordCompactionNoShrink(state.ledger, state.iteration),
        });
      }
    }
    // ── D1: projection-rendered trace event (the projector boundary) ──────────
    // The Projector is the last DAG node; emit its render as a replayable trace
    // line (sections + reachable refs + dropped refs + size) mirroring
    // contract-compiled / assessment. Best-effort: no bus → no-op.
    if (trace.projection) {
      yield* emitProjectionRendered({
        taskId: state.taskId,
        iteration: state.iteration,
        sections: trace.projection.sections.map((s) => s.name),
        refs: trace.projection.refs,
        droppedRefs: trace.projection.droppedRefs,
        chars: trace.projection.chars,
      });
    }

    if (process.env.RA_ASSEMBLY_DEBUG === "1") {
      console.error(`[RA_ASSEMBLY_TRACE] ${JSON.stringify({ taskId: state.taskId, iteration: state.iteration, capability: trace.capability, stages: trace.stages, messages: trace.messages, tools: trace.tools })}`);
    }

    // RA_PROMPT_DUMP — write the assembled prompt+messages to disk for diff.
    // Strictly diagnostic. Off by default. Path: /tmp/ra-prompt-dump-iter{N}.json
    if (process.env.RA_PROMPT_DUMP) {
      const path = `${process.env.RA_PROMPT_DUMP}-iter${state.iteration}-${state.taskId.slice(-8)}.json`;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const fs = require("node:fs") as typeof import("node:fs");
        fs.writeFileSync(path, JSON.stringify({ iteration: state.iteration, systemPromptText, conversationMessages }, null, 2));
      } catch { /* diagnostic only — never fail the run */ }
    }

    // ── Inc 1: recall overflow gate (tier-aware context architecture) ─────────
    // recall is only usable when a >4000-char tool result was truncated and its
    // storedKey is surfaced in THIS iteration's window. Below the inline cap the
    // full data is already inline and no key exists — advertising recall there
    // lures weak models into BLIND recall with invented keys (trace 01KSV58K:
    // recall("hn_posts") on a 3928-char inline result → {"found":false}). Gate on
    // the TRUE post-window messages (conversationMessages), not the all-time
    // scratchpad — a key that scrolls out of the window is unrecallable.
    // Calibration may force-enable for models measured as recall-native.
    //
    // DEFAULT-ON (opt-out via RA_RECALL_GATE=0) — cleared the project default-on
    // rule by the Phase-3 cross-tier ablation (ablation-warden, fixture-pinned
    // N=3, report: wiki/Research/Harness-Reports/phase3-ablation-2026-05-30.md):
    // gpt-4o-mini pass^k 2/5→5/5, composite +14.7pp, tokens −31.1%, recall-smells
    // 5→0; cogito tokens −11.2%, +0.9pp, recall-smells 2→0; zero cross-tier
    // divergence. The blind-recall lure (weak models calling recall() with invented
    // keys on inline data — recall-as-file-write class) is eliminated.
    // CAVEAT: MCP array/object data uses several recall-pointer marker formats; a
    // cross-tier MCP-data ablation is a Phase-4 follow-up before declaring the gate
    // universal — until then the HN-synthesis/inline-data proof is what justifies
    // the default. Calibration may force-enable for models measured as recall-native.
    const recallForceOn = input.calibration?.observationHandling === "uses-recall";
    const gatedToolSchemas = recallGateEnabled()
      ? filterRecallByOverflow(filteredToolSchemas, conversationMessages, recallForceOn)
      : filteredToolSchemas;

    // ── tool-surface-resolved trace event (Overhaul Phase 2) ─────────────────
    // The resolver's reason map, amended with the recall-overflow gate verdict
    // (that gate runs here because it needs the assembled conversation window).
    {
      const surfaceReasons = new Map(toolSurface.reasons);
      const gatedNames = new Set(gatedToolSchemas.map((ts) => ts.name));
      for (const ts of filteredToolSchemas) {
        if (!gatedNames.has(ts.name)) {
          surfaceReasons.set(ts.name, "hidden: recall-overflow gate (no recallable key in window)");
        }
      }
      yield* emitToolSurfaceResolved({
        taskId: state.taskId,
        iteration: state.iteration,
        visible: promptSchemas.map((ts) => ts.name),
        callable: gatedToolSchemas.map((ts) => ts.name),
        reasons: [...surfaceReasons].map(([tool, reason]) => ({ tool, reason })),
      });
    }

    // ── TextParseDriver: inject format instructions into system prompt ────────
    // When the driver is in text-parse mode (local models that can't reliably emit
    // FC JSON), append the driver's format guide so the model knows how to express
    // tool calls as structured text. For native-fc mode, buildPromptInstructions
    // returns "" so this is a no-op.
    //
    // In native-fc mode, skip when toolSchemaDetail is "names-only"/"names-and-types"
    // (the profile suppressed full descriptions; native FC carries tools natively and
    // buildPromptInstructions returns "" anyway). In text-parse mode the instructions
    // ARE the calling mechanism and must always be injected — otherwise the model has
    // tool names but no format to express a call, and stalls.
    const canInjectDriverInstructions = shouldInjectDriverInstructions(
      context.toolCallingDriver.mode,
      profile.toolSchemaDetail,
    );
    // Compact profiles ("names-only"/"names-and-types") deliberately hide full
    // tool descriptions. The text-parse FORMAT must still be injected (it's the
    // calling mechanism), but strip descriptions from the schemas so the driver's
    // tool listing honors the profile rather than re-exposing what it suppressed.
    const compactProfile =
      profile.toolSchemaDetail === "names-only" || profile.toolSchemaDetail === "names-and-types";
    const driverSchemas = compactProfile
      ? gatedToolSchemas.map((s) => ({ ...s, description: "" }))
      : gatedToolSchemas;
    const driverInstructions = canInjectDriverInstructions
      ? context.toolCallingDriver.buildPromptInstructions(driverSchemas)
      : "";

    // ── Decision Rationale (gated on tool availability) ──────────────────────
    // Only injected when tools are reachable on this turn. ~250 tokens of
    // formatting rules per call is dead weight on no-tool tasks (knowledge
    // recall, pure synthesis) — and the model can't emit a rationale block
    // for a tool call it has no way to make. Format is identical for
    // native-fc and text-parse paths; parseRationaleBlocks no-ops when no
    // blocks are present in the response.
    //
    // Empirical evidence: 2026-05-25 Mastra-vs-RA bench (local tier k1-france-
    // capital): RA 485 tok vs Mastra 50 tok for "Paris". Rationale block
    // accounted for ~250 of the 435-tok gap. Gating restores parity on
    // tasks where rationale was never going to be emitted anyway.
    // Opt-in audit gate (owner decision 2026-06-04) — see KernelInput.auditRationale.
    // Off by default: the rationale block is decode-tax-only (audit, not quality).
    // When ON, this reduces to the prior `hasReachableTools ? [...] : ""`, so the
    // emitted prompt is byte-identical to the old default.
    const auditRationaleOn =
      input.auditRationale === true || process.env.RA_RATIONALE_AUDIT === "1";
    const hasReachableTools = gatedToolSchemas.length > 0;
    const rationaleInstructions = hasReachableTools && auditRationaleOn
      ? [
          "## Decision Rationale (MANDATORY — every tool call)",
          "Every tool call you issue MUST be preceded by a rationale block in your text content. Tool calls without a matching rationale block are considered malformed and you will be asked to retry.",
          "Emit rationale blocks BEFORE the tool call(s), one per call, in order:",
          '<rationale call="1">{"why":"one sentence, ≤280 chars, explaining why this tool and these arguments","confidence":0.0-1.0}</rationale>',
          "Rules:",
          "- `call` is the 1-indexed position of the tool call within this turn (1 for the first, 2 for the second…).",
          "- `why` is REQUIRED, max 280 chars, must be specific to THIS call (not generic).",
          "- `confidence` is OPTIONAL (number 0-1).",
          "- The rationale is for post-hoc review only — NOT passed to the tool, does NOT change behavior.",
          "- If you emit no tool calls this turn, emit no rationale blocks.",
        ].join("\n")
      : "";

    const parts = [systemPromptText];
    if (driverInstructions) parts.push(driverInstructions);
    if (rationaleInstructions) parts.push(rationaleInstructions);
    // Hotfix 0.5-1 (2026-07-07): render harness guidance into the dynamic
    // tail. GuidanceContext was previously assembled (and pendingGuidance
    // cleared) but never passed to assembly — every guidance-channel signal
    // was a silent no-op. Tail placement keeps the stable prefix intact.
    const guidanceText = buildGuidanceText(guidance);
    if (guidanceText) parts.push(guidanceText);
    const systemPromptWithDriver = parts.join("\n\n");

    // ── STREAM (with text delta emission) ──────────────────────────────────
    const llmTools = gatedToolSchemas.map((ts) => ({
      name: sanitizeToolName(ts.name),
      description: ts.description,
      inputSchema: {
        type: "object" as const,
        properties: Object.fromEntries(
          (ts.parameters ?? []).map((p) => [
            p.name,
            {
              type: p.type ?? "string",
              description: p.description,
              // Gemini requires `items` on every array-type parameter
              ...(p.type === "array" ? { items: p.items ?? { type: "string" } } : {}),
              ...(p.enum ? { enum: p.enum } : {}),
            },
          ]),
        ),
        required: (ts.parameters ?? [])
          .filter((p) => p.required)
          .map((p) => p.name),
      } as Record<string, unknown>,
    }));

    // Request logprobs when entropy sensor may be active (modelId present in meta)
    const wantLogprobs = state.meta.entropy?.modelId !== undefined;

    // Budget resolution moved to the LLM gateway (Phase 1): tier-adaptive
    // think budget + B2 thinking allowance live in resolveOutputBudget; a
    // kernel pressure override (state.maxOutputTokensOverride) rides the
    // explicit budgetTokens escape hatch.
    //
    // E3 economize actuator: under the long-horizon profile, a non-`green` pace
    // band downshifts this NON-synthesis think budget at the gateway (cap at
    // `standard`). OFF, or a `green` band → `paceBand` undefined → the gateway
    // resolves the budget byte-identically to today.
    const economizeBand = downshiftBudgetBand(
      state.meta.horizonProfile === "long",
      state.meta.assessment,
    );
    const llmStreamEffect = gatewayStream(llm, {
      purpose: "think",
      tier: profile.tier,
      thinkingModel: profile.thinkingModel === true,
      ...(economizeBand ? { paceBand: economizeBand } : {}),
      ...(state.maxOutputTokensOverride !== undefined
        ? { budgetTokens: state.maxOutputTokensOverride }
        : {}),
    }, {
      messages: conversationMessages,
      ...(input.modelId ? { model: input.modelId } : {}),
      systemPrompt: systemPromptWithDriver,
      temperature: temp,
      // Snapshot run correlation into the request so the observable-LLM wrapper
      // (below the kernel) can key the LLMExchange trace to the real run instead
      // of the 'llm-direct'/0 placeholder. Build-time snapshot, FiberRef-free.
      traceContext: { taskId: state.taskId, iteration: state.iteration },
      // TextParseDriver: pass empty tools array — constrained providers (Anthropic/OpenAI)
      // enforce FC when tools are present, which breaks text-parse mode for local models.
      ...(llmTools.length > 0 && context.toolCallingDriver.mode !== "text-parse" ? { tools: llmTools } : {}),
      ...(wantLogprobs ? { logprobs: true, topLogprobs: 5 } : {}),
    });

    const streamInit = yield* Effect.either(
      llmStreamEffect.pipe(
        Effect.mapError(
          (err) => {
            const rawMessage =
              err && typeof err === "object" && "message" in err
                ? (err as { message: string }).message
                : String(err);
            const explained = explainProviderError(
              rawMessage,
              input.providerName,
              input.modelId,
            );
            return new ExecutionError({
              strategy,
              message: `LLM stream failed at iteration ${state.iteration}: ${explained}`,
              step: state.iteration,
              cause: err,
            });
          },
        ),
      ),
    );

    if (Either.isLeft(streamInit)) {
      return transitionState(state, {
        status: "failed" as const,
        error: streamInit.left.message,
        output: null,
        meta: {
          ...state.meta,
          terminatedBy: "llm_error",
        },
      });
    }

    const llmStream = streamInit.right;

    // Accumulate content + emit text deltas via FiberRef callback
    let accumulatedContent = "";
    let accumulatedUsage = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCost: 0,
    };
    let accumulatedLogprobs: { token: string; logprob: number; topLogprobs?: readonly { token: string; logprob: number }[] }[] = [];
    // Native FC: accumulate tool_use blocks from stream events
    let accumulatedToolCalls: { id: string; name: string; input: string }[] = [];
    let accumulatedStopReason: string = "end_turn";

    const textDeltaCb = yield* FiberRef.get(StreamingTextCallback);

    let streamConsumeError: string | undefined;
    yield* Stream.runForEach(llmStream, (event) =>
      Effect.gen(function* () {
        if (event.type === "text_delta") {
          accumulatedContent += event.text;
          if (textDeltaCb) {
            yield* textDeltaCb(event.text).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/capabilities/reason/think.ts:342", tag: errorTag(err) })));
          }
        } else if (event.type === "content_complete") {
          accumulatedContent = event.content;
          // Extract stop reason from content_complete event if present
          if ("stopReason" in event && typeof (event as Record<string, unknown>).stopReason === "string") {
            accumulatedStopReason = (event as Record<string, unknown>).stopReason as string;
          }
        } else if (event.type === "usage") {
          accumulatedUsage = event.usage;
        } else if (event.type === "logprobs") {
          accumulatedLogprobs = [...accumulatedLogprobs, ...event.logprobs];
        } else if (event.type === "tool_use_start") {
          // Native FC: start accumulating a new tool call
          accumulatedToolCalls.push({ id: event.id, name: event.name, input: "" });
          accumulatedStopReason = "tool_use";
        } else if (event.type === "tool_use_delta") {
          // Native FC: accumulate JSON input for the current tool call
          const currentTC = accumulatedToolCalls[accumulatedToolCalls.length - 1];
          if (currentTC) {
            currentTC.input += event.input;
          }
        } else if (event.type === "error") {
          streamConsumeError = event.error;
        }
      }),
    ).pipe(
      Effect.catchAll((streamErr) => {
        streamConsumeError =
          streamErr && typeof streamErr === "object" && "message" in streamErr
            ? (streamErr as { message: string }).message
            : String(streamErr);
        return Effect.void;
      }),
    );

    if (streamConsumeError !== undefined) {
      const explained = explainProviderError(
        streamConsumeError,
        input.providerName,
        input.modelId,
      );
      return transitionState(state, {
        status: "failed" as const,
        error: `LLM stream failed at iteration ${state.iteration}: ${explained}`,
        output: null,
        meta: {
          ...state.meta,
          terminatedBy: "llm_error",
        },
      });
    }

    // ── Native-FC name de-sanitization ───────────────────────────────────────
    // Outbound, tool schemas were sanitized to satisfy the provider regex
    // (e.g. MCP `github/list_commits` → `github_list_commits`). Map the returned
    // tool-call names BACK to the canonical registered names BEFORE either
    // consumer (the toolCallResolver path and the no-resolver native-FC
    // fallback) so registry lookup/execution is unchanged. The reverse map is
    // built from the EXACT schemas offered this turn. accumulatedToolCalls is a
    // mutable list of objects, so in-place name reassignment is safe.
    const { map: canonicalBySanitized, collisions } = buildSanitizedReverseMap(
      gatedToolSchemas.map((ts) => ts.name),
    );
    if (collisions.length > 0) {
      yield* Effect.logWarning(
        `[think] tool-name sanitization collision — inbound de-sanitization may ` +
        `dispatch the wrong tool: ${collisions
          .map(([a, b]) => `"${a}" ~ "${b}" → "${sanitizeToolName(a)}"`)
          .join("; ")}. Rename the tools to disambiguate.`,
      );
    }
    for (const tc of accumulatedToolCalls) {
      const canon = canonicalBySanitized.get(tc.name);
      if (canon !== undefined) tc.name = canon;
    }

    // ── 0-token diagnostic ───────────────────────────────────────────────────
    // Surface silent empty responses from providers (e.g. Gemini, GPT-4o-mini)
    // before they silently produce success=false. The most likely cause is the
    // fast-path firing despite requiredTools being set, OR a provider returning
    // an empty stream with no error event.
    if (
      accumulatedUsage.totalTokens === 0 &&
      accumulatedContent.length === 0 &&
      accumulatedToolCalls.length === 0
    ) {
      const fastPathEligible = state.iteration === 0 && !((input.requiredTools?.length ?? 0) > 0);
      yield* Effect.log(
        `[think] WARNING: LLM returned 0 tokens at iteration ${state.iteration}. ` +
        `stopReason=${accumulatedStopReason}. ` +
        `hasRequiredTools=${(input.requiredTools?.length ?? 0) > 0} (${(input.requiredTools ?? []).join(",")}). ` +
        `fast-path-eligible=${fastPathEligible}. ` +
        `toolCallResolver=${!!input.toolCallResolver}. ` +
        `llmToolsCount=${llmTools.length}.`
      );
    }

    // Store logprobs in entropy meta for the entropy sensor
    if (accumulatedLogprobs.length > 0) {
      const entropyMeta = state.meta.entropy ?? {};
      state = transitionState(state, { meta: { ...state.meta, entropy: { ...entropyMeta, lastLogprobs: accumulatedLogprobs } } });
    }

    // Build response shape matching original llm.complete() return
    const thoughtResponse = {
      content: accumulatedContent,
      stopReason: accumulatedStopReason as StopReason,
      usage: accumulatedUsage,
      model: input.modelId ?? "unknown",
    };

    // Increment LLM call counter
    state = transitionState(state, { llmCalls: (state.llmCalls ?? 0) + 1 });

    // ── max_output_tokens recovery ───────────────────────────────────────────
    // Stage 1: LLM hit its output token limit for the first time — escalate to
    //          64k tokens and re-run the same request (no message injection).
    // Stage 2: Override already set — inject a recovery user turn and continue.
    //          Maximum 3 Stage 2 attempts before failing.
    if (thoughtResponse.stopReason === "max_tokens") {
      const recoveryCount = state.maxOutputTokensRecoveryCount ?? 0;

      if (!state.maxOutputTokensOverride) {
        // Stage 1: escalate token limit, re-run same request (no iteration bump)
        return transitionState(state, {
          maxOutputTokensOverride: 64_000,
        });
      } else if (recoveryCount < 3) {
        // Stage 2: inject recovery message, continue conversation (no iteration bump)
        const recoveryMessage: KernelMessage = {
          role: "user",
          content: "[Harness] Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.",
        };
        return transitionState(state, {
          messages: [...state.messages, recoveryMessage],
          maxOutputTokensRecoveryCount: recoveryCount + 1,
        });
      } else {
        // Exhausted all recovery attempts — surface error
        return transitionState(state, {
          status: "failed",
          error: "max_output_tokens limit reached after recovery attempts",
        });
      }
    }

    // Clear recovery state after a successful (non-max_tokens) response so that
    // maxOutputTokensOverride does not persist and silently inflate billing for
    // all remaining iterations. Also reset the count so a later max_tokens event
    // in the same run re-enters Stage 1 cleanly.
    if (state.maxOutputTokensOverride !== undefined) {
      state = transitionState(state, {
        maxOutputTokensOverride: undefined,
        maxOutputTokensRecoveryCount: undefined,
      });
    }

    const rawThought = thoughtResponse.content;
    const newTokens = state.tokens + thoughtResponse.usage.totalTokens;
    const newInputTokens = state.inputTokens + (thoughtResponse.usage.inputTokens ?? 0);
    const newOutputTokens = state.outputTokens + (thoughtResponse.usage.outputTokens ?? 0);
    const newCost = state.cost + thoughtResponse.usage.estimatedCost;

    // HS-128 — Per-iteration token snapshot for the verbosity detector.
    // Append `usage.totalTokens` (NOT the running total) to a rolling window
    // capped at 5 entries on state.meta.lastIterationTokens. Guarded by a
    // truthy check: undefined `usage` (test providers that don't emit usage)
    // AND zero-token usage both skip the append so the window only contains
    // real-LLM measurements. Downstream transitionState calls in this turn
    // pick up the updated meta via their `...state.meta` spreads.
    // See kernel/capabilities/reflect/verbosity-detector.ts.
    if (thoughtResponse.usage?.totalTokens) {
      const priorWindow = state.meta.lastIterationTokens ?? [];
      const nextWindow = [...priorWindow, thoughtResponse.usage.totalTokens].slice(-5);
      // ContextPressure is now emitted from the observable-llm chokepoint, so the
      // lastContextTokens/lastContextWindow meta is no longer computed here — only
      // the rolling lastIterationTokens window (consumed by verbosity-detector).
      state = transitionState(state, {
        meta: { ...state.meta, lastIterationTokens: nextWindow },
      });
    }

    // Strip <think>...</think> blocks before parsing
    const { thinking: extractedThinking, content: cleanContent } = extractThinking(rawThought);
    const providerThinking = (thoughtResponse as Record<string, unknown>).thinking as string | undefined;
    const thinking = extractedThinking || providerThinking || null;
    let thought = cleanContent || providerThinking || rawThought;
    // Thinking models (e.g. cogito) may put the full answer in the thinking field
    // with only a tiny fragment in content. When content is deficient, extract
    // structured value (final answer, code, tool calls) from thinking.
    if (thought.trim().length < 50 && thinking && thinking.length > 100) {
      const rescued = rescueFromThinking(thinking, thought.trim());
      if (rescued) thought = rescued;
    }

    // HS-cleanup-1 root fix: parse rationale blocks ONCE from the raw text,
    // then strip the wrapper XML from the thought before storing. Native-FC
    // attachment (lines below) reuses these pre-parsed blocks via the
    // `prerasedRationaleBlocks` snapshot — see act/text-parse branches.
    //
    // Invariant: framework markup (`<rationale call="N">{...}</rationale>`)
    // never enters `state.steps[].content`, so it cannot re-enter the model
    // context next iteration nor surface as user-facing output.
    const preparsedRationaleBlocks = parseRationaleBlocks(
      `${thought ?? ""}\n${thinking ?? ""}`,
    );
    thought = stripRationaleBlocks(thought);

    const thoughtStep = makeStep("thought", thought, thinking ? { thinking } : undefined);
    const newSteps = [...state.steps, thoughtStep];

    // Strip fabricated action/observation pairs — small models often "simulate"
    // multiple tool calls in one thought. Only the FIRST ACTION is real; everything
    // after a fabricated "Observation:" is hallucinated and must be stripped.
    const firstActionIdx = thought.search(/ACTION:/i);
    if (firstActionIdx >= 0) {
      // Find the first "Observation:" AFTER the first ACTION
      const afterAction = thought.slice(firstActionIdx);
      const fabObsMatch = afterAction.match(/\nObservation[:\s]/i);
      if (fabObsMatch && fabObsMatch.index !== undefined) {
        thought = thought.slice(0, firstActionIdx + fabObsMatch.index).trimEnd();
      }
    }

    // ── v0.11.x: surface model-stated assumptions as AssumptionRecordedEvents.
    // Best-effort; failure is swallowed inside the emitter so think never breaks.
    yield* surfaceAssumptions({
      thought,
      thinking,
      taskId: state.taskId,
      iteration: state.iteration,
    });

    // Publish thought event with full prompt trace for logModelIO.
    // messages[] carries the complete FC conversation thread with role labels.
    // rawResponse is the unmodified LLM output before thought-stripping.
    const messagesForTrace = conversationMessages.map((m) => ({
      role: m.role as string,
      content: typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? (m.content as Record<string, unknown>[]).map((b) => (b as { text?: string }).text ?? "").join("")
          : String(m.content ?? ""),
    }));
    const userContent = messagesForTrace.map((m) => m.content).join("\n---\n");
    yield* hooks.onThought(state, thought, {
      system: systemPromptWithDriver,
      user: userContent,
      messages: messagesForTrace,
      rawResponse: rawThought,
    });

    // ── FAST-PATH: trivial task exit ─────────────────────────────────────────
    // If this is the first iteration, the model produced no tool call, no
    // FINAL ANSWER prefix (handled by the oracle), and the response is
    // substantive, exit immediately without running the termination oracle or
    // tool-parsing pipeline. Avoids 4-6 extra loop iterations that meta-tool
    // injection + entropy scoring would otherwise add to simple Q&A.
    // SKIP fast-path when required tools are specified — the agent must use
    // them before it can exit, even if the model already knows the answer.
    const hasRequiredTools = (input.requiredTools?.length ?? 0) > 0;
    if (
      state.iteration === 0 &&
      !hasRequiredTools &&
      !thought.match(/ACTION:/i) &&
      !thought.match(/FINAL\s+ANSWER\s*[:：]/i) &&
      thought.trim().length > 20 &&
      thoughtResponse.stopReason === "end_turn"
    ) {
      const output = thought.trim();
      // Sprint 3.3 — flow through the Arbitrator. Fast-path is a "trivial
      // task completed immediately" signal; Arbitrator vetoes if controller
      // showed pathological activity (which shouldn't happen on a fast-path
      // but the veto runs uniformly to keep the contract simple).
      const stateWithSteps = transitionState(state, {
        steps: newSteps,
        tokens: newTokens,
        inputTokens: newInputTokens,
        outputTokens: newOutputTokens,
        cost: newCost,
        priorThought: output,
        iteration: state.iteration + 1,
      });
      return arbitrateAndApply(
        stateWithSteps,
        { kind: "fast-path-completed", output },
        arbitrationContextFromState(stateWithSteps, {
          task: input.task,
          requiredTools: input.requiredTools,
        }),
      );
    }

    // ── NATIVE FUNCTION CALLING BRANCH ─────────────────────────────────────
    // The LLM returns structured tool_use blocks instead of text-based ACTION:
    // directives. We resolve them through the ToolCallResolver.
    if (input.toolCallResolver) {
      const resolver = input.toolCallResolver;

      // Parse accumulated tool call inputs from JSON strings
      const parsedToolCalls = accumulatedToolCalls.map((tc) => {
        let parsedInput: unknown = {};
        try {
          parsedInput = tc.input ? JSON.parse(tc.input) : {};
        } catch {
          parsedInput = {};
        }
        return { id: tc.id, name: tc.name, input: parsedInput };
      });

      const resolverInput: ResolverInput = {
        content: accumulatedContent || undefined,
        toolCalls: parsedToolCalls.length > 0 ? parsedToolCalls : undefined,
        stopReason: accumulatedStopReason,
      };

      // Use resolveWithDialect to capture which tier fired (native-fc / fenced-json / pseudo-code / etc.)
      const resolverWithDialect = resolver.resolveWithDialect
        ? resolver.resolveWithDialect(
            resolverInput,
            toolSurface.universe.map((ts) => ({
              name: ts.name,
              paramNames: ts.parameters?.map((p) => p.name) ?? [],
            })),
          )
        : resolver.resolve(
            resolverInput,
            toolSurface.universe.map((ts) => ({
              name: ts.name,
              paramNames: ts.parameters?.map((p) => p.name) ?? [],
            })),
          ).pipe(Effect.map((result) => ({ result, dialect: "none" as const })));

      const { result: resolverResult, dialect: dialectObserved } = yield* resolverWithDialect;

      // Record dialect on state.meta for telemetry
      if (dialectObserved !== "none") {
        state = transitionState(state, {
          meta: { ...state.meta, lastDialectObserved: dialectObserved },
        });
      }

      if (resolverResult._tag === "tool_calls") {
        // Attach intentional rationale from `<rationale call="N">{...}</rationale>`
        // blocks (already parsed once upstream into preparsedRationaleBlocks).
        // Provider native FC events carry no sibling rationale field, so we
        // match by 1-indexed call position.
        const rationaleBlocks = preparsedRationaleBlocks;
        const rawCalls = (resolverResult.calls as readonly ToolCallSpec[]).map(
          (c, i) => {
            if (c.rationale) return c;
            const r = rationaleBlocks.get(i + 1);
            return r ? { ...c, rationale: r } : c;
          },
        ) as readonly ToolCallSpec[];
        // Compute per-tool call counts from step history for budget enforcement.
        const toolCallCounts = buildSuccessfulToolCallCounts(state.steps);

        const { effective, blockedOptionalBatch, quotaBudgetConflict } = gateNativeToolCallsForRequiredTools(
          rawCalls,
          input.requiredTools ?? [],
          state.toolsUsed,
          input.relevantTools,
          toolCallCounts,
          input.maxCallsPerTool,
          input.requiredToolQuantities,
          input.strictToolDependencyChain,
          input.nextMovesPlanning,
        );

        if (blockedOptionalBatch) {
          const redirect = guardRequiredToolsBlock(
            rawCalls,
            input,
            state,
            profile,
            hooks,
            newSteps,
            newTokens,
            newCost,
            thought,
            thinking,
          );
          if (redirect) return redirect;
          // Falls through if the guard decides no redirect is needed (should be unreachable
          // while blockedOptionalBatch is true — guard always returns a state in that case).
        }

        if (effective.length > 0) {
          // Store pending native tool calls in meta for handleActing
          return transitionState(state, {
            steps: newSteps,
            tokens: newTokens,
            inputTokens: newInputTokens,
            outputTokens: newOutputTokens,
            cost: newCost,
            status: "acting",
            meta: {
              ...state.meta,
              pendingNativeToolCalls: effective,
              // Store thought + thinking for post-action FA check
              lastThought: thought,
              lastThinking: thinking,
            },
          });
        }
        // Resolver returned tool_calls but gated to zero (empty batch) — fall through
      }

      if (resolverResult._tag === "final_answer") {
        // Genuine final answer (no tool calls). Run the guard chain — if any
        // guard fires, redirect the loop. Otherwise fall through to assembly.
        const redirect =
          guardPrematureFinalAnswer(input, state, profile, adapter, newSteps, newTokens, newCost) ??
          guardCompletionGaps(input, state, newSteps, newTokens, newCost) ??
          guardQualityCheck(input, state, profile, adapter, newSteps, newTokens, newCost) ??
          guardEvidenceGrounding(state, resolverResult.content, newSteps, newTokens, newCost, input.grounding);
        if (redirect) return redirect;

        // All checks pass — assemble final output
        const hasFA = hasFinalAnswer(resolverResult.content);
        const cleanContentFA = stripPreamble(
          hasFA
            ? extractFinalAnswer(resolverResult.content)
            : resolverResult.content,
        );

        const assembled = assembleOutput({
          steps: newSteps,
          finalAnswer: cleanContentFA,
          terminatedBy: "llm_end_turn",
          entropyScores: state.meta.entropy?.entropyHistory,
        });
        // Sprint 3.3 — flow through the Arbitrator. The agent emitted either
        // a FINAL ANSWER: regex match (via=regex) or a plain end_turn
        // (via=end-turn). The Arbitrator's veto applies if the controller
        // showed pathological activity.
        const stateWithSteps = transitionState(state, {
          steps: newSteps,
          tokens: newTokens,
          inputTokens: newInputTokens,
          outputTokens: newOutputTokens,
          cost: newCost,
          priorThought: thought.trim(),
          iteration: state.iteration + 1,
        });
        return arbitrateAndApply(
          stateWithSteps,
          {
            kind: "agent-final-answer",
            via: hasFA ? "regex" : "end-turn",
            output: assembled.text,
          },
          arbitrationContextFromState(stateWithSteps, {
            task: input.task,
            requiredTools: input.requiredTools,
          }),
        );
      } else if (resolverResult._tag === "abstained") {
        // O3: legitimacy gate (Task 5) — distinguish earned abstentions from
        // premature bails. Derive inputs from available kernel state; conservative
        // fallbacks noted inline where a signal isn't cleanly available.

        // taskRequiresTools: true when explicit required tools OR any data tool is wired.
        const hasDataTools = (input.availableToolSchemas ?? []).some(
          (ts) => !META_TOOL_SET.has(ts.name),
        );
        const legitimacyRequiredToolsList = input.requiredTools ?? [];
        const taskRequiresTools = legitimacyRequiredToolsList.length > 0 || hasDataTools;

        // requiredToolsAttempted: at least one required tool was called (or any
        // non-meta tool when no explicit required list is set).
        const requiredToolsAttempted =
          legitimacyRequiredToolsList.length > 0
            ? legitimacyRequiredToolsList.some((t) => state.toolsUsed.has(t))
            : [...state.toolsUsed].some((t) => !META_TOOL_SET.has(t));

        // requiredToolUnavailable: a declared required tool is not in the registered
        // schema set. Fallback: false (conservative — assume available unless proven missing).
        const availableToolNames = new Set([
          ...(input.availableToolSchemas ?? []).map((ts) => ts.name),
          ...(input.allToolSchemas ?? []).map((ts) => ts.name),
        ]);
        const requiredToolUnavailable =
          legitimacyRequiredToolsList.length > 0 &&
          legitimacyRequiredToolsList.some((t) => !availableToolNames.has(t));

        // ungroundedSynthesisRejections: sum of Arbitrator synthesis retries +
        // block-mode grounding retries. Fallback: 0 when counters are absent.
        const ungroundedSynthesisRejections =
          (state.meta.synthesisRetryCount ?? 0) + (state.meta.groundingBlockRetry ?? 0);

        // iterationsRemaining: budget left this run (clamped ≥ 0).
        const iterationsRemaining = Math.max(
          0,
          ((state.meta.maxIterations as number) ?? 10) - state.iteration,
        );

        const legitimacyVerdict = checkAbstentionLegitimacy({
          taskRequiresTools,
          requiredToolsAttempted,
          requiredToolUnavailable,
          ungroundedSynthesisRejections,
          iterationsRemaining,
        });

        if (legitimacyVerdict.legitimate) {
          // Earned abstention — emit pass diagnostic step, then terminate.
          const passMsg = "abstention-legitimacy: legitimate — earned abstention accepted";
          const legitimacyPassStep = makeStep("observation", passMsg, {
            observationResult: makeObservationResult("abstention-legitimacy", true, passMsg),
          });
          const stateWithAbstention = transitionState(state, {
            steps: [...newSteps, legitimacyPassStep],
            tokens: newTokens,
            inputTokens: newInputTokens,
            outputTokens: newOutputTokens,
            cost: newCost,
            iteration: state.iteration + 1,
            meta: {
              ...state.meta,
              abstention: {
                reason: resolverResult.reason,
                missing: resolverResult.missing,
              },
            },
          });
          return terminate(stateWithAbstention, {
            reason: "abstained",
            deliverable: sentinelDeliverable("model-abstained"),
          });
        }

        // Illegitimate abstention — DO NOT terminate. Emit reject diagnostic step,
        // inject nudge via pendingGuidance, and let the loop continue.
        const nudgeMsg =
          legitimacyVerdict.nudge ??
          "You have not yet attempted the tools needed to ground an answer. Try them before abstaining.";
        const legitimacyRejectStep = makeStep("observation", nudgeMsg, {
          observationResult: makeObservationResult("abstention-legitimacy", false, nudgeMsg),
        });
        return transitionState(state, {
          steps: [...newSteps, legitimacyRejectStep],
          tokens: newTokens,
          inputTokens: newInputTokens,
          outputTokens: newOutputTokens,
          cost: newCost,
          status: "thinking",
          iteration: state.iteration + 1,
          pendingGuidance: {
            errorRecovery: nudgeMsg,
          },
        });
      } else if (resolverResult._tag === "thinking") {
        const thinkingContent = resolverResult.content.trim();
        const reqTools = input.requiredTools ?? [];
        const missingReq = getMissingRequiredToolsFromSteps(
          state.steps,
          reqTools,
          input.requiredToolQuantities,
        );

        // ── Auto-promote substantive thought to final answer ────────────────
        // Many local models produce a complete, well-formatted answer in
        // their thought content but never call final-answer explicitly. The
        // harness then loops, the model regenerates the same answer 3-5
        // times, burns tokens, and ultimately fails on max-iterations or
        // dispatcher veto. This short-circuit recognizes when the thought
        // IS the answer and routes it through the same arbitrator gates as
        // an explicit final-answer call. Conditions (all must hold):
        //   1. At least one non-meta tool has been called (real work done)
        //   2. All required tools are satisfied
        //   3. Thinking content is substantial (≥100 chars) and structured
        //   4. We're not on iteration 0 (give the model at least one chance
        //      to call tools before promoting)
        //
        // The arbitrator's synthesisQualityRetry path applies normally — if
        // the auto-promoted answer fails grounding, retry feedback fires
        // exactly as if the model had called final-answer itself. So this
        // change can't make outputs WORSE; it just stops needless loops.
        const hasRealToolWork = [...state.toolsUsed].some(
          (t) => !META_TOOL_SET.has(t),
        );
        if (
          hasRealToolWork &&
          missingReq.length === 0 &&
          state.iteration > 0 &&
          looksLikeFinalAnswer(thinkingContent)
        ) {
          const stateWithThought = transitionState(state, {
            steps: [...newSteps, makeStep("thought", thinkingContent)],
            tokens: newTokens,
            inputTokens: newInputTokens,
            outputTokens: newOutputTokens,
            cost: newCost,
            iteration: state.iteration + 1,
            priorThought: thinkingContent,
          });
          return arbitrateAndApply(
            stateWithThought,
            {
              kind: "agent-final-answer",
              via: "end-turn",
              output: thinkingContent,
            },
            arbitrationContextFromState(stateWithThought, {
              task: input.task,
              requiredTools: input.requiredTools,
            }),
          );
        }

        // ── Standard thinking handler ──────────────────────────────────────
        // Note: Even if all required tools are met, we continue the loop to
        // allow the model to call final-answer explicitly. The act phase will
        // accept final-answer once all required tools are satisfied.
        const consecutiveEmpty = !thinkingContent
          ? newSteps.reduceRight((count, s) => {
              if (count === -1) return -1;
              if (s.type === "observation" && s.content.startsWith("Continue working")) return count + 1;
              if (s.type === "thought" || s.type === "action") return -1;
              return count;
            }, 0)
          : 0;

        let thinkingSteps = [...newSteps];
        if (thinkingContent) {
          thinkingSteps = [...thinkingSteps, makeStep("thought", thinkingContent)];
        }

        let nudgeMessage: string | undefined;
        if (missingReq.length > 0) {
          const quantities = input.requiredToolQuantities ?? {};
          const successCounts = buildSuccessfulToolCallCounts(state.steps);
          const missingWithProgress = missingReq.map((t) => {
            const needed = quantities[t];
            if (!needed || needed <= 1) return t;
            const actual = successCounts[t] ?? 0;
            return `${t} (${actual}/${needed} calls done)`;
          });
          const isStuck = consecutiveEmpty >= 2;
          const defaultNudge = isStuck
            ? `⚠️ ACTION REQUIRED: You have not made progress. You MUST call: ${missingWithProgress.join(", ")} RIGHT NOW. Stop waiting and use the tool immediately.`
            : `Continue working on the task. You still need to call: ${missingWithProgress.join(", ")}. Use the available tools to complete the task.`;

          const lastObsForHint = state.steps.filter((s) => s.type === "observation").pop();
          const lastActionForHint = state.steps.filter((s) => s.type === "action").pop();
          const lastToolNameForHint = (lastActionForHint?.metadata?.toolCall as { name?: string } | undefined)?.name;
          const adapterNudge = adapter.continuationHint?.({
            toolsUsed: state.toolsUsed,
            requiredTools: reqTools,
            missingTools: missingReq,
            iteration: state.iteration,
            maxIterations: (state.meta.maxIterations as number) ?? 10,
            lastToolName: lastToolNameForHint,
            lastToolResultPreview: lastObsForHint?.content?.slice(0, 200),
          });

          nudgeMessage = adapterNudge ?? defaultNudge;

          // Layer 1: Novelty signal — strengthen nudge when recent observations add little new info.
          // Extracted to think-guards.guardDiminishingReturns. When the guard fires it returns the
          // full thinking-branch redirect state; when it passes through (novelty high, <3 real obs,
          // or empty observations) we continue with the default/adapter nudge below.
          const diminishingRedirect = guardDiminishingReturns(
            state,
            input,
            profile,
            newTokens,
            newCost,
            {
              thinkingContent,
              thinkingSteps,
              missingReq,
              adapterOrDefaultNudge: nudgeMessage,
            },
          );
          if (diminishingRedirect) return diminishingRedirect;

          thinkingSteps = [...thinkingSteps, makeStep("observation", nudgeMessage, {
            observationResult: makeObservationResult("system", true, nudgeMessage),
          })];
        }

        // Route nudge through pendingGuidance instead of injecting a synthetic USER
        // message into the conversation thread. Rendered in the Guidance: section of
        // the next system prompt. Keeps the FC thread clean.
        return transitionState(state, {
          steps: thinkingSteps,
          tokens: newTokens,
          inputTokens: newInputTokens,
          outputTokens: newOutputTokens,
          cost: newCost,
          iteration: state.iteration + 1,
          priorThought: thinkingContent || state.priorThought,
          pendingGuidance: nudgeMessage
            ? {
                requiredToolsPending: missingReq,
                errorRecovery: nudgeMessage,
              }
            : undefined,
        });
      }
    }

    // ── NO-RESOLVER FALLBACK ────────────────────────────────────────────────
    // When executeReactive is called directly (without execution engine wiring),
    // toolCallResolver is absent but the LLM may still emit native FC events.
    // Forward them to act.ts via pendingNativeToolCalls so ToolService executes them.
    if (accumulatedToolCalls.length > 0) {
      // Native FC: rationale has no sibling field on provider tool_use events.
      // Use the pre-parsed blocks (extracted before the stored thought was
      // stripped of rationale wrappers — see preparsedRationaleBlocks above).
      const rationaleBlocks = preparsedRationaleBlocks;
      const parsedCalls: ToolCallSpec[] = accumulatedToolCalls.map((tc, i) => {
        let parsedInput: unknown = {};
        try {
          parsedInput = tc.input ? JSON.parse(tc.input) : {};
        } catch {
          parsedInput = {};
        }
        const rationale = rationaleBlocks.get(i + 1);
        return {
          id: tc.id ?? `tc-${state.iteration}-${i}`,
          name: tc.name,
          arguments: parsedInput as Record<string, unknown>,
          ...(rationale ? { rationale } : {}),
        };
      });

      if (parsedCalls.length > 0) {
        return transitionState(state, {
          steps: newSteps,
          tokens: newTokens,
          inputTokens: newInputTokens,
          outputTokens: newOutputTokens,
          cost: newCost,
          status: "acting",
          meta: {
            ...state.meta,
            pendingNativeToolCalls: parsedCalls,
            lastThought: thought,
            lastThinking: thinking,
          },
        });
      }
    }

    // ── TERMINATION ORACLE ──────────────────────────────────────────────────
    // Unified exit decision: replaces scattered hasFinalAnswer, end_turn, and
    // completion-gap checks with a single scored signal pipeline.
    {
      const priorRedirects = newSteps.filter(
        (s) => s.type === "observation" && s.content.startsWith("\u26A0\uFE0F Not done yet"),
      ).length;
      const priorFAAttempts = state.steps.filter(
        (s) => s.type === "observation" && s.content.startsWith("\u26A0\uFE0F") && s.content.includes("final-answer"),
      ).length;

      // A2 — resolve the long-horizon guard scaling from mirrored meta so the
      // veto windows and the coverage gate budget match the arbitrate path.
      // `undefined` off the profile → run-cumulative veto + one-shot redirect.
      const oracleHorizon = resolveHorizonProfile({
        horizonProfile: state.meta.horizonProfile,
        maxIterations: (state.meta.maxIterations as number | undefined) ?? 0,
      });
      const oracleCtx: TerminationContext = {
        thought: thought.trim(),
        thinking: thinking?.trim(),
        stopReason: thoughtResponse.stopReason ?? "end_turn",
        toolRequest: null,
        iteration: state.iteration,
        steps: state.steps,
        priorThought: state.priorThought,
        entropy: state.meta.entropy?.latestScore as TerminationContext["entropy"],
        trajectory: state.meta.entropy?.latestTrajectory as TerminationContext["trajectory"],
        controllerDecisions: state.meta.controllerDecisions as TerminationContext["controllerDecisions"],
        // CHANGE A: hand the run-wide controller history to the oracle so
        // controllerSignalVetoEvaluator can detect pathological tactical
        // activity that should override an apparent successful exit.
        controllerDecisionLog: state.controllerDecisionLog,
        ...(oracleHorizon
          ? {
              vetoDecisionWindow: oracleHorizon.vetoDecisionWindow,
              redirectBudget: oracleHorizon.redirectBudget,
            }
          : {}),
        // E2 — surface the assessment phase ONLY under the profile so
        // controllerSignalVetoEvaluator stands down in synthesize (veto-at-
        // finish-line). Absent off the profile → byte-identical.
        ...(oracleHorizon && state.meta.assessment
          ? { assessmentPhase: state.meta.assessment.phase }
          : {}),
        toolsUsed: state.toolsUsed,
        requiredTools: (state.meta.requiredTools as string[]) ?? (input.requiredTools as string[]) ?? [],
        allToolSchemas: input.allToolSchemas ?? input.availableToolSchemas ?? [],
        redirectCount: priorRedirects,
        priorFinalAnswerAttempts: priorFAAttempts,
        taskDescription: input.task,
        // B2 check 2.5: hand the compiled RunContract to the terminal gate's
        // coverage check (via llmEndTurnEvaluator). Absent → tool-name coverage.
        ...(state.meta.runContract !== undefined
          ? { runContract: state.meta.runContract }
          : {}),
      };

      const decision = evaluateTermination(oracleCtx, defaultEvaluators);

      // CHANGE A: a "fail" verdict from the veto evaluator transitions to
      // status:"failed" — the kernel terminates and result.success becomes
      // false. The agent's textual output (if any) is discarded; the
      // veto reason becomes state.error.
      // Sprint 3.3 — both fail and exit verdicts now flow through the
      // Arbitrator via the oracle-decision intent. The Arbitrator
      // forwards the oracle's action and applies status:failed for fail,
      // status:done for exit. Output is assembled either way.
      if (decision.shouldExit) {
        const assembled = decision.output
          ? assembleOutput({
              steps: state.steps,
              finalAnswer: decision.output,
              terminatedBy: decision.reason,
              entropyScores: state.meta.entropy?.entropyHistory,
            })
          : { text: "" };
        const stateWithSteps = transitionState(state, {
          steps: newSteps,
          tokens: newTokens,
          inputTokens: newInputTokens,
          outputTokens: newOutputTokens,
          cost: newCost,
          priorThought: thought.trim(),
          iteration: state.iteration + 1,
        });
        return arbitrateAndApply(
          stateWithSteps,
          {
            kind: "oracle-decision",
            decision,
            output: assembled.text,
          },
          arbitrationContextFromState(stateWithSteps, {
            task: input.task,
            requiredTools: input.requiredTools,
          }),
          {
            evaluator: decision.evaluator,
            allVerdicts: decision.allVerdicts,
          },
        );
      }

      if (decision.action === "redirect") {
        const gapMsg = `\u26A0\uFE0F Not done yet — ${decision.reason}.\nComplete remaining actions before finishing.`;
        const gapStep = makeStep("observation", gapMsg, {
          observationResult: makeObservationResult("completion-guard", false, gapMsg),
        });
        yield* hooks.onObservation(state, gapMsg, false);
        return transitionState(state, {
          steps: [...newSteps, gapStep],
          tokens: newTokens,
          inputTokens: newInputTokens,
          outputTokens: newOutputTokens,
          cost: newCost,
          iteration: state.iteration + 1,
          priorThought: thought.trim(),
          meta: { ...state.meta, redirectCount: (priorRedirects + 1) },
        });
      }

      // Continue — update priorThought for next iteration's stability check
      state = transitionState(state, { priorThought: thought.trim() });
    }

    // No tool request and oracle said continue — increment iteration and loop
    return transitionState(state, {
      steps: newSteps,
      tokens: newTokens,
      inputTokens: newInputTokens,
      outputTokens: newOutputTokens,
      cost: newCost,
      iteration: state.iteration + 1,
    });
  });
}
