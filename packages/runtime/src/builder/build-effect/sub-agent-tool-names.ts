/**
 * Resolve the tool names a parent hands a sub-agent (`spawn-agent` /
 * `spawn-agents` `tools`, a `.withAgentTool` per-call `tools` arg) against the
 * tools the child will really have, BEFORE they become its `allowedTools` /
 * `requiredTools`.
 *
 * Census 2026-11-10: all 19 wrong-name tool failures were depth-1 children. The
 * parent passed `umami_get_website_stats` (providers forbid `/`, so the model
 * writes `_`); the child's allowlist kept it verbatim, matched no registered
 * tool, and the child ran with an empty toolbox while its contract demanded the
 * missing tool. It could only fail.
 *
 * One home for both delegation paths (`sub-agent-executor.ts`,
 * `local-agent-tools.ts`). The matcher itself is `resolveToolName` from
 * `@reactive-agents/tools` (separator / case only, ambiguity-safe); a toolset
 * alias (`web`, `git`) still expands the way `builtins` does.
 */
import {
  ALWAYS_INCLUDE_TOOLS,
  BUILTIN_TOOL_NAMES,
  resolveBuiltinSelection,
  resolveToolName,
  type SubAgentResult,
} from "@reactive-agents/tools";
import { META_TOOLS } from "@reactive-agents/reasoning";

/** Outcome of resolving a sub-agent's requested tool names. */
export interface SubAgentToolResolution {
  /** Real tool names, deduplicated, request order kept. */
  readonly tools: readonly string[];
  /** Names that resolved to a different real name (`umami_x` to `umami/x`). */
  readonly corrected: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  /** Names that matched no tool, or more than one (ambiguous: never guessed). */
  readonly unresolved: readonly string[];
}

/**
 * The tool names a light-runtime child can have: the built-ins, the framework
 * meta-tools, the always-included tools, and the parent tools proxied into it
 * (its MCP tools). Parent custom tools are not proxied, so they are not here.
 */
export const subAgentToolUniverse = (
  proxiedNames: Iterable<string> = [],
): ReadonlySet<string> =>
  new Set<string>([...BUILTIN_TOOL_NAMES, ...META_TOOLS, ...ALWAYS_INCLUDE_TOOLS, ...proxiedNames]);

/**
 * Resolve each requested name against `available`: verbatim or the one
 * separator / case variant (`resolveToolName`), else a toolset alias expanded
 * like `builtins`, else unresolved. Pure.
 */
export const resolveSubAgentToolNames = (
  requested: readonly string[],
  available: ReadonlySet<string>,
): SubAgentToolResolution => {
  const tools = new Set<string>();
  const corrected: Array<{ from: string; to: string }> = [];
  const unresolved: string[] = [];
  for (const raw of requested) {
    const name = raw.trim();
    if (name.length === 0) continue;
    const hit = resolveToolName(name, available);
    if (hit !== undefined) {
      tools.add(hit);
      if (hit !== name) corrected.push({ from: name, to: hit });
      continue;
    }
    const expanded = [...resolveBuiltinSelection([name]).names].filter((n) => available.has(n));
    if (expanded.length > 0 && !(expanded.length === 1 && expanded[0] === name)) {
      for (const n of expanded) tools.add(n);
      continue;
    }
    unresolved.push(name);
  }
  return { tools: [...tools], corrected, unresolved };
};

/**
 * The line appended to the parent's tool result when some names were dropped
 * or corrected, so the parent sees what the child really got. `undefined` when
 * every name resolved verbatim.
 */
export const subAgentToolNameNote = (r: SubAgentToolResolution): string | undefined => {
  const parts: string[] = [];
  if (r.corrected.length > 0) {
    parts.push(`Sub-agent tool names corrected: ${r.corrected.map((c) => `${c.from} -> ${c.to}`).join(", ")}.`);
  }
  if (r.unresolved.length > 0) {
    parts.push(
      `Sub-agent tools dropped (unknown, or matching more than one tool): ${r.unresolved.join(", ")}.`,
    );
  }
  return parts.length > 0 ? parts.join(" ") : undefined;
};

/**
 * Append the resolution note (if any) to a sub-agent result's summary, on
 * success and failure alike: a dropped name matters most when the child failed.
 */
export const withSubAgentToolNote = (
  result: SubAgentResult,
  r: SubAgentToolResolution | undefined,
): SubAgentResult => {
  const note = r === undefined ? undefined : subAgentToolNameNote(r);
  return note === undefined ? result : { ...result, summary: `${result.summary}\n[${note}]` };
};

/**
 * The spawn result when tools were requested and none resolved: the child is
 * not started (it would run with an empty toolbox and could only fail). Names
 * the unknown tools and lists the ones that exist, meta-tools excluded.
 */
export const unresolvedSubAgentToolsResult = (
  subAgentName: string,
  r: SubAgentToolResolution,
  available: ReadonlySet<string>,
): SubAgentResult => {
  const meta: ReadonlySet<string> = new Set<string>(META_TOOLS);
  const listed = [...available].filter((n) => !meta.has(n)).sort();
  return {
    subAgentName,
    success: false,
    summary:
      `Sub-agent not started: none of the requested tools exist (${r.unresolved.join(", ")}). ` +
      `Available tools: ${listed.join(", ")}.`,
    tokensUsed: 0,
    stepsCompleted: 0,
    completionStatus: "failed",
  };
};
