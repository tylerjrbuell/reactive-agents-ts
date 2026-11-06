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
import {
  buildRunEnvelope,
  wrapApprovalDecider,
  CONTEXT_PROFILES,
  fromDisclosureMode,
} from "@reactive-agents/reasoning";
import type { BuildRunEnvelopeOptions, RunEnvelopeData } from "@reactive-agents/reasoning";
import type { RunPosture, TaskContract } from "@reactive-agents/core";
import type { ReactiveAgentsConfig } from "../types.js";
import { disclosureHarness } from "./tool-disclosure.js";

/**
 * Resolve the disclosure-mode floor for the harness config: the profile's
 * explicit `toolDisclosureMode`, else the tier default (same tier heuristic
 * `kernel/loop/runner.ts` uses — ollama with no explicit tier ⇒ "local",
 * else "mid"), expanded to the three real mechanism switches.
 *
 * Closes F-4 (2026-08-24 external-research-convergence amendment, re-opened
 * 2026-09-03 architecture audit): `fromDisclosureMode()` existed and was
 * unit-tested but had zero production callers — every `ContextProfile`
 * tier's `toolDisclosureMode` (all 4 tiers set one) was declared and never
 * read. This is the floor, not the ceiling — an explicit
 * `config.reasoningOptions.harness` field still wins (see call site below),
 * and `.withTools({ disclosure })` wins over both (tool-disclosure.ts).
 */
export function disclosureFloor(config: ReactiveAgentsConfig): BuildRunEnvelopeOptions["harness"] {
  const tier =
    config.contextProfile?.tier ?? (config.provider === "ollama" ? "local" : "mid");
  const mode = config.contextProfile?.toolDisclosureMode ?? CONTEXT_PROFILES[tier].toolDisclosureMode;
  return mode ? fromDisclosureMode(mode) : undefined;
}

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
 * `initialAdvisory` is the conversation's prior to-do list (seeded into the
 * ledger at run start). It is per-run, not config, and only the TERMINAL pass
 * passes it: an auxiliary/continuation pass starts from a fresh ledger whose
 * facts merge into the run ledger, so re-seeding would duplicate the list.
 *
 * `auxiliaryPass` marks a pass as a FRAGMENT of a run whose grounding evidence
 * lives in a sibling pass — see `RunEnvelopePolicy.auxiliaryPass`.
 */
export type RunEnvelopeExtras = Pick<
  BuildRunEnvelopeOptions,
  "approvalDecision" | "interactionResponse" | "auxiliaryPass" | "initialAdvisory"
> & {
  /**
   * Rendered between-turn environment notice (chat engine). Lands on
   * `envelope.rails.environmentUpdate`; absent ⇒ the envelope is byte-identical
   * to one built without the feature. TERMINAL pass only, like `initialAdvisory`.
   */
  readonly environmentUpdate?: string;
  /**
   * Run posture. `"plan"` lands on `envelope.rails.posture`; absent/`"execute"`
   * ⇒ the key is ABSENT (envelope byte-identical). Carried on EVERY pass
   * (terminal, continuation, verification retry): posture is a restriction, so an
   * auxiliary pass must not regain the execute tool surface.
   */
  readonly posture?: RunPosture;
};

/**
 * Plan posture is plan-only: a `.withContract` taskContract's REQUIRED tools must
 * not reach the terminal mint (`requiredToolsForJudgment` falls back to
 * `envelope.policy.taskContract.tools`), or a plan turn that cannot call them
 * would be judged ungrounded. Drops `kind: "required"` entries; `available` /
 * `forbidden` entries and every other contract field are kept. Execute posture
 * never calls this (envelope byte-identical).
 */
function withoutRequiredTools(contract: TaskContract): TaskContract {
  return { ...contract, tools: contract.tools.filter((t) => t.kind !== "required") };
}

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
  const { environmentUpdate, posture, ...buildExtras } = extras;
  const envelope = buildRunEnvelope({
    taskContract:
      posture === "plan" && config.taskContract
        ? withoutRequiredTools(config.taskContract)
        : config.taskContract,
    fabricationGuard: config.fabricationGuard,
    grounding: config.grounding,
    stallPolicy: config.stallPolicy,
    // `.withTools({ disclosure })` expanded over the `.withHarness` switches;
    // unset ⇒ the caller's harness config unchanged. See tool-disclosure.ts.
    harness: disclosureHarness(config),
    // Lowest-priority layer, beneath env — see `resolveHarnessConfig`'s
    // `profileDefault` parameter. An explicit `harness` field above, or any
    // explicit `RA_*` env var, still wins.
    harnessProfileDefault: disclosureFloor(config),
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
    ...buildExtras,
  });
  if (!environmentUpdate && posture !== "plan") return envelope;
  const rails: RunEnvelopeData["rails"] = {
    ...envelope.rails,
    ...(environmentUpdate ? { environmentUpdate } : {}),
    ...(posture === "plan" ? { posture } : {}),
  };
  return { ...envelope, rails };
}
