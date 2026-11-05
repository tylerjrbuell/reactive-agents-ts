/**
 * Think phase — response dispatch stage.
 *
 * `handleThinking`'s routing stage, moved verbatim from `think.ts` (#219 /
 * HS-249 decomposition). Everything that turns the normalized thought into
 * acting work or an early exit, or falls through to the termination
 * oracle: the W3a text-parse think→acting transition (GH #243 teaching/
 * parse single source), the fast-path trivial-task exit, the native FC
 * ToolCallResolver branch (tool_calls / final_answer / abstained /
 * thinking sub-branches), and the no-resolver fallback for direct calls.
 * Returns `{ handled: true, state }` for every acting/redirect transition,
 * `{ handled: false, state }` when the termination oracle must run —
 * `lastDialectObserved` state writes ride through unchanged on both arms.
 */
import { Effect } from "effect";
import { parseRationaleBlocks, type ToolCallSpec } from "@reactive-agents/tools";
import type { AssistantTurn } from "./assistant-turn.js";
import type { ProviderAdapter } from "@reactive-agents/llm-provider";
import type { StopReason } from "@reactive-agents/llm-provider";
import { sentinelDeliverable } from "@reactive-agents/core";
import { META_TOOLS as META_TOOL_SET } from "../../../kernel/state/kernel-constants.js";
import {
  guardRequiredToolsBlock,
  guardPrematureFinalAnswer,
  guardCompletionGaps,
  guardQualityCheck,
  guardDiminishingReturns,
  guardEvidenceGrounding,
} from "./think-guards.js";
import { gateNativeToolCallsForRequiredTools } from "../decide/tool-gating.js";
import { missingRequired } from "../verify/requirement-state.js";
import { proposeModelExit } from "../decide/model-exit-proposal.js";
import { hasFinalAnswer, extractFinalAnswer, stripPreamble } from "../../utils/tool-parsing.js";
import { assembleOutput } from "../../../kernel/loop/output-assembly.js";
import { terminate } from "../../../kernel/loop/terminate.js";
import { readTaughtCallShape, readTextParseTransitionMode } from "../../utils/text-parse-mode.js";
import { makeStep } from "../sense/step-utils.js";
import { makeObservationResult } from "../../utils/observation-helpers.js";
import { transitionState, type KernelState, type KernelContext } from "../../../kernel/state/kernel-state.js";
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";
import { injectSignal } from "../reflect/signal-injection.js";
import { checkAbstentionLegitimacy } from "../verify/abstention-legitimacy.js";
import { resolveToolSurface } from "./tool-surface.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import type { ReasoningStep } from "../../../types/index.js";
import { countEmptyNudges, guardUnresolvedToolCall, isToolCallShaped, UNRESOLVED_STEP_META } from "./unresolved-tool-call.js";
import { looksLikeFinalAnswer, looksLikeCompleteProse } from "./final-answer-heuristics.js";

/**
 * Shared turn context for the dispatch stage and the termination-oracle
 * stage (`evaluate-think-termination.ts`) — exactly the normalized
 * response + request-shape locals the verbatim stage bodies read.
 */
export interface ThinkTurnParams {
  readonly state: KernelState
  readonly context: KernelContext
  readonly adapter: ProviderAdapter
  readonly toolSurface: ReturnType<typeof resolveToolSurface>
  readonly driverSchemas: readonly ToolSchema[]
  readonly driverInstructions: string
  readonly newSteps: readonly ReasoningStep[]
  readonly newTokens: number
  readonly newInputTokens: number
  readonly newOutputTokens: number
  readonly newCost: number
  readonly thought: string
  readonly thinking: string | null
  readonly thoughtResponse: {
    readonly content: string
    readonly stopReason: StopReason
    readonly usage: {
      readonly inputTokens: number
      readonly outputTokens: number
      readonly totalTokens: number
      readonly estimatedCost: number
    }
    readonly model: string
    readonly thinking?: string
  }
  readonly preparsedRationaleBlocks: ReturnType<typeof parseRationaleBlocks>
  /** The turn as resolved by the assistant-turn boundary (assistant-turn.ts). */
  readonly assistantTurn: AssistantTurn
  readonly accumulatedContent: string
  readonly accumulatedToolCalls: { id: string; name: string; input: string }[]
  readonly accumulatedStopReason: string
}

/**
 * Route the normalized response into acting work or an early exit.
 * The boolean `handled` arm plus the (possibly `lastDialectObserved`-
 * mutated) state is all `think.ts` needs to choose between a direct
 * return and the oracle stage.
 */
export function dispatchThinkResponse(turn: ThinkTurnParams) {
  return Effect.gen(function* () {
    const {
      context, adapter, toolSurface, driverSchemas, driverInstructions,
      newSteps, newTokens, newInputTokens, newOutputTokens, newCost,
      thought, thinking, thoughtResponse, preparsedRationaleBlocks,
      accumulatedToolCalls,
    } = turn;
    let { state } = turn;
    const { input, profile, hooks } = context;
    // ── W3a Stage B: text-parse think→acting transition ──────────────────────
    // (spec 2026-06-03-driver-redesign Stage B; flag-gated, default `off` =
    // byte-unchanged). The driver already TEACHES the markup format and
    // PARSES it (`buildPromptInstructions` + `extractCalls`) — what was
    // missing was the TRANSITION: nothing moved a text-parse loop to
    // `acting`, so act.ts's text-parse `extractCalls` seam was unreachable
    // and a dialect-`none` model burned maxIterations emitting markup
    // (the S4 defect class). This block only DECIDES; dispatch stays
    // single-sourced in act.ts's existing pipeline (guards, policy choke
    // point, HealingPipeline, ledger seam — no second executor).
    //
    // TEACH/PARSE SINGLE SOURCE (GH #243): parsed against `driverSchemas`,
    // the same schema set the prompt's tool instructions were built from —
    // one grammar, builder is truth.
    if (context.toolCallingDriver.mode === "text-parse") {
      const textParseMode = readTextParseTransitionMode();
      if (textParseMode !== "off") {
        const parsed = context.toolCallingDriver.extractCalls(thought, driverSchemas);
        // GH #243 pin (review r1#2): the markup marker we detect AND the
        // format we re-teach on failure are READ from `driverInstructions` —
        // the same taught string this run's prompt was built from — never
        // hand-typed here. No structurally-readable block ⇒ no markup claim
        // (fail safe to today's path rather than guess a grammar).
        const taughtShape = readTaughtCallShape(driverInstructions);
        const markerPresent = taughtShape !== undefined && thought.includes(taughtShape.open);
        if (textParseMode === "shadow") {
          const parsedSummaries = parsed.map((c) => ({
            name: c.name,
            argumentKeys: Object.keys(c.arguments),
            parseMode: c.parseMode,
          }));
          // Observe-only promotion preflight: record the parse-diff (what
          // the parser saw vs. what the loop did — nothing) WITHOUT
          // touching the transition; falls through to today's exact path.
          if (parsed.length > 0 || markerPresent) {
            yield* emitHarnessSignalInjected({
              taskId: state.taskId,
              iteration: state.iteration,
              signalKind: "other",
              origin: "text-parse-shadow",
              content: `text-parse shadow: driver parsed ${parsed.length} call(s) from this turn's markup; loop acted on 0 (shadow mode).`,
              metadata: {
                textParseMode,
                parsedCalls: parsedSummaries,
                markerPresent,
                acted: false,
              },
            });
          }
        } else if (parsed.length > 0) {
          // act mode: map to the SAME acting flow. Ids mirror act.ts's own
          // text-parse mapping so the gated set and any legacy re-extraction
          // agree.
          const textParsedCalls: ToolCallSpec[] = parsed.map((e, i) => ({
            id: `text-parse-${state.iteration}-${i}`,
            name: e.name,
            arguments: e.arguments,
            ...(e.rationale ? { rationale: e.rationale } : {}),
          }));
          // Review r1#1 (controller ruling: mirror, not comment): run the
          // parsed batch through the SAME pure gate the native resolver
          // branch uses — per-tool budget prefilter (maxCallsPerTool Layer
          // 3, its only enforcement point), dependency-chain optional-batch
          // blocking, relevantTools pass-through, single-step mode
          // (nextMovesPlanning disabled ⇒ one call per step), and the
          // quotaBudgetConflict fail-fast via guardRequiredToolsBlock. No
          // remaining gate delta vs native is known at the decision point.
          const toolCallCounts = state.evidence.successfulCounts;
          const { effective, blockedOptionalBatch } = gateNativeToolCallsForRequiredTools(
            textParsedCalls,
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
              textParsedCalls,
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
            if (redirect) return { state: redirect, handled: true };
          }
          if (effective.length > 0) {
            // The native branch's exact transition shape: status acting +
            // the GATED set on pendingNativeToolCalls (act.ts dispatches it
            // ahead of any re-extraction) + meta.lastThought (this turn's
            // text) for the resume/legacy extraction fallback.
            return { state: transitionState(state, {
              steps: newSteps,
              tokens: newTokens,
              inputTokens: newInputTokens,
              outputTokens: newOutputTokens,
              cost: newCost,
              status: "acting",
              meta: {
                ...state.meta,
                pendingNativeToolCalls: effective,
                lastThought: thought,
                lastThinking: thinking,
              },
            }), handled: true };
          }
          // Parsed calls all gated out (budget/dep-chain) — fall through,
          // exactly as the native branch does on an emptied batch.
        } else if (markerPresent && taughtShape !== undefined) {
          // act mode + markup + zero parsed: NEVER silent. Deterministic,
          // observation-shaped message back into the loop (same house
          // pattern as the required-tools nudge), ledger-visible via the
          // existing observation → tool-result projection, retry
          // instruction on the guidance channel (no stray USER message).
          // The retry text QUOTES the live taught block (r1#2) — the nudge
          // itself speaks builder truth, so it cannot drift from the grammar.
          const failMsg =
            "text-parse: your reply contained " + taughtShape.open + " markup but no tool call " +
            "could be parsed. Re-emit exactly one call block in the taught format:\n" +
            taughtShape.block;
          const failStep = makeStep("observation", failMsg, {
            observationResult: makeObservationResult("system", false, failMsg),
          });
          yield* hooks.onObservation(state, failMsg, false);
          const failSignal = yield* injectSignal(state, {
            signalKind: "other",
            origin: "text-parse-parse-failure",
            content: failMsg,
            field: "errorRecovery",
            metadata: { textParseMode, parsedCalls: [], markerPresent: true, acted: false },
          });
          return { state: transitionState(failSignal.state, {
            steps: [...newSteps, failStep],
            tokens: newTokens,
            inputTokens: newInputTokens,
            outputTokens: newOutputTokens,
            cost: newCost,
            iteration: state.iteration + 1,
            priorThought: thought.trim(),
            pendingGuidance: { errorRecovery: failMsg, pendingSignals: failSignal.pendingSignals },
          }), handled: true };
        }
        // act mode, no markup, nothing parsed → today's path (answer/loop).
      }
    }

    // ── FAST-PATH: trivial task exit ─────────────────────────────────────────
    // If the turn is plain prose (assistant-turn disposition "prose": no resolved,
    // native or unresolved call — the boundary, not the shape regex, decides), no
    // FINAL ANSWER prefix (oracle's), and substantive, exit immediately without
    // the termination oracle or tool-parsing pipeline. Avoids 4-6 extra loop
    // iterations that meta-tool injection + entropy scoring add to simple Q&A.
    // SKIP fast-path when required tools are specified — the agent must use
    // them before it can exit, even if the model already knows the answer.
    //
    // NOT gated to iteration 0 (2026-09-04 root fix): a plain conversational
    // end_turn reply with no tool call is just as terminal on iteration 3 as
    // on iteration 0. Gating this to iteration 0 only meant a run that missed
    // the fast-path on its first pass (e.g. the model chose to "think" before
    // answering) had NO equivalent short-circuit afterward — every later
    // iteration fell through the full tool-oriented arbitrator pipeline with
    // no path to recognize "the model is just talking, not acting" until the
    // loop-detector's multi-iteration grace period (maxConsecutiveThoughts,
    // default 3-5) forcibly rescued it. Observed live: a banter/opinion chat
    // turn re-generated near-identical conversational replies for 6
    // iterations before `graceful_thought` finally delivered iteration 0's
    // answer verbatim — see wiki/Research/Harness-Reports/2026-09-04-*.
    // The reply is a CLAIM (Plan 9 item 2b): the exit gate disposes it
    // (decide/model-exit-proposal.ts), then the Arbitrator's veto still guards
    // every iteration this fires on.
    const hasRequiredTools = (input.requiredTools?.length ?? 0) > 0;
    if (
      !hasRequiredTools &&
      !thought.match(/ACTION:/i) &&
      !thought.match(/FINAL\s+ANSWER\s*[:：]/i) &&
      thought.trim().length > 20 && turn.assistantTurn.meta.disposition === "prose" && !isToolCallShaped(thought, toolSurface.universe) &&
      thoughtResponse.stopReason === "end_turn"
    ) {
      const output = thought.trim();
      const stateWithSteps = transitionState(state, {
        steps: newSteps,
        tokens: newTokens,
        inputTokens: newInputTokens,
        outputTokens: newOutputTokens,
        cost: newCost,
        priorThought: output,
        iteration: state.iteration + 1,
      });
      return { state: yield* proposeModelExit(stateWithSteps, input, { kind: "fast-path-completed", output }), handled: true };
    }

    // ── NATIVE FUNCTION CALLING BRANCH ─────────────────────────────────────
    // The LLM returns structured tool_use blocks instead of text-based ACTION:
    // directives. We resolve them through the ToolCallResolver.
    // Resolved ONCE upstream by the assistant-turn boundary (normalize stage).
    if (turn.assistantTurn.resolution) {
      const { result: resolverResult, dialect: dialectObserved } = turn.assistantTurn.resolution;

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
        // Run-wide per-tool call counts (seeded passes included) for budget enforcement.
        const toolCallCounts = state.evidence.successfulCounts;

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
          if (redirect) return { state: redirect, handled: true };
          // Falls through if the guard decides no redirect is needed (should be unreachable
          // while blockedOptionalBatch is true — guard always returns a state in that case).
        }

        if (effective.length > 0) {
          // Store pending native tool calls in meta for handleActing
          return { state: transitionState(state, {
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
          }), handled: true };
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
        if (redirect) return { state: redirect, handled: true };

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
          contract: state.meta.runContract,
        });
        // A FINAL ANSWER: prefix (via=regex) or a plain end_turn (via=end-turn):
        // a claim the exit gate disposes before the Arbitrator's verdict.
        const stateWithSteps = transitionState(state, {
          steps: newSteps,
          tokens: newTokens,
          inputTokens: newInputTokens,
          outputTokens: newOutputTokens,
          cost: newCost,
          priorThought: thought.trim(),
          iteration: state.iteration + 1,
        });
        return { state: yield* proposeModelExit(stateWithSteps, input, {
          kind: "agent-final-answer",
          via: hasFA ? "regex" : "end-turn",
          output: assembled.text,
        }), handled: true };
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
          return { state: terminate(stateWithAbstention, {
            reason: "abstained",
            deliverable: sentinelDeliverable("model-abstained"),
          }), handled: true };
        }

        // Illegitimate abstention — DO NOT terminate. Emit reject diagnostic step,
        // inject nudge via pendingGuidance, and let the loop continue.
        const nudgeMsg =
          legitimacyVerdict.nudge ??
          "You have not yet attempted the tools needed to ground an answer. Try them before abstaining.";
        const legitimacyRejectStep = makeStep("observation", nudgeMsg, {
          observationResult: makeObservationResult("abstention-legitimacy", false, nudgeMsg),
        });
        return { state: transitionState(state, {
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
        }), handled: true };
      } else if (resolverResult._tag === "thinking") {
        const thinkingContent = resolverResult.content.trim();
        // F2: shaped-but-unresolved reply — strike accounting (see module doc).
        const shaped = resolverResult.reason === "unresolved-tool-call";
        const strikeState = shaped
          ? yield* guardUnresolvedToolCall(state, turn, thinkingContent)
          : null;
        if (strikeState) return { state: strikeState, handled: true };
        const reqTools = input.requiredTools ?? [];
        const missingReq = missingRequired(
          state.evidence,
          reqTools,
          input.requiredToolQuantities, // run-wide: state.evidence holds the seed's calls
        );

        // ── A thought that reads as the answer is the model claiming done ───
        // Local models often write the full answer as a thought and never call
        // final-answer. Plan 9 item 2b: that is a PROPOSAL the exit gate
        // disposes (missing required tools, unmet delivery conditions, no
        // draft); the lexical checks below only mark the text as a draft.
        // Iteration 0 is skipped: the model gets one turn to act first. A run
        // that never needed or used a tool is held to the weaker prose check
        // (a banter reply has no headers or lists); anything else needs the
        // structural answer shape.
        const noToolNeeded =
          reqTools.length === 0 && ![...state.toolsUsed].some((t) => !META_TOOL_SET.has(t));
        const hasDraft = noToolNeeded
          ? looksLikeCompleteProse(thinkingContent)
          : looksLikeFinalAnswer(thinkingContent);
        if (state.iteration > 0 && !shaped && hasDraft) {
          const stateWithThought = transitionState(state, {
            steps: [...newSteps, makeStep("thought", thinkingContent)],
            tokens: newTokens,
            inputTokens: newInputTokens,
            outputTokens: newOutputTokens,
            cost: newCost,
            iteration: state.iteration + 1,
            priorThought: thinkingContent,
          });
          return { state: yield* proposeModelExit(stateWithThought, input, {
            kind: "agent-final-answer",
            via: "end-turn",
            output: thinkingContent,
          }), handled: true };
        }

        // ── Standard thinking handler ──────────────────────────────────────
        // Note: Even if all required tools are met, we continue the loop to
        // allow the model to call final-answer explicitly. The act phase will
        // accept final-answer once all required tools are satisfied.
        const consecutiveEmpty = !thinkingContent ? countEmptyNudges(newSteps) : 0;

        let thinkingSteps = [...newSteps];
        if (thinkingContent) {
          thinkingSteps = [...thinkingSteps, makeStep("thought", thinkingContent, shaped ? UNRESOLVED_STEP_META : undefined)];
        }

        let nudgeMessage: string | undefined;
        if (missingReq.length > 0) {
          const quantities = input.requiredToolQuantities ?? {};
          const successCounts = state.evidence.successfulCounts;
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
          if (diminishingRedirect) return { state: diminishingRedirect, handled: true };

          thinkingSteps = [...thinkingSteps, makeStep("observation", nudgeMessage, {
            observationResult: makeObservationResult("system", true, nudgeMessage),
          })];
        }

        // Route nudge through pendingGuidance instead of injecting a synthetic USER
        // message into the conversation thread. Rendered in the Guidance: section of
        // the next system prompt. Keeps the FC thread clean.
        return { state: transitionState(state, {
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
        }), handled: true };
      }
    }

    // ── NO-RESOLVER FALLBACK ────────────────────────────────────────────────
    // Without a toolCallResolver (executeReactive called directly) the LLM may still
    // emit native FC events: forward them to act.ts. A resolver that gated its batch
    // to zero (maxCallsPerTool) is final — re-dispatching here bypassed the budget.
    if (accumulatedToolCalls.length > 0 && turn.assistantTurn.resolution?.result._tag !== "tool_calls") {
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
        return { state: transitionState(state, {
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
        }), handled: true };
      }
    }

    // Fall through to the termination-oracle stage (think.ts).
    return { state, handled: false };
  });
}
