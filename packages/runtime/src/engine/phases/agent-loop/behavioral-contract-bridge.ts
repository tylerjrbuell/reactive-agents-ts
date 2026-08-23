/**
 * Behavioral-contract → kernel-native enforcement bridge.
 *
 * Root cause fixed here: `BehavioralContractService.checkToolCall` /
 * `checkIteration` were only ever called from the inline direct-LLM agent
 * loop (`inline-act.ts` / `iteration-guards.ts`), which has been dead in
 * production since Move 1 (2026-08-13) made the kernel/`ReasoningService`
 * arm the sole real execution path. `checkOutput` was never called from
 * anywhere. See wiki/Architecture/DEBT-REGISTER.md for the finding.
 *
 * `packages/reasoning` (the kernel) may import ONLY core/llm-provider/memory/
 * tools — never `@reactive-agents/guardrails` or `@reactive-agents/runtime` —
 * so `BehavioralContractService` cannot be resolved from inside the kernel.
 * Instead of inventing new kernel-crossing plumbing, this module translates
 * each contract field into a mechanism the kernel ALREADY natively enforces:
 *
 *   - `deniedTools` / `allowedTools` → merged into `config.forbiddenTools`
 *     (prompt-visibility exclusion, `prepareReasoningToolSchemas`) AND
 *     `config.taskContract.tools` (the declared TaskContract the kernel
 *     compiles into `RunContract.constraints` — `compileRunContract` →
 *     `forbiddenTools()` → `evaluateToolPolicy` in
 *     `kernel/capabilities/act/act.ts` / `tool-observe.ts`, THE existing
 *     tool-policy gate) / `config.allowedTools` (the existing hard
 *     allowlist, same gate).
 *   - `maxIterations` → tightens `config.contextProfile.maxIterations`.
 *     `strategies/reactive.ts` already takes `Math.min` across the tier
 *     `contextProfile.maxIterations` hint and the builder's own
 *     `.withMaxIterations()` cap — injecting a tighter value here means the
 *     contract can only TIGHTEN the effective cap, never loosen it.
 *   - `maxToolCalls` has no direct kernel-native equivalent (a running count
 *     across ALL tool calls, not a per-tool-name allow/deny) — see
 *     `startMaxToolCallsGuard` below, which reuses `KillSwitchService`
 *     instead.
 *   - `checkOutput` (`maxOutputLength` / `deniedTopics` / `requireDisclosure`)
 *     has no kernel-native analog either — it is invoked directly from the
 *     shared post-arm code in `execution-engine.ts` once the final output is
 *     visible (see the `runFinalOutputContractCheck` there).
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { TaskContract, ToolRequirement } from "@reactive-agents/core";
import type { BehavioralContract } from "@reactive-agents/guardrails";
import { KillSwitchService } from "@reactive-agents/guardrails";
import type { ReactiveAgentsConfig } from "../../../types.js";
import type { EbLike } from "../../runtime-context.js";

/**
 * Merge a `BehavioralContract`'s tool-policy + iteration-cap fields into a
 * NEW `ReactiveAgentsConfig`, without mutating the caller's config. Pure.
 *
 * Merge precedence (documented, not obvious from the code alone):
 *   - `deniedTools` — UNION with any existing `config.forbiddenTools` /
 *     `config.taskContract` forbidden entries. A tool denied by EITHER the
 *     contract or the user's own `.withContract()` stays denied; denial
 *     never gets weaker by combining two sources.
 *   - `allowedTools` (allowlist) — INTERSECTION with any existing
 *     `config.allowedTools`. An allowlist is a restriction; combining two
 *     restrictions can only narrow the permitted set, never widen it. When
 *     only one side declares an allowlist, that side's list wins outright.
 *   - `maxIterations` — `Math.min` against whatever `contextProfile.maxIterations`
 *     already carries (see module doc above); the builder's own
 *     `.withMaxIterations()` is reconciled downstream in `reactive.ts`.
 */
export function mergeBehavioralContractIntoConfig(
  config: ReactiveAgentsConfig,
  contract: BehavioralContract,
): ReactiveAgentsConfig {
  let next: ReactiveAgentsConfig = config;

  // ── allowedTools (intersection) ──
  if (contract.allowedTools && contract.allowedTools.length > 0) {
    const existing = config.allowedTools;
    const merged =
      existing && existing.length > 0
        ? existing.filter((t) => contract.allowedTools!.includes(t))
        : [...contract.allowedTools];
    next = { ...next, allowedTools: merged };
  }

  // ── deniedTools (union) ──
  if (contract.deniedTools && contract.deniedTools.length > 0) {
    // Prompt-visibility exclusion (tool-schemas.ts reads config.forbiddenTools).
    const existingForbidden = new Set(config.forbiddenTools ?? []);
    for (const name of contract.deniedTools) existingForbidden.add(name);
    next = { ...next, forbiddenTools: [...existingForbidden] };

    // Kernel-enforced deny (compileRunContract → RunContract.constraints →
    // act.ts's evaluateToolPolicy). Extend the declared TaskContract's tool
    // list; synthesize a minimal valid TaskContract when the caller declared
    // none. `prompt`/`success` are structurally required by the type but are
    // NOT read by compileRunContract's forbidden-tool derivation (only
    // `.tools` is), so a permissive filler is safe here — it never surfaces.
    const existingTools: readonly ToolRequirement[] = config.taskContract?.tools ?? [];
    const existingForbiddenNames = new Set(
      existingTools.filter((t) => t.kind === "forbidden").map((t) => t.name),
    );
    const newForbiddenEntries: ToolRequirement[] = contract.deniedTools
      .filter((name) => !existingForbiddenNames.has(name))
      .map((name) => ({ kind: "forbidden" as const, name }));
    if (newForbiddenEntries.length > 0) {
      const taskContract: TaskContract = config.taskContract
        ? { ...config.taskContract, tools: [...existingTools, ...newForbiddenEntries] }
        : {
            prompt: "",
            tools: [...newForbiddenEntries],
            success: { type: "predicate", fn: () => true },
          };
      next = { ...next, taskContract };
    }
  }

  // ── maxIterations (tighten only) ──
  if (contract.maxIterations != null) {
    const existingProfileCap = config.contextProfile?.maxIterations;
    const tightened =
      typeof existingProfileCap === "number"
        ? Math.min(existingProfileCap, contract.maxIterations)
        : contract.maxIterations;
    next = {
      ...next,
      contextProfile: { ...next.contextProfile, maxIterations: tightened },
    };
  }

  return next;
}

/**
 * `maxToolCalls` has no kernel-native equivalent — it is a running count
 * across ALL tool calls for the run, not a per-tool-name allow/deny. Starts
 * an EventBus subscriber (this lives in `packages/runtime`, never
 * `packages/reasoning`) that counts `ToolCallCompleted` events scoped to
 * this task and, on exceeding the cap, calls `KillSwitchService.terminate()`
 * — the SAME abort mechanism `.stop()`/`.trigger()` already use, and the one
 * the kernel arm's run-fiber `AbortSignal` (wired at `ReactiveAgent.run()`
 * via `acquireRunSignal()`) already respects mid-flight. Reusing it means no
 * new abort mechanism for the kernel to learn about.
 *
 * No-op (returns a no-op unsubscribe) when `eb`/`ks` are unavailable or the
 * contract declares no `maxToolCalls` cap — zero cost on the common path.
 */
export function startMaxToolCallsGuard(args: {
  readonly eb: EbLike | null;
  readonly ks: {
    readonly terminate: (agentId: string, reason: string) => Effect.Effect<void>;
  } | null;
  readonly taskId: string;
  readonly agentId: string;
  readonly maxToolCalls: number | undefined;
}): Effect.Effect<() => void, never> {
  const { eb, ks, taskId, agentId, maxToolCalls } = args;
  return Effect.gen(function* () {
    if (!eb || !ks || maxToolCalls == null) return () => {};
    let count = 0;
    const unsubscribe = yield* eb.on("ToolCallCompleted", (event) => {
      if (event.taskId !== taskId) return Effect.void;
      count += 1;
      if (count > maxToolCalls) {
        return ks
          .terminate(
            agentId,
            `behavioral contract: max tool calls exceeded (${maxToolCalls})`,
          )
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({
                site: "runtime/src/engine/phases/agent-loop/behavioral-contract-bridge.ts:max-tool-calls-terminate",
                tag: errorTag(err),
              }),
            ),
          );
      }
      return Effect.void;
    });
    return unsubscribe;
  });
}

// Re-export for callers that only need the type (keeps execution-engine.ts's
// import list to one module for this feature).
export type { BehavioralContract };
export { KillSwitchService };
