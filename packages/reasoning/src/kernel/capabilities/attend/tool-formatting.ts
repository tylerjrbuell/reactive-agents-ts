/**
 * kernel/utils/tool-formatting.ts — Tool schema formatting, tool-relevance
 * filtering, tool-result compression (preview + scratchpad storage), and
 * novelty-ratio computation.
 *
 * Extracted from tool-utils.ts. All functions are pure (no Effect dependencies).
 */

// ── Tool Schema Formatting ────────────────────────────────────────────────────

/**
 * Fixed char overhead of a compressed tool-result header (STORED line + Type +
 * Preview + coverage hint) used by the try-fit "show all" budget check. Shared
 * by the commit-array and generic-record renderers so the two paths cannot drift.
 */
const HEADER_OVERHEAD = 220;

export interface ToolParamSchema {
  readonly name: string;
  readonly type: string;
  readonly description?: string;
  readonly required?: boolean;
  /** Required by Gemini for array-type parameters. */
  readonly items?: { readonly type: string };
  readonly enum?: readonly string[];
}

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly ToolParamSchema[];
  /** Human-readable return shape, when supplied by the tool definition. */
  readonly returnType?: string;
  /**
   * Which channel this tool belongs to (control-plane design,
   * 2026-08-08-control-plane-vs-meta-tools). `"domain"` (default) = the agent
   * calls it to affect the world; `"harness"` = an agent↔harness coordination
   * affordance (terminate / discover / recall). The invariant: no `"harness"`
   * tool occupies a provider FC slot when the model's dialect is `native-fc`
   * (there the harness reads control from the response shape — no-tool-call =
   * done — so a harness tool is pure token tax + misuse temptation). Absent =>
   * treated as `"domain"`; harness membership is otherwise derived from
   * `META_TOOLS` (single source) at the wire-build site.
   */
  readonly scope?: "domain" | "harness";
}

/** Format tool schemas for LLM consumption.
 * compact (default): "tool_name({param: type}) — description"
 * verbose: multi-line with required/optional markers
 */
export function formatToolSchemas(schemas: readonly ToolSchema[], verbose = false): string {
  if (verbose) {
    return schemas
      .map((s) => {
        const params = s.parameters
          .map((p) => `  - ${p.name} (${p.type}${p.required ? ", required" : ""}): ${p.description ?? ""}`)
          .join("\n");
        return `${s.name}: ${s.description}\n${params}`;
      })
      .join("\n\n");
  }
  return schemas
    .map((s) => {
      if (s.parameters.length === 0) return `- ${s.name}() — ${s.description}`;
      const params = s.parameters
        .map((p) => `"${p.name}": "${p.type}${p.required ? " (required)" : " (optional)"}"`)
        .join(", ");
      return `- ${s.name}({${params}}) — ${s.description}`;
    })
    .join("\n");
}

/** Compact tool format — name and param types only, no description. ~15 tokens per tool. */
export function formatToolSchemaCompact(tool: ToolSchema): string {
  if (tool.parameters.length === 0) return `- ${tool.name}()`;
  const params = tool.parameters
    .map((p) => `${p.name}: ${p.type}${p.required ? "" : "?"}`)
    .join(", ");
  return `- ${tool.name}(${params})`;
}

/**
 * Micro tool format — name and description only, no parameters. ~8 tokens per tool.
 * Used for collapsed/inactive tools in tier-compressed system prompts.
 */
export function formatToolSchemaMicro(tool: ToolSchema): string {
  const desc = tool.description ?? "";
  const truncated = desc.length > 80 ? `${desc.slice(0, 77)}...` : desc;
  return `${tool.name}: ${truncated}`;
}

export interface FilteredTools {
  primary: readonly ToolSchema[];   // mentioned in task — full schema
  secondary: readonly ToolSchema[]; // not mentioned — compact/collapsed
}

/**
 * Extract action keywords from a task description for fuzzy tool matching.
 * Maps common task verbs/nouns to tool-relevant terms.
 */
const TASK_KEYWORD_MAP: Record<string, readonly string[]> = {
  "send": ["send", "message", "notify", "signal"],
  "message": ["send", "message", "signal", "chat"],
  "search": ["search", "find", "query", "lookup"],
  "fetch": ["get", "list", "read", "fetch", "retrieve"],
  "commit": ["commit", "git", "list_commits", "get_commit"],
  "pull request": ["pull_request", "pr", "merge"],
  "issue": ["issue", "bug", "ticket"],
  "write": ["write", "create", "save", "file"],
  "read": ["read", "get", "file", "content"],
  "summarize": ["search", "read", "get"],
  "analyze": ["search", "read", "get", "code"],
  "repository": ["repo", "repository", "github", "branch"],
};

/** Slug tokens too generic to use alone for namespaced-tool primary classification. */
const GENERIC_SLUG_TOKENS = new Set([
  "list", "get", "create", "update", "delete", "add", "set", "check",
  "find", "fetch", "read", "write", "send", "push", "pull", "from",
  "make", "edit", "open", "close", "move", "copy", "show", "view",
  "repo", "repository", "file", "files", "branch", "branches",
  "content", "contents", "data", "info", "item", "items",
  "name", "path", "type", "user", "users", "team", "org",
  "message", "messages", "comment", "comments", "release", "releases",
  "latest", "label", "labels", "status", "result", "results",
  "request", "review", "search", "code", "tags", "group",
  "pending", "reply", "issue", "issues",
]);

/**
 * Split tool schemas into primary (mentioned in task) and secondary (other).
 * Primary tools get full descriptions; secondary get compact name+types only.
 *
 * Matching uses three strategies:
 * 1. Name matching — tool name (or slug) appears in task text
 * 2. Description matching — task keywords appear in tool description
 * 3. Semantic keyword expansion — task verbs map to related tool terms
 */
export function filterToolsByRelevance(
  taskDescription: string,
  schemas: readonly ToolSchema[],
): FilteredTools {
  const taskLower = taskDescription.toLowerCase();
  const taskWords = taskLower.split(/\s+/);
  const primary: ToolSchema[] = [];
  const secondary: ToolSchema[] = [];

  // Expand task keywords using the semantic map
  const expandedKeywords = new Set<string>();
  for (const word of taskWords) {
    expandedKeywords.add(word);
    for (const [trigger, synonyms] of Object.entries(TASK_KEYWORD_MAP)) {
      if (word.includes(trigger) || trigger.includes(word)) {
        for (const syn of synonyms) expandedKeywords.add(syn);
      }
    }
  }

  for (const tool of schemas) {
    const isNamespaced = tool.name.includes("/");
    const localSlug = isNamespaced
      ? (tool.name.split("/").pop()?.toLowerCase() ?? "")
      : tool.name.toLowerCase();

    if (isNamespaced) {
      // Namespaced MCP tools (e.g. "github/list_commits"):
      // ONLY match by local slug — never by description or namespace name.
      // This prevents all 40+ "github/*" tools from being primary when task says "GitHub".
      const localSlugSpaced = localSlug.replace(/[-_]/g, " ");
      // Check 1: full local slug appears verbatim in task (e.g. "list_commits" in task)
      const fullSlugMatch = taskLower.includes(localSlug) || taskLower.includes(localSlugSpaced);
      // Check 2: distinctive slug parts (non-generic action verbs) match raw task words.
      // Uses raw task words — NOT expanded keywords — to avoid matching all tools in a
      // namespace just because the task mentions the namespace (e.g. "GitHub").
      const rawTaskWords = new Set(taskWords);
      const allSlugParts = localSlugSpaced.split(/\s+/);
      const distinctiveParts = allSlugParts.filter(
        (sp) => sp.length > 3 && !GENERIC_SLUG_TOKENS.has(sp),
      );
      // If the tool has distinctive parts, require at least one to be in the task.
      // If all parts are generic (e.g. "get_data"), fall back to full-slug verbatim.
      const slugPartsMatch = distinctiveParts.length > 0
        ? distinctiveParts.some((sp) => rawTaskWords.has(sp))
        : false;
      (fullSlugMatch || slugPartsMatch ? primary : secondary).push(tool);
    } else {
      // Built-in tools: use all three matching strategies
      const nameVariants = [
        tool.name.toLowerCase(),
        localSlug,
        tool.name.toLowerCase().replace(/[-_]/g, " "),
      ];
      const nameMentioned = nameVariants.some((v) => v && taskLower.includes(v));

      const descLower = (tool.description ?? "").toLowerCase();
      const descWords = descLower.split(/\s+/);
      const descMatch = !nameMentioned && descWords.some((dw) =>
        dw.length > 3 && expandedKeywords.has(dw),
      );

      const slugParts = localSlug.replace(/[-_]/g, " ").split(/\s+/);
      const slugMatch = !nameMentioned && !descMatch && slugParts.some((sp) =>
        sp.length > 3 && expandedKeywords.has(sp),
      );

      (nameMentioned || descMatch || slugMatch ? primary : secondary).push(tool);
    }
  }

  // Special case: delegation keywords → spawn-agent should be primary
  const DELEGATION_KEYWORDS = ["delegate", "subagent", "sub-agent", "sub agent", "spawn", "parallel", "concurrently"];
  const hasDelegation = DELEGATION_KEYWORDS.some((k) => taskLower.includes(k));
  if (hasDelegation) {
    const spawnTool = schemas.find((t) => t.name === "spawn-agent");
    if (spawnTool && !primary.includes(spawnTool)) {
      primary.push(spawnTool);
      const secIdx = secondary.indexOf(spawnTool);
      if (secIdx >= 0) secondary.splice(secIdx, 1);
    }
  }

  return { primary, secondary };
}

// ── Tool Result Compression ───────────────────────────────────────────────────

export interface CompressResult {
  content: string;
  stored?: { key: string; value: string };
}

// Monotonic counter for unique scratchpad keys within a process lifetime
let _toolResultCounter = 0;

/** Generate the next unique scratchpad key for a stored tool result. */
export function nextToolResultKey(): string {
  return `_tool_result_${++_toolResultCounter}`;
}

/** Replace blind truncation with structured preview + optional scratchpad storage. */
export function compressToolResult(
  result: string,
  toolName: string,
  budget: number,
  previewItems: number,
): CompressResult {
  // discover-tools exemption (2026-08-19 — root-caused via a live trace, see
  // wiki/Planning/Implementation-Plans/2026-08-19-lightweight-tool-index-progressive-disclosure.md
  // §6e root cause 2). discover-tools' "honest exhaustion" branch
  // (discover-tools.ts) deliberately dumps the COMPLETE tool catalog so the
  // model has ground truth instead of assuming a hidden tool exists — that
  // is the entire point of the design, stated in its own 2026-08-06 fix
  // comment. The generic preview-compressor below truncated that dump right
  // back down to `previewItems` lines (frontier tier: 3) + a "...N more
  // lines" marker, silently defeating the guarantee: confirmed live, a model
  // whose target tool was in the truncated tail never saw it, never called
  // recall() to retrieve the rest, and answered "I don't have access" with
  // the correct tool sitting uncompressed two lines further down in
  // storage. discover-tools' own output is already terse (one line per
  // tool, formatToolLine) — it is the wrong shape for a "preview + recall"
  // treatment designed for noisy CLI/JSON payloads, not a curated listing
  // meant to be read whole.
  if (toolName === "discover-tools") return { content: result };
  if (result.length <= budget) return { content: result };

  const key = nextToolResultKey();

  // Try JSON first
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(result);
    } catch {
      // NDJSON fallback — `gh ... --jq '.[] | {...}'` and similar CLI filters
      // emit one JSON value per line rather than a single top-level array.
      // Recognize it as equivalent to an array so listing tasks ("last N
      // commits") get the same full-render/recall-hint treatment a real
      // array gets, instead of falling through to the blind plain-text line
      // preview below, which has no concept of "N items, M shown" (root
      // cause of a live run losing 21 of 25 requested commits, 2026-07-30).
      const lines = result.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      if (lines.length < 2) throw new SyntaxError("not JSON and not NDJSON");
      parsed = lines.map((l) => JSON.parse(l));
    }

    // CLI-tool-result envelope unwrap — gh-cli wraps its payload as `{command,
    // stdout, stderr, exitCode, ...}`; docker-execute and code-execute wrap
    // theirs as `{executed, output, exitCode, ...}` (no `stdout` field — verified
    // against docker-execution.ts / code-execution.ts, which never emit `stdout`;
    // this branch previously checked `stdout` only, so it silently never fired
    // for either tool). Compressing the OUTER envelope treats the actual data a
    // task asked for as one opaque string field (sliced to 80 chars by the
    // generic object-branch below); the array/object detectors never see it.
    // Recurse on the payload alone — dropping the wrapper's fixed overhead
    // (command text, stderr, escaping) from the budget check also means many
    // payloads that fit once unwrapped get shown in full with no STORED/recall
    // dance at all.
    {
      const record = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
      const payloadField =
        record && typeof record.stdout === "string" ? "stdout" :
        record && typeof record.output === "string" ? "output" :
        undefined;
      if (
        record &&
        payloadField &&
        ("command" in record || "exitCode" in record)
      ) {
        const payload = record[payloadField] as string;
        const command = typeof record.command === "string" ? record.command : undefined;
        const exitCode = typeof record.exitCode === "number" ? record.exitCode : undefined;
        const inner = compressToolResult(payload, toolName, budget, previewItems);
        const prefix =
          `[${toolName}${command ? `: ${command}` : ""}` +
          `${exitCode !== undefined ? ` (exit ${exitCode})` : ""}]\n`;
        return { content: prefix + inner.content, stored: inner.stored };
      }
    }

    if (Array.isArray(parsed)) {
      const looksLikeGitHubCommitArray = (value: unknown): value is Array<Record<string, unknown>> => {
        if (!Array.isArray(value) || value.length === 0) return false;
        const first = value[0];
        if (!first || typeof first !== "object") return false;
        const commit = (first as Record<string, unknown>).commit;
        if (!commit || typeof commit !== "object") return false;
        const author = (commit as Record<string, unknown>).author;
        const message = (commit as Record<string, unknown>).message;
        const date =
          author && typeof author === "object"
            ? (author as Record<string, unknown>).date
            : undefined;
        return typeof message === "string" && typeof date === "string";
      };

      if (looksLikeGitHubCommitArray(parsed)) {
        const renderCommit = (item: Record<string, unknown>, i: number): string => {
          const commit = item.commit as Record<string, unknown>;
          const authorObj = commit.author as Record<string, unknown>;
          const rawMessage = String(commit.message ?? "");
          const message = rawMessage
            .split("\n")[0]
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 140);
          const author = String(authorObj.name ?? "").trim();
          const date = String(authorObj.date ?? "").trim();
          const shaShort = String(item.sha ?? "").slice(0, 7);
          return `  [${i}] sha=${shaShort} | message=${message} | author=${author} | date=${date}`;
        };

        // Try-fit: if every commit fits at title-detail level within budget,
        // show all of them. Listing tasks ("last N commits") fabricate the
        // hidden tail when only `previewItems` are visible — the model has
        // a real recall path but rarely uses it. Showing the full list when
        // it fits is the structural fix.
        const allItems = parsed.map((it, i) => renderCommit(it, i)).join("\n");
        const showAll = allItems.length + HEADER_OVERHEAD <= budget;

        if (showAll) {
          const content =
            `[STORED: ${key} | ${toolName}]\n` +
            `Type: Array(${parsed.length}) | Schema: commit.message, commit.author.name, commit.author.date, sha (7-char short)\n` +
            `All ${parsed.length} commits:\n` +
            allItems +
            `\n  ✓ Preview includes all commits with exact message/author/date values.`;
          return { content, stored: { key, value: result } };
        }

        const items = parsed
          .slice(0, previewItems)
          .map((it, i) => renderCommit(it as Record<string, unknown>, i))
          .join("\n");
        const shownCount = Math.min(previewItems, parsed.length);
        const remaining = parsed.length - shownCount;
        const moreStr = `\n  ...${remaining} more`;
        const coverageHint =
          `\n  — full data is stored. Use recall("${key}", arrayStart: ${shownCount}, arrayCount: ${remaining}) for remaining commits.`;
        const content =
          `[STORED: ${key} | ${toolName}]\n` +
          `Type: Array(${parsed.length}) | Schema: commit.message, commit.author.name, commit.author.date, sha (7-char short)\n` +
          `Preview (first ${shownCount} of ${parsed.length}):\n` +
          items +
          moreStr +
          coverageHint;

        return { content, stored: { key, value: result } };
      }

      // Schema: inspect first item keys, flatten one level of nesting
      const first = parsed[0] as Record<string, unknown> | undefined;
      const schema = first
        ? Object.entries(first)
            .flatMap(([k, v]) =>
              v !== null && typeof v === "object" && !Array.isArray(v)
                ? Object.keys(v as object).map((sub) => `${k}.${sub}`)
                : [k],
            )
            .slice(0, 8)
            .join(", ")
        : "unknown";

      const renderRecord = (item: Record<string, unknown>, i: number): string => {
        // Render up to 6 fields. Lifted from 4 — schema header advertises 6+
        // typical fields but the model only saw the first 4 (e.g. HN posts:
        // id/title/score/by — missing descendants/url). Filter tasks ("top N
        // by COMMENTS") fail because the criterion field is invisible.
        // Numeric fields (scores, counts, ids) are short so the budget impact
        // is modest; try-fit still falls back to previewItems when total grows.
        const pairs = Object.entries(item)
          .slice(0, 6)
          .map(([k, v]) => {
            const val =
              v !== null && typeof v === "object"
                ? Object.values(v as object)
                    .filter((x) => typeof x === "string")
                    .map(String)[0] ?? "{...}"
                : // URL-like fields get tighter truncation — 30 chars is enough
                // to identify the domain; full URL adds 50 chars per row with
                // little selection-criterion value.
                /^https?:\/\//.test(String(v))
                ? String(v).slice(0, 30) + (String(v).length > 30 ? "..." : "")
                : String(v).slice(0, 60);
            return `${k}=${val}`;
          })
          .join("  ");
        return `  [${i}] ${pairs}`;
      };

      // Try-fit: full coverage at row-summary detail wins over a partial
      // preview when it fits the budget. Listing tasks ("top N", "all X")
      // fabricate hidden rows when only `previewItems` are visible — the
      // model has a recall path but rarely uses it. Showing the full list
      // when it fits eliminates the fabrication surface entirely.
      const allItems = (parsed as Array<Record<string, unknown>>)
        .map((it, i) => renderRecord(it, i))
        .join("\n");
      const showAll = allItems.length + HEADER_OVERHEAD <= budget;

      if (showAll) {
        const content =
          `[STORED: ${key} | ${toolName}]\n` +
          `Type: Array(${parsed.length}) | Schema: ${schema}\n` +
          `All ${parsed.length} items:\n` +
          allItems +
          `\n  ✓ Preview covers all items — you can use this data directly.`;
        return { content, stored: { key, value: result } };
      }

      const items = (parsed as Array<Record<string, unknown>>)
        .slice(0, previewItems)
        .map((it, i) => renderRecord(it, i))
        .join("\n");
      const shownCount = Math.min(previewItems, parsed.length);
      const remaining = parsed.length - shownCount;
      const moreStr = `\n  ...${remaining} more`;
      const coverageHint = remaining <= 2
        ? `\n  ✓ Preview covers nearly all items — you can use this data directly.`
        : `\n  — full data is stored. Use segmented recall if needed: recall("${key}", arrayStart: ${shownCount}, arrayCount: ${remaining}) or recall("${key}", start: 0, maxChars: 1200).`;
      const content =
        `[STORED: ${key} | ${toolName}]\n` +
        `Type: Array(${parsed.length}) | Schema: ${schema}\n` +
        `Preview (first ${shownCount} of ${parsed.length}):\n` +
        items +
        moreStr +
        coverageHint;

      return { content, stored: { key, value: result } };
    }

    // JSON object
    if (typeof parsed === "object" && parsed !== null) {
      // Budget-scaled key count + per-value slice length — previously a fixed
      // 8 keys x 80 chars regardless of `budget`, so a fetched http-get page
      // (one giant `body` string) rendered byte-identical output at every
      // model tier (600-char local tier vs 4000-char frontier tier measured
      // live 2026-09-03, see wiki/Research/Harness-Reports). `budget` is the
      // one knob a caller has to widen an object preview; it must move the
      // output.
      const totalKeys = Object.keys(parsed as object).length;
      const available = Math.max(0, budget - HEADER_OVERHEAD);
      const maxKeysShown = Math.max(4, Math.min(totalKeys, Math.floor(available / 40)));
      const valueSliceLen = Math.max(40, Math.min(200, Math.floor(available / Math.max(maxKeysShown, 1)) - 6));

      const entries = Object.entries(parsed as Record<string, unknown>)
        .slice(0, maxKeysShown)
        .map(([k, v]) => {
          const val =
            v === null
              ? "null"
              : Array.isArray(v)
                ? `Array(${v.length})`
                : typeof v === "object"
                  ? `{${Object.keys(v as object).slice(0, 3).join(", ")}}`
                  : String(v).slice(0, valueSliceLen);
          return `  ${k}: ${val}`;
        })
        .join("\n");
      const content =
        `[STORED: ${key} | ${toolName}]\n` +
        `Type: Object(${totalKeys} keys)\n` +
        entries +
        `\n  — full object is stored. Use recall("${key}", start: 0, maxChars: 1200), recall("${key}", query: "keyword"), or | transform: for focused extraction.`;

      return { content, stored: { key, value: result } };
    }
  } catch {
    // Not JSON — plain text preview
  }

  // Plain text: skip box-drawing banners (common in CLIs) and prefer Usage/flags lines
  const lines = result.split("\n");
  const { previewStart, previewText, bannerLinesSkipped } = buildPlainTextToolPreview(
    lines,
    previewItems,
  );
  const shownLineCount = Math.min(previewItems, Math.max(0, lines.length - previewStart));
  const remaining = lines.length - previewStart - shownLineCount;
  const bannerNote =
    bannerLinesSkipped > 0
      ? `(${bannerLinesSkipped} decorative/banner line(s) omitted from preview — substantive text is in storage)\n`
      : "";
  const moreStr = remaining > 0 ? `\n  ...${remaining} more lines` : "";
  const content =
    `[STORED: ${key} | ${toolName}]\n` +
    bannerNote +
    previewText +
    moreStr +
    `\n  — full text is stored. For terminal/CLI output use recall("${key}", full: true) first; ` +
    `or segmented recall("${key}", lineStart: ${previewStart + shownLineCount}, lineCount: 40) or recall("${key}", start: 0, maxChars: 1200).`;

  return { content, stored: { key, value: result } };
}

/** Box-drawing and block characters used in CLI banners / tables */
const BANNER_CHAR_RE = /[\u2500-\u257F\u2550-\u256C]/g;

function isMostlyBannerLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true;
  const nonSpace = trimmed.replace(/\s/g, "");
  if (nonSpace.length === 0) return true;
  const boxMatches = trimmed.match(BANNER_CHAR_RE)?.length ?? 0;
  if (boxMatches / nonSpace.length >= 0.35) return true;
  if (/^[-=─━_|/\\*\s]{4,}$/.test(trimmed)) return true;
  return false;
}

function looksLikeCliHelpLine(line: string): boolean {
  const t = line.trim();
  if (/^usage:/i.test(t)) return true;
  if (/\s--[\w][\w-]*/.test(t)) return true;
  if (/^(options|flags|commands|subcommands|examples?|arguments?):?\s*$/i.test(t)) return true;
  return false;
}

/**
 * Pick a preview window for large plain-text tool output so previews are not only ASCII art.
 */
function buildPlainTextToolPreview(
  lines: readonly string[],
  previewItems: number,
): { previewStart: number; previewText: string; bannerLinesSkipped: number } {
  let i = 0;
  while (i < lines.length && isMostlyBannerLine(lines[i]!)) {
    i++;
  }
  let previewStart = i;
  const scanEnd = Math.min(lines.length, i + 100);
  for (let j = i; j < scanEnd; j++) {
    if (looksLikeCliHelpLine(lines[j]!)) {
      previewStart = j;
      break;
    }
  }
  const slice = lines.slice(previewStart, previewStart + previewItems);
  const previewText = slice.map((l) => (l.length > 120 ? `${l.slice(0, 120)}…` : l)).join("\n");
  return { previewStart, previewText, bannerLinesSkipped: previewStart };
}

/**
 * Computes the novelty ratio of new text vs accumulated prior content.
 * Returns 0.0 (entirely duplicate) to 1.0 (entirely new).
 * Uses word-token overlap on words ≥4 chars — cheap, no LLM call needed.
 */
export function computeNoveltyRatio(newText: string, priorText: string): number {
  const tokenize = (t: string): Set<string> =>
    new Set((t.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? []));
  const newTokens = tokenize(newText);
  const priorTokens = tokenize(priorText);
  if (newTokens.size === 0) return 0;
  const novelCount = [...newTokens].filter((t) => !priorTokens.has(t)).length;
  return novelCount / newTokens.size;
}
