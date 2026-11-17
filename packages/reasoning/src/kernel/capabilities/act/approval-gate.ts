/**
 * Block-mode approval gate — the in-process half of Durable HITL (Phase D).
 *
 * `.withApprovalPolicy()` has two modes:
 *
 *   - `mode: "detach"` — pause the whole run at the first gated call, persist a
 *     checkpoint, hand control back to the caller (`awaiting-approval`), resume
 *     from ANY process on `approveRun`/`denyRun`. Handled in the runner/act
 *     pause path + the strategy pre-checks; requires `.withDurableRuns()`.
 *
 *   - `mode: "block"` — decide each gated call IN PROCESS, synchronously, without
 *     pausing the run. This module. It is the default when durable runs are off.
 *
 * The load-bearing rule here is DENY-BY-DEFAULT. `mode: "block"` used to be an
 * inert no-op: every gate site keyed on `mode === "detach"`, nothing read
 * `"block"`, so a `requiresApproval` tool executed with no human decision — and
 * `"block"` is the mode you get from `.withApprovalPolicy(...)` without durable
 * runs, i.e. the common one (DEBT-REGISTER §3, empirically confirmed
 * 2026-07-23). A safety switch that silently does nothing is worse than none.
 * So a gated call with no configured decider is now REFUSED, never executed.
 *
 * `resolveBlockApproval` is the ONE decision every block-mode execution path
 * delegates to — the canonical `executeToolAndObserve` primitive (kernel single
 * path + plan-execute + blueprint), and the kernel's parallel-batch loop, which
 * bypasses the primitive. Sandbox strategies that run tools past the gate
 * (code-action) cannot honour per-call approval and refuse the run outright.
 */
import { Effect, Option } from "effect";
import { preflightToolCall, type ToolDefinition } from "@reactive-agents/tools";
import { shouldGate, type ApprovalGateConfig } from "../decide/tool-gating.js";
import type { ToolServiceInstance } from "../../state/kernel-state.js";

/** A human's decision on one gated call. `reason` is surfaced in the deny observation. */
export interface ApprovalDecision {
  readonly approve: boolean;
  readonly reason?: string;
}

/**
 * The resolved, Effect-wrapped block-mode decider. The public builder surface
 * accepts a plain callback (sync, or Promise-returning); `wrapApprovalDecider`
 * lifts it into this shape at config→envelope time so the pure kernel only ever
 * sees an Effect. Never fails — a throwing/rejecting callback denies (safe
 * direction), so the `never` error channel of the act phase is preserved.
 */
export type BlockApprovalDecider = (pending: PendingApproval) => Effect.Effect<ApprovalDecision, never>;

/** One gated call awaiting a decision, as the block-mode decider receives it. */
export interface PendingApproval {
  readonly toolName: string;
  readonly args: unknown;
  readonly iteration: number;
  /**
   * How long the decider should wait for a human, in ms, from the policy's
   * `timeoutMs`. Absent ⇒ the decider's own default. The kernel does not
   * enforce it; the decider does (and should deny on expiry).
   */
  readonly timeoutMs?: number;
}

// ── The approval policy, one shape per pipeline stage ─────────────────────────
//
// An approval policy crosses three boundaries on its way to the gate:
//
//   authored  .withApprovalPolicy({ ... })          — every field optional
//   configured  ReactiveAgentsConfig/RuntimeOptions — mode resolved, tools an
//               array (serialization-friendly), decider still a plain callback
//   resolved  KernelInput / RunEnvelope.rails       — tools a Set, decider lifted
//               into an Effect; what the pure kernel actually reads
//
// These differ only where they MUST: the tool container and the decider's
// representation. Everything else (`mode`, `requireFor`) exists once, here, and
// the two earlier stages are derived from the resolved shape — so a new field
// reaches all three by construction. This file is the sole declaration site;
// four hand-written copies of this shape had already drifted apart once
// (DEBT-REGISTER §3), which is what `scripts/check-cross-cutting.sh` Check 6
// now prevents by pinning the `"detach" | "block"` union to this file alone.

/** Which half of Durable HITL a gated call goes through. */
export type ApprovalMode = "detach" | "block";

/**
 * The resolved, kernel-facing approval policy — the CANONICAL shape. Both
 * `KernelInput.approvalPolicy` and `RunEnvelope.rails.approvalPolicy` are typed
 * as this, and the earlier stages below are derived from it.
 */
export interface ResolvedApprovalPolicy extends ApprovalGateConfig {
  readonly mode: ApprovalMode;
  /**
   * Block-mode in-process decider, lifted from the public `onApprove` callback
   * by `wrapApprovalDecider` at config→envelope time. Absent ⇒ deny-by-default.
   */
  readonly decide?: BlockApprovalDecider;
  /**
   * How long a block-mode decider waits for a human, in ms. Passed to the
   * decider as `timeoutMs`; absent ⇒ unchanged behaviour (the decider's own
   * default). Ignored in detach mode, where the run is paused, not waiting.
   */
  readonly timeoutMs?: number;
}

/**
 * Config stage: `tools` as a plain array and the decider in its unlifted public
 * callback form, both so an agent config stays structurally serializable.
 * `buildRunEnvelopeFromConfig` is the one seam that converts this to
 * {@link ResolvedApprovalPolicy}.
 */
export type ConfiguredApprovalPolicy = Omit<ResolvedApprovalPolicy, "tools" | "decide"> & {
  readonly tools: readonly string[];
  /**
   * In-process approval callback from `.withApprovalPolicy({ onApprove })`.
   * Distinct from `run()`'s `onApproval` option, which drives the DETACH
   * pause→resume loop and receives a `runId`; this one is in-loop and per-call.
   */
  readonly onApprove?: ApprovalCallback;
};

/**
 * Author stage: the public `.withApprovalPolicy()` argument. Every field is
 * optional — the builder resolves `mode` (from whether durable runs are on) and
 * folds per-tool `requiresApproval` flags into `tools`.
 */
export type AuthoredApprovalPolicy = Partial<ConfiguredApprovalPolicy>;

/**
 * Outcome of consulting the block-mode gate for one call.
 *
 * - `gated: false` — not a block-mode gated call; execute normally.
 * - `gated: true, approved: true` — the decider approved; execute.
 * - `gated: true, approved: false` — refused; do NOT execute, surface `message`
 *   as the observation so the model sees why and can adapt.
 */
export type BlockApprovalOutcome =
  | { readonly gated: false }
  | { readonly gated: true; readonly approved: true }
  | { readonly gated: true; readonly approved: false; readonly message: string };

const NO_DECIDER_MESSAGE = (toolName: string): string =>
  `[Tool "${toolName}" requires approval, but no approval handler is configured. ` +
  `Supply .withApprovalPolicy({ onApprove }) to decide in process, or ` +
  `.withApprovalPolicy({ mode: "detach" }) + .withDurableRuns() to pause for ` +
  `durable cross-process approval. Blocked — the call did not run.]`;

/**
 * Resolve the block-mode approval outcome for one tool call. Pure of any tool
 * execution — it only decides whether the call may proceed.
 *
 * Only fires for `mode: "block"`; `detach` is handled by the run-pause paths and
 * a call reaching here in detach mode has already been approved/resumed, so it
 * passes through untouched. A non-gated call (not named in `tools`, not matched
 * by `requireFor`, no shell command matching `commands`) is never a gate —
 * returns `{ gated: false }` immediately.
 */
export function resolveBlockApproval(
  toolName: string,
  args: unknown,
  policy: ResolvedApprovalPolicy | undefined,
  ctx: { readonly iteration: number },
): Effect.Effect<BlockApprovalOutcome, never> {
  return Effect.gen(function* () {
    if (policy?.mode !== "block") return { gated: false };
    if (!shouldGate(toolName, policy, { iteration: ctx.iteration, args })) return { gated: false };

    // DENY-BY-DEFAULT: a gated call with no decider is refused, not executed.
    if (!policy.decide) {
      return { gated: true, approved: false, message: NO_DECIDER_MESSAGE(toolName) };
    }

    const decision = yield* policy.decide({
      toolName,
      args,
      iteration: ctx.iteration,
      ...(policy.timeoutMs !== undefined ? { timeoutMs: policy.timeoutMs } : {}),
    });
    if (decision.approve) return { gated: true, approved: true };
    const reasonSuffix = decision.reason ? ` Reason: ${decision.reason}` : "";
    return {
      gated: true,
      approved: false,
      message: `[Tool "${toolName}" was denied by the approval handler.${reasonSuffix} Blocked — the call did not run.]`,
    };
  });
}

const hasPreflight = (def: object): def is Pick<ToolDefinition, "preflight"> =>
  "preflight" in def && typeof def.preflight === "function";

/**
 * The tool's own refusal for a call that would be put to approval, or
 * `undefined` to proceed. A call the tool is certain to refuse at execution
 * (shell command outside the allowlist) must never reach a human: the refusal
 * goes straight back to the model. Only gated calls are checked (ungated calls
 * keep today's path); no policy, no tool service, a tool without `preflight`,
 * or an unknown tool all proceed. The text comes from the tool — no tool
 * logic is duplicated here.
 */
export function preflightGatedCall(
  toolService: Option.Option<ToolServiceInstance>,
  toolName: string,
  args: Record<string, unknown>,
  policy: ApprovalGateConfig | undefined,
  iteration: number,
): Effect.Effect<string | undefined, never> {
  if (policy === undefined || Option.isNone(toolService)) return Effect.succeed(undefined);
  if (!shouldGate(toolName, policy, { iteration, args })) return Effect.succeed(undefined);
  return toolService.value.getTool(toolName).pipe(
    // `getTool` is typed narrowly; the real definition may carry `preflight`.
    Effect.map((def) => (hasPreflight(def) ? preflightToolCall(def, args) : undefined)),
    Effect.catchAll(() => Effect.succeed(undefined)),
  );
}

/**
 * The first call in `calls` that must pause for approval (detach mode): gated,
 * and not already refused by its tool's preflight. A preflight-refused call
 * never pauses the run — it flows on to the dispatch primitive, which returns
 * the refusal as a failed observation.
 */
export function firstDetachGatedCall<C extends { readonly name: string; readonly arguments: Record<string, unknown> }>(
  calls: readonly C[],
  policy: ApprovalGateConfig,
  iteration: number,
  toolService: Option.Option<ToolServiceInstance>,
): Effect.Effect<C | undefined, never> {
  return Effect.gen(function* () {
    for (const c of calls) {
      if (!shouldGate(c.name, policy, { iteration, args: c.arguments })) continue;
      if ((yield* preflightGatedCall(toolService, c.name, c.arguments, policy, iteration)) === undefined) return c;
    }
    return undefined;
  });
}

/** The plain callback shape the public builder accepts for in-process approval. */
export type ApprovalCallback = (
  pending: PendingApproval,
) => ApprovalDecision | boolean | Promise<ApprovalDecision | boolean>;

const normalizeDecision = (d: ApprovalDecision | boolean): ApprovalDecision =>
  typeof d === "boolean" ? { approve: d } : d;

/**
 * Lift a user-supplied approval callback into a `BlockApprovalDecider`.
 *
 * Accepts a boolean, an `ApprovalDecision`, or a Promise of either — and coerces
 * to the Effect-returning shape the kernel consumes. A callback that THROWS or
 * REJECTS denies the call (safe direction) rather than crashing the run: the
 * approval gate is a safety mechanism, and its own failure must fail closed.
 */
export function wrapApprovalDecider(callback: ApprovalCallback): BlockApprovalDecider {
  return (pending) =>
    Effect.promise(() => Promise.resolve(callback(pending))).pipe(
      Effect.map(normalizeDecision),
      Effect.catchAllDefect(() =>
        Effect.succeed<ApprovalDecision>({
          approve: false,
          reason: "approval handler threw — denied (fail-closed)",
        }),
      ),
    );
}
