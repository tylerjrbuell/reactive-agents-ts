/**
 * decide/synthesis-retry.ts — synthesis-grounding retry gate (Sprint 3.4 Scaffold 3).
 *
 * synthesisQualityRetry: bounded scaffold-leak check that escalates an
 * agent-final-answer intent ONE more corrective iteration. Moved verbatim
 * from `arbitrator.ts` (GH #220 / quality program Task 7). Internal to the
 * decide/ cluster (arbitrateInner imports it).
 */

import { resolveScratchpadValue } from "@reactive-agents/tools";
import { detectScaffoldLeak } from "../verify/scaffold-leak.js";
import type { ArbitrationContext } from "./arbitration-types.js";

/**
 * Sprint 3.4 Scaffold 3 — synthesis-quality gate at the Arbitrator.
 *
 * For agent-final-answer intents, run the generalized grounding check on the
 * intent's output against the run's evidence corpus. When the synthesis is
 * ungrounded (or contains framework compression-marker echo) AND we haven't
 * yet retried, return an escalate("retry-with-feedback") Verdict instead of
 * exit-success. The runner consumes the escalation and runs ONE more
 * reasoning iteration with the feedback injected as guidance.
 *
 * Bounded by maxRetries (default 1) — first revision usually fixes it.
 */
export function synthesisQualityRetry(
  intent: { readonly output: string },
  ctx: ArbitrationContext,
): { readonly retry: false } | { readonly retry: true; readonly feedback: string } {
  // Cap at 1 retry — bounded cost; the model's first revision is usually
  // the right one. If a second pass also fails, accept the failure outcome
  // rather than looping.
  const SYNTHESIS_RETRY_MAX = 1;
  const currentRetries = ctx.synthesisRetryCount ?? 0;
  if (currentRetries >= SYNTHESIS_RETRY_MAX) return { retry: false };

  // Build the evidence corpus from prior observations. Look up scratchpad
  // for COMPLETE content when an observation has a `storedKey` — without
  // this the corpus only contains the compressed preview's first ~5 items
  // and the grounding check falsely rejects claims about items 6-N.
  const corpus = ctx.steps
    .filter(
      (s) =>
        s.type === "observation" &&
        typeof s.content === "string" &&
        s.content.trim().length > 0,
    )
    .map((s) => {
      const storedKey = s.metadata?.storedKey as string | undefined;
      const fullFromScratchpad =
        storedKey && ctx.scratchpad ? ctx.scratchpad.get(storedKey) : undefined;
      return fullFromScratchpad ? resolveScratchpadValue(fullFromScratchpad) : s.content;
    })
    .join("\n\n");

  if (corpus.length < 20) return { retry: false }; // no evidence → can't ground

  // Scaffold-leak echo is the only synthesis-quality failure this retry path
  // acts on: the model shipped framework internal scaffolding ([STORED:],
  // _tool_result_N, "compressed preview") instead of synthesizing real
  // content. (Prose claim-grounding was removed — it false-rejected legitimate
  // summaries at 64-73%.) No leak ⇒ no retry.
  const leak = detectScaffoldLeak(intent.output);
  if (!leak.leaked) return { retry: false };

  // Build feedback the model can act on.
  // IMPORTANT: do not include literal example strings of the bad output —
  // local models often copy quoted negative examples verbatim. Describe the
  // failure abstractly and instruct the model toward the desired shape.
  const feedback = `Your previous answer was rejected because it described the structure of the tool result instead of synthesizing the actual values. Use the concrete fields (titles, scores, names, numbers) from the tool observations above and produce the answer the user requested. Do not describe the data — present it.`;

  return { retry: true, feedback };
}
