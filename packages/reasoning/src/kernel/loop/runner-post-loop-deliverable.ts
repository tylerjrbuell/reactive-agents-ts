/**
 * runner-post-loop-deliverable.ts — §8 / §8.5 / §8.7-§8.8 post-loop
 * finalization clusters, decomposed VERBATIM from runner.ts (quality program
 * Task 9 / GH #222; formerly lines 1121-1171, 1173-1236, 1238-1306).
 *
 * Each function owns one banner block; bodies are byte-identical to the
 * originals modulo destructured params (Task 4 rule: explicit deps, same live
 * instances). §8.7-§8.8 is an Effect because §8.8 fires the (shadow-only,
 * never-mutating) grounding-fabrication judgment probe.
 */
import { Effect } from "effect";
import { modelSynthesisDeliverable } from "@reactive-agents/core";
import {
  transitionState,
  type KernelState,
  type KernelInput,
  type KernelRunOptions,
} from "../../kernel/state/kernel-state.js";
import { buildSuccessfulToolCallCounts } from "../../kernel/capabilities/verify/requirement-state.js";
import { findUnconsumedStoredKeys } from "../../kernel/capabilities/verify/unconsumed-evidence.js";
import { looksSubstantive } from "../../kernel/capabilities/verify/quality-utils.js";
import { judgmentGroundingFabricationShadowFromState } from "../../kernel/capabilities/verify/grounding-fabrication-judgment-shadow.js";
import { missingRequiredToolsForInput } from "./runner-helpers/state-queries.js";
import {
  assembleDeliverable,
  commitDeliverable,
  deliverableTerminationReason,
  countDeliverableCandidates,
  buildEffectiveToolsUsed,
} from "./runner-helpers/deliverable.js";

/** §8 — post-loop required-tools final safety net (pure state -> state). */
export function applyRequiredToolsFinalCheck(args: {
  readonly state: KernelState;
  readonly currentInput: KernelInput;
  readonly currentOptions: KernelRunOptions;
  readonly requiredTools: readonly string[];
  readonly isAwaitingApproval: boolean;
  readonly isAwaitingInteraction: boolean;
  readonly isAbstained: boolean;
  readonly isBudgetTerminal: boolean;
}): KernelState {
  let state = args.state;
  const { currentInput, currentOptions, requiredTools, isAwaitingApproval, isAwaitingInteraction, isAbstained, isBudgetTerminal } = args;

    // ── 8. Post-loop required tools check ───────────────────────────────────
    // Final safety net: if the loop exited without failure but required quotas
    // are still missing, fail with a deterministic missing_required_tool error.
    // This applies uniformly across all non-failed exits.
    if (
      state.status !== "failed" &&
      requiredTools.length > 0 &&
      !isAwaitingApproval &&
      !isAwaitingInteraction &&
      !isAbstained &&
      !isBudgetTerminal
    ) {
      const effectiveToolsUsed = buildEffectiveToolsUsed(state);
      const missingTools = missingRequiredToolsForInput(state.steps, currentInput, state.ledger);
      if (missingTools.length > 0) {
        const visibleTools = (currentInput.availableToolSchemas ?? []).map((t) => t.name);
        const allKnownTools = (currentInput.allToolSchemas ?? currentInput.availableToolSchemas ?? []).map((t) => t.name);
        const calledTools = [...effectiveToolsUsed];
        const terminatedBy = String(
          state.meta.terminatedBy ??
            (state.iteration >= currentOptions.maxIterations ? "max_iterations" : "unknown"),
        );
        // Render quantities so the user sees N/M satisfaction rather than a bare
        // tool name. Without this, a quota of 2 with 1 successful call looks
        // identical to "tool never called" in the error output.
        const successCounts = buildSuccessfulToolCallCounts(state.steps);
        const quantities = currentInput.requiredToolQuantities ?? {};
        const renderRequirement = (name: string) => {
          const need = quantities[name] ?? 1;
          const have = successCounts[name] ?? 0;
          return need > 1 ? `${name}×${need} (${have}/${need} satisfied)` : name;
        };
        // Invariant: status=failed implies output=null. Earlier paths
        // (loop_graceful, harness_deliverable) may have populated state.output
        // with a lastThought or assembled artifacts; once required-tool
        // satisfaction fails the run, those become invalid deliverables and
        // must be discarded — otherwise they leak as the user-visible answer
        // even though the run is structurally a failure.
        state = transitionState(state, {
          status: "failed",
          output: null,
          error:
            `Task incomplete — missing_required_tool: required tool(s) not called: ${missingTools.map(renderRequirement).join(", ")}.\n` +
            `required=[${requiredTools.map(renderRequirement).join(", ")}]\n` +
            `called=[${calledTools.join(", ")}]\n` +
            `available=[${allKnownTools.join(", ")}]\n` +
            `visible=[${visibleTools.join(", ")}]\n` +
            `terminatedBy=${terminatedBy}`,
        });
      }
    }
  return state;
}

/** §8.5 — non-authoritative termination -> harness deliverable (pure). */
export function applyNonFinalAnswerDeliverable(args: {
  readonly state: KernelState;
}): KernelState {
  let state = args.state;


    // ── 8.5. Non-authoritative termination → harness deliverable ───────────
    // When the model stopped without explicitly calling `final-answer` (e.g. an
    // `end_turn` text after a failed tool call, or a dispatcher-forced early
    // stop) and there are substantive tool artifacts, swap state.output for the
    // assembled deliverable so the quality gate has real data to synthesize
    // from. Without this, whatever the model emitted in its last turn — often
    // an apology, a hallucination, or the raw text of the last observation —
    // leaks through as the final answer.
    //
    // Scoped narrowly to explicit "model ended turn without final-answer"
    // markers so strategies that deliver their own output without setting
    // `terminatedBy` keep control of the output.
    //
    // ROOT-CAUSE FIX (2026-08-16, live QA): this used to fire unconditionally
    // whenever `terminatedBy` matched AND any tool artifact existed — it never
    // looked at `state.output` first. Traced with a raw prompt/state dump on a
    // native-FC model (gemma4:e4b, `.run('Whats the price of XRP and
    // bitcoin?')`, no requiredTools): at the exact moment this ran,
    // `state.output` was ALREADY the model's own correct, complete answer
    // ("The current price of XRP is $0.999731 and the current price of
    // Bitcoin (BTC) is $63,101.") — this block clobbered it with a raw
    // tool_artifact reconstruction anyway, purely because terminatedBy=
    // "end_turn" and one tool call had happened, then labeled the model's own
    // (discarded) answer "harness-authored" and paid for an extra output-gate
    // LLM resynthesis pass to reproduce what the model had already written
    // correctly. Native-FC's control-plane design (think.ts's `wireToolSchemas`
    // filter, "the harness reads control from the response shape" — no
    // `final-answer` TOOL is even offered) makes end_turn-with-real-text the
    // EXPECTED, common completion shape for these models, not an edge case —
    // so this was overfiring on the majority path, not a rare one.
    // Now only steps in when state.output is empty OR reads as a non-answer
    // (a short apology/incapability statement — `looksSubstantive`,
    // quality-utils.ts) — the actual "apology, hallucination, or raw
    // observation text" case the comment above describes. When the model DID
    // write something substantive, §8.7 below promotes it as `model_synthesis`
    // instead, and the verifier's other content-quality checks (harness-
    // parrot, shallow-giveup, continuation-intent, scaffold-leak — verifier.ts
    // checks 3c-3e, 4b) still run against whatever ships either way, so
    // genuinely bad model text is still caught; it's just no longer thrown
    // away UNSEEN the moment it happens to be non-empty.
    const nonFinalAnswerTerminations = new Set([
      "end_turn",
      "llm_end_turn",
      "dispatcher-early-stop",
      "low_delta_guard",
    ]);
    if (
      state.status === "done" &&
      typeof state.meta.terminatedBy === "string" &&
      nonFinalAnswerTerminations.has(state.meta.terminatedBy) &&
      !looksSubstantive(state.output ?? "")
    ) {
      const artifactCount = countDeliverableCandidates(state);
      if (artifactCount > 0) {
        const previousTerminatedBy = state.meta.terminatedBy;
        const deliverable = assembleDeliverable(state);
        // Single-writer: commitDeliverable owns state.output; we hand it the
        // terminatedBy promotion to stamp alongside (Sprint-1 P1 mission 2A).
        state = commitDeliverable(state, deliverable, {
          terminatedBy: deliverableTerminationReason(deliverable),
          previousTerminatedBy,
        });
      }
    }
  return state;
}

/** §8.7 + §8.8 — output-ownership consolidation + empty-output fallback. */
export function applyOutputOwnershipCluster(args: {
  readonly state: KernelState;
}): Effect.Effect<KernelState, never, never> {
  return Effect.gen(function* () {
    let state = args.state;

    // ── 8.7. Output ownership consolidation ──────────────────────────────────
    // The kernel must own the final output. Strategy adapters (reactive.ts,
    // plan-execute.ts, etc.) historically had their own fallback chains
    // (state.output ?? lastThought ?? null) that ran AFTER runKernel returned
    // — bypassing the verifier gate below. Pull those fallbacks here so:
    //   1. state.output reflects exactly what the user will receive
    //   2. the verifier sees the actual deliverable before it ships
    //   3. strategy adapters can return state.output directly with no synthesis
    //
    // Only fills from lastThought when status=done. Failed runs were already
    // forced to output=null by the transitionState invariant.
    //
    // 2026-08-15 root fix (5th funnel): this ran BEFORE §8.8 and unconditionally
    // accepted ANY non-empty lastThought — including runs where terminatedBy is
    // null/outside the §8.5 whitelist (e.g. no explicit terminal reason at all,
    // measured live on a gemini-2.5-flash trace). Because it always satisfies
    // `!state.output`, §8.8's assembleDeliverable() call — which HAS the
    // unconsumed-evidence check from 68e0b0d5 — never ran on this path. Skip
    // here when unconsumed evidence exists and there are grounded observations
    // to fall back to, so §8.8 gets the case instead.
    const skip87ForUnconsumedEvidence =
      findUnconsumedStoredKeys(state.steps).length > 0 &&
      countDeliverableCandidates(state) > 0;
    if (state.status === "done" && !state.output && !skip87ForUnconsumedEvidence) {
      const lastThought = [...state.steps]
        .filter((s) => s.type === "thought")
        .pop();
      if (lastThought?.content && lastThought.content.trim().length > 0) {
        // Sprint-1 B2 / P1 mission 2A: typed DeliverableProvenance channel.
        // Construct a model_synthesis Deliverable and route it through the
        // single writer commitDeliverable (no extraMeta — this path does not
        // own terminatedBy, so the existing reason is preserved). Raw-string
        // mutations of state.output are the anti-pattern this collapses.
        const deliverable = modelSynthesisDeliverable({
          type: "thought",
          content: lastThought.content,
          iteration: state.iteration,
        });
        state = commitDeliverable(state, deliverable);
      }
    }

    // ── 8.8. Output-ownership invariant — never ship empty output when work
    // was done. §8.5's harness-deliverable assembly keys off a NARROW
    // terminatedBy whitelist (end_turn/dispatcher-early-stop/...). But the
    // arbitrator's early-stop stamps terminatedBy="controller_early_stop:<reason>"
    // (arbitrator.ts) and other done-terminations fall outside the set too, so a
    // `done` run could reach the verifier with state.output empty despite
    // substantive tool artifacts — the 2026-06-29 cross-tier sweep saw gpt-4o-mini
    // (22418 tok) and sonnet ship output="" with status=done on exactly this path.
    // This general fallback assembles a deliverable from the accumulated work
    // whenever a done run has empty output but deliverable candidates exist —
    // immune to terminatedBy string drift, and additive (fires ONLY on empty
    // output, so it can never override a path that already produced output).
    if (
      state.status === "done" &&
      !state.output &&
      countDeliverableCandidates(state) > 0
    ) {
      // Task 3 (Phase D leverage plan, shadow-only): fire the
      // grounding-fabrication judgment shadow alongside the SAME
      // deterministic content-containment check `assembleDeliverable`
      // consults (`evaluateUnconsumedEvidenceGrounding`) — this is the most
      // general, terminatedBy-drift-immune reach of that check across
      // done-run terminations. Fire-and-forget; never alters `state` or the
      // deliverable this branch commits.
      yield* judgmentGroundingFabricationShadowFromState(state);
      state = commitDeliverable(state, assembleDeliverable(state));
    }
    return state;
  });
}
