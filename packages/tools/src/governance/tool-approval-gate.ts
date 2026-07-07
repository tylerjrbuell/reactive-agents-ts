/**
 * governance/tool-approval-gate.ts — service-layer authorization choke (hotfix 0.5-3, 2026-07-07).
 *
 * Architecture sweep (report 05) found `ToolService.execute` never enforced
 * `requiresApproval`/`riskLevel` despite a JSDoc `@throws ToolAuthorizationError`
 * — the only enforcement was the kernel HITL gate, and only in detach mode on
 * the kernel path. Direct `ToolService.execute` callers (plan-execute steps,
 * non-kernel consumers) bypassed approval entirely.
 *
 * This is the missing choke point: an OPTIONAL service consulted inside
 * `execute` before the handler runs, for any tool whose definition sets
 * `requiresApproval: true`. It is `serviceOption`-resolved (same opt-in idiom
 * as `ToolResultCache`) so:
 *   - unprovided → behavior byte-identical to today (no regression);
 *   - provided   → EVERY execute path (kernel + direct) is gated at one seam.
 *
 * The kernel's interactive/durable HITL flow remains the UX layer on top; this
 * gate is the fail-closed backstop that a caller can wire once to cover the
 * paths the kernel gate never saw. Unifying the two behind one decision source
 * is Phase 3/6 work (the ideal-architecture single-authority pillar); this
 * hotfix only makes the mechanism real and reachable.
 */
import { Context, Effect } from "effect";
import type { ToolDefinition } from "../types.js";

export interface ToolApprovalRequest {
  readonly toolName: string;
  readonly riskLevel: string | undefined;
  readonly requiresApproval: boolean;
  readonly arguments: Record<string, unknown>;
  readonly agentId: string;
  readonly sessionId: string;
}

export interface ToolApprovalDecision {
  readonly approved: boolean;
  /** Reason surfaced in the ToolAuthorizationError message when denied. */
  readonly reason?: string;
}

/**
 * Optional authorization decision service. When provided to the ToolService
 * layer, `execute` consults it for every `requiresApproval` tool and fails
 * closed (ToolAuthorizationError) on a non-approval.
 */
export class ToolApprovalGate extends Context.Tag("ToolApprovalGate")<
  ToolApprovalGate,
  {
    readonly authorize: (
      req: ToolApprovalRequest,
    ) => Effect.Effect<ToolApprovalDecision, never>;
  }
>() {}

/** True when the tool definition demands approval before execution. */
export const definitionRequiresApproval = (def: ToolDefinition): boolean =>
  def.requiresApproval === true;
