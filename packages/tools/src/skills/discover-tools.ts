import { Effect, Ref } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

/**
 * Minimal tool descriptor needed by the discovery listing. Lets the kernel
 * pass already-resolved schemas straight through without rebuilding to a
 * full ToolDefinition.
 */
export interface DiscoverableTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: string;
    readonly required?: boolean;
  }[];
}

/**
 * Per-run state for discover-tools.
 *
 * The curator gates which tool schemas reach the model each iteration. When
 * the user registers many tools, only required + relevant + already-used +
 * discovered ones are shown — the rest are findable via this tool.
 *
 * `discoveredRef` accumulates names the model has surfaced via `discover-tools`
 * so they become visible in the next iteration's schema list. The curator
 * reads `discoveredRef` to decide what to expose.
 */
export interface DiscoverToolsState {
  /** Returns the full registered tool catalog (descriptors only). */
  readonly getAllToolDefinitions: () => readonly DiscoverableTool[];
  /** Per-run set of tool names the model has discovered. Curator reads this. */
  readonly discoveredRef: Ref.Ref<Set<string>>;
}

export const discoverToolsTool: ToolDefinition = {
  name: "discover-tools",
  description:
    "List tools you can call. Use when the tool you need isn't in your current visible list. " +
    "Pass `query` to filter by intent (e.g. 'read file', 'search web', 'run code') — returns the top matches. " +
    "Omit `query` to see every available tool. " +
    "Tools you discover become callable in your next response.",
  parameters: [
    {
      name: "query",
      type: "string",
      description:
        "Short description of what you want to do. Omit to list all available tools.",
      required: false,
    },
  ],
  returnType: "string",
  riskLevel: "low",
  timeoutMs: 2_000,
  requiresApproval: false,
  source: "builtin",
  category: "data",
};

/**
 * Build the handler. Captures `state` so the per-run discoveredRef and tool
 * catalog are reachable from the pure (Record<string,unknown>) → Effect handler
 * signature the tool service expects.
 */
export const makeDiscoverToolsHandler =
  (state: DiscoverToolsState) =>
  (args: Record<string, unknown>): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.gen(function* () {
      const query =
        typeof args.query === "string" ? args.query.trim() : undefined;

      const all = state.getAllToolDefinitions();
      if (all.length === 0) {
        return "No tools registered.";
      }

      const matches = query && query.length > 0
        ? rankByQuery(all, query).slice(0, 8)
        : all;

      // Side-effect: mark these as discovered so the curator surfaces them
      // in the next iteration's tool schema list.
      yield* Ref.update(state.discoveredRef, (set) => {
        const next = new Set(set);
        for (const t of matches) next.add(t.name);
        return next;
      });

      const lines = matches.map(formatToolLine);
      const header =
        query && query.length > 0
          ? `Top ${matches.length} tools matching "${query}" (now callable):`
          : `${matches.length} tools available (now callable):`;
      return [header, ...lines].join("\n");
    });

/**
 * One-line tool summary: `name(param: type, …) — first sentence of description`.
 * Description first-sentence keeps the listing terse; the full schema reaches
 * the model via the next iteration's tool list.
 */
function formatToolLine(t: DiscoverableTool): string {
  const params = (t.parameters ?? [])
    .map((p) => `${p.name}: ${p.type}${p.required ? "" : "?"}`)
    .join(", ");
  const firstSentence = t.description.split(/(?<=[.!?])\s/)[0] ?? t.description;
  const trimmed =
    firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}…` : firstSentence;
  return `- ${t.name}(${params}) — ${trimmed}`;
}

/**
 * Rank tools by query relevance. Cheap deterministic scorer:
 *   +5 query is substring of name
 *   +3 query is substring of description (case-insensitive)
 *   +1 per query token that appears in name+description
 * Tie-break: shorter name first (more specific).
 */
function rankByQuery(
  tools: readonly DiscoverableTool[],
  query: string,
): readonly DiscoverableTool[] {
  const q = query.toLowerCase();
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  const scored = tools.map((t) => {
    const name = t.name.toLowerCase();
    const desc = t.description.toLowerCase();
    let score = 0;
    if (name.includes(q)) score += 5;
    if (desc.includes(q)) score += 3;
    for (const tok of tokens) {
      if (name.includes(tok) || desc.includes(tok)) score += 1;
    }
    return { tool: t, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) =>
      b.score - a.score !== 0 ? b.score - a.score : a.tool.name.length - b.tool.name.length,
    )
    .map((s) => s.tool);
}
