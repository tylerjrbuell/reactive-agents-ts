// packages/llm-provider/src/user-capability.ts
//
// The caller-supplied capability tier.
//
// `.withModel({ model, numCtx })` is the user stating the model's context
// window. The capability layer used to ignore it, so when the live probe could
// not run — air-gapped box, a proxy that doesn't expose /api/show, an endpoint
// the framework couldn't reach — the model still resolved at the conservative
// 2048-token `source: "fallback"` entry, `.withStrictValidation()` failed the
// build, and the remedy it printed ("add it to STATIC_CAPABILITIES") asked the
// user to patch the framework for a fact they had already supplied.
//
// Trust ordering is preserved: this only fills the hole a failed probe leaves.
// A probe (or a static-table entry) always wins, because both know more than a
// single number — notably the tool-call dialect, which is NOT inferred here.
//
// Inferred rows (built from provider-reported metadata, see capability-reported.ts) ARE overridable:
// a context window is the one fact the caller can state better than a family
// default, and the inferred row keeps the dialect/thinking facts inference
// derived. The row is re-based on the inferred capability, not the fallback.
//
// Scope (2026-11-19): the declared window belongs to the agent/run that
// declared it. It is applied per call through
// `resolveCapability(provider, model, { userNumCtx })`, never stored in the
// process-wide registry, so another agent on the same model id without a
// numCtx still resolves the default. The process-global writer
// `registerUserSuppliedCapability` (capability-resolver.ts) is deprecated.

import { fallbackCapability, type Capability } from "./capability.js";
import { withoutProvisional } from "./capability-provisional.js";

/**
 * Apply a caller-declared context window to an already-resolved capability.
 *
 * Pure: reads nothing global and writes nothing. Returns `current` unchanged
 * when `numCtx` is absent or not a positive finite number, or when `current`
 * came from a probe / cache / static table / an earlier user row (measured or
 * declared facts outrank a single caller-supplied number). When `current` is
 * `inferred`, it is kept as the base (so `toolCallDialect` and
 * `supportsThinkingMode` survive); otherwise every conservative default from
 * `fallbackCapability` is kept except the window itself. In particular
 * `toolCallDialect` stays `"none"`, since a context size says nothing about how
 * the model wants tools passed.
 *
 * @param current - the capability the tiers resolved for (provider, model)
 * @param numCtx - the window the caller declared, e.g. `.withModel({ numCtx })`
 * @returns a `source: "user"` row, or `current` when the window does not apply
 */
export function applyUserNumCtx(current: Capability, numCtx: number | undefined): Capability {
  if (numCtx === undefined || !Number.isFinite(numCtx) || numCtx <= 0) return current;
  if (current.source !== "fallback" && current.source !== "inferred") return current;
  // A declared window is not the provisional hosted guess: drop the marker.
  const base =
    current.source === "inferred"
      ? current
      : withoutProvisional(fallbackCapability(current.provider, current.model));
  return {
    ...base,
    maxContextTokens: numCtx,
    recommendedNumCtx: numCtx,
    source: "user",
  };
}
