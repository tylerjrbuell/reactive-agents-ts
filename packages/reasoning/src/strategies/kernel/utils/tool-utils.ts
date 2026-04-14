/**
 * shared/tool-utils.ts — Pure tool parsing and formatting utilities.
 *
 * Extracted from reactive.ts and tree-of-thought.ts to eliminate duplication
 * across reasoning strategies. All functions are pure (no Effect dependencies).
 */

import { META_TOOLS as META_TOOLS_SET } from "../kernel-constants.js";

// ── Tool Parsing ──────────────────────────────────────────────────────────────

/** Expanded regex matching FINAL ANSWER with optional markdown bold and various colon forms. */
export const FINAL_ANSWER_RE = /(?:\*{0,2})final\s*answer(?:\*{0,2})\s*[:：]?\s*/i;

export function hasFinalAnswer(thought: string): boolean {
  return FINAL_ANSWER_RE.test(thought);
}

export function extractFinalAnswer(thought: string): string {
  const match = thought.match(new RegExp(FINAL_ANSWER_RE.source + "([\\s\\S]*)", "i"));
  return match ? match[1]!.trim() : thought;
}

/**
 * Common "thinking out loud" preamble patterns that local models emit before
 * the actual content. These are meta-commentary about the task, not the answer.
 */
const PREAMBLE_PATTERNS: readonly RegExp[] = [
  /^The\s+user\s+has\s+(?:provided|asked|requested|given)\b[^]*?\n\n/i,
  /^I\s+will\s+(?:structure|organize|format|present|analyze|summarize)\b[^]*?\n\n/i,
  /^(?:Let\s+me|I(?:'ll| will| need to))\s+(?:analyze|review|examine|process|synthesize|extract)\b[^]*?\n\n/i,
  /^(?:Here(?:'s| is) (?:my|the|a) (?:plan|approach|analysis|breakdown|summary))[^]*?\n\n/i,
  /^(?:Based on|Looking at|After reviewing|Given)\s+(?:the|all|these)\s+(?:provided|above|tool|data|search)\b[^]*?\n\n/i,
];

/**
 * Strip "thinking out loud" preamble from model-generated output.
 * Only removes recognized meta-commentary prefixes — if no preamble is detected,
 * the original text is returned unchanged.
 */
export function stripPreamble(text: string): string {
  let result = text;
  for (const pattern of PREAMBLE_PATTERNS) {
    const match = result.match(pattern);
    if (match) {
      const afterPreamble = result.slice(match[0].length).trim();
      if (afterPreamble.length > 0) {
        result = afterPreamble;
      }
    }
  }
  return result;
}

/**
 * Safely evaluate a transform expression against a tool result.
 * Only allows property access chains, array methods (slice, filter, map, join, length),
 * and string methods (trim, split, toLowerCase, toUpperCase, includes, startsWith, endsWith).
 * Returns serialized result string, or an error string prefixed with "[Transform error:" on failure.
 */
export function evaluateTransform(expr: string, result: unknown): string {
  try {
    const output = safeEval(expr.trim(), result);
    if (typeof output === "string") return output;
    return JSON.stringify(output, null, 2);
  } catch (e) {
    return `[Transform error: ${e instanceof Error ? e.message : String(e)}] — fix the expression or remove | transform:`;
  }
}

/** Allowlisted methods safe to call on arrays/strings. */
const SAFE_METHODS = new Set([
  // Array
  "slice", "filter", "map", "join", "length", "find", "some", "every",
  "includes", "indexOf", "flat", "flatMap", "at", "concat", "reverse",
  // String
  "trim", "split", "toLowerCase", "toUpperCase", "startsWith", "endsWith",
  "replace", "substring", "charAt",
  // Object
  "keys", "values", "entries",
]);

/**
 * Safe expression evaluator — walks a dot-access / bracket-access / method-call chain
 * starting from `result`. No arbitrary code execution.
 *
 * Supported syntax:
 *   result.key.nested          — property access
 *   result[0]                  — numeric index
 *   result["key"]              — string index  
 *   result.slice(0, 5)         — allowlisted method call with literal args
 *   result.map(x => x.name)   — arrow lambdas with single property access
 *   result.filter(x => x.ok)  — arrow lambdas with truthy check
 */
function safeEval(expr: string, result: unknown): unknown {
  // Handle literal string expressions: "hello" or 'hello'
  const literalStr = expr.match(/^["'](.*)["']$/);
  if (literalStr) return literalStr[1];

  // Strip leading "result" or "result." if present
  let chain = expr;
  if (chain === "result") return result;
  if (chain.startsWith("result.")) chain = chain.slice(7);
  else if (chain.startsWith("result[")) chain = chain.slice(6);

  let current: unknown = result;
  let remaining = chain;

  while (remaining.length > 0) {
    remaining = remaining.trimStart();
    if (remaining.length === 0) break;

    // Dot access: .key
    if (remaining.startsWith(".")) {
      remaining = remaining.slice(1);
    }

    // Bracket access: [0] or ["key"] or ['key']
    if (remaining.startsWith("[")) {
      const closeIdx = remaining.indexOf("]");
      if (closeIdx === -1) throw new Error("Unclosed bracket in expression");
      const inner = remaining.slice(1, closeIdx).trim();
      remaining = remaining.slice(closeIdx + 1);

      // Numeric index
      const num = Number(inner);
      if (!isNaN(num) && current != null) {
        current = (current as Record<string, unknown>)[num];
        continue;
      }
      // String key (quoted)
      const strMatch = inner.match(/^["'](.+)["']$/);
      if (strMatch && current != null) {
        current = (current as Record<string, unknown>)[strMatch[1]!];
        continue;
      }
      throw new Error(`Unsupported bracket expression: [${inner}]`);
    }

    // Property or method name
    const nameMatch = remaining.match(/^(\w+)/);
    if (!nameMatch) throw new Error(`Unexpected token in expression: ${remaining.slice(0, 20)}`);
    const name = nameMatch[1]!;
    remaining = remaining.slice(name.length);

    // Special: Object.keys/values/entries
    if (name === "Object" && remaining.startsWith(".")) {
      const methodMatch = remaining.slice(1).match(/^(keys|values|entries)\s*\(/);
      if (methodMatch) {
        const method = methodMatch[1]!;
        remaining = remaining.slice(1 + method.length);
        // Skip opening paren
        remaining = remaining.replace(/^\s*\(\s*\)\s*/, "");
        if (method === "keys") current = Object.keys(current as object);
        else if (method === "values") current = Object.values(current as object);
        else current = Object.entries(current as object);
        continue;
      }
    }

    // Method call: name(args)
    if (remaining.startsWith("(")) {
      if (!SAFE_METHODS.has(name)) {
        throw new Error(`Method '${name}' is not allowed in transforms`);
      }
      // Find matching close paren
      const args = extractParenContent(remaining);
      remaining = remaining.slice(args.length + 2); // +2 for parens

      // Parse arguments
      const parsedArgs = parseMethodArgs(args, name);

      if (current == null) throw new Error(`Cannot call .${name}() on null/undefined`);
      const method = (current as Record<string, unknown>)[name];
      if (typeof method !== "function") throw new Error(`'${name}' is not a function`);
      current = (method as Function).apply(current, parsedArgs);
      continue;
    }

    // Property access: .length or .name
    if (name === "length" && (Array.isArray(current) || typeof current === "string")) {
      current = (current as { length: number }).length;
      continue;
    }
    if (current == null) throw new Error(`Cannot access '${name}' on null/undefined`);
    current = (current as Record<string, unknown>)[name];
  }

  return current;
}

/** Extract content between matching parentheses. */
function extractParenContent(str: string): string {
  if (!str.startsWith("(")) return "";
  let depth = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "(") depth++;
    else if (str[i] === ")") {
      depth--;
      if (depth === 0) return str.slice(1, i);
    }
  }
  throw new Error("Unclosed parenthesis in expression");
}

/** Parse method arguments — supports literals and simple arrow lambdas. */
function parseMethodArgs(argsStr: string, methodName: string): unknown[] {
  const trimmed = argsStr.trim();
  if (trimmed === "") return [];

  // Check for arrow lambda: x => x.prop or (x) => x.prop
  const arrowMatch = trimmed.match(/^\(?(\w+)\)?\s*=>\s*(.+)$/);
  if (arrowMatch) {
    const paramName = arrowMatch[1]!;
    const bodyExpr = arrowMatch[2]!.trim();
    // Create a safe lambda that only does property access
    return [
      (item: unknown) => safeEval(bodyExpr.replace(new RegExp(`^${paramName}\\.?`), "result."), item),
    ];
  }

  // Split on commas (respecting nesting)
  const args: unknown[] = [];
  let current = "";
  let depth = 0;
  for (const ch of trimmed) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) {
      args.push(parseLiteral(current.trim()));
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) args.push(parseLiteral(current.trim()));
  return args;
}

/** Parse a literal value: number, string, boolean, null. */
function parseLiteral(val: string): unknown {
  if (val === "true") return true;
  if (val === "false") return false;
  if (val === "null") return null;
  if (val === "undefined") return undefined;
  const num = Number(val);
  if (!isNaN(num) && val !== "") return num;
  // String literal
  const strMatch = val.match(/^["'](.*)["']$/);
  if (strMatch) return strMatch[1];
  // Return as-is for arrow function bodies already handled above
  return val;
}

// ── Tool Schema Formatting ────────────────────────────────────────────────────

export interface ToolParamSchema {
  readonly name: string;
  readonly type: string;
  readonly description?: string;
  readonly required?: boolean;
}

export interface ToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly ToolParamSchema[];
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
  if (result.length <= budget) return { content: result };

  const key = nextToolResultKey();

  // Try JSON first
  try {
    const parsed = JSON.parse(result) as unknown;

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
        const items = parsed
          .slice(0, previewItems)
          .map((item, i) => {
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
            return `  [${i}] message=${message} | author=${author} | date=${date}`;
          })
          .join("\n");

        const shownCount = Math.min(previewItems, parsed.length);
        const remaining = parsed.length - shownCount;
        const moreStr = remaining > 0 ? `\n  ...${remaining} more` : "";
        const coverageHint =
          remaining === 0
            ? `\n  ✓ Preview includes all commits with exact message/author/date values.`
            : `\n  — full data is stored. Use recall("${key}", arrayStart: ${shownCount}, arrayCount: ${previewItems}) for remaining commits.`;
        const content =
          `[STORED: ${key} | ${toolName}]\n` +
          `Type: Array(${parsed.length}) | Schema: commit.message, commit.author.name, commit.author.date\n` +
          `Preview (first ${shownCount}):\n` +
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

      const items = (parsed as Array<Record<string, unknown>>)
        .slice(0, previewItems)
        .map((item, i) => {
          const pairs = Object.entries(item)
            .slice(0, 4)
            .map(([k, v]) => {
              const val =
                v !== null && typeof v === "object"
                  ? Object.values(v as object)
                      .filter((x) => typeof x === "string")
                      .map(String)[0] ?? "{...}"
                  : String(v).slice(0, 60);
              return `${k}=${val}`;
            })
            .join("  ");
          return `  [${i}] ${pairs}`;
        })
        .join("\n");

      const shownCount = Math.min(previewItems, parsed.length);
      const remaining = parsed.length - shownCount;
      const moreStr = remaining > 0 ? `\n  ...${remaining} more` : "";
      // When the preview covers most/all items, tell the agent it can proceed
      // without a recall — avoids wasting an iteration.
      const coverageHint = remaining <= 2
        ? `\n  ✓ Preview covers ${remaining === 0 ? "all" : "nearly all"} items — you can use this data directly.`
        : `\n  — full data is stored. Use segmented recall if needed: recall("${key}", arrayStart: ${shownCount}, arrayCount: ${previewItems}) or recall("${key}", start: 0, maxChars: 1200).`;
      const content =
        `[STORED: ${key} | ${toolName}]\n` +
        `Type: Array(${parsed.length}) | Schema: ${schema}\n` +
        `Preview (first ${shownCount}):\n` +
        items +
        moreStr +
        coverageHint;

      return { content, stored: { key, value: result } };
    }

    // JSON object
    if (typeof parsed === "object" && parsed !== null) {
      const entries = Object.entries(parsed as Record<string, unknown>)
        .slice(0, 8)
        .map(([k, v]) => {
          const val =
            v === null
              ? "null"
              : Array.isArray(v)
                ? `Array(${v.length})`
                : typeof v === "object"
                  ? `{${Object.keys(v as object).slice(0, 3).join(", ")}}`
                  : String(v).slice(0, 80);
          return `  ${k}: ${val}`;
        })
        .join("\n");

      const totalKeys = Object.keys(parsed as object).length;
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

export type ToolElaborationInjectionConfig = {
  readonly enabled?: boolean;
  readonly maxHintsPerTool?: number;
};

export type NextMovesPlanningConfig = {
  readonly enabled?: boolean;
  readonly maxBatchSize?: number;
  readonly allowParallelBatching?: boolean;
};

export type QuotaBudgetConflict = {
  readonly toolName: string;
  readonly requiredMinCalls: number;
  readonly maxCalls: number;
  readonly actualCalls: number;
};

function describeToolBehavior(name: string): readonly string[] {
  const lowered = name.toLowerCase();
  if (lowered.includes("search") || lowered.includes("http") || lowered.includes("fetch") || lowered.includes("get")) {
    return [
      "Use for read-only lookup and data retrieval.",
      "Independent calls can be grouped before the next think step.",
      "Prefer concrete, narrow arguments to reduce noisy observations.",
    ];
  }
  if (lowered.includes("read") || lowered.includes("list") || lowered.includes("query")) {
    return [
      "Use for read-only inspection.",
      "Safe candidate for short-term batched execution.",
      "Return focused slices over broad payloads when possible.",
    ];
  }
  if (lowered.includes("write") || lowered.includes("delete") || lowered.includes("update") || lowered.includes("create")) {
    return [
      "Has side effects; execute with explicit intent.",
      "Avoid batching with other mutating calls unless ordering is guaranteed.",
      "Confirm target path/resource arguments before invocation.",
    ];
  }
  return [
    "Use only when arguments are complete and specific.",
    "Prefer one clear objective per call.",
    "If multiple independent calls are needed, batch only safe read-like calls.",
  ];
}

export function isParallelBatchSafeTool(name: string): boolean {
  // Explicitly safe tools — dispatching multiple in parallel is always correct.
  const PARALLEL_SAFE_TOOLS = new Set([
    "spawn-agent",   // single subagent dispatch
    "spawn-agents",  // parallel subagent dispatch
    "recall",        // scratchpad read — pure, no side effect
    "find",          // index lookup — pure, no side effect
  ]);
  if (PARALLEL_SAFE_TOOLS.has(name)) return true;

  const lowered = name.toLowerCase();
  if (META_TOOLS_SET.has(name)) return false;
  if (lowered.includes("final-answer")) return false;
  if (lowered.includes("write") || lowered.includes("delete") || lowered.includes("update") || lowered.includes("create")) {
    return false;
  }
  return (
    lowered.includes("search") ||
    lowered.includes("http") ||
    lowered.includes("fetch") ||
    lowered.includes("get") ||
    lowered.includes("read") ||
    lowered.includes("list") ||
    lowered.includes("query")
  );
}

export function buildToolElaborationInjection(
  toolSchemas: readonly { readonly name: string; readonly parameters?: readonly { readonly name: string }[] }[],
  config?: ToolElaborationInjectionConfig,
): string {
  if (!config?.enabled || toolSchemas.length === 0) return "";
  const maxHints = Math.max(1, config.maxHintsPerTool ?? 2);
  const lines = toolSchemas.map((tool) => {
    const hints = describeToolBehavior(tool.name).slice(0, maxHints);
    const args = (tool.parameters ?? []).map((p) => p.name).join(", ");
    const argsLine = args.length > 0 ? `required args: ${args}` : "required args: none";
    return [
      `- ${tool.name}`,
      `  - ${argsLine}`,
      ...hints.map((h) => `  - ${h}`),
    ].join("\n");
  });
  return [
    "## Tool Elaboration (lightweight)",
    "Use these tool-specific hints to choose precise calls and avoid dead iterations.",
    ...lines,
  ].join("\n");
}

export function planNextMoveBatches<T extends { readonly name: string }>(
  calls: readonly T[],
  config?: NextMovesPlanningConfig,
): readonly (readonly T[])[] {
  if (calls.length === 0) return [];
  if (!config?.enabled) return calls.map((c) => [c]);

  const allowParallel = config.allowParallelBatching ?? true;
  if (!allowParallel) return calls.map((c) => [c]);

  const maxBatchSize = Math.max(1, config.maxBatchSize ?? 3);
  const batches: T[][] = [];
  let current: T[] = [];

  for (const call of calls) {
    const safe = isParallelBatchSafeTool(call.name);
    if (!safe) {
      if (current.length > 0) {
        batches.push(current);
        current = [];
      }
      batches.push([call]);
      continue;
    }

    current.push(call);
    if (current.length >= maxBatchSize) {
      batches.push(current);
      current = [];
    }
  }

  if (current.length > 0) {
    batches.push(current);
  }

  return batches;
}

/**
 * Gate native parallel tool batches against {@link requiredTools} so optional tools
 * (e.g. http-get) cannot run while a required tool (e.g. file-write) is still missing.
 *
 * - Pre-filters calls that have exceeded their per-tool budget (`maxCallsPerTool`).
 * - If required minCalls conflict with maxCallsPerTool (or budget already exhausted), return
 *   an explicit quotaBudgetConflict and block optional calls.
 * - If calls target missing required tools, return the first safe required batch
 *   (can contain multiple parallel-safe calls).
 * - If calls are all from {@link relevantTools} or satisfied required → allow through.
 * - If calls omit every missing required tool and aren't relevant:
 *   - strict mode: block batch (`blockedOptionalBatch: true`)
 *   - default mode: allow one exploratory call to preserve discovery context.
 */
export function gateNativeToolCallsForRequiredTools<T extends { readonly name: string }>(
  calls: readonly T[],
  requiredTools: readonly string[],
  toolsUsed: ReadonlySet<string>,
  relevantTools?: readonly string[],
  toolCallCounts?: Readonly<Record<string, number>>,
  maxCallsPerTool?: Readonly<Record<string, number>>,
  requiredToolQuantities?: Readonly<Record<string, number>>,
  strictDependencyChain?: boolean,
  nextMovesPlanning?: NextMovesPlanningConfig,
): {
  readonly effective: readonly T[];
  readonly blockedOptionalBatch: boolean;
  readonly quotaBudgetConflict?: readonly QuotaBudgetConflict[];
} {
  const enforceSingleStep = nextMovesPlanning?.enabled === false;
  const applyStepMode = (selected: readonly T[]): readonly T[] =>
    enforceSingleStep && selected.length > 1 ? [selected[0]!] : selected;

  // Layer 3: pre-filter calls that have exhausted their per-tool budget.
  const budgeted =
    maxCallsPerTool && toolCallCounts
      ? calls.filter((c) => {
          const max = maxCallsPerTool[c.name];
          return max === undefined || (toolCallCounts[c.name] ?? 0) < max;
        })
      : calls;

  if (requiredTools.length === 0) {
    return { effective: applyStepMode(budgeted), blockedOptionalBatch: false };
  }
  const quantities = requiredToolQuantities ?? {};
  const getActualCalls = (toolName: string): number =>
    toolCallCounts?.[toolName] ?? (toolsUsed.has(toolName) ? 1 : 0);
  const isRequiredSatisfied = (toolName: string): boolean =>
    getActualCalls(toolName) >= (quantities[toolName] ?? 1);

  const missing = requiredTools.filter((t) => !isRequiredSatisfied(t));
  if (missing.length === 0) {
    return { effective: applyStepMode(budgeted), blockedOptionalBatch: false };
  }
  const quotaBudgetConflict = missing
    .map((toolName): QuotaBudgetConflict | null => {
      const maxCalls = maxCallsPerTool?.[toolName];
      if (maxCalls === undefined) return null;
      const requiredMinCalls = quantities[toolName] ?? 1;
      const actualCalls = getActualCalls(toolName);
      const impossibleByConfiguration = requiredMinCalls > maxCalls;
      const exhaustedBudget = actualCalls >= maxCalls && actualCalls < requiredMinCalls;
      if (!impossibleByConfiguration && !exhaustedBudget) return null;
      return {
        toolName,
        requiredMinCalls,
        maxCalls,
        actualCalls,
      };
    })
    .filter((entry): entry is QuotaBudgetConflict => entry !== null);
  if (quotaBudgetConflict.length > 0) {
    return {
      effective: [],
      blockedOptionalBatch: true,
      quotaBudgetConflict,
    };
  }

  const towardMissing = budgeted.filter((c) => missing.includes(c.name));
  if (towardMissing.length > 0) {
    const maxBatchSize = Math.max(1, nextMovesPlanning?.maxBatchSize ?? 4);
    const requiredBatches = planNextMoveBatches(towardMissing, {
      enabled: true,
      maxBatchSize,
      allowParallelBatching: true,
    });
    return { effective: applyStepMode(requiredBatches[0] ?? []), blockedOptionalBatch: false };
  }
  // Allow relevant tools and re-calls of already-satisfied required tools.
  const satisfiedRequired = new Set(
    requiredTools.filter((t) => isRequiredSatisfied(t)),
  );
  const allowedSet = new Set([...(relevantTools ?? []), ...satisfiedRequired]);
  if (allowedSet.size > 0) {
    const allowedCalls = budgeted.filter((c) => allowedSet.has(c.name));
    if (allowedCalls.length > 0) {
      return { effective: applyStepMode(allowedCalls), blockedOptionalBatch: false };
    }
  }
  // Strict mode enforces required-tool hierarchy before exploratory context gathering.
  if (strictDependencyChain) {
    return { effective: [], blockedOptionalBatch: budgeted.length > 0 || calls.length > 0 };
  }

  // Non-strict mode keeps progress moving by allowing one exploratory call.
  if (budgeted.length > 0) {
    return { effective: applyStepMode([budgeted[0]!]), blockedOptionalBatch: false };
  }
  return { effective: [], blockedOptionalBatch: false };
}
