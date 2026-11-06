import { Effect, Ref } from "effect";
import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";
import { currentDiscoveredToolsStore, resolveStore } from "./run-tool-stores.js";

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
  /**
   * Set of tool names the model has discovered. Curator reads this. Omit to
   * resolve the CURRENT run's set from `runToolStoresSlot` at each invocation
   * (run isolation then comes from the run scope).
   */
  readonly discoveredRef?: Ref.Ref<Set<string>>;
  /**
   * Number of tools registered in the ToolService but NOT in this run's
   * permitted catalog (e.g. built-ins left out by an opt-in `builtins` list).
   * Optional: when omitted, discover-tools cannot see the registry and its
   * empty-catalog answer says only what it can see. When provided, the answer
   * distinguishes "registered but not enabled" from "nothing registered".
   */
  readonly getUnlistedToolCount?: () => number;
  /**
   * Tool names the kernel's task-relevance scorer ranked as needed for the
   * run's task, drawn from the run's permitted catalog (best first).
   * discover-tools never scores the task itself: one scorer, owned by the
   * kernel. When provided, a query answer with confident matches also lists
   * up to 4 of these that the query did not match, and marks them discovered
   * so they are callable next response. Omit for query-only answers.
   */
  readonly getTaskRelevantTools?: () => readonly string[];
}

/** Maximum task-relevant tools appended to a query answer. */
const TASK_RELEVANT_APPENDIX_CAP = 4;

/**
 * Task-relevant tools to append after the query matches: permitted catalog
 * members only, not already matched, deduplicated, order kept, capped.
 */
function taskRelevantAppendix(
  state: DiscoverToolsState,
  all: readonly DiscoverableTool[],
  matches: readonly DiscoverableTool[],
): readonly DiscoverableTool[] {
  const names = state.getTaskRelevantTools?.() ?? [];
  if (names.length === 0) return [];
  const byName = new Map(all.map((t) => [t.name, t] as const));
  const taken = new Set(matches.map((t) => t.name));
  const out: DiscoverableTool[] = [];
  for (const name of names) {
    if (out.length >= TASK_RELEVANT_APPENDIX_CAP) break;
    const tool = byName.get(name);
    if (tool === undefined || taken.has(name)) continue;
    taken.add(name);
    out.push(tool);
  }
  return out;
}

/**
 * Answer for an empty permitted catalog. The catalog is the run's permitted
 * surface, not the registry, so "nothing here" never implies "nothing
 * registered" unless the caller says the unlisted count is 0 (surface-hiding
 * spike 2026-11-06: 12 built-ins registered, answer was "No tools registered.").
 */
function emptyCatalogAnswer(unlisted: number | undefined): string {
  if (unlisted === 0) return "No tools are registered.";
  const lead = "No tools are available to you in this run.";
  if (unlisted === undefined) {
    return `${lead} Registered tools that are not enabled for this run are not listed here.`;
  }
  const noun = unlisted === 1 ? "registered tool is" : "registered tools are";
  return `${lead} ${unlisted} ${noun} not enabled for this run, so they are not listed and cannot be called.`;
}

/**
 * Skills are not tools; say only that. This tool cannot see whether a skill
 * catalog exists, so it must not point at a "## Skills" prompt section that
 * is absent when no skills are configured (truthfulness audit 2026-11-06).
 */
const TOOLS_ONLY_NOTE = "(Tools only. Skills are not listed here.)";

export const discoverToolsTool: ToolDefinition = {
  name: "discover-tools",
  description:
    "List callable TOOLS (functions with parameters you invoke). Use when the tool you need isn't in your current visible list. " +
    "It lists tools only, not skills. " +
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
        return emptyCatalogAnswer(state.getUnlistedToolCount?.());
      }

      // ── No query: list the whole permitted surface. ──
      if (!query || query.length === 0) {
        yield* markDiscovered(state, all);
        return [
          `${all.length} TOOLS available (callable functions — invoke by name with arguments):`,
          TOOLS_ONLY_NOTE,
          ...all.map(formatToolLine),
        ].join("\n");
      }

      // ── Query given: rank, then apply a relevance FLOOR. ──
      // ROOT FIX (2026-08-06): the scorer awards +1 per incidental token, so a
      // query like "read file" matched `file-write` (its name/description both
      // contain "file") and the handler reported it as a confident match —
      // "Top 1 tools matching 'read file' (now callable): file-write". A model
      // hunting a READ capability was told one existed when it did not, then
      // thrashed for iterations and (on capable models) shipped a fabricated
      // deliverable. Discovery must be HONEST: a single incidental common-token
      // hit is not a match. When nothing clears the floor, say so and list the
      // complete permitted set so the model stops assuming a hidden tool exists.
      const RELEVANCE_FLOOR = 2;
      const ranked = rankByQuery(all, query);
      const confident = ranked.filter((r) => r.score >= RELEVANCE_FLOOR).slice(0, 8);

      if (confident.length === 0) {
        // Honest exhaustion: no tool NAME/description keyword-matched the
        // query. Surface the ENTIRE catalog (marked callable) so the model
        // has ground truth. Message order fixed 2026-08-19 (root-caused via
        // a live trace — see
        // wiki/Planning/Implementation-Plans/2026-08-19-lightweight-tool-index-progressive-disclosure.md
        // §6e root cause 2): the ORIGINAL wording led with "No tool clearly
        // matches... capability is NOT available", BEFORE the list — a model
        // reading that framing gave up without scanning the list at all, even
        // though the correct tool was sitting right there (confirmed live,
        // gpt-4o-mini, verifier escalation: "gave up without trying tools
        // that were still available"). The keyword scorer misses real
        // matches whenever the model's query phrasing doesn't share a
        // keyword with the tool's own description — an unavoidable case for
        // paraphrased/open-ended queries, not a rare edge case. Leading with
        // the list and putting the "if genuinely none of these" caveat AFTER
        // it keeps the original honesty guarantee (no hallucinated hidden
        // tool) without pre-empting the model into skipping the one place
        // the real answer might be.
        yield* markDiscovered(state, all);
        return [
          `Your query "${query}" didn't closely keyword-match any tool by name or ` +
            `description. This is the COMPLETE set of TOOLS (callable functions) ` +
            `available to you — scan it below for the one you need before concluding ` +
            `nothing fits; a real match can still be here even without a keyword hit.`,
          ...all.map(formatToolLine),
          `If, after checking, genuinely none of the above can do what you need, that ` +
            `capability is NOT available as a tool; do not assume a hidden tool exists ` +
            `beyond this list. Proceed with one ` +
            `of these, or if the task truly cannot be done, say so via final-answer.`,
        ].join("\n");
      }

      const matches = confident.map((r) => r.tool);
      const appendix = taskRelevantAppendix(state, all, matches);
      yield* markDiscovered(state, [...matches, ...appendix]);
      const lines = [
        `Top ${matches.length} TOOLS matching "${query}" (callable functions — invoke by name with arguments):`,
        TOOLS_ONLY_NOTE,
        ...matches.map(formatToolLine),
      ];
      if (appendix.length > 0) {
        lines.push("Also needed for this task (now callable):", ...appendix.map(formatToolLine));
      }
      return lines.join("\n");
    });

/**
 * Mark tools as discovered so the curator surfaces them in the next iteration's
 * tool schema list. Shared by every return path — a listed tool must be callable.
 */
function markDiscovered(
  state: DiscoverToolsState,
  tools: readonly DiscoverableTool[],
): Effect.Effect<void> {
  return Effect.flatMap(resolveStore(state.discoveredRef, currentDiscoveredToolsStore), (ref) =>
    Ref.update(ref, (set) => {
      const next = new Set(set);
      for (const t of tools) next.add(t.name);
      return next;
    }),
  );
}

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
 *
 * Returns the score alongside each tool so the handler can apply a relevance
 * FLOOR — a single incidental common-token hit (score 1) is not a match.
 */
interface ScoredTool {
  readonly tool: DiscoverableTool;
  readonly score: number;
}

function rankByQuery(
  tools: readonly DiscoverableTool[],
  query: string,
): readonly ScoredTool[] {
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
    );
}
