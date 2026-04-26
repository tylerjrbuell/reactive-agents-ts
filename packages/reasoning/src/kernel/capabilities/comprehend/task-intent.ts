/**
 * task-intent.ts — Lightweight regex-based extraction of requested output format from a task prompt.
 *
 * Called once at kernel start to detect explicit format cues ("markdown table", "JSON", etc.)
 * so the output quality gate can validate the deliverable matches what the user asked for.
 *
 * Design: Pure regex/keyword extraction — NO LLM call. Must be fast and deterministic.
 */

// ── Output Format Types ──────────────────────────────────────────────────────

export type OutputFormat =
  | "markdown"
  | "json"
  | "csv"
  | "html"
  | "code"
  | "list"
  | "prose";

export interface TaskIntent {
  /** The detected output format, or null if no explicit format was requested. */
  readonly format: OutputFormat | null;
  /** The raw cue phrases that matched (e.g. ["markdown table", "prices"]). */
  readonly cues: readonly string[];
  /** Expected content hints extracted from "with the X, Y, and Z" phrases. */
  readonly expectedContent: readonly string[];
  /**
   * Named entities the task explicitly enumerates that MUST appear in the output.
   * E.g. "for each currency: XRP, XLM, ETH, Bitcoin" → ["xrp", "xlm", "eth", "bitcoin"]
   */
  readonly expectedEntities: readonly string[];
}

// ── Format Detection Rules ───────────────────────────────────────────────────
// Ordered by specificity — most specific patterns first to avoid false positives.

interface FormatRule {
  readonly format: OutputFormat;
  readonly patterns: readonly RegExp[];
}

const FORMAT_RULES: readonly FormatRule[] = [
  {
    format: "markdown",
    patterns: [
      /markdown\s+table/i,
      /(?:generate|create|build|make|produce|output)\s+(?:a\s+)?table/i,
      /(?:as|in)\s+(?:a\s+)?table(?:\s+format)?/i,
      /(?:as|in|using)\s+markdown/i,
      /markdown\s+(?:format|output)/i,
    ],
  },
  {
    format: "json",
    patterns: [
      /(?:as|in|return|output)\s+json/i,
      /json\s+(?:format|output|response)/i,
      /format\s+(?:as|in)\s+json/i,
    ],
  },
  {
    format: "csv",
    patterns: [
      /(?:as|in|export|output)\s+csv/i,
      /csv\s+(?:format|file|output)/i,
      /comma[- ]separated/i,
    ],
  },
  {
    format: "html",
    patterns: [
      /(?:as|in|generate|create)\s+(?:an?\s+)?html/i,
      /html\s+(?:page|format|output|code)/i,
    ],
  },
  {
    format: "code",
    patterns: [
      /(?:write|create|generate|give\s+me)\s+(?:a\s+)?(?:\w+\s+)?(?:function|script|program|class|module|code\s+snippet|snippet)/i,
      /code\s+(?:example|block|snippet)/i,
    ],
  },
  {
    format: "list",
    patterns: [
      /(?:bullet|numbered|ordered|unordered)\s+list/i,
      /(?:give|provide|show|return)\s+(?:me\s+)?(?:a\s+)?(?:bullet|numbered)?\s*list/i,
      /^list\s+(?:the|all|top|every)\b/i,
    ],
  },
];

// ── Expected Content Extraction ──────────────────────────────────────────────

const CONTENT_HINT_PATTERNS: readonly RegExp[] = [
  /with\s+the\s+(.+?)(?:\.|$)/i,
  /(?:include|including|containing)\s+(.+?)(?:\.|$)/i,
  /(?:columns?|fields?)\s*[:=]\s*(.+?)(?:\.|$)/i,
];

/**
 * Patterns that enumerate entities the task explicitly names.
 * E.g. "for each currency: XRP, XLM, ETH, Bitcoin" → ["xrp", "xlm", "eth", "bitcoin"]
 */
const ENTITY_PATTERNS: readonly RegExp[] = [
  /(?:for\s+)?each\s+\w+\s*:\s*(.+?)(?:\.\s|$)/i,
  /(?:for|of)\s+(?:the\s+)?following\s*:\s*(.+?)(?:\.\s|$)/i,
  /(?:fetch|get|find|look\s*up|retrieve|search)\s+(?:the\s+)?(?:current\s+)?(?:\w+\s+){0,3}(?:for|of)\s+(.+?)(?:\.\s|$)/i,
];

function splitTerms(raw: string): string[] {
  return raw
    .split(/\s*[,|]\s*|\s+and\s+/i)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.length < 50);
}

function extractExpectedContent(task: string): readonly string[] {
  const hints: string[] = [];
  for (const pattern of CONTENT_HINT_PATTERNS) {
    const match = task.match(pattern);
    if (match?.[1]) {
      hints.push(...splitTerms(match[1]));
    }
  }
  return hints;
}

/**
 * Extract named entities that the task explicitly enumerates.
 * These are the specific items the output MUST reference to be considered complete.
 */
function extractExpectedEntities(task: string): readonly string[] {
  const entities: string[] = [];
  for (const pattern of ENTITY_PATTERNS) {
    const match = task.match(pattern);
    if (match?.[1]) {
      entities.push(...splitTerms(match[1]));
    }
  }
  return entities;
}

// ── Main Extraction Function ─────────────────────────────────────────────────

/**
 * Extract the requested output format from a task prompt.
 *
 * Pure regex-based — no LLM call. Returns the first strongly-matched format
 * along with the cue phrases that triggered the match.
 *
 * @param task - The original user task prompt
 * @returns TaskIntent with format, cues, and expected content hints
 */
export function extractOutputFormat(task: string): TaskIntent {
  if (!task || task.trim().length === 0) {
    return { format: null, cues: [], expectedContent: [], expectedEntities: [] };
  }

  const cues: string[] = [];
  let detectedFormat: OutputFormat | null = null;

  for (const rule of FORMAT_RULES) {
    for (const pattern of rule.patterns) {
      const match = task.match(pattern);
      if (match) {
        cues.push(match[0].toLowerCase().trim());
        if (!detectedFormat) {
          detectedFormat = rule.format;
        }
      }
    }
  }

  const expectedContent = extractExpectedContent(task);
  const expectedEntities = extractExpectedEntities(task);

  return {
    format: detectedFormat,
    cues,
    expectedContent,
    expectedEntities,
  };
}
