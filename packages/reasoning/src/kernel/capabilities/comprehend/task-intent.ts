/**
 * task-intent.ts — Lightweight regex-based extraction of requested output format from a task prompt.
 *
 * Called once at kernel start to detect explicit format cues ("markdown table", "JSON", etc.)
 * so the output quality gate can validate the deliverable matches what the user asked for.
 *
 * Design: Pure regex/keyword extraction — NO LLM call. Must be fast and deterministic.
 *
 * Also hosts {@link nominateRequiredTools} — surfaces likely-required tools from the
 * task text by matching semantic-category keyword cues against names/descriptions of
 * tools the run actually has available. The runner seeds the result on
 * `state.meta.nominatedTools` and act/guard.ts uses high-confidence nominations as a
 * required-tool floor when `input.requiredTools` is empty (HS-115 anti-scaffold closure
 * for F4/F5 — every emit has a same-commit consumer per North Star §9).
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
      // Sentence-initial or post-period imperative: "List them", "List the…"
      /(?:^|[.?!]\s+)list\s+\w+/i,
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

// ── Tool Nomination (HS-115 / Audit G-E) ─────────────────────────────────────
//
// `nominateRequiredTools` is a pure keyword-cue matcher. It produces a list of
// tool names that the task text plausibly *requires*, scoped strictly to the
// names the run actually has available. Two contracts the consumer relies on:
//
//   1) **No phantom tool names.** Only entries from `availableTools[].name` may
//      appear in the output. A cue without a matching available tool yields no
//      nomination (the agent cannot be asked to call a tool that does not exist).
//   2) **Confidence floor.** Nominations below 0.5 are dropped at source. The
//      guard consumer further filters to ≥ 0.7 before treating a nomination as
//      a required-tool floor — this keeps weak signals informational only.
//
// The function is intentionally regex/keyword-only (no LLM). It runs once at
// kernel start and seeds `state.meta.nominatedTools` for downstream consumers.

/** A single tool nomination — emitted by {@link nominateRequiredTools}. */
export interface NominatedTool {
  /** Tool name. Always an exact name from the `availableTools` input. */
  readonly name: string;
  /** Confidence in [0.5, 1.0]. ≥ 0.7 is the guard-fallback floor. */
  readonly confidence: number;
  /** Short human-readable rationale (the matched category). */
  readonly reason: string;
  /** The raw cue phrases from the task text that triggered the match. */
  readonly cues: readonly string[];
}

/** A semantic category mapping task-text cues to candidate tool-name patterns. */
interface NominationRule {
  /** Display label included in the nomination `reason`. */
  readonly category: string;
  /** Task-text cue patterns (case-insensitive). Each cue is a literal substring. */
  readonly taskCues: readonly RegExp[];
  /**
   * Patterns that match an *available* tool by name OR description.
   * A nomination is emitted only when at least one available tool matches.
   */
  readonly toolPatterns: readonly RegExp[];
  /**
   * Base confidence contributed by a single task-cue match. Multiple cues
   * accumulate (capped at 1.0). Tool-pattern strength does not affect score —
   * it only gates whether the candidate is admissible at all.
   */
  readonly cueWeight: number;
}

const NOMINATION_RULES: readonly NominationRule[] = [
  {
    category: "math/compute",
    taskCues: [
      /\bcalculat\w*/i,
      /\bcompute\b/i,
      /\bevaluate\b/i,
      /\bsolve\b/i,
      /\bsum\b/i,
      /\bproduct\b/i,
      /\b\d+\s*[+\-*/x×÷]\s*\d+/i,
      /\bwhat['’]?s\s+\d+/i,
      /\barithmetic\b/i,
    ],
    toolPatterns: [/calc/i, /\bcompute\b/i, /\bmath\b/i, /\barithmetic\b/i, /evaluator/i],
    cueWeight: 0.55,
  },
  {
    category: "web-search",
    taskCues: [
      /\bsearch\b/i,
      /\bgoogle\b/i,
      /\bweb\s+search\b/i,
      /\blook\s*up\b/i,
      /\blookup\b/i,
      /\bfind\s+(?:information|info|news|the\s+latest)\b/i,
      /\bresearch\b/i,
    ],
    toolPatterns: [/search/i, /lookup/i, /google/i, /\bweb\b/i, /research/i],
    cueWeight: 0.55,
  },
  {
    category: "http-fetch",
    taskCues: [
      /\bfetch\b/i,
      /\bdownload\b/i,
      /\bcall\s+(?:the\s+)?api\b/i,
      /\bhit\s+(?:the\s+)?endpoint\b/i,
      /\brequest\s+(?:the\s+)?url\b/i,
    ],
    toolPatterns: [/\bhttp\b/i, /\bfetch\b/i, /\brequest\b/i, /\bapi\b/i, /url/i],
    cueWeight: 0.55,
  },
  {
    category: "file-write",
    taskCues: [
      /\bwrite\s+(?:[^.]*?\s+)?(?:to\s+(?:a\s+|the\s+)?)?file\b/i,
      /\bsave\s+(?:[^.]*?\s+)?(?:to\s+(?:a\s+|the\s+)?)?file\b/i,
      /\bsave\s+(?:[^.]*?\s+)?to\s+disk\b/i,
      /\bcreate\s+(?:a\s+)?(?:file|document)\b/i,
      /\bappend\s+to\s+(?:a\s+|the\s+)?file\b/i,
    ],
    toolPatterns: [/write[-_]?file/i, /save[-_]?file/i, /file[-_]?write/i, /create[-_]?file/i, /fs[-_]?write/i],
    cueWeight: 0.6,
  },
  {
    category: "file-read",
    taskCues: [
      /\bread\s+(?:the\s+|a\s+)?file/i,
      /\bopen\s+(?:the\s+|a\s+)?file/i,
      /\bload\s+(?:the\s+|a\s+)?(?:file|document)/i,
      /\bcat\s+(?:the\s+|a\s+)?file/i,
    ],
    toolPatterns: [/read[-_]?file/i, /open[-_]?file/i, /file[-_]?read/i, /fs[-_]?read/i, /load[-_]?file/i],
    cueWeight: 0.6,
  },
];

/** True when `pattern` matches `tool.name` or `tool.description` (if present). */
function toolMatchesPattern(
  tool: { readonly name: string; readonly description?: string },
  pattern: RegExp,
): boolean {
  if (pattern.test(tool.name)) return true;
  if (tool.description && pattern.test(tool.description)) return true;
  return false;
}

/**
 * Nominate tools the task text plausibly requires from the available set.
 *
 * Pure regex/keyword matching — no LLM, no I/O. Output is a stable, descending-
 * confidence list. Never emits a name that is not in `availableTools`.
 *
 * @param task            Original user task prompt.
 * @param availableTools  The tool surface this run actually has access to.
 *                        Each entry must expose `name`; `description` is
 *                        consulted to disambiguate generic names.
 */
export function nominateRequiredTools(
  task: string,
  availableTools: readonly { readonly name: string; readonly description?: string }[],
): readonly NominatedTool[] {
  if (!task || task.trim().length === 0) return [];
  if (!availableTools || availableTools.length === 0) return [];

  // Per-tool accumulator: collect all cues + reasons + score contributions.
  const acc = new Map<
    string,
    { confidence: number; reasons: Set<string>; cues: Set<string> }
  >();

  for (const rule of NOMINATION_RULES) {
    // Collect task cues for this category.
    const matchedCues: string[] = [];
    for (const cuePattern of rule.taskCues) {
      const match = task.match(cuePattern);
      if (match) matchedCues.push(match[0].toLowerCase().trim());
    }
    if (matchedCues.length === 0) continue;

    // Identify available tools matching ANY of the rule's tool patterns.
    const candidateTools = availableTools.filter((tool) =>
      rule.toolPatterns.some((p) => toolMatchesPattern(tool, p)),
    );
    if (candidateTools.length === 0) continue; // phantom-name guard

    // Score = cueWeight * cue-count, capped at 1.0.
    const score = Math.min(1, rule.cueWeight + (matchedCues.length - 1) * 0.15);
    if (score < 0.5) continue; // confidence floor at source

    for (const tool of candidateTools) {
      const slot = acc.get(tool.name) ?? {
        confidence: 0,
        reasons: new Set<string>(),
        cues: new Set<string>(),
      };
      slot.confidence = Math.min(1, Math.max(slot.confidence, score));
      slot.reasons.add(rule.category);
      for (const c of matchedCues) slot.cues.add(c);
      acc.set(tool.name, slot);
    }
  }

  const out: NominatedTool[] = [];
  for (const [name, slot] of acc) {
    out.push({
      name,
      confidence: slot.confidence,
      reason: [...slot.reasons].sort().join(", "),
      cues: [...slot.cues],
    });
  }

  // Stable sort: confidence desc, then name asc for deterministic ordering.
  out.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
  return out;
}
