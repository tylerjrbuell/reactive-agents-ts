/**
 * Context Builder — builds conversation messages, tool schemas, and base system
 * prompt for each LLM turn.
 *
 * Pure data transformation: no LLM calls, no Effect services.
 * Fully unit-testable in isolation.
 *
 * Note: the full system prompt (with guidance, ICS, progress sections) is
 * assembled by think.ts using buildStaticContext + buildGuidanceSection.
 */
import type { ProviderAdapter } from "@reactive-agents/llm-provider";

// ── sanitizeToolName ──────────────────────────────────────────────────────────

/**
 * Sanitize a registered tool name into the shape native-FC providers accept.
 *
 * Anthropic/OpenAI require tool names to match `^[a-zA-Z0-9_-]{1,128}$`. MCP
 * tools register canonically as `${server}/${tool}` (e.g. `github/list_commits`),
 * whose `/` is rejected by the provider regex. We replace every disallowed
 * character with `_` so the outbound schema is valid; the inbound tool-call
 * name is mapped BACK to the canonical name at the native-FC boundary (think.ts)
 * so registry lookup/execution is unchanged.
 *
 * Pure: identical input → identical output. Names already matching the regex
 * are returned unchanged.
 */
export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** Result of building the sanitized→canonical reverse map for a tool set. */
export interface SanitizedReverseMap {
  /** sanitized display name → canonical registered name (first wins on collision). */
  readonly map: ReadonlyMap<string, string>;
  /**
   * Distinct canonical name pairs that sanitize to the same display name.
   * A non-empty list means inbound de-sanitization is ambiguous for those
   * names and may dispatch the wrong tool — callers should surface it.
   */
  readonly collisions: ReadonlyArray<readonly [string, string]>;
}

/**
 * Build the inbound de-sanitization map (sanitized FC name → canonical name)
 * for the tool set offered this turn, detecting collisions.
 *
 * `sanitizeToolName` is many-to-one (`a.b` and `a/b` both → `a_b`), so two
 * distinct canonical names can collapse to one display name. The old
 * `new Map(pairs)` construction silently kept the LAST such pair, dispatching
 * the earlier tool's calls to the wrong canonical name. This keeps the FIRST
 * deterministically and reports every collision so the caller can warn.
 * Exact duplicate registrations (same canonical name twice) are not collisions.
 */
export function buildSanitizedReverseMap(
  canonicalNames: readonly string[],
): SanitizedReverseMap {
  const map = new Map<string, string>();
  const collisions: Array<readonly [string, string]> = [];
  for (const name of canonicalNames) {
    const key = sanitizeToolName(name);
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, name);
    } else if (existing !== name) {
      collisions.push([existing, name] as const);
    }
    // existing === name → duplicate registration, ignore.
  }
  return { map, collisions };
}

// ── buildSystemPrompt ─────────────────────────────────────────────────────────

/**
 * Build the system prompt text.
 * Tier-adaptive: frontier/large models get detailed reasoning guidance;
 * mid models get standard guidance; local models get minimal prompt.
 */
export function buildSystemPrompt(
  _task: string,
  systemPrompt?: string,
  tier?: "local" | "mid" | "large" | "frontier",
  /**
   * Whether this run has ANY tools. Defaults true so existing callers are
   * byte-identical; the assembly stage passes the real value.
   *
   * F6 (2026-07-28): this function had no idea whether tools existed, so a
   * zero-tool run still received the full tool doctrine — including a sentence
   * teaching parallel tool-call batching — immediately followed by the tool
   * reference block's "No tools available for this task." The prompt explained
   * how to batch tool calls and then said there were none.
   *
   * Measured on "What is 17 × 23? Answer with just the number. Do not use any
   * tools.": kernel prompt 461 chars vs the inline path's 88 (5.2×), and live
   * that showed up as +449% tokens on haiku and +467% on qwen3.5 — the SAME
   * multiplier on both tiers, i.e. a fixed structural tax rather than anything
   * model-adaptive. Both arms answered correctly, so nothing was bought.
   *
   * "Think step by step" is deliberately KEPT in every branch: the reactive
   * contract depends on that CoT instruction (see systemPromptStage's note),
   * and it is not tool guidance.
   */
  hasTools = true,
): string {
  // Use custom system prompt if provided (no task appended — task is in messages[0])
  if (systemPrompt) return systemPrompt;

  // Lean tier-adaptive instruction — NO task, NO tool schemas, NO format rules
  // The task is seeded as state.messages[0] by the execution engine.
  const t = tier ?? "mid";
  if (t === "local") {
    return hasTools
      ? "You are a helpful assistant. Use the provided tools when needed to complete tasks."
      : "You are a helpful assistant.";
  }
  const PARALLEL_HINT = " When a task requires multiple independent lookups or actions, issue all tool calls in the same response — they execute in parallel.";

  if (t === "frontier" || t === "large") {
    return hasTools
      ? `You are an expert reasoning agent. Think step by step. Use tools precisely and efficiently. Prefer concise, direct answers once you have sufficient information.${PARALLEL_HINT}`
      : "You are an expert reasoning agent. Think step by step. Prefer concise, direct answers once you have sufficient information.";
  }
  // mid tier
  return hasTools
    ? `You are a reasoning agent. Think step by step and use available tools when needed.${PARALLEL_HINT}`
    : "You are a reasoning agent. Think step by step.";
}

// toProviderMessage deleted (Plan 9 Phase 4 typed-parts stage A, 2026-11-06):
// no live caller; it mirrored assembly/to-llm-messages.ts (toLLMMessages),
// which is the one kernel-to-provider conversion and the single site where
// typed content parts will map to provider ContentBlocks.

// buildToolSchemas deleted (Overhaul Phase 2, 2026-07-07): its gate-blocked
// narrowing is Stage 3 of resolveToolSurface (reason/tool-surface.ts), which
// also carries the per-tool reason map. Sole caller was think.ts.
// buildConversationMessages + CompressionAppliedSidecar deleted (Phase 1b,
// 2026-07-07): the entire ContextManager/APC chain had no live caller —
// project() (assembly/) is the sole prompt pipeline. See
// wiki/Research/Audit-Reports-2026-07-07/02-prompts-context-assembly.md.
