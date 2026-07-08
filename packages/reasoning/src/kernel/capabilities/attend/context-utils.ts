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
import type { LLMMessage, ProviderAdapter } from "@reactive-agents/llm-provider";
import type { KernelMessage } from "../../../kernel/state/kernel-state.js";

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
): string {
  // Use custom system prompt if provided (no task appended — task is in messages[0])
  if (systemPrompt) return systemPrompt;

  // Lean tier-adaptive instruction — NO task, NO tool schemas, NO format rules
  // The task is seeded as state.messages[0] by the execution engine.
  const t = tier ?? "mid";
  if (t === "local") {
    return "You are a helpful assistant. Use the provided tools when needed to complete tasks.";
  }
  const PARALLEL_HINT = " When a task requires multiple independent lookups or actions, issue all tool calls in the same response — they execute in parallel.";

  if (t === "frontier" || t === "large") {
    return `You are an expert reasoning agent. Think step by step. Use tools precisely and efficiently. Prefer concise, direct answers once you have sufficient information.${PARALLEL_HINT}`;
  }
  // mid tier
  return `You are a reasoning agent. Think step by step and use available tools when needed.${PARALLEL_HINT}`;
}

// ── toProviderMessage ─────────────────────────────────────────────────────────

/**
 * Convert a KernelMessage to provider-native LLMMessage format.
 *
 * Tool names are stored canonically in state.messages (e.g. MCP
 * `github/list_commits`) so registry lookup / allowedTools matching stays
 * intact. The provider payload requires the sanitized form (`^[a-zA-Z0-9_-]+$`),
 * so on replay we sanitize the tool_use `name` and tool_result `toolName` here —
 * keeping the rendered thread consistent with the (also-sanitized) outbound
 * tools array. This is outbound-only: nothing downstream of the provider call
 * reads these rendered names back.
 */
export function toProviderMessage(msg: KernelMessage): LLMMessage {
  if (msg.role === "assistant") {
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant message with tool calls — provider maps to their format
      return {
        role: "assistant",
        content: [
          ...(msg.content ? [{ type: "text" as const, text: msg.content }] : []),
          ...msg.toolCalls.map((tc) => ({
            type: "tool_use" as const,
            id: tc.id,
            name: sanitizeToolName(tc.name),
            input: tc.arguments,
          })),
        ],
      } as LLMMessage;
    }
    return { role: "assistant", content: msg.content };
  }
  if (msg.role === "tool_result") {
    return {
      role: "tool" as const,
      toolCallId: msg.toolCallId,
      toolName: sanitizeToolName(msg.toolName),
      content: msg.content,
    } as LLMMessage;
  }
  // user role (or fallback)
  return { role: "user", content: msg.content };
}

// buildToolSchemas deleted (Overhaul Phase 2, 2026-07-07): its gate-blocked
// narrowing is Stage 3 of resolveToolSurface (reason/tool-surface.ts), which
// also carries the per-tool reason map. Sole caller was think.ts.
// buildConversationMessages + CompressionAppliedSidecar deleted (Phase 1b,
// 2026-07-07): the entire ContextManager/APC chain had no live caller —
// project() (assembly/) is the sole prompt pipeline. See
// wiki/Research/Audit-Reports-2026-07-07/02-prompts-context-assembly.md.
