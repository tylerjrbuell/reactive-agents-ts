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

import { fallbackCapability, type Capability } from "./capability.js";
import { registerProbedCapability, resolveCapability } from "./capability-resolver.js";

/**
 * Register the context window the caller declared, unless something better is
 * already known.
 *
 * No-op when the model already resolves from a probe / cache / static table, or
 * when `numCtx` is not a positive number. The registered entry keeps every
 * conservative default from `fallbackCapability` except the window itself —
 * in particular `toolCallDialect` stays `"none"`, since a context size says
 * nothing about how the model wants tools passed.
 */
export function registerUserSuppliedCapability(
  provider: string,
  model: string,
  numCtx: number,
): void {
  if (!Number.isFinite(numCtx) || numCtx <= 0) return;
  if (resolveCapability(provider, model).source !== "fallback") return;

  const base = fallbackCapability(provider, model);
  const cap: Capability = {
    ...base,
    maxContextTokens: numCtx,
    recommendedNumCtx: numCtx,
    source: "user",
  };
  registerProbedCapability(cap);
}
