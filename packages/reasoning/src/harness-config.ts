/**
 * HarnessConfig — the typed, per-agent control surface for harness mechanisms.
 *
 * WHY THIS EXISTS. Every mechanism below was previously reachable ONLY through
 * a process-global environment variable read at the call site
 * (`harness-flags.ts`). That made the harness un-configurable from code, absent
 * from the 80-method builder surface, undocumented, and — the load-bearing
 * defect — process-global, so two agents in one process could not differ and a
 * sub-agent could not inherit anything.
 *
 * PRECEDENCE IS FIXED: explicit config > environment variable > built-in
 * default. An env var never overrides a programmatic choice; it only fills a
 * hole. The env layer is `harness-flags.ts`, which remains the ONLY place in
 * `packages/reasoning` that reads the RA-prefixed environment variables (gate:
 * scripts/check-ablatable.sh).
 *
 * ABSENT-FIELD DISCIPLINE. Fields whose "unset" state is meaningful
 * (`recencyBudgetChars`, `toolResultBudgetChars`, `toolIndexMaxEntries`,
 * `promptDumpPathPrefix`) are written with a conditional spread and are absent
 * — not `undefined` — when nothing sets them, so `"x" in resolved` still
 * distinguishes "no override" from "override of 0". Same rule as
 * `buildRunEnvelope`.
 */
import {
  lazyDisclosureEnabled,
  toolDiscoveryEnabled,
  toolIndexEnabled,
  toolIndexMaxEntriesFlag,
  verboseRulesEnabled,
  stableToolSurfaceEnabled,
  recencyBudgetCharsOverride,
  toolResultBudgetCharsOverride,
  thoughtContinuityEnabled,
  toolObserveSymmetryEnabled,
  rationaleAuditEnabled,
  treeOfThoughtExploreBudgetMs,
  assemblyDebugEnabled,
  promptDumpPathPrefix,
} from "./harness-flags.js";

/** User-facing shape: every field optional, absent means "do not decide". */
export interface HarnessConfig {
  /** Per-iteration lazy tool disclosure. Default ON. (`RA_LAZY_TOOLS=0`) */
  readonly lazyDisclosure?: boolean;
  /** Register the `discover-tools` meta-tool. Default follows `lazyDisclosure`. (`RA_TOOL_DISCOVERY`) */
  readonly toolDiscovery?: boolean;
  /** Render a cheap name+one-line index of the hidden tool set. Default OFF. (`RA_TOOL_INDEX`) */
  readonly toolIndex?: boolean;
  /** Cap on entries in that index. Unset ⇒ the tier profile decides. (`RA_TOOL_INDEX_MAX_ENTRIES`) */
  readonly toolIndexMaxEntries?: number;
  /** Inject the verbose ReAct RULES block. Default OFF. (`RA_VERBOSE_RULES`) */
  readonly verboseRules?: boolean;
  /** Keep the function-calling tool array byte-stable across iterations so the
   *  provider's prompt cache survives. Default OFF. (`RA_STABLE_TOOL_SURFACE`) */
  readonly stableToolSurface?: boolean;
  /** Character budget for recent observations. Unset ⇒ derived from the window. (`RA_RECENCY_BUDGET_CHARS`) */
  readonly recencyBudgetChars?: number;
  /** Per-tool-result preservation cap. Unset ⇒ the tier table decides. (`RA_TOOL_RESULT_BUDGET_CHARS`) */
  readonly toolResultBudgetChars?: number;
  /** Carry thought continuity across projected results. Default OFF. (`RA_THOUGHT_CONTINUITY`) */
  readonly thoughtContinuity?: boolean;
  /** Symmetric observe formatting on tool results. Default OFF. (`RA_TOOL_OBSERVE_SYMMETRY`) */
  readonly toolObserveSymmetry?: boolean;
  /** Emit a per-tool-call rationale block for audit. Default OFF — an AUDIT
   *  feature, measured as a pure speed/token tax. (`RA_RATIONALE_AUDIT`) */
  readonly auditRationale?: boolean;
  /** Tree-of-Thought exploration budget in milliseconds. Default 120000. (`RA_TOT_EXPLORE_BUDGET_MS`) */
  readonly treeOfThoughtExploreBudgetMs?: number;
  /** Verbose assembly-stage diagnostics. Debug only. (`RA_ASSEMBLY_DEBUG`) */
  readonly assemblyDebug?: boolean;
  /** Write each rendered prompt to `<prefix>-<n>.txt`. Debug only. (`RA_PROMPT_DUMP`) */
  readonly promptDumpPathPrefix?: string;
}

/** Internal shape: booleans and always-defaulted numbers are present; genuinely
 *  optional overrides stay optional so "absent" survives the round trip. */
export interface ResolvedHarness {
  readonly lazyDisclosure: boolean;
  readonly toolDiscovery: boolean;
  readonly toolIndex: boolean;
  readonly toolIndexMaxEntries?: number;
  readonly verboseRules: boolean;
  readonly stableToolSurface: boolean;
  readonly recencyBudgetChars?: number;
  readonly toolResultBudgetChars?: number;
  readonly thoughtContinuity: boolean;
  readonly toolObserveSymmetry: boolean;
  readonly auditRationale: boolean;
  readonly treeOfThoughtExploreBudgetMs: number;
  readonly assemblyDebug: boolean;
  readonly promptDumpPathPrefix?: string;
}

/** `config ?? env ?? default`, for a field whose env layer already folds in its default. */
function pick(configured: boolean | undefined, fromEnv: boolean): boolean {
  return configured !== undefined ? configured : fromEnv;
}

/** `config ?? env`, for a field where ABSENT is a meaningful third state. */
function pickOptional<T>(configured: T | undefined, fromEnv: T | undefined): T | undefined {
  return configured !== undefined ? configured : fromEnv;
}

/**
 * Resolve the harness config ONCE per run. Call this at the runtime boundary,
 * never at a call site — a call site that re-resolves reintroduces the
 * process-global read this type exists to remove.
 */
export function resolveHarnessConfig(config: HarnessConfig = {}): ResolvedHarness {
  const toolIndexMaxEntries = pickOptional(config.toolIndexMaxEntries, toolIndexMaxEntriesFlag());
  const recencyBudgetChars = pickOptional(config.recencyBudgetChars, recencyBudgetCharsOverride());
  const toolResultBudgetChars = pickOptional(
    config.toolResultBudgetChars,
    toolResultBudgetCharsOverride(),
  );
  const promptDump = pickOptional(config.promptDumpPathPrefix, promptDumpPathPrefix());

  // Finding 5 (harness-control-surface final fix wave): `harness-flags.ts`
  // couples `toolDiscovery`'s and `verboseRules`' env-layer DEFAULTS to
  // `RA_LAZY_TOOLS` (see toolDiscoveryEnabled()/verboseRulesEnabled() there),
  // but that coupling only fires when reading raw env — it does not follow a
  // caller's `resolveHarnessConfig({ lazyDisclosure: false })`. Reproduce the
  // coupling one level up: when the caller explicitly set `lazyDisclosure` in
  // config (and did NOT also explicitly set the derived field), derive the
  // derived field's fallback from the RESOLVED `lazyDisclosure` value instead
  // of a fresh env read. When the caller left `lazyDisclosure` unset, behavior
  // is unchanged — the env layer's own coupling already applies.
  const resolvedLazyDisclosure = pick(config.lazyDisclosure, lazyDisclosureEnabled());
  const toolDiscoveryFallback =
    config.lazyDisclosure !== undefined ? resolvedLazyDisclosure : toolDiscoveryEnabled();
  const verboseRulesFallback =
    config.lazyDisclosure !== undefined ? !resolvedLazyDisclosure : verboseRulesEnabled();

  return Object.freeze({
    lazyDisclosure: resolvedLazyDisclosure,
    toolDiscovery: pick(config.toolDiscovery, toolDiscoveryFallback),
    toolIndex: pick(config.toolIndex, toolIndexEnabled()),
    ...(toolIndexMaxEntries !== undefined ? { toolIndexMaxEntries } : {}),
    verboseRules: pick(config.verboseRules, verboseRulesFallback),
    stableToolSurface: pick(config.stableToolSurface, stableToolSurfaceEnabled()),
    ...(recencyBudgetChars !== undefined ? { recencyBudgetChars } : {}),
    ...(toolResultBudgetChars !== undefined ? { toolResultBudgetChars } : {}),
    thoughtContinuity: pick(config.thoughtContinuity, thoughtContinuityEnabled()),
    toolObserveSymmetry: pick(config.toolObserveSymmetry, toolObserveSymmetryEnabled()),
    auditRationale: pick(config.auditRationale, rationaleAuditEnabled()),
    treeOfThoughtExploreBudgetMs:
      config.treeOfThoughtExploreBudgetMs ?? treeOfThoughtExploreBudgetMs(),
    assemblyDebug: pick(config.assemblyDebug, assemblyDebugEnabled()),
    ...(promptDump !== undefined ? { promptDumpPathPrefix: promptDump } : {}),
  });
}

/** The no-config resolution — byte-identical to today's env-only behaviour. */
export const defaultResolvedHarness = (): ResolvedHarness => resolveHarnessConfig();

/** The four disclosure postures a `ContextProfile` can name. */
export type ToolDisclosureMode = "full" | "discover" | "index" | "hybrid";

/**
 * Expand a profile's `toolDisclosureMode` into the three mechanism switches it
 * actually means. This is what makes `ContextProfile.toolDisclosureMode` a real
 * field rather than a declared-and-unread one (spec finding F-4).
 *
 * The result is a plain `HarnessConfig`, so a caller can spread it and then
 * override any single field — the mode is a shorthand, never a lock.
 */
export function fromDisclosureMode(mode: ToolDisclosureMode): HarnessConfig {
  switch (mode) {
    case "full":
      return { lazyDisclosure: false, toolDiscovery: false, toolIndex: false };
    case "discover":
      return { lazyDisclosure: true, toolDiscovery: true, toolIndex: false };
    case "index":
      return { lazyDisclosure: true, toolDiscovery: false, toolIndex: true };
    case "hybrid":
      return { lazyDisclosure: true, toolDiscovery: true, toolIndex: true };
  }
}
