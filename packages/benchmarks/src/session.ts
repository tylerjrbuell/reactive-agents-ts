import type {
  HarnessVariant, BenchmarkSession, BenchmarkTask, HarnessConfig, Tier,
} from "./types.js"

// ── 9-variant ablation ladder ─────────────────────────────────────────────────

export const ABLATION_VARIANTS: ReadonlyArray<HarnessVariant> = [
  // Tier 0: Universal baseline — single API call, no tools, no loop
  { type: "internal", id: "bare-llm",     label: "Bare LLM",          config: {} },

  // Tier 1: Build-it-yourself — raw SDK + while loop + native FC
  { type: "internal", id: "manual-react", label: "Manual ReAct Loop",  config: { tools: true } },

  // Tier 2: Established frameworks (pinned versions, see competitors/)
  { type: "competitor", id: "langchain-react", label: "LangChain JS",       framework: "langchain",      frameworkVersion: "0.3.x" },
  { type: "competitor", id: "vercel-ai-sdk",   label: "Vercel AI SDK",      framework: "vercel-ai",      frameworkVersion: "4.x" },
  { type: "competitor", id: "openai-agents",   label: "OpenAI Agents SDK",  framework: "openai-agents",  frameworkVersion: "0.x" },
  { type: "competitor", id: "mastra-agent",    label: "Mastra",             framework: "mastra",         frameworkVersion: "0.x" },
  { type: "competitor", id: "llamaindex-ts",   label: "LlamaIndex TS",      framework: "llamaindex",     frameworkVersion: "0.x" },

  // Tier 3: RA harness layers
  {
    type: "internal", id: "ra-reasoning", label: "RA Reasoning",
    config: { tools: true, reasoning: true },
  },
  {
    type: "internal", id: "ra-full", label: "RA Full Harness",
    config: { tools: true, reasoning: true, reactiveIntelligence: true, memory: true },
  },

  // Tier 3 (ablation): RA Full with verifier gate replaced by noopVerifier.
  // M3 isolation — measure the verifier's contribution to end-task accuracy.
  {
    type: "internal", id: "ra-full-noop-verifier", label: "RA Full (No Verifier)",
    config: { tools: true, reasoning: true, reactiveIntelligence: true, memory: true, verifier: "noop" },
  },

  // (Sprint-1 A2, 2026-06-02) The `ra-full-assembly-off` ablation variant
  // was removed when RA_ASSEMBLY flag + legacy curate() were deleted. The
  // env passthrough (config.env) remains for future env-gated arms.
  //
  // NOTE: env-gated ablation arms (e.g. WS-4 `ra-recite` = ra-full + RA_RECITE=1)
  // are defined INLINE in their own session, NOT added here — adding to this
  // ladder bloats every full sweep (realWorldFull / competitorComparison spread
  // [...ABLATION_VARIANTS]) with an arm only one ablation needs.
]

// ── Selection integrity ───────────────────────────────────────────────────────

/**
 * A benchmark that measured nothing must FAIL, not report zeros.
 *
 * Executed 2026-07-09: `run.ts --task rw-4,rw-8,rw-9` without `--session` took
 * the legacy path, which filters `BENCHMARK_TASKS` (a different, smaller list
 * with no `rw-*`). Every id matched nothing, and the run printed
 * "All 0 tasks completed", wrote a report of zeros, and exited 0.
 *
 * A green bench over an empty cell set is worse than a red one: the report it
 * writes becomes the baseline that later runs diff against, so a silent
 * no-op eventually certifies a regression as a win.
 */
export function assertNonEmptySelection(sel: {
  readonly tasks: readonly { readonly id: string }[];
  readonly variants?: readonly { readonly id: string }[];
  readonly requestedTaskIds?: readonly string[];
  readonly requestedVariantIds?: readonly string[];
  readonly available?: readonly string[];
}): void {
  if (sel.tasks.length === 0) {
    const requested = sel.requestedTaskIds?.length
      ? ` Requested: ${sel.requestedTaskIds.join(", ")}.`
      : "";
    const available = sel.available?.length ? ` Available: ${sel.available.join(", ")}.` : "";
    throw new Error(
      `Benchmark selection is empty — no tasks matched, so nothing would be measured.${requested}${available}`,
    );
  }
  if (sel.variants !== undefined && sel.variants.length === 0) {
    const requested = sel.requestedVariantIds?.length
      ? ` Requested: ${sel.requestedVariantIds.join(", ")}.`
      : "";
    throw new Error(
      `Benchmark selection is empty — no variants matched, so nothing would be measured.${requested}`,
    );
  }
}

// ── Session utilities ─────────────────────────────────────────────────────────

/**
 * Resolve which tasks a session should run.
 * Priority: taskIds > tiers > tags > all tasks.
 */
export function resolveTasks(
  session: Pick<BenchmarkSession, "taskIds" | "tiers" | "tags">,
  allTasks: readonly BenchmarkTask[],
): readonly BenchmarkTask[] {
  if (session.taskIds?.length) {
    return allTasks.filter(t => session.taskIds!.includes(t.id))
  }
  if (session.tiers?.length) {
    return allTasks.filter(t => session.tiers!.includes(t.tier as Tier))
  }
  if (session.tags?.length) {
    return allTasks.filter(t => t.tags?.some(tag => session.tags!.includes(tag)))
  }
  return allTasks
}

/**
 * Merge a base HarnessConfig with an override, override wins on conflicts.
 */
export function mergeConfigs(
  base: HarnessConfig,
  override: HarnessConfig,
): HarnessConfig {
  return { ...base, ...override }
}

/**
 * Look up a variant by ID from the canonical ABLATION_VARIANTS list.
 * Throws if not found — callers should use IDs that are known at build time.
 */
export function getVariant(id: string): HarnessVariant {
  const v = ABLATION_VARIANTS.find(v => v.id === id)
  if (!v) throw new Error(`Unknown variant ID: ${id}`)
  return v
}
