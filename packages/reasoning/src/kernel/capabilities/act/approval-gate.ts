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
import { Effect } from "effect";
import { shouldGate, type ApprovalGateConfig } from "../decide/tool-gating.js";

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
export type BlockApprovalDecider = (pending: {
  readonly toolName: string;
  readonly args: unknown;
  readonly iteration: number;
}) => Effect.Effect<ApprovalDecision, never>;

/** The block-mode slice of a resolved approval policy this module reads. */
export interface BlockApprovalPolicy extends ApprovalGateConfig {
  readonly mode?: "detach" | "block";
  readonly decide?: BlockApprovalDecider;
}

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
 * passes through untouched. A non-gated tool (not named in `tools`, not matched
 * by `requireFor`) is never a gate — returns `{ gated: false }` immediately.
 */
export function resolveBlockApproval(
  toolName: string,
  args: unknown,
  policy: BlockApprovalPolicy | undefined,
  ctx: { readonly iteration: number },
): Effect.Effect<BlockApprovalOutcome, never> {
  return Effect.gen(function* () {
    if (policy?.mode !== "block") return { gated: false };
    if (!shouldGate(toolName, policy, ctx)) return { gated: false };

    // DENY-BY-DEFAULT: a gated call with no decider is refused, not executed.
    if (!policy.decide) {
      return { gated: true, approved: false, message: NO_DECIDER_MESSAGE(toolName) };
    }

    const decision = yield* policy.decide({ toolName, args, iteration: ctx.iteration });
    if (decision.approve) return { gated: true, approved: true };
    const reasonSuffix = decision.reason ? ` Reason: ${decision.reason}` : "";
    return {
      gated: true,
      approved: false,
      message: `[Tool "${toolName}" was denied by the approval handler.${reasonSuffix} Blocked — the call did not run.]`,
    };
  });
}

/** The plain callback shape the public builder accepts for in-process approval. */
export type ApprovalCallback = (pending: {
  readonly toolName: string;
  readonly args: unknown;
  readonly iteration: number;
}) => ApprovalDecision | boolean | Promise<ApprovalDecision | boolean>;

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
