/**
 * Verify capability — an answer that CLAIMS an action the run never performed
 * (ablation 2026-11-10, wiki/Research/Ablations/2026-11-10-stable-tool-list-ablation.md).
 *
 * mimo on `wide-metric` called only `metrics_fetch`, wrote "I've filed a
 * report", and the run was accepted as success, in 12 of 20 runs. The
 * `report_file` tool was offered and never called.
 *
 * The check is general (no tool list): an answer sentence that asserts a
 * COMPLETED action ("I've filed a report", "the message was sent") names an
 * action verb. A tool on the run's surface matches the claim when its name
 * contains that verb AND the claim's sentence names another word of the tool
 * name (`report_file` + "filed a report"; `file-write` + "wrote the file").
 * A tool named by the verb alone (`email`, `send`) matches on the verb. The
 * claim is unbacked when no matching tool ever ran successfully.
 *
 * Precision first: only first-person or passive completed forms count, a
 * sentence with a negation, condition or future marker before the verb never
 * counts, and questions never count. Readers: the exit gate (a model exit is
 * denied with the unmet action named) and the terminal verifier (reject).
 *
 * Pure, deterministic, no LLM.
 */
import type { ReasoningStep } from "../../../types/index.js";
import { GUARD_OBSERVATION_TAG, HARNESS_PSEUDO_TOOLS, META_TOOLS } from "../../state/kernel-constants.js";

/** Completed-action verb forms and the stem a tool name would carry. */
const ACTION_VERBS: Readonly<Record<string, string>> = {
  filed: "file",
  sent: "send",
  emailed: "email",
  messaged: "message",
  posted: "post",
  submitted: "submit",
  created: "create",
  opened: "open",
  wrote: "write",
  written: "write",
  saved: "save",
  stored: "store",
  uploaded: "upload",
  published: "publish",
  scheduled: "schedule",
  booked: "book",
  deleted: "delete",
  removed: "remove",
  updated: "update",
  committed: "commit",
  pushed: "push",
  deployed: "deploy",
  notified: "notify",
  reported: "report",
  logged: "log",
  recorded: "record",
};

const VERB_ALT = Object.keys(ACTION_VERBS).join("|");
const ADVERBS = "(?:(?:also|now|just|already|successfully|then|gone ahead and|went ahead and)\\s+)*";
/** "I've filed", "we have sent", "I filed", "I've also successfully posted". */
const ACTIVE_CLAIM = new RegExp(`\\b(?:i|we)(?:'ve|’ve|\\s+have|\\s+has)?\\s+${ADVERBS}(${VERB_ALT})\\b`, "gi");
/** "has been filed", "was sent", "were created", "is now saved". */
const PASSIVE_CLAIM = new RegExp(
  `\\b(?:has|have|was|were|is|are)\\s+(?:now\\s+)?(?:been\\s+)?(?:successfully\\s+)?(${VERB_ALT})\\b`,
  "gi",
);
/** A sentence prefix that makes the verb not a completed claim. */
const NOT_A_CLAIM =
  /\b(?:not|never|no|unable|cannot|can't|couldn't|didn't|wasn't|weren't|haven't|hasn't|isn't|failed to|if|once|when|would|should|could|will|won't|might|may|unless|before|until|whether)\b|n't\b/i;

/** Name words that say nothing about the action. */
const GENERIC_NAME_WORDS = new Set(["tool", "tools", "api", "mcp", "the", "a", "an", "to", "of", "and", "for", "get", "new"]);

/** Lower-case words of a tool name: split on separators and camelCase. */
export function toolNameWords(name: string): readonly string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

/** One asserted action no successful tool call backs. */
export interface UnbackedClaim {
  /** The claim as written, e.g. `I've filed a report`. */
  readonly phrase: string;
  /** Matching tools offered this run, none of which ran successfully. */
  readonly tools: readonly string[];
}

/** The sentence around `idx` (split on . ! ? newline) and the part before `idx`. */
function sentenceAt(text: string, idx: number): { readonly sentence: string; readonly before: string } {
  let start = 0;
  for (const ch of [".", "!", "?", "\n"]) start = Math.max(start, text.lastIndexOf(ch, idx - 1) + 1);
  let end = text.length;
  for (const ch of [".", "!", "?", "\n"]) {
    const e = text.indexOf(ch, idx);
    if (e !== -1 && e < end) end = e;
  }
  return { sentence: text.slice(start, end), before: text.slice(start, idx) };
}

/** True when `word` (or its plural) appears as a word in `sentence`. */
const mentions = (sentence: string, word: string): boolean =>
  new RegExp(`\\b${word}(?:s|es)?\\b`, "i").test(sentence);

/** Tools whose name matches the claimed verb in `sentence`. */
function matchingTools(stem: string, sentence: string, tools: readonly string[]): readonly string[] {
  return tools.filter((name) => {
    const words = toolNameWords(name);
    if (!words.includes(stem)) return false;
    const others = words.filter((w) => w !== stem && !GENERIC_NAME_WORDS.has(w) && w.length >= 3);
    return others.length === 0 || others.some((w) => mentions(sentence, w));
  });
}

/** Tool names with a successful, executed result in `steps` (guard warnings excluded). */
export function succeededToolNames(steps: readonly ReasoningStep[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const s of steps) {
    if (s.type !== "observation" || s.metadata?.frameworkInstrumentation === GUARD_OBSERVATION_TAG) continue;
    const r = s.metadata?.observationResult;
    if (r?.success !== true) continue;
    out.add(r.toolName);
    for (const d of r.delegatedToolsUsed ?? []) out.add(d);
  }
  return out;
}

/**
 * Completed actions the answer asserts that no successful tool call backs.
 * `tools` is the run's tool surface (names); meta and harness tools never match.
 */
export function unbackedClaimedActions(
  answer: string,
  tools: readonly string[],
  succeeded: ReadonlySet<string>,
): readonly UnbackedClaim[] {
  const candidates = tools.filter((t) => !META_TOOLS.has(t) && !HARNESS_PSEUDO_TOOLS.has(t));
  if (candidates.length === 0 || answer.trim().length === 0) return [];
  const out: UnbackedClaim[] = [];
  for (const pattern of [ACTIVE_CLAIM, PASSIVE_CLAIM]) {
    for (const m of answer.matchAll(pattern)) {
      const idx = m.index ?? 0;
      const stem = ACTION_VERBS[(m[1] ?? "").toLowerCase()];
      if (stem === undefined) continue;
      const { sentence, before } = sentenceAt(answer, idx);
      if (NOT_A_CLAIM.test(before) || answer[idx + sentence.length - before.length] === "?") continue;
      const matched = matchingTools(stem, sentence, candidates);
      if (matched.length === 0 || matched.some((t) => succeeded.has(t))) continue;
      const phrase = sentence.trim().slice(0, 120);
      if (!out.some((c) => c.phrase === phrase)) out.push({ phrase, tools: matched });
    }
  }
  return out;
}

/** The outstanding item an unbacked claim becomes (exit gate list, verifier reason). */
export function describeUnbackedClaim(c: UnbackedClaim): string {
  const names = c.tools.map((t) => `\`${t}\``).join(" or ");
  return `the answer says "${c.phrase}" but ${names} never ran successfully: call it, or say plainly that it was not done`;
}
