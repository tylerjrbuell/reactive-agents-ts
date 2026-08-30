/**
 * run-envelope-config.ts — the ONE `ReactiveAgentsConfig → RunEnvelope` mapping.
 *
 * The cross-cutting cascade (2026-07-22) deleted seven hand-threaded strategy
 * input fields and replaced them with an ambient `RunEnvelope`. That fixed the
 * drop INSIDE the reasoning package — but it left the drop site one level up:
 * THREE runtime builders (`reasoning-think.ts`, `reasoning-harness-hooks.ts`,
 * `verification-think-retry.ts`) each re-enumerated the config→envelope mapping
 * by hand, and each of them ends in an `as unknown as ReasoningExecuteRequest`
 * cast, so the compiler checked nothing about `envelope`. A new wither would
 * have had to be remembered at 3 sites, which is the original defect class with
 * a smaller N (review finding I3, 2026-07-23).
 *
 * This module is that one seam. A new cross-cutting concern is added by editing
 * `BuildRunEnvelopeOptions` (reasoning) and this function — nothing else.
 * `scripts/check-cross-cutting.sh` check 4 fails CI if a reasoning execute
 * request is built without going through it.
 */
import { buildRunEnvelope, wrapApprovalDecider } from "@reactive-agents/reasoning";
import type { BuildRunEnvelopeOptions, RunEnvelopeData } from "@reactive-agents/reasoning";
import type { ReactiveAgentsConfig } from "../types.js";

/**
 * Per-pass additions the CONFIG cannot know about.
 *
 * `approvalDecision` / `interactionResponse` are one-shot FiberRef resume
 * values, not config: the runner applies them ONLY against a restored pause in
 * `resumeState` (`kernel/loop/runner.ts:595` —
 * `state.meta.awaitingApprovalFor && effectiveInput.approvalDecision`). A pass
 * that starts from a fresh kernel state provably cannot consume one, and
 * forwarding a stale decision to a LATER pass would be worse than dropping it:
 * it could satisfy a gate the human never saw. So the two continuation-style
 * builders omit them DELIBERATELY (verified 2026-07-23, review I3), and the
 * omission is expressed here as "the caller does not pass the extra" rather
 * than as a comment in three files.
 *
 * `auxiliaryPass` marks a pass as a FRAGMENT of a run whose grounding evidence
 * lives in a sibling pass — see `RunEnvelopePolicy.auxiliaryPass`.
 */
export type RunEnvelopeExtras = Pick<
  BuildRunEnvelopeOptions,
  "approvalDecision" | "interactionResponse" | "auxiliaryPass"
>;

/**
 * Build the run-wide `RunEnvelope` for one reasoning pass from the agent config.
 *
 * Every field is read from `config` exactly once, here. `approvalPolicy`'s
 * `tools` is widened from the config's array form to the `Set` the kernel gate
 * reads.
 */
export function buildRunEnvelopeFromConfig(
  config: ReactiveAgentsConfig,
  extras: RunEnvelopeExtras = {},
): RunEnvelopeData {
  return buildRunEnvelope({
    taskContract: config.taskContract,
    fabricationGuard: config.fabricationGuard,
    grounding: config.grounding,
    stallPolicy: config.stallPolicy,
    harness: config.reasoningOptions?.harness,
    approvalPolicy: config.approvalPolicy
      ? {
          mode: config.approvalPolicy.mode,
          tools: new Set(config.approvalPolicy.tools),
          requireFor: config.approvalPolicy.requireFor,
          // Block-mode in-process decider: lift the public `onApprove` callback
          // into the kernel's Effect-returning `decide` HERE, the ONE config→
          // envelope seam. `detach` ignores it (it pauses instead); absent in
          // block mode ⇒ `resolveBlockApproval` denies by default.
          ...(config.approvalPolicy.onApprove
            ? { decide: wrapApprovalDecider(config.approvalPolicy.onApprove) }
            : {}),
        }
      : undefined,
    ...extras,
  });
}
