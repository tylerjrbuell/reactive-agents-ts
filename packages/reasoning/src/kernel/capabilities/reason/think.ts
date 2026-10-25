/**
 * Think phase — calls the LLM and understands what it decided to do.
 *
 * Stage decomposition (GH #219 / HS-249): the ~2,100-line `handleThinking`
 * gen regrew into the same monolith family the #217/#218 decomps closed.
 * The phase now keeps its canonical request core inline — this file is the
 * GRANDFATHERED projector consumer (scripts/check-projection.sh pins
 * `toLLMMessages(` here, check-domain-only-fc.sh pins the `wireToolSchemas`
 * build site, and check-volatile-placement.sh pins `messagesForRequest`) —
 * and orchestrates verbatim stage modules under `capabilities/reason/`.
 * Zero behavior change; moved bodies are byte-identical:
 *
 * - `resolve-think-surface.ts`     — harness config, meta-tool injection,
 *                                    pressure gate, tool surface, W-Q
 *                                    intervention inputs, harness skill
 * - (this file, inline)            — request core: `project()` assembly
 *                                    (via `buildThinkProviderRequest`, the
 *                                    display-sanitizing wrapper over
 *                                    project(fromKernelState(...)) — see
 *                                    build-think-provider-request.ts),
 *                                    projection/ledger facts, recall gate,
 *                                    driver/rationale/index instructions,
 *                                    guidance tail, wire schemas
 * - `prepare-think-gateway-call.ts`— head-truncation guard, demand num_ctx,
 *                                    gatewayStream call construction
 * - `consume-think-stream.ts`      — stream init + consumption (`llm_error`
 *                                    is the single hard-failure path here)
 * - `normalize-think-response.ts`  — de-sanitization, `thoughtResponse`,
 *                                    max_output_tokens recovery, thought
 *                                    step, W-Q intervention stamp
 * - `dispatch-think-response.ts`   — text-parse transition, fast-path exit,
 *                                    native-FC resolver, no-resolver fallback
 * - `evaluate-think-termination.ts`— termination oracle + final pass state
 *
 * Small helper modules split from the header: `build-think-provider-request.ts`,
 * `tool-index-disclosure.ts`, `final-answer-heuristics.ts`,
 * `context-pressure.ts` (all re-exported below so existing import paths —
 * colocated tests, `kernel/loop/auto-checkpoint.ts` — resolve unchanged).
 *
 * Imported from `react-kernel.ts` as the "thinking" phase.
 */
import { Effect } from "effect";
import { LLMService, selectAdapter } from "@reactive-agents/llm-provider";
import type { LLMMessage } from "@reactive-agents/llm-provider";
import type { KernelState, KernelContext } from "../../../kernel/state/kernel-state.js";
import { transitionState, asKernelStateLike } from "../../../kernel/state/kernel-state.js";
import { sanitizeToolName } from "../attend/context-utils.js";
import { shouldInjectDriverInstructions } from "../decide/tool-gating.js";
import { emitToolSurfaceResolved, emitProjectionRendered, emitCuratorDecision, emitSignalRendered, emitSignalEffect } from "../../utils/diagnostics.js";
import { toLLMMessages } from "../../../assembly/to-llm-messages.js";
import { recordCompactionMarker, recordCompactionNoShrink, recordResultTruncation } from "../../ledger/emit.js";
import { filterRecallByOverflow, recallGateEnabled } from "./think-guards.js";
import { buildGuidanceText, type GuidanceContext } from "../../../context/guidance.js";
import { markRendered } from "../../state/signal-ledger.js";
import { closeSignal } from "../../state/signal-ledger.js";
import { classifySignalEffect } from "../../loop/runner-helpers/signal-effect.js";
import { META_TOOLS as META_TOOL_SET } from "../../../kernel/state/kernel-constants.js";
import { buildToolIndexText, buildToolIndexCallableSchemas } from "./tool-index-disclosure.js";
import { buildThinkProviderRequest } from "./build-think-provider-request.js";
import { resolveThinkToolSurface } from "./resolve-think-surface.js";
import { prepareThinkGatewayCall } from "./prepare-think-gateway-call.js";
import { consumeThinkStream } from "./consume-think-stream.js";
import { normalizeThinkResponse } from "./normalize-think-response.js";
import { dispatchThinkResponse, type ThinkTurnParams } from "./dispatch-think-response.js";
import { evaluateThinkTermination } from "./evaluate-think-termination.js";

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

/** Per-tier context pressure thresholds — local models get narrowed earlier. */
export { CONTEXT_PRESSURE_THRESHOLDS, shouldNarrowToFinalAnswerOnly } from "./context-pressure.js";

// Tool-index disclosure helpers (RA_TOOL_INDEX) — moved verbatim to
// tool-index-disclosure.ts; re-exported for existing import paths.
export { buildToolIndexCallableSchemas, buildToolIndexText } from "./tool-index-disclosure.js";

// Planning-pattern prose heuristics — moved verbatim to
// final-answer-heuristics.ts; re-exported for existing import paths.
export { looksLikeCompleteProse, looksLikeFinalAnswer } from "./final-answer-heuristics.js";

// Canonical provider-request assembly seam — moved verbatim to
// build-think-provider-request.ts; re-exported for existing import paths.
export { buildThinkProviderRequest } from "./build-think-provider-request.js";

/**
 * Think phase — the original `handleThinking` body, now the request core
 * plus a five-stage pipeline (see the module header for the stage map).
 * The phase signature contract is unchanged: (state, context) =>
 * Effect<KernelState, never, LLMService>. Every early exit
 * (`_tag: "failed"` stream failure, `_tag: "handled"` normalization
 * recovery, `handled: true` dispatch) returns the same KernelState the
 * pre-decomposition code returned at the same point; fall-through is the
 * oracle stage's decision. No behavior change — bodies moved verbatim.
 */
export function handleThinking(
  state: KernelState,
  context: KernelContext,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    // Stage 1 — tool-surface & guidance resolution (harness config, meta-tool
    // injection, pressure gate, W-Q intervention inputs, harness skill).
    const surface = yield* resolveThinkToolSurface({ state, context });
    const { input, profile } = context;
    const { toolSurface, promptSchemas, pipeline, effectiveSystemPrompt, missingRequiredForPressure, surfaceDeniedTool, surfaceGateNarrowed, deniedToolNames, h } = surface;
    // Prologue local (orig line 339) — consumed by the pipeline transforms
    // below; identical value to the surface stage's own binding.
    const strategy = state.strategy;

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
    // Signal consumption edge (2026-10-25): classify any signal that was
    // rendered in a prior pass but not yet closed. Classification is
    // deterministic (classifySignalEffect, no LLM) and uses the steps
    // produced since render (now present in state.steps).
    const ledgerNow = state.signalLedger ?? [];
    const priorRendered = ledgerNow.filter(
      (e) => e.state === "rendered" && e.effect === undefined && (e.renderedIter ?? -1) < state.iteration,
    );
    if (priorRendered.length > 0) {
      let nextLedger = ledgerNow;
      for (const entry of priorRendered) {
        const result = classifySignalEffect(entry.target, state.steps);
        nextLedger = closeSignal(nextLedger, entry.signalId, result.response, {
          observedTool: result.observedTool,
          detail: result.detail,
        });
        yield* emitSignalEffect({
          taskId: state.taskId,
          iteration: state.iteration,
          signalId: entry.signalId,
          response: result.response,
          observedTool: result.observedTool,
          detail: result.detail,
        });
      }
      state = transitionState(state, { signalLedger: nextLedger });
    }
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
    // - Slice C (HISTORICAL): profile.recentObservationsLimit once threaded
    //   through here. W2f census grep: it now has ZERO code readers — the
    //   field + its all-tier default 0 survive as a public profileOverrides
    //   surface whose effect died in a later curator refactor. Truth law:
    //   do not claim a thread that is not there. Removal (or re-wiring)
    //   is filed as DEBT D-2026-10-13-W2F-1.
    // Canonical context-assembly seam: systemPrompt+messages come from
    // project(), the SOLE assembler. (The legacy `curate()` fallback and its
    // `RA_ASSEMBLY` env gate were deleted in Sprint-1 A2, 2026-06-02 — see
    // below; there is no opt-out.) Cleared the default-on bar by the hardened
    // cross-tier A/B grid before that deletion
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
      // Dialect-blindness fix (2026-08-05): pass the REAL driver mode so the
      // in-prompt tool reference is skipped on native-FC (tools ride the FC
      // `tools` array); text-parse/weak-FC still get the in-prompt copy.
      context.toolCallingDriver.mode,
      h,
      input.remainingGoals,
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

    // ── FM-17 layer 1: record the result-truncated fact ─────────────────────
    // Mirrors the compaction-marker block above but reads per-MESSAGE projection
    // (project-results.ts), not the whole-thread compaction outcome — a result
    // can be individually truncated on a turn where compaction never ran.
    const truncatedRefs = trace.messages
      .filter((m) => m.projection === "preview+ref" && m.ref !== undefined)
      .map((m) => m.ref as string);
    if (truncatedRefs.length > 0) {
      // PHASE (finding C1): stamp the NEXT index, matching act.ts:1182/1205 and
      // kernel-state.ts's `projectStepsToLedger(patch.iteration)` convention.
      // `assess()` runs at the TOP of the pass (iterate-pass.ts) with
      // `currentIter = state.iteration`, i.e. BEFORE this projection — so a fact
      // stamped `state.iteration` here is never at `currentIter` when the next
      // assess() reads it, and the trailing-run stall computation sees
      // `has(currentIter) === false` forever. MEASURED before this fix on a real
      // 6-iteration run: stallCount was 0 on EVERY pass, so Layer C never fired.
      //
      // Holds for both return shapes of this function: the paths handing off
      // with `status: "acting"` leave the bump to act.ts, and the paths staying
      // "thinking" bump here — either way the state that reaches the next
      // assess() carries `state.iteration + 1`.
      state = transitionState(state, {
        ledger: recordResultTruncation(state.ledger, truncatedRefs, state.iteration + 1),
      });
    }
    // ── D1: projection-rendered trace event (the projector boundary) ──────────
    // The Projector is the last DAG node; emit its render as a replayable trace
    // line (sections + reachable refs + dropped refs + size) mirroring
    // contract-compiled / assessment. Best-effort: no bus → no-op.
    if (trace.projection) {
      // R4 — carry the per-result compression decisions + the capability window
      // the budgets came from, so the "crushed X→Y under budget B @ window W"
      // failure class surfaces in one trace/console line. Only preview+ref
      // results (the ones the model can't see in full) are interesting.
      const compressions = trace.messages
        .filter(
          (m): m is typeof m & { tool: string; rawChars: number; budget: number } =>
            m.projection === "preview+ref" &&
            typeof m.tool === "string" &&
            typeof m.rawChars === "number" &&
            typeof m.budget === "number",
        )
        .map((m) => ({
          tool: m.tool,
          rawChars: m.rawChars,
          shownChars: m.chars,
          budget: m.budget,
        }));
      yield* emitProjectionRendered({
        taskId: state.taskId,
        iteration: state.iteration,
        sections: trace.projection.sections.map((s) => s.name),
        refs: trace.projection.refs,
        droppedRefs: trace.projection.droppedRefs,
        chars: trace.projection.chars,
        window: trace.capability.window,
        tier: trace.capability.tier,
        ...(compressions.length > 0 ? { compressions } : {}),
      });

      // Curator-decision events — the emit side of a pipeline that was fully
      // built (event → execution-engine rationaleLog consumer → trace normalize
      // → diagnose debrief) but had ZERO callers, so trace/analyze.ts's blindspot
      // detector flagged "context kept/dropped/compressed (budget-inversion
      // evidence): emitCuratorDecision has 0 callers" on EVERY run. This is the
      // trace-side twin of the R4 console line: the projector's per-result
      // keep-vs-compress decision (the exact budget-inversion class fixed in
      // 838935cb) now reaches the debrief. Emit each COMPRESSED result (the
      // budget-relevant evidence); when a render compressed nothing, emit one
      // "kept" for the last projected result so a clean tool-using run still
      // clears the blindspot instead of tripping a false positive.
      const toolResults = trace.messages.filter(
        (m): m is typeof m & { ref: string } => m.role === "tool_result" && typeof m.ref === "string",
      );
      const compressedRefs = new Set<string>();
      for (const m of toolResults) {
        if (m.projection !== "preview+ref") continue;
        compressedRefs.add(m.ref);
        yield* emitCuratorDecision({
          taskId: state.taskId,
          iteration: state.iteration,
          action: "compressed",
          targetRef: m.ref,
          rationale: {
            why: `overflow: ${m.rawChars ?? m.chars} chars > budget ${m.budget ?? 0} (window ${trace.capability.window}, ${trace.capability.tier}) — projected as preview+ref`,
            refs: [m.ref],
          },
        });
      }
      const lastKept = [...toolResults].reverse().find((m) => !compressedRefs.has(m.ref));
      if (compressedRefs.size === 0 && lastKept) {
        yield* emitCuratorDecision({
          taskId: state.taskId,
          iteration: state.iteration,
          action: "kept",
          targetRef: lastKept.ref,
          rationale: {
            why: `fit: ${lastKept.chars} chars <= budget ${lastKept.budget ?? trace.capability.window} — kept full`,
            refs: [lastKept.ref],
          },
        });
      }
    }

    if (h.assemblyDebug) {
      console.error(`[RA_ASSEMBLY_TRACE] ${JSON.stringify({ taskId: state.taskId, iteration: state.iteration, capability: trace.capability, stages: trace.stages, messages: trace.messages, tools: trace.tools })}`);
    }

    // RA_PROMPT_DUMP — write the assembled prompt+messages to disk for diff.
    // Strictly diagnostic. Off by default. Path: /tmp/ra-prompt-dump-iter{N}.json
    const promptDumpPrefix = h.promptDumpPathPrefix;
    if (promptDumpPrefix) {
      const path = `${promptDumpPrefix}-iter${state.iteration}-${state.taskId.slice(-8)}.json`;
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
      input.auditRationale === true || h.auditRationale;
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

    // Lightweight tool index (2026-08-19, RA_TOOL_INDEX — see
    // wiki/Planning/Implementation-Plans/2026-08-19-lightweight-tool-index-progressive-disclosure.md).
    // Counter-proposal to 09 §5.2's discover-tools removal: `discover-tools`
    // never fires (§5.2's own evidence) because the model has no signal
    // anything is hidden — tool-surface.ts's `reasons` map already computes
    // WHY each tool is hidden, every iteration, but only for tracing. This
    // renders a cheap name+one-line index of the hidden set directly, no FC
    // schema tax. Default OFF pending an ablation-warden measurement.
    const toolIndexText = h.toolIndex
      ? buildToolIndexText(
          toolSurface.universe,
          toolSurface.visible,
          profile.toolIndexMaxEntries ?? h.toolIndexMaxEntries,
        )
      : "";

    const parts = [systemPromptText];
    if (driverInstructions) parts.push(driverInstructions);
    if (rationaleInstructions) parts.push(rationaleInstructions);
    if (toolIndexText) parts.push(toolIndexText);
    // Hotfix 0.5-1 (2026-07-07): GuidanceContext was previously assembled
    // (and pendingGuidance cleared) but never passed to assembly — every
    // guidance-channel signal was a silent no-op.
    //
    // Automatic-caching fix (2026-08-24): guidance used to be rendered into
    // the SYSTEM PROMPT's dynamic tail, on the claim that "tail placement
    // keeps the stable prefix intact." That claim was wrong — appending
    // anywhere inside the system STRING still changes the whole string's
    // content and hash, and Anthropic's prompt cache hierarchy puts system
    // before messages, so any system-content change invalidates the cache
    // for that call and everything downstream. Live traces confirmed this:
    // system-prompt length churned 444 -> 649 -> 444 -> 444 chars across
    // iterations, tracking exactly when guidance fired. Guidance now lands
    // as a trailing message-thread entry instead (see guidanceText's use
    // building `messagesForRequest` below) — the system prompt stays
    // byte-identical across iterations whenever nothing structural changed,
    // maximizing automatic-caching reuse, while the message thread's
    // EXPECTED per-iteration growth absorbs the volatile content, exactly
    // matching how the automatic-caching breakpoint is designed to move
    // forward. The guidance message is request-only — it is built from
    // `conversationMessages` (a fresh per-iteration projection, not the
    // kernel's canonical `state.messages`) and never written back to state,
    // so it stays as ephemeral as the old system-prompt-tail approach was.
    //
    // `prompt.guidance` compose hook (2026-08-16): of the 9 guidance channels
    // (required-tools reminders, oracle/ICS nudges, error-recovery, the
    // post-tool-call finish nudge, quality-gate hints, evidence-gap
    // redirects, etc.), only `loopDetected` had ANY override point before
    // this — the other 8 were pure hardcoded text with zero composability,
    // directly contradicting the "no black-box agents" design goal. This
    // exposes the FULL rendered block as one hook so `.compose(h =>
    // h.on('prompt.guidance', ...))` can inspect, replace, or suppress
    // (return null) whatever the harness is about to tell the model, same
    // as `prompt.system` already does for the user's own base prompt.
    const defaultGuidanceText = buildGuidanceText(guidance);
    const guidanceText = pipeline
      ? yield* Effect.promise(() =>
          pipeline.transform('prompt.guidance', defaultGuidanceText, {
            iteration: state.iteration,
            phase: 'think',
            state: asKernelStateLike(state),
            strategy,
          })
        )
      : defaultGuidanceText;
    // Signal consumption edge (2026-10-25): stamp render for every pending
    // signal whose guidance field actually composed non-empty text. Stamp
    // requires the composed GuidanceContext slice to be non-empty (Review
    // Focus 5); empty-field signals stay "open" (unobserved at run end).
    const pendingRefs = pending?.pendingSignals ?? [];
    if (pendingRefs.length > 0 && guidanceText && guidanceText.trim().length > 0) {
      for (const ref of pendingRefs) {
        const fieldVal = (guidance as unknown as Record<string, unknown>)[ref.field];
        if (typeof fieldVal === "string" && fieldVal.trim().length > 0) {
          state = transitionState(state, {
            signalLedger: markRendered(state.signalLedger ?? [], ref.signalId, state.iteration),
          });
          yield* emitSignalRendered({
            taskId: state.taskId,
            iteration: state.iteration,
            signalId: ref.signalId,
            renderedInIter: state.iteration,
            renderedSection: "guidance",
          });
        }
      }
    }
    const systemPromptWithDriver = parts.join("\n\n");
    // guidanceText rides as a trailing user-role message on the OUTGOING
    // request only — conversationMessages (and therefore state.messages)
    // stays untouched, so guidance never becomes part of persisted
    // conversation history that gets replayed/compacted/traced.
    const messagesForRequest: LLMMessage[] = guidanceText
      ? [...conversationMessages, { role: "user" as const, content: guidanceText }]
      : conversationMessages;

    // ── Control-plane invariant: the FC array is DOMAIN-ONLY on native-FC ────
    // (2026-08-08-control-plane-vs-meta-tools). A harness-scope tool
    // (terminate/discover/recall) in a native-FC tool slot is pure token tax +
    // misuse temptation — the harness reads control from the response shape
    // (no-tool-call = the `end_turn` terminal, arbitrator.ts:286/427) instead.
    // Text-parse/none KEEP them: those models cannot signal control by shape,
    // so the sentinels are load-bearing. Harness membership: the `scope` field
    // when set, else `META_TOOLS` (single source). Domain tools always stay, so
    // an in-progress task never loses a real affordance.
    const isNativeFC = context.toolCallingDriver.mode === "native-fc";
    const baseWireToolSchemas = isNativeFC
      ? gatedToolSchemas.filter(
          (ts) => ts.scope === "domain" || (ts.scope !== "harness" && !META_TOOL_SET.has(ts.name)),
        )
      : gatedToolSchemas;
    // The other half of the index fix (2026-08-19, see buildToolIndexCallableSchemas'
    // JSDoc) — only matters on native-fc (text-parse doesn't send a `tools:`
    // param at all, see the mode check below, so promoted schemas here are
    // harmless no-ops for it). Dedup against gatedToolSchemas defensively —
    // should never overlap by construction (promoted = hidden = not visible
    // = not in gatedToolSchemas) but a name collision must not double-list.
    const indexPromotedSchemas = h.toolIndex
      ? buildToolIndexCallableSchemas(
          toolSurface.universe,
          toolSurface.visible,
          profile.toolIndexMaxEntries ?? h.toolIndexMaxEntries,
        )
      : [];
    const wireToolSchemas = indexPromotedSchemas.length === 0
      ? baseWireToolSchemas
      : [
          ...baseWireToolSchemas,
          ...indexPromotedSchemas.filter(
            (ts) => !baseWireToolSchemas.some((existing) => existing.name === ts.name),
          ),
        ];
    const llmTools = wireToolSchemas.map((ts) => ({
      name: sanitizeToolName(ts.name),
      // W2d 2.4 (FC payload honesty): on compact profiles
      // ("names-only"/"names-and-types" — the local tier) the profile has
      // ALREADY declared this model cannot afford description prose, yet the
      // wire `tools:` array kept shipping it — measured ~4,000 corrected
      // tokens ≈49% of an 8K window, ~80% of that descriptions. The wire
      // array now honors the SAME semantics as the prompt-text stripper
      // above (description cleared, not a second stripper): name, types,
      // required list and enum values are KEPT; description strings are
      // dropped. Full-detail profiles (mid/large/frontier) are
      // byte-unchanged — big models keep tool fidelity.
      description: compactProfile ? "" : ts.description,
      inputSchema: {
        type: "object" as const,
        properties: Object.fromEntries(
          (ts.parameters ?? []).map((p) => [
            p.name,
            {
              type: p.type ?? "string",
              ...(compactProfile ? {} : { description: p.description }),
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

    // Stage 2 — gateway preflight (head-truncation guard, demand num_ctx,
    // gatewayStream construction). Acquires LLMService + the think temperature
    // (relocated from the prologue; deterministic same-instance yield).
    const gateway = yield* prepareThinkGatewayCall({ state, context, h, llmTools, systemPromptWithDriver, messagesForRequest });
    state = gateway.state;

    // Stage 3 — init + consume the LLM stream. Only hard failure path is
    // `terminatedBy: "llm_error"` (unchanged); single termination ownership
    // preserved (arbitrator decides, terminate.ts finalizes — never here).
    const stream = yield* consumeThinkStream({
      state: gateway.state,
      llmStreamEffect: gateway.llmStreamEffect,
      context,
    });
    if (stream._tag === "failed") return { ...stream.state, signalLedger: state.signalLedger ?? stream.state.signalLedger };

    // Stage 4 — normalize the consumed stream into the thought bundle.
    const response = yield* normalizeThinkResponse({
      state: stream.state,
      context,
      toolSurface,
      gatedToolSchemas,
      llmTools,
      systemPromptWithDriver,
      conversationMessages,
      missingRequiredForPressure,
      surfaceDeniedTool,
      surfaceGateNarrowed,
      deniedToolNames,
      accumulatedContent: stream.accumulatedContent,
      accumulatedThinking: stream.accumulatedThinking,
      accumulatedUsage: stream.accumulatedUsage,
      accumulatedLogprobs: stream.accumulatedLogprobs,
      accumulatedToolCalls: stream.accumulatedToolCalls,
      accumulatedStopReason: stream.accumulatedStopReason,
    });
    if (response._tag === "handled") return { ...response.state, signalLedger: state.signalLedger ?? response.state.signalLedger };

    // Shared turn context for the dispatch + oracle stages.
    const turn: ThinkTurnParams = {
      state: response.state,
      context,
      adapter,
      toolSurface,
      driverSchemas,
      driverInstructions,
      newSteps: response.newSteps,
      newTokens: response.newTokens,
      newInputTokens: response.newInputTokens,
      newOutputTokens: response.newOutputTokens,
      newCost: response.newCost,
      thought: response.thought,
      thinking: response.thinking,
      thoughtResponse: response.thoughtResponse,
      preparsedRationaleBlocks: response.preparsedRationaleBlocks,
      // Mutated in place by the de-sanitization pass above; same array.
      accumulatedContent: stream.accumulatedContent,
      accumulatedToolCalls: stream.accumulatedToolCalls,
      accumulatedStopReason: stream.accumulatedStopReason,
    };

    // Stage 5 — route the response (text-parse transition, fast-path exit,
    // native-FC resolver, no-resolver fallback) or fall through.
    const dispatched = yield* dispatchThinkResponse(turn);
    if (dispatched.handled) return { ...dispatched.state, signalLedger: state.signalLedger ?? dispatched.state.signalLedger };

    // Stage 6 — termination oracle + final pass state.
    return yield* evaluateThinkTermination({ ...turn, state: { ...dispatched.state, signalLedger: state.signalLedger ?? dispatched.state.signalLedger } });
  });
}
