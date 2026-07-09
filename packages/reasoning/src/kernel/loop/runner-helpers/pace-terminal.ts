// File: src/kernel/loop/runner-helpers/pace-terminal.ts
//
// E3 terminal pace-action — forced synthesis before the budget cliff.
//
// Audit 05-#1: when the token/cost budget is exceeded, the arbitrator's
// pre-intent guard fires `exit-failure terminatedBy="budget_exceeded"`, which
// nulls the output — the run DISCARDS whatever it had gathered. The E1 pace band
// flips to `terminal` at burnRatio ≥ 0.95, one notch BEFORE the cliff at 1.0. On
// that band the loop calls this helper at iteration start (before the next think
// turn can push spend over the cliff): it runs ONE generous synthesis on the
// accumulated evidence and terminates with an HONEST status instead of a
// discarded failure.
//
// The termination reason is `budget_terminal`, a NON-FAILURE terminal reason:
//   - terminate()'s post-condition gate passes it through (the partial answer
//     ships instead of being nulled — the 05-#1 fix);
//   - the runner skips the post-loop verifier / required-tools / output gates for
//     it (already synthesized; re-verifying could null the partial answer);
//   - deriveTerminatedBy narrows it to `end_turn` → `goalAchieved` unknown, so a
//     PARTIAL run never reports a false success.
// When requirements are still outstanding, `meta.budgetTerminalPartial` +
// `verificationWarning` (naming what stayed unmet) carry the honest partial
// label.
//
// OPT-IN behind the long-horizon profile (the caller gates on it); off the
// profile this helper is never reached → byte-identical.

import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { harnessSynthesisDeliverable } from "@reactive-agents/core";
import type { LLMService } from "@reactive-agents/llm-provider";
import { terminate } from "../terminate.js";
import type { KernelState } from "../../state/kernel-state.js";
import { collectToolData } from "../finalize.js";
import { buildSynthesisPrompt } from "../output-synthesis.js";
import { extractOutputFormat } from "../../capabilities/comprehend/task-intent.js";
import { extractThinkingSafeContent } from "../../utils/stream-parser.js";
import { gatewayComplete } from "../../llm-gateway.js";
import { emitGuardFired } from "../../utils/diagnostics.js";
import { outstandingDescriptions } from "../../assessment/pace-actions.js";
import type { RunContract } from "../../contract/run-contract.js";
import type { RunAssessment } from "../../assessment/assess.js";

export interface TerminalSynthesisArgs {
  readonly state: KernelState;
  readonly task: string;
  /** The resolved LLM (from `Effect.serviceOption`), or `undefined` when absent. */
  readonly llm: LLMService["Type"] | undefined;
  readonly contract: RunContract;
  readonly assessment: RunAssessment;
  readonly taskId: string;
  readonly emitLog: (event: LogEvent) => Effect.Effect<void, never>;
}

/**
 * Force a final generous synthesis and terminate with `budget_terminal`. Reads
 * the accumulated tool evidence + any model draft, runs one generous synthesis
 * pass (skipped gracefully when no LLM or no material), and ships the result as
 * an honest — partial when requirements remain — answer. Never returns a
 * discarded/empty failure: an empty synthesis falls back to the raw evidence,
 * and the runner's §8.8 safety net backfills from candidates if even that is
 * empty.
 */
export function forceTerminalSynthesis(
  args: TerminalSynthesisArgs,
): Effect.Effect<KernelState, never, never> {
  return Effect.gen(function* () {
    const { state, task, llm, contract, assessment, taskId, emitLog } = args;

    const draft = (state.output ?? "").trim();
    const toolData = collectToolData(state.messages);
    // Prefer the accumulated tool evidence as the synthesis material; fall back
    // to whatever draft the model produced.
    const rawForSynthesis = toolData.length > 0 ? toolData : draft;

    const intent = extractOutputFormat(task);
    const format = intent.format ?? "prose";

    let synthOutput = draft;
    let synthesized = false;
    if (llm && rawForSynthesis.length > 0) {
      const prompt = buildSynthesisPrompt(rawForSynthesis, format, task, intent);
      // Generous budget — the deliverable render is the one place spend is always
      // justified (H3); synthesis is exempt from the E3 economize downshift.
      const resp = yield* gatewayComplete(
        llm,
        { purpose: "synthesize", budgetClass: "generous" },
        {
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          traceContext: { taskId, iteration: state.iteration },
        },
      ).pipe(Effect.catchAll(() => Effect.succeed({ content: "" })));
      const candidate = extractThinkingSafeContent(resp).content.trim();
      if (candidate.length > 0) {
        synthOutput = candidate;
        synthesized = true;
      }
    }
    // Never ship empty when there is material: fall back to the raw evidence.
    if (synthOutput.length === 0) synthOutput = rawForSynthesis;

    const outstanding = outstandingDescriptions(contract, assessment);
    const partial = outstanding.length > 0;
    const pct = Math.round(assessment.pace.burnRatio * 100);
    const warning = partial
      ? `Budget exhausted before completion (~${pct}% spent); ` +
        `${outstanding.length} requirement(s) unmet: ${outstanding.join("; ")}.`
      : undefined;

    yield* emitLog({
      _tag: "warning",
      message:
        `[pace-terminal] Budget terminal band (burnRatio=${assessment.pace.burnRatio.toFixed(2)}) — ` +
        `forcing final synthesis (synthesized=${synthesized}, outstanding=${outstanding.length}) ` +
        `before the budget_exceeded cliff can discard the answer`,
      timestamp: new Date(),
    });
    yield* emitGuardFired({
      taskId,
      iteration: state.iteration,
      guard: "pace_terminal",
      outcome: "terminate",
      reason: "budget_terminal",
      metadata: {
        burnRatio: assessment.pace.burnRatio,
        outstanding: outstanding.length,
        synthesized,
        outputChars: synthOutput.length,
      },
    });

    return terminate(state, {
      reason: "budget_terminal",
      deliverable: harnessSynthesisDeliverable([], undefined, synthOutput),
      extraMeta: {
        budgetTerminalPartial: partial,
        ...(warning ? { verificationWarning: warning } : {}),
      },
    });
  });
}
