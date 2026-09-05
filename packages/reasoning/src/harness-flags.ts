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
export function lazyDisclosureEnabled(defaultValue = true): boolean {
  const v = readFlag("RA_LAZY_TOOLS");
  return v === undefined ? defaultValue : !isOff(v);
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
export function toolDiscoveryEnabled(defaultValue = true): boolean {
  const explicit = readFlag("RA_TOOL_DISCOVERY");
  if (explicit !== undefined) return !isOff(explicit);
  const lazy = readFlag("RA_LAZY_TOOLS");
  return lazy === undefined ? defaultValue : !isOff(lazy);
}

/**
 * Always-visible lightweight index of hidden-but-permitted tools (progressive
 * disclosure, 2026-08-19 — counter-proposal to 09-UNIFIED-PROGRAM.md §5.2's
 * discover-tools removal ruling). `discover-tools` is a REACTIVE meta-tool —
 * the model must already suspect something is hidden to think to call it,
 * and `tool-surface.ts`'s own reason map (why each tool is hidden) is
 * computed every iteration but never rendered into the prompt, so the model
 * has zero signal. This renders a cheap name+one-line index of currently
 * hidden tools directly in the dynamic tail instead — no FC schema tax, just
 * plain text, only present when something is actually hidden.
 *
 * Default OFF pending an ablation-warden cross-tier measurement — see
 * wiki/Planning/Implementation-Plans/2026-08-19-lightweight-tool-index-progressive-disclosure.md.
 * `RA_TOOL_INDEX=1` to enable for probing.
 */
export function toolIndexEnabled(defaultValue = false): boolean {
  const v = readFlag("RA_TOOL_INDEX");
  return v === undefined ? defaultValue : v === "1";
}

/**
 * Env-flag fallback for `ContextProfile.toolIndexMaxEntries` ("hybrid" mode's
 * cap — see context-profile.ts) — no public builder API sets the field
 * per-run yet, so this is the only way to drive it outside a
 * `CONTEXT_PROFILES` tier default. `profile.toolIndexMaxEntries` always wins
 * when set; this is consulted only as a fallback. Unset ⇒ undefined (no cap,
 * "index" mode's behavior).
 */
export function toolIndexMaxEntriesFlag(): number | undefined {
  const raw = readFlag("RA_TOOL_INDEX_MAX_ENTRIES");
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
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
 * Recency budget override (chars) — Task 15 ablatability audit.
 *
 * Was read directly at `assembly/capability.ts`. Test/ablation knob: forces
 * the recency budget low so a normal-sized tool result deterministically
 * exercises the summary+ref overflow branch. `undefined` (unset) leaves the
 * derived budget (`window * 0.35 * 4`) untouched — this does not gate a
 * mechanism on/off, it overrides one input to an always-on computation, which
 * is exactly why it belongs in the same registry as the on/off switches: a
 * direct read here duplicated the "which of N sites decides this" problem
 * `RA_LAZY_TOOLS` created, just for a number instead of a boolean.
 */
export function recencyBudgetCharsOverride(): number | undefined {
  const v = readFlag("RA_RECENCY_BUDGET_CHARS");
  return v === undefined ? undefined : Number(v);
}

/**
 * Per-result tool-output preservation budget override (chars) — Task 15.
 *
 * Was read directly at `assembly/capability.ts`. Env override for ablation;
 * `undefined` (unset) leaves the tier default (`TIER_TOOL_RESULT_PRESERVE`)
 * untouched.
 */
export function toolResultBudgetCharsOverride(): number | undefined {
  const v = readFlag("RA_TOOL_RESULT_BUDGET_CHARS");
  return v === undefined ? undefined : Number(v);
}

/**
 * Thought continuity — render the prior turn's recorded thought as the
 * replayed assistant content, instead of `content: ""`.
 *
 * Default OFF. `RA_THOUGHT_CONTINUITY=1` turns it on. Experimental, pending
 * ablation (rung1 sweep 2026-07-28: INERT on the current golden corpus — see
 * `wiki/Research/Harness-Reports/2026-07-28-rung1-flag-inertness.md`).
 *
 * Was read directly at `assembly/stages/project-results.ts:67`.
 */
export function thoughtContinuityEnabled(): boolean {
  return readFlag("RA_THOUGHT_CONTINUITY") === "1";
}

/**
 * Single/batch tool-observation symmetry (Phase E2).
 *
 * Default OFF: the single-tool-call path stays byte-identical (no
 * verification, no semantic-memory write). `RA_TOOL_OBSERVE_SYMMETRY=1` makes
 * the single path also attach a VerificationResult and fork the daemon
 * semantic-memory store, matching the batch path. HOT-PATH behavior change,
 * gated so it can be benched live before any default-on decision (rung1
 * sweep 2026-07-28: INERT on the current golden corpus).
 *
 * Was read directly at `kernel/capabilities/act/act.ts:166`.
 */
export function toolObserveSymmetryEnabled(): boolean {
  return readFlag("RA_TOOL_OBSERVE_SYMMETRY") === "1";
}

/**
 * Rationale-audit gate — MANDATORY per-tool-call rationale blocks.
 *
 * Default OFF: the rationale block is decode-tax-only (audit, not quality).
 * `RA_RATIONALE_AUDIT=1` (or the per-call `KernelInput.auditRationale ===
 * true`, which callers still check independently) turns it on. Rung1 sweep
 * 2026-07-28: INERT on the current golden corpus.
 *
 * Was read directly at TWO sites — `kernel/capabilities/reason/think.ts:626`
 * and `strategies/plan-execute.ts:370` — the exact multi-site-same-flag shape
 * this audit exists to close off, even though (unlike `RA_LAZY_TOOLS`) both
 * sites already agreed on direction.
 */
export function rationaleAuditEnabled(): boolean {
  return readFlag("RA_RATIONALE_AUDIT") === "1";
}

/**
 * Tree-of-thought explore-phase wall-clock budget (ms).
 *
 * Default 120_000. The BFS explore phase makes many serial expansion/scoring
 * LLM calls; on slow thinking models it can run minutes and starve Phase 2
 * (the react execute) of time before an external timeout kills the run with 0
 * output. Env-overridable so the default sits comfortably under typical run
 * timeouts. Rung1 sweep 2026-07-28: UNTESTABLE on the current corpus — every
 * golden runs the `reactive` strategy, none exercise tree-of-thought.
 *
 * Was read directly at `strategies/tree-of-thought.ts:231`.
 */
export function treeOfThoughtExploreBudgetMs(): number {
  return Number(readFlag("RA_TOT_EXPLORE_BUDGET_MS") ?? 120_000);
}

/**
 * Assembly debug trace — dumps the per-iteration projection trace
 * (`[RA_ASSEMBLY_TRACE]`) to stderr. Diagnostic only; never changes model
 * behavior or the assembled request.
 *
 * Default OFF. Was read directly at `kernel/capabilities/reason/think.ts:520`.
 */
export function assemblyDebugEnabled(): boolean {
  return readFlag("RA_ASSEMBLY_DEBUG") === "1";
}

/**
 * Prompt-dump path prefix — writes the assembled prompt+messages for the
 * current iteration to `${prefix}-iter{N}-{taskId}.json`. Diagnostic only;
 * `undefined` (unset) disables the dump entirely and changes nothing else.
 *
 * Was read directly at `kernel/capabilities/reason/think.ts:526-527`.
 */
export function promptDumpPathPrefix(): string | undefined {
  return readFlag("RA_PROMPT_DUMP");
}

/**
 * Overhaul A/B: register the `write_result_to_file` meta-tool so the model
 * can materialize a deliverable by reference instead of transcribing /
 * copying the `[STORED:]` marker.
 *
 * Default OFF. `RA_OVERHAUL=1` turns it on (branch overhaul/agentic-core).
 * Rung1 sweep 2026-07-28: INERT on the current golden corpus.
 *
 * Was read directly at
 * `packages/runtime/src/builder/build-effect/runtime-construction.ts:339` —
 * the one mechanism in this file that lives in `packages/runtime` rather than
 * `packages/reasoning`. `packages/runtime` depends on `packages/reasoning`
 * (never the reverse), so routing through this registry and re-exporting from
 * `packages/reasoning/src/index.ts` is architecturally sound; the reverse
 * would not be.
 */
export function overhaulEnabled(): boolean {
  return readFlag("RA_OVERHAUL") === "1";
}
