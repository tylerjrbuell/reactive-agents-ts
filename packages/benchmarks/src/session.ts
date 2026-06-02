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

  // Tier 3 (ablation): RA Full with the canonical project() context-assembly
  // path disabled — flips RA_ASSEMBLY=0 so think.ts falls back to legacy
  // defaultContextCurator.curate(). Paired against the default `ra-full`
  // (project() default-on) by `sessions/context-stress.ts` for the Phase-A
  // cross-tier A/B. The env passthrough is generic (config.env), so future
  // env-gated arms graduate the same way.
  {
    type: "internal", id: "ra-full-assembly-off", label: "RA Full (legacy curate, RA_ASSEMBLY=0)",
    config: { tools: true, reasoning: true, reactiveIntelligence: true, memory: true, env: { RA_ASSEMBLY: "0" } },
  },
]

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
