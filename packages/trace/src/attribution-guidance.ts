// packages/trace/src/attribution-guidance.ts
//
// Attribution rule that checks the harness's guidance against the tool surface
// of the same request (Workstream H verdict, 2026-11-06, instrument fault (b)).
// Rule order and the verdict assembly live in attribution.ts; the facts it reads
// live in attribution-facts.ts.
//
//   harness:contradictory-guidance  the run's deciding turn told the model to call a
//                               tool while that request offered no schema for it;
//                               the model tried to follow, the tool never ran, and
//                               the run failed on top of it

import type { HarnessSignalInjectedEvent, LLMExchangeEvent } from "./events.js";
import { isMeta, str, ev1, clip, oneLine, type Facts, type Rule } from "./attribution-facts.js";

/**
 * A directive to call a named tool in request text (`call the \`http-get\` tool`,
 * `Now call http-get with ...`). The name is checked against the run's tools, so
 * prose such as "call it" or "call text" does not count.
 */
const CALL_DIRECTIVE = /\bcall(?:\s+the)?\s+`?([a-z][a-z0-9]*(?:[-_][a-z0-9]+)*)`?/g;

/** Tools the trace shows exist for this run: offered on some turn, on a resolved surface, or required by the contract. */
const runTools = (f: Facts): ReadonlySet<string> => new Set<string>([
  ...f.exchanges.flatMap((x) => x.toolSchemaNames),
  ...f.requiredTools,
  ...f.ev.flatMap((e) => (e.kind === "tool-surface-resolved" ? [...e.visible, ...e.callable] : [])),
]);

/** Run tools the request (system prompt, user and system messages) told the model to call. */
const directedTools = (x: LLMExchangeEvent, tools: ReadonlySet<string>): readonly string[] => {
  const text = [x.systemPrompt ?? "", ...x.messages.filter((m) => m.role === "user" || m.role === "system").map((m) => m.content)].join("\n");
  return [...new Set([...text.matchAll(CALL_DIRECTIVE)].map((m) => m[1]!))].filter((n) => tools.has(n) && !isMeta(n));
};

/** The model's turn named the tool: a native call, or the name as a token in its text (a printed call). */
const attempted = (x: LLMExchangeEvent, tool: string): boolean =>
  (x.response.toolCalls ?? []).some((c) => c.name === tool) ||
  new RegExp(`(^|[^\\w-])${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\w-]|$)`).test(x.response.content);

/**
 * The run's last LLM turn was a `think` turn whose request told the model to
 * call a tool the same request offered no schema for (e.g. the unresolved-call
 * guard withheld every tool while the Guidance section still said "Now call
 * http-get"). The model tried to follow the directive (it named the tool), the
 * tool never ran, and the run failed: the harness asked for something it had
 * made impossible, so `model:never-engaged` was the wrong owner.
 *
 * Only the deciding turn is judged, and only `think` turns: synthesis and verify
 * calls are tool-less by design and may list outstanding tools as context. A
 * model that ignored the directive (never named the tool) is left to other rules.
 */
export const ruleContradictoryGuidance: Rule = ({ f }) => {
  const x = f.exchanges.at(-1);
  if (x === undefined || x.purpose !== "think") return undefined;
  const ran = new Set(f.toolEnds.filter((t) => t.ok !== false).map((t) => t.toolName));
  const tool = directedTools(x, runTools(f)).find((n) => !x.toolSchemaNames.includes(n) && !ran.has(n) && attempted(x, n));
  if (tool === undefined) return undefined;
  const withheld = f.ev.filter((e): e is HarnessSignalInjectedEvent =>
    e.kind === "harness-signal-injected" && e.seq < x.seq && str(e.metadata, "kind") === "tools-withheld").at(-1);
  return {
    reason: "harness:contradictory-guidance",
    evidence: [
      ev1(x, `the deciding turn's request told the model to call ${tool} but offered ${x.toolSchemaNames.length > 0 ? `only [${x.toolSchemaNames.join(", ")}]` : "no tool schemas"}; the model named ${tool} in its reply`),
      ...(withheld ? [ev1(withheld, `harness withheld the tools for that turn: ${clip(oneLine(withheld.contentPreview), 60)}`)] : []),
      ...(f.completed ? [ev1(f.completed, `${tool} never ran; run ended status=${f.completed.status} terminatedBy=${f.terminatedBy ?? "?"}`)] : []),
    ],
    needs: [],
  };
};
