import { contextLevel, estimateTokens } from "@reactive-agents/ui-core";
import type { StoredContext } from "../db/chat-queries.js";
import { utilityPrompt } from "./utility-agent.js";

/**
 * Compaction summary contract. The summariser must answer with these level-2 sections,
 * in this order. The UI parses them (`parseCompactionSections`), so the names are part
 * of the wire format.
 */
export const COMPACTION_SECTIONS = [
  "Goal",
  "Decisions",
  "Facts & identifiers",
  "Files & artifacts",
  "Open questions",
  "Next steps",
] as const;

/** Wrapper heading for a summary that did not follow the contract. The text is kept, not dropped. */
export const UNSTRUCTURED_SUMMARY_HEADING = "## Summary (unstructured)";

/** Upper bound on the transcript quoted to the summariser (characters). */
export const SUMMARY_TRANSCRIPT_CHAR_CAP = 60_000;

/** Share of the cap kept from the start of the transcript; the rest goes to the most recent messages. */
const HEAD_SHARE = 0.2;

/**
 * What goes under each section. Kept OUT of the heading line: a model copies a heading
 * verbatim, so guidance written into it ends up in the summary's headings.
 */
const SECTION_GUIDANCE: Readonly<Record<(typeof COMPACTION_SECTIONS)[number], string>> = {
  Goal: "what the user is trying to achieve",
  Decisions: "choices made and what was ruled out",
  "Facts & identifiers": "names, numbers, file paths, IDs, versions, verbatim error strings",
  "Files & artifacts": "files, documents and outputs created or changed",
  "Open questions": "what is still unresolved",
  "Next steps": "what happens next",
};

/** The instruction half of the summariser prompt (the transcript goes before it). */
export function compactionInstruction(): string {
  return [
    "Summarise the conversation above so it can replace the original as context for future turns.",
    "Reply with exactly these markdown sections, in this order, each as a level-2 heading, and nothing before the first heading.",
    "The bullet under each heading says what belongs there; replace it with your content:",
    ...COMPACTION_SECTIONS.flatMap((s) => [`## ${s}`, `- (${SECTION_GUIDANCE[s]})`]),
    "Write each section as short bullets or a sentence. If a section has nothing in it, write `None.` under its heading.",
    "Write each heading line exactly as shown, with nothing added to it. No preamble and no closing remarks.",
  ].join("\n");
}

/**
 * Comparable form of a section heading: trimmed, whitespace collapsed, lower case, and
 * without trailing colons or parentheticals. `Facts & identifiers (names, IDs):` and
 * `facts & identifiers` compare equal. The UI parser (`parseCompactionSections`) uses the
 * same rule.
 */
export function normalizeSectionHeading(heading: string): string {
  let s = heading.trim().replace(/\s+/g, " ");
  for (;;) {
    const next = s.replace(/\s*:\s*$/, "").replace(/\s*\([^()]*\)\s*$/, "");
    if (next === s) break;
    s = next;
  }
  return s.toLowerCase();
}

/** The text of a level-2 heading line (`## X`, not `###`), or `null`. */
function level2Heading(line: string): string | null {
  const m = /^##\s+(.+?)\s*$/.exec(line);
  return m ? m[1]! : null;
}

/**
 * The full summariser prompt for a set of turns: the transcript, bounded, then the
 * instruction. A long chat cannot overflow the summariser's context.
 */
export function compactionPrompt(turns: ReadonlyArray<{ role: string; content: string }>): string {
  return utilityPrompt(boundTranscript(turns), compactionInstruction());
}

/**
 * Render turns as `User:` / `Assistant:` paragraphs, capped at `maxChars`. When the cap
 * bites, the first ~20% and the last of the budget are kept and the middle is replaced
 * by `[... N earlier messages elided ...]`. N counts messages that are wholly absent. A
 * message cut at a boundary counts as present.
 */
export function boundTranscript(
  turns: ReadonlyArray<{ role: string; content: string }>,
  maxChars: number = SUMMARY_TRANSCRIPT_CHAR_CAP,
): string {
  const lines = turns.map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.content}`);
  const full = lines.join("\n\n");
  if (full.length <= maxChars) return full;

  // Budget the marker first so the whole result stays within maxChars.
  const headBudget = Math.floor(maxChars * HEAD_SHARE);
  const tailBudget = Math.max(0, maxChars - headBudget - 120);
  const tailStart = full.length - tailBudget;

  let offset = 0;
  let elided = 0;
  for (const line of lines) {
    const start = offset;
    const end = offset + line.length;
    if (start >= headBudget && end <= tailStart) elided++;
    offset = end + 2;
  }
  const marker =
    elided > 0
      ? `[... ${elided} earlier messages elided ...]`
      : "[... part of a long message elided ...]";
  return `${full.slice(0, headBudget)}\n\n${marker}\n\n${full.slice(tailStart)}`;
}

/**
 * Accept a summary that has every section, in order. Headings match after
 * `normalizeSectionHeading` (case, spacing, a trailing parenthetical or colon), and a
 * matched heading is rewritten to its exact contract name. Anything else is wrapped
 * under `UNSTRUCTURED_SUMMARY_HEADING` so the text is kept and the UI still renders it.
 * Empty input stays empty: the caller refuses it.
 */
export function structureCompactionSummary(raw: string): string {
  const text = raw.trim();
  if (text === "") return "";
  const lines = text.split("\n").map((l) => l.trimEnd());
  let at = 0;
  for (const section of COMPACTION_SECTIONS) {
    const want = normalizeSectionHeading(section);
    const found = lines.findIndex((l, i) => {
      if (i < at) return false;
      const h = level2Heading(l);
      return h !== null && normalizeSectionHeading(h) === want;
    });
    if (found < 0) return `${UNSTRUCTURED_SUMMARY_HEADING}\n\n${text}`;
    lines[found] = `## ${section}`;
    at = found + 1;
  }
  return lines.join("\n");
}

/**
 * Context reading for the transcript the next turn will see. Tokens are estimated from
 * the text. Window numbers come only from a known window; without one the reading
 * carries tokens alone (no fake percentage).
 */
export function compactionContextEstimate(
  transcript: ReadonlyArray<{ content: string }>,
  windowTokens: number | undefined,
): StoredContext {
  const tokensUsed = transcript.reduce((sum, t) => sum + estimateTokens(t.content), 0);
  if (windowTokens === undefined || windowTokens <= 0) return { tokensUsed, estimated: true };
  const utilizationPct = Math.round((tokensUsed / windowTokens) * 100);
  return { tokensUsed, windowTokens, utilizationPct, level: contextLevel(utilizationPct), estimated: true };
}
