/**
 * Think phase — lightweight tool-index disclosure helpers.
 *
 * Moved verbatim from `think.ts` (GH #219 / HS-249 decomposition). One line
 * per hidden tool — name, params, one-line description — plus the schema-
 * promotion half (`buildToolIndexCallableSchemas`) that makes the promoted
 * hidden set callable on native-FC dialects; see the doc comments below for
 * the 2026-08-19 live-wire investigation they record. Re-exported from
 * `think.ts` so existing import paths still resolve.
 */

import type { ToolSchema } from "../attend/tool-formatting.js";

/**
 * Lightweight tool index (2026-08-19, RA_TOOL_INDEX — see
 * wiki/Planning/Implementation-Plans/2026-08-19-lightweight-tool-index-progressive-disclosure.md).
 * One line per hidden tool — name, params, first sentence of description —
 * so the model always knows a hidden tool exists, without paying the FC
 * schema tax `discover-tools` pays on every call. Empty when nothing is
 * hidden (an unpruned surface renders nothing).
 */
/**
 * Shared by `buildToolIndexText` and `buildToolIndexCallableSchemas` — the
 * hidden set an index render operates over, capped identically for both so
 * the prose and the promoted FC schemas never describe a different set of
 * tools than they make callable.
 */
function cappedHiddenTools(
  universe: readonly ToolSchema[],
  visible: readonly ToolSchema[],
  maxEntries?: number,
): { readonly capped: readonly ToolSchema[]; readonly overflow: number } {
  const visibleNames = new Set(visible.map((ts) => ts.name));
  const hidden = universe.filter((ts) => !visibleNames.has(ts.name));
  const capped = maxEntries && maxEntries > 0 && hidden.length > maxEntries
    ? hidden.slice(0, maxEntries)
    : hidden;
  return { capped, overflow: hidden.length - capped.length };
}

/**
 * The other half of the index mechanism's fix (2026-08-19, root-caused via a
 * live wire-level trace — see
 * wiki/Planning/Implementation-Plans/2026-08-19-lightweight-tool-index-progressive-disclosure.md
 * §6e). `buildToolIndexText` only renders PROSE describing hidden tools; on a
 * native-fc dialect the provider API can only invoke a function present in
 * the request's declared `tools:` array, which is built from
 * `toolSurface.callable`/`.visible` — NEVER from `.universe`, where the index
 * text's hidden set lives. A tool named only in prose was therefore
 * structurally uncallable, confirmed live: a model reading the index,
 * wanting the tool, and being unable to invoke it improvised a fake
 * workaround via an unrelated tool instead (0% solved across a 5-rep,
 * 2-catalog-size ablation).
 *
 * This promotes the SAME capped hidden set into real (but compact —
 * first-sentence-only description, matching the index text's own economy)
 * ToolSchema entries so they can be unioned into the wire schema array
 * (`llmTools`, below) and actually invoked. Text-parse/sentinel dialects
 * don't need this (their `tools:` param isn't sent to the provider at all —
 * see the `context.toolCallingDriver.mode !== "text-parse"` gate below — and
 * per the same investigation, the healing pipeline already resolves a
 * model-named call against `toolSurface.universe` regardless of the FC
 * array on those dialects, so prose-only disclosure may already work there;
 * untested, flagged as the next measurement in the plan doc).
 */
export function buildToolIndexCallableSchemas(
  universe: readonly ToolSchema[],
  visible: readonly ToolSchema[],
  maxEntries?: number,
): readonly ToolSchema[] {
  const { capped } = cappedHiddenTools(universe, visible, maxEntries);
  return capped.map((ts) => {
    const firstSentence = ts.description.split(/(?<=[.!?])\s/)[0] ?? ts.description;
    return { ...ts, description: firstSentence };
  });
}

/**
 * The overflow-only note for tools past the cap — see the "double-payment"
 * fix below for why this is ALL this function renders now.
 */
export function buildToolIndexText(
  universe: readonly ToolSchema[],
  visible: readonly ToolSchema[],
  /**
   * "hybrid" mode's cap (ContextProfile.toolIndexMaxEntries) — truncate the
   * index and defer the remainder to discover-tools' query search instead of
   * letting an unbounded catalog turn the index itself into a wall of text.
   * Undefined/0 ⇒ no cap ("index" mode's unbounded behavior).
   */
  maxEntries?: number,
): string {
  // Fix (2026-08-19, found live investigating why `index` mode cost MORE
  // per tool than `full` mode despite carrying LESS information per tool):
  // every capped/promoted tool used to get a prose line here AND a real FC
  // schema via buildToolIndexCallableSchemas (name/params/description sent
  // TWICE — once as text, once as the structured tool the provider already
  // shows the model). A tool present in the `tools:` array needs no prose
  // call-out; the schema itself is the disclosure. Only tools that did NOT
  // get promoted (the overflow, capped-out portion — unreachable except via
  // discover-tools' query search) still need a mention, and only as a count,
  // not a per-tool description nobody asked to see rendered twice.
  const { overflow } = cappedHiddenTools(universe, visible, maxEntries);
  if (overflow === 0) return "";
  return (
    `${overflow} additional tool(s) exist beyond what's shown above — ` +
    `call discover-tools with a query to search them.`
  );
}
