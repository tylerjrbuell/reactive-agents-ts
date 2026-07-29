/**
 * Harness killswitch resolution — ONE place decides what each env flag means.
 *
 * `RA_LAZY_TOOLS` was read directly at three sites, and it gated three
 * INDEPENDENT mechanisms:
 *
 *   tool-capabilities.ts:128  `!== "0"` → register the `discover-tools` meta-tool
 *   think.ts:296              `!== "0"` → lazy per-iteration disclosure pruning
 *   system-prompt.ts:87       `=== "0"` → inject the verbose ReAct RULES block
 *
 * So `RA_LAZY_TOOLS=0` simultaneously removed discovery, disabled pruning AND
 * added a large prompt block — in opposite directions. Any ablation using it
 * moved three variables at once, which is precisely why F3 ("the kernel spends
 * model calls discovering tools the inline path simply uses") could not be
 * measured: there was no way to turn discovery off while leaving the pruning
 * that CREATES the need for discovery in place.
 *
 * That is the simplification program's root complaint in miniature — a harness
 * whose mechanisms cannot be ablated independently cannot be shown to earn
 * their cost. Splitting them is a prerequisite for measuring them, not a
 * cosmetic tidy-up.
 *
 * BACK-COMPAT IS EXACT. With no new variables set, `RA_LAZY_TOOLS=0` still
 * flips all three exactly as before, and the unset default is byte-identical to
 * the previous behaviour. The new variables are overrides: set one and it wins
 * for its own mechanism only.
 */

/** `undefined` when unset/blank, so an explicit "0" is distinguishable. */
function readFlag(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

/** A flag is OFF only on an explicit "0". Any other value is ON. */
function isOff(v: string | undefined): boolean {
  return v === "0";
}

/**
 * Per-iteration lazy tool disclosure: the visible set is
 * required ∪ relevant ∪ floor ∪ heuristic ∪ used ∪ discovered ∪ meta,
 * rather than every permitted tool.
 *
 * Default ON (since 2026-04-26). Off via `RA_LAZY_TOOLS=0`.
 */
export function lazyDisclosureEnabled(): boolean {
  return !isOff(readFlag("RA_LAZY_TOOLS"));
}

/**
 * Registration of the `discover-tools` meta-tool — the escape hatch that lets
 * the model surface a permitted tool that lazy disclosure pruned from view.
 *
 * Default ON. `RA_TOOL_DISCOVERY=0` turns off discovery ALONE, leaving pruning
 * intact — the arm F3 needs and could not previously express. Falls back to
 * `RA_LAZY_TOOLS` so the legacy compound switch keeps working.
 *
 * Note the dependency, which is real rather than incidental: with pruning off
 * every permitted tool is already visible, so discovery has nothing to add.
 */
export function toolDiscoveryEnabled(): boolean {
  const explicit = readFlag("RA_TOOL_DISCOVERY");
  if (explicit !== undefined) return !isOff(explicit);
  return !isOff(readFlag("RA_LAZY_TOOLS"));
}

/**
 * The verbose ReAct RULES block in the system prompt.
 *
 * Default OFF. Historically it rode the INVERSE of `RA_LAZY_TOOLS` (`=== "0"`),
 * so anyone disabling lazy tools to cut prompt size silently ADDED this block.
 * `RA_VERBOSE_RULES=1` now asks for it directly.
 */
export function verboseRulesEnabled(): boolean {
  const explicit = readFlag("RA_VERBOSE_RULES");
  if (explicit !== undefined) return !isOff(explicit);
  return readFlag("RA_LAZY_TOOLS") === "0";
}

/**
 * Stable tool surface — the FC `tools` array and the in-prompt tool reference
 * both stay fixed for the whole run instead of being narrowed per iteration.
 *
 * Default OFF. `RA_STABLE_TOOL_SURFACE=1` turns it on.
 *
 * WHY IT EXISTS. Anthropic caches by exact prefix and `tools` is position zero
 * of that prefix, so per-iteration narrowing invalidates every cache breakpoint
 * on every turn. Measured on haiku: the pruning arm spends 39,174 tokens for
 * $0.04518 with cacheRead 0; the non-pruning arm spends 66,719 tokens for
 * $0.03871 with cacheRead 40,277. Pruning wins 41% of tokens and loses 17% of
 * the money.
 *
 * WHY IT IS NOT THE DEFAULT. That is one measurement, one tier, one task shape.
 * Promotion goes through the 09 §6 lift rule on rungs 2 and 3 of the ladder.
 *
 * NOTE ON "LOGIT MASKING". The industry rule is that tool availability should be
 * controlled by masking rather than list mutation. The Anthropic API exposes no
 * per-tool masking — `tool_choice` is auto/any/tool(name)/none only — so that
 * rule cannot be applied literally here. Availability is instead enforced at
 * execution: the schema stays in the list and a call to a withheld tool returns
 * a corrective observation. Building a masking abstraction over an API that
 * cannot mask would be the over-engineering this program exists to stop.
 */
export function stableToolSurfaceEnabled(): boolean {
  return readFlag("RA_STABLE_TOOL_SURFACE") === "1";
}
