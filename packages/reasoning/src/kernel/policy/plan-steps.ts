/**
 * policy/plan-steps.ts — pure helpers for the plan/execute posture pair.
 *
 * Spec: wiki/Architecture/Design-Specs/2026-11-16-plan-execute-posture-robustness.md.
 * Deterministic (golden rule 5): no LLM, no clock, no fs.
 *
 *  - {@link derivePlanSteps}: the checklist items hidden in a plan reply
 *    (numbered / bulleted step lines), used by the terminal `plan-checklist`
 *    step when the model recorded no `todo` list itself;
 *  - {@link planToolCatalogLine}: the opt-in (`planToolCatalog`) one-line
 *    catalog of the tools the execute phase would have;
 *  - {@link FOLLOW_PLAN_GUIDANCE}: the execute-side advisory line.
 */
import type { ToolSchema } from "../capabilities/attend/tool-formatting.js";
import { META_TOOLS } from "../state/kernel-constants.js";

/** Most steps a derived checklist holds. */
export const MAX_DERIVED_STEPS = 12;
/** Longest derived step title (characters). */
export const MAX_DERIVED_STEP_CHARS = 140;
/** Most tools the plan catalog names. */
export const MAX_CATALOG_TOOLS = 40;
const MAX_CATALOG_DESC_CHARS = 70;

/** The execute-side advisory line, rendered while a seeded checklist has unchecked steps. */
export const FOLLOW_PLAN_GUIDANCE =
  "Follow the plan checklist: work the next unchecked step, mark it done with todo when finished, and revise the list with todo if reality differs from the plan. " +
  "Issue independent tool calls together in one turn, update todo in the same turn as the real work, and never re-add steps already on the list.";

const NUMBERED = /^\s*(?:step\s+)?(\d{1,2})\s*[.):]\s+(\S.*)$/i;
const BULLETED = /^\s*[-*•]\s+(\S.*)$/;
const INLINE_MARKER = /(?:^|\s)(\d{1,2})[.)]\s+(?=\S)/g;

/** Strip emphasis / code markers and trailing punctuation, collapse whitespace. */
const clean = (raw: string): string =>
  raw.replace(/\*\*|__|`/g, "").replace(/\s+/g, " ").trim().replace(/[.;,]+$/, "");

const clip = (s: string, max: number): string =>
  s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

/**
 * First-person / framing narrative, never a step: "I need to…", "I'll…",
 * "Let me…", "We should…", "To understand X, I'll…", "Finally, I'll…".
 */
const NARRATIVE =
  /^(?:(?:first|next|then|finally|lastly|after that|now)[,:]?\s+)?(?:i\b|i'(?:ll|m|d|ve)\b|we\b|we'(?:ll|re)\b|let me\b|let's\b|my plan\b)|^to\s[^,]{1,80},\s*(?:i|we)\b/i;

const normalizeTokens = (s: string): ReadonlySet<string> =>
  new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 0 && !["the", "a", "an", "of", "to", "and"].includes(w)));
const tokens = normalizeTokens;

/** Near-identical titles: same words ignoring case/punctuation/articles, or ≥80% token overlap. */
function similar(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size === 0 || b.size === 0) return a.size === b.size;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  // A restatement that is wholly contained in a longer title (≥3 words) is a duplicate too.
  return shared / Math.max(a.size, b.size) >= 0.8 || (Math.min(a.size, b.size) >= 3 && shared === Math.min(a.size, b.size));
}

/** Inline `1) a 2) b` runs: markers must count up from 1 and number at least two. */
function inlineNumbered(reply: string): readonly string[] {
  const marks: { n: number; at: number; end: number }[] = [];
  for (const m of reply.matchAll(INLINE_MARKER)) {
    const at = m.index ?? 0;
    marks.push({ n: Number(m[1]), at, end: at + m[0].length });
  }
  const run: typeof marks = [];
  for (const mk of marks) {
    if (mk.n === run.length + 1) run.push(mk);
  }
  if (run.length < 2) return [];
  // A step ends at its sentence end, so prose after the last step is not part of it.
  return run.map((mk, i) => (reply.slice(mk.end, run[i + 1]?.at ?? reply.length).split(/(?<=[.!?])\s/)[0] ?? ""));
}

/** One list in a reply: the prose line above it and its raw item texts. */
interface RawList {
  readonly heading: string;
  readonly items: string[];
}

/**
 * The lists `re` finds, in reply order. A list ends at an unindented prose line
 * (a heading) and, for numbered lists, where the numbering restarts. Indented
 * prose is a continuation and ends nothing.
 */
function listsOf(lines: readonly string[], re: RegExp, numbered: boolean): readonly RawList[] {
  const lists: RawList[] = [];
  let open: RawList | undefined;
  let heading = "";
  let prev = 0;
  for (const line of lines) {
    const m = re.exec(line);
    if (m !== undefined && m !== null) {
      const text = m[numbered ? 2 : 1] ?? "";
      const n = numbered ? Number(m[1]) : 0;
      if (open === undefined || (numbered && n <= prev)) {
        open = { heading, items: [] };
        lists.push(open);
      }
      open.items.push(text);
      prev = n;
    } else if (line.trim().length > 0 && !NUMBERED.test(line) && !BULLETED.test(line) && !/^\s/.test(line)) {
      open = undefined;
      heading = line;
    }
  }
  return lists;
}

/** One list's step titles: cleaned, clipped, narrative and near-duplicates dropped, capped. */
function stepTitles(source: readonly string[]): readonly string[] {
  const seen: ReadonlySet<string>[] = [];
  const out: string[] = [];
  for (const r of source) {
    const title = clip(clean(r), MAX_DERIVED_STEP_CHARS);
    if (title.length === 0 || NARRATIVE.test(title)) continue;
    const words = tokens(title);
    if (seen.some((s) => similar(s, words))) continue;
    seen.push(words);
    out.push(title);
    if (out.length === MAX_DERIVED_STEPS) break;
  }
  return out;
}

const PLAN_HEADING = /todo|steps?|actionable|plan/i;

/**
 * Checklist titles derived from a plan reply, taken from ONE list: a model that
 * restates its plan (a vague list, then the same steps with tool hints, then
 * bullets) must not get the union. Numbered lists are the candidates (else
 * bulleted, else an inline `1) a 2) b` run). The winner has the most steps
 * naming a tool; ties go to the list under a plan/steps/todo heading, then to
 * the later one. With no hints anywhere the longest list wins (ties: later).
 * Inside it, markers and emphasis are stripped, each title clipped to
 * {@link MAX_DERIVED_STEP_CHARS}, narrative and near-duplicates dropped, at most
 * {@link MAX_DERIVED_STEPS}. Empty when nothing reads as a step.
 */
export function derivePlanSteps(reply: string): readonly string[] {
  const lines = reply.split(/\r?\n/);
  const numbered = listsOf(lines, NUMBERED, true);
  const candidates = numbered.length > 0 ? numbered : listsOf(lines, BULLETED, false);
  const lists: readonly { readonly heading: string; readonly titles: readonly string[] }[] =
    candidates.length > 0
      ? candidates.map((l) => ({ heading: l.heading, titles: stepTitles(l.items) }))
      : [{ heading: "", titles: stepTitles(inlineNumbered(reply)) }];
  let best: (typeof lists)[number] | undefined;
  let bestKey: readonly number[] = [];
  for (const l of lists) {
    const hinted = l.titles.filter((t) => planStepTool(t) !== undefined).length;
    const key = [hinted, hinted === 0 ? l.titles.length : 0, PLAN_HEADING.test(l.heading) ? 1 : 0];
    // Lexicographic key compare; an equal key lets the later list win.
    const firstDiff = key.findIndex((k, i) => k !== bestKey[i]);
    if (best === undefined || firstDiff === -1 || key[firstDiff]! > bestKey[firstDiff]!) {
      best = l;
      bestKey = key;
    }
  }
  return best?.titles ?? [];
}

const TOOL_HINT = /\btool:\s*`?([\w][\w./-]*)/i;

/**
 * The tool a step names as `tool: name` / `(tool: name)`, or undefined. Trailing
 * punctuation is not part of the name.
 */
export function planStepTool(title: string): string | undefined {
  const name = TOOL_HINT.exec(title)?.[1]?.replace(/[.\/-]+$/, "");
  return name !== undefined && name.length > 0 ? name : undefined;
}

const firstSentence = (s: string): string => clip(clean(s).split(/(?<=[.!?])\s/)[0] ?? "", MAX_CATALOG_DESC_CHARS);

/**
 * The plan tool catalog, one guidance line: names plus a one-line
 * description of the execute phase's domain tools (meta/planning tools left out;
 * MCP tools `server/name` grouped by server after the own tools),
 * capped at {@link MAX_CATALOG_TOOLS}. `undefined` when there is nothing to list.
 */
export function planToolCatalogLine(schemas: readonly Pick<ToolSchema, "name" | "description">[] | undefined): string | undefined {
  const tools = (schemas ?? []).filter((t) => !META_TOOLS.has(t.name));
  if (tools.length === 0) return undefined;
  const own: string[] = [];
  const servers = new Map<string, string[]>();
  for (const t of tools.slice(0, MAX_CATALOG_TOOLS)) {
    const d = firstSentence(t.description);
    const entry = d.length > 0 ? `${t.name} (${d})` : t.name;
    const slash = t.name.indexOf("/");
    if (slash <= 0) own.push(entry);
    else {
      const server = t.name.slice(0, slash);
      servers.set(server, [...(servers.get(server) ?? []), entry]);
    }
  }
  const parts = [
    ...(own.length > 0 ? [own.join("; ")] : []),
    ...[...servers].map(([server, entries]) => `MCP ${server}: ${entries.join("; ")}`),
  ];
  const hidden = tools.length - Math.min(tools.length, MAX_CATALOG_TOOLS);
  const more = hidden > 0 ? `; and ${hidden} more` : "";
  return `Execute-phase tools: ${parts.join(". ")}${more}. You cannot call these now; reference them in steps as \`tool: name\`.`;
}
