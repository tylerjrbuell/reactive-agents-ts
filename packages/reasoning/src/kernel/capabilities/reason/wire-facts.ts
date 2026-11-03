/**
 * reason/wire-facts.ts — the facts of the request that actually goes on the wire.
 *
 * The 2026-10-29 tracing audit (L3/L4) found a run could not be diagnosed from
 * its trace alone: `tool-surface-resolved` is emitted BEFORE the control-plane
 * strip / head-truncation ladder, `llm-exchange` records tool NAMES only, and
 * nothing said which resolver supplied `num_ctx` or whether the output budget
 * was clamped. This module builds those facts once, at the wire boundary, from
 * values the gateway preflight ALREADY computed (no recomputation, so the
 * record cannot disagree with what shipped), and emits them as a
 * `guard-fired{guard:"wire-request"}` event (the generic structured carrier —
 * `LLMExchangeEmitted` is a closed core type; promoting this to a first-class
 * `llm-exchange.wire` field is a core follow-up).
 */
import { Effect } from "effect";
import { BUILTIN_TOOL_NAMES } from "@reactive-agents/tools";
import { META_TOOLS } from "../../state/kernel-constants.js";
import { sanitizeToolName } from "../attend/context-utils.js";
import { emitGuardFired } from "../../utils/diagnostics.js";
import type { KernelState } from "../../state/kernel-state.js";

// Interface merging keeps kernel-state.ts (LOC-pinned) untouched.
declare module "../../state/kernel-state.js" {
  interface KernelMeta {
    /** Wire tool names shipped on the previous think call (for the per-turn surface diff). */
    readonly lastShippedTools?: readonly string[];
  }
}

/** Trace `guard` name of the wire-request facts event. */
export const WIRE_REQUEST_GUARD = "wire-request";

export type ToolProvenance = "builtin" | "meta" | "user" | "mcp";
export type NumCtxSource = "demand" | "explicit" | "profile" | "provider-default";

/**
 * Where a tool came from, derived deterministically from its canonical name:
 * harness meta-tools, the shipped builtin set, MCP (`{server}/{tool}` prefix),
 * else user-defined.
 */
export function classifyToolProvenance(canonicalName: string, scope?: "domain" | "harness"): ToolProvenance {
  if (scope === "harness" || META_TOOLS.has(canonicalName)) return "meta";
  if (BUILTIN_TOOL_NAMES.has(canonicalName)) return "builtin";
  if (canonicalName.includes("/")) return "mcp";
  return "user";
}

/** sanitized-wire-name → provenance, built from the canonical schemas the wire array was derived from. */
export function provenanceBySanitizedName(
  schemas: readonly { readonly name: string; readonly scope?: "domain" | "harness" }[],
): ReadonlyMap<string, ToolProvenance> {
  return new Map(schemas.map((s) => [sanitizeToolName(s.name), classifyToolProvenance(s.name, s.scope)]));
}

/** Added/removed wire tools vs the previous think call (`undefined` previous ⇒ first call, no diff). */
export function diffToolSurface(
  previous: readonly string[] | undefined,
  current: readonly string[],
): { readonly added: readonly string[]; readonly removed: readonly string[] } | undefined {
  if (previous === undefined) return undefined;
  const prev = new Set(previous);
  const cur = new Set(current);
  return { added: current.filter((n) => !prev.has(n)), removed: previous.filter((n) => !cur.has(n)) };
}

export interface WireFactsInput {
  readonly provider: string | undefined;
  /** numCtx the kernel put on the request (`request.numCtx`, only set by the demand policy); undefined ⇒ the provider resolves it (the guard ceiling mirrors that resolver). */
  readonly numCtxSent: number | undefined;
  /** Ceiling the head-truncation guard enforced against (`resolveEffectiveNumCtx`); undefined off-Ollama. */
  readonly effectiveCeiling: number | undefined;
  readonly explicitNumCtx: number | undefined;
  /** Output budget the gateway was asked for before / after the guard's clamp. */
  readonly outputBudgetRequested: number | undefined;
  readonly outputBudgetSent: number | undefined;
  readonly outputClamped: boolean;
  readonly promptTokensEstimate: number | undefined;
  readonly guardFired: boolean;
  /** Wire tool names, in order. */
  readonly shippedTools: readonly string[];
  readonly provenance: ReadonlyMap<string, ToolProvenance>;
  readonly previousShippedTools: readonly string[] | undefined;
}

/** Pure: assemble the metadata payload of the `wire-request` event. */
export function buildWireFacts(i: WireFactsInput): Record<string, unknown> {
  const numCtxSource: NumCtxSource =
    i.numCtxSent !== undefined
      ? "demand"
      : i.effectiveCeiling === undefined
        ? "provider-default"
        : i.explicitNumCtx !== undefined && i.explicitNumCtx === i.effectiveCeiling
          ? "explicit"
          : "profile";
  return {
    provider: i.provider ?? "unknown",
    numCtx: i.numCtxSent ?? i.effectiveCeiling ?? null,
    numCtxSource,
    effectiveCeiling: i.effectiveCeiling ?? null,
    outputBudgetRequested: i.outputBudgetRequested ?? null,
    outputBudget: i.outputBudgetSent ?? null,
    outputClamped: i.outputClamped,
    promptTokensEstimate: i.promptTokensEstimate ?? null,
    headTruncationGuardFired: i.guardFired,
    toolsShipped: i.shippedTools.map((name) => ({ name, provenance: i.provenance.get(name) ?? "user" })),
    toolSurfaceDiff: diffToolSurface(i.previousShippedTools, i.shippedTools) ?? null,
  };
}

/** Emit the wire facts and record the shipped surface for the next turn's diff. */
export function emitWireRequest(state: KernelState, facts: WireFactsInput): Effect.Effect<KernelState> {
  return emitGuardFired({
    taskId: state.taskId,
    iteration: state.iteration,
    guard: WIRE_REQUEST_GUARD,
    outcome: "pass",
    reason: "facts of the request shipped on the wire this think",
    metadata: buildWireFacts(facts),
  }).pipe(
    Effect.as({ ...state, meta: { ...state.meta, lastShippedTools: facts.shippedTools } } as KernelState),
  );
}
