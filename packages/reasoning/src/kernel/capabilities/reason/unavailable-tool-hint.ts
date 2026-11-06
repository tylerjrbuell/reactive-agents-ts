/**
 * Think phase — the unavailable-tool hint (fix A of the 2026-11-06 surface-hiding
 * spike, `wiki/Research/Harness-Reports/2026-11-06-tool-surface-hiding-spike.md`).
 *
 * A model can name a tool that is not on its surface: a builtin the opt-in
 * default left out, a name outside a Cortex allowlist, a contract-forbidden
 * tool, or a made-up name. The resolver then returns `unresolved-tool-call` and
 * appends its own hint to the turn's text, which lands only in `state.steps`.
 * With no required tools nothing reached the next request, so the model never
 * learned why its call did nothing, and after the strike cap it answered in
 * prose claiming the action (runs 01M6FMFJGN717FFX7RSZH40WDV,
 * 01M6JEVEK40AW79DKZJ7HSPCAT).
 *
 * This module is the ONE producer of that hint. Callers route its text through
 * the guidance channel (`errorRecovery`); no other site words it. Deterministic:
 * the names come from the turn's calls and the run's surface data, never an LLM.
 */
import { BUILTIN_TOOL_NAMES, detectToolCallShape } from "@reactive-agents/tools";
import type { ToolSchema } from "../attend/tool-formatting.js";

/** Callable names listed in the hint before the rest are counted. */
const MAX_LISTED_TOOLS = 12;

/** One tool name the model called that is not on its surface. */
export interface UnavailableTool {
  readonly name: string;
  /** True when the run knows the tool (registered, builtin, or hidden by a rule) but did not permit it. */
  readonly exists: boolean;
}

/** The surface data the hint is computed from (all available at dispatch time). */
export interface UnavailableToolInputs {
  /** Native call names of the turn (empty when the call was printed as text). */
  readonly nativeCallNames: readonly string[];
  /** The turn's text, for a call printed as text. */
  readonly text: string;
  /** What the resolver resolved names against (`ResolvedToolSurface.universe`). */
  readonly universe: readonly ToolSchema[];
  /** Names the run knows but may not offer: the full catalog and every name the surface ruled on. */
  readonly knownNames: Iterable<string>;
}

/**
 * The names the model called that are not on its surface, in call order,
 * deduplicated. A printed call naming an offered tool is a parse problem, not
 * an availability one, so it is excluded.
 */
export function unavailableToolsOf(inputs: UnavailableToolInputs): readonly UnavailableTool[] {
  const offered = new Set(inputs.universe.map((t) => t.name));
  const named =
    inputs.nativeCallNames.length > 0
      ? inputs.nativeCallNames
      : detectToolCallShape(inputs.text, offered).names;
  const known = new Set(inputs.knownNames);
  const out: UnavailableTool[] = [];
  for (const name of new Set(named)) {
    if (name.length === 0 || offered.has(name)) continue;
    out.push({ name, exists: known.has(name) || BUILTIN_TOOL_NAMES.has(name) });
  }
  return out;
}

const clauseOf = (t: UnavailableTool): string =>
  t.exists ? `${t.name} is not enabled for this run` : `${t.name} is not a tool in this run`;

const listOf = (names: readonly string[]): string =>
  names.length <= MAX_LISTED_TOOLS
    ? names.join(", ")
    : `${names.slice(0, MAX_LISTED_TOOLS).join(", ")} (+${names.length - MAX_LISTED_TOOLS} more)`;

/**
 * THE hint text. `callable` lists what the model can call next turn; pass
 * `undefined` when the next turn withholds tools (naming tools there would
 * contradict the instruction not to call one). Empty `unavailable` gives
 * `undefined`, so a turn without an off-surface name renders nothing new.
 */
export function unavailableToolHint(
  unavailable: readonly UnavailableTool[],
  callable: readonly ToolSchema[] | undefined,
): string | undefined {
  if (unavailable.length === 0) return undefined;
  const head = `Tool call not executed: ${unavailable.map(clauseOf).join("; ")}. The action was not performed; do not claim it was done.`;
  if (callable === undefined) return head;
  const names = [...new Set(callable.map((t) => t.name))];
  const offer = names.length > 0 ? `Tools you can call: ${listOf(names)}.` : "No tools are callable right now.";
  return `${head} ${offer} If the task needs a tool you cannot call, say so in your answer.`;
}
