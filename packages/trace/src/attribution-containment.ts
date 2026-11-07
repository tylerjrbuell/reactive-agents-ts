// packages/trace/src/attribution-containment.ts
//
// Containment test for the evidence rules (tool-result budget spike,
// wiki/Research/Harness-Reports/2026-11-07-tool-result-budget-spike.md, F3).
// `harness:evidence-truncated` used to fire on any compressed or dropped result
// before the divergence turn. On the lh-1 corpus it over-blamed the harness 6 of
// 6 times: the URLs the deliverables used were visible on the turn that wrote
// them. This module asks the question the rule's `needs` field left open: was
// the text the deliverable depends on in the divergence turn's request?
//
// What it compares (trace facts only, no grader re-run):
//   - deliverable tokens: URL-shaped tokens in the content the divergence turn
//     wrote (its write, plus every write call in the same response, since graders
//     cross-check files written together), or the shipped answer. Literal `\n`
//     ends a token, the way a real line break would.
//   - the divergence turn's recorded request text, and the recorded text of
//     every tool result before that turn.
//
// Each token is `visible` (the request shows it), `unsourced` (no recorded
// result holds it: the model miscopied or recalled it, the cut cannot have
// hidden it) or `unverified` (a recorded result holds it and the request text
// does not; when the recorder clipped the request it may sit in the clipped
// part). URLs because they are the tokens a grader checks that a run can only
// copy from evidence (a source list, a citation). Numbers and prose are not
// tested: a number can be computed, prose can be paraphrased. A deliverable with
// no URL gives no containment signal and the rules keep their old reading.
//
// Not covered: text the cut hid that the deliverable LACKS. The recorder keeps
// the act-time preview of a compressed result, not the raw text, so the hidden
// part is not in the trace. A rule cleared by containment says so in `missing`.

import { isWriter, contentArg, resultText, type Facts, type Divergence, type RequestView } from "./attribution-facts.js";

/** A URL as graders match one: stops at whitespace, quotes, brackets, a backtick, a backslash and an ellipsis. */
const URL_TOKEN = /https?:\/\/[^\s)\]"'<>`\\…]+/g;
/** Sentence punctuation a URL token does not end with. */
const TRAILING_PUNCT = /[.,;:!?]+$/;

/** Distinct URL-shaped tokens in `text`, in first-seen order, trailing punctuation stripped. */
export function urlTokens(text: string): readonly string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(URL_TOKEN)) {
    const u = m[0].replace(TRAILING_PUNCT, "");
    if (u.length > "https://".length) out.add(u);
  }
  return [...out];
}

/** A write call's content as text: a string as is, a structured value as JSON. */
const contentText = (args: unknown): string | undefined => {
  const s = contentArg(args);
  if (s !== undefined) return s;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return undefined;
  const v = (args as Readonly<Record<string, unknown>>)["content"];
  return v === undefined ? undefined : JSON.stringify(v);
};

/** The text the divergence turn delivered: its write and sibling writes, or the shipped answer. */
export function deliverableText(f: Facts, d: Divergence): string {
  const parts: string[] = [];
  if (d.write !== undefined) parts.push(contentText(d.write.args) ?? "");
  for (const c of d.exchange.response.toolCalls ?? []) if (isWriter(c.name)) parts.push(contentText(c.arguments) ?? "");
  if (d.target.kind === "answer") parts.push(f.completed?.output ?? d.exchange.response.content);
  return parts.join("\n");
}

/** Result of {@link containment}. */
export interface Containment {
  /** URL tokens the deliverable holds. Empty: no containment signal. */
  readonly tokens: readonly string[];
  /** Tokens the divergence turn's request shows. */
  readonly visible: readonly string[];
  /** Tokens no recorded tool result holds (miscopied or recalled): the cut cannot have hidden them. */
  readonly unsourced: readonly string[];
  /** Tokens a recorded result holds that the request text does not show. */
  readonly unverified: readonly string[];
}

/**
 * Was the text the deliverable depends on in the divergence turn's request?
 *
 * @param f Run facts.
 * @param d The divergence turn.
 * @param req That turn's recorded request.
 */
export function containment(f: Facts, d: Divergence, req: RequestView): Containment {
  const tokens = urlTokens(deliverableText(f, d));
  const evidence = f.toolEnds.filter((t) => t.seq < d.exchange.seq && !isWriter(t.toolName)).map(resultText).join("\n");
  const visible = tokens.filter((u) => req.text.includes(u));
  const unsourced = tokens.filter((u) => !req.text.includes(u) && !evidence.includes(u));
  const unverified = tokens.filter((u) => !req.text.includes(u) && evidence.includes(u));
  return { tokens, visible, unsourced, unverified };
}

/** True when containment clears a cut: the deliverable holds URL tokens and each is visible or unsourced. */
export const cutCleared = (c: Containment): boolean => c.tokens.length > 0 && c.unverified.length === 0;

/** One-line summary of a {@link Containment} for evidence details. */
export const containmentLine = (c: Containment): string =>
  `${c.visible.length}/${c.tokens.length} URL(s) the deliverable uses are visible in the request` +
  (c.unsourced.length > 0 ? `, ${c.unsourced.length} in no recorded result (${c.unsourced.slice(0, 2).join(", ")})` : "") +
  (c.unverified.length > 0 ? `, ${c.unverified.length} in a recorded result but not the request text` : "");
