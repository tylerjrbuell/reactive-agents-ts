/**
 * shared/tool-utils.ts — Pure tool parsing and formatting utilities.
 *
 * Extracted from reactive.ts and tree-of-thought.ts to eliminate duplication
 * across reasoning strategies. All functions are pure (no Effect dependencies).
 */

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
      // Strip generic tokens (CRUD verbs + context nouns) that appear in most tool
      // names and/or task text without carrying discriminative signal.
      const GENERIC_SLUG_TOKENS = new Set([
        // Common CRUD / action verbs
        "list", "get", "create", "update", "delete", "add", "set", "check",
        "find", "fetch", "read", "write", "send", "push", "pull", "from",
        "make", "edit", "open", "close", "move", "copy", "show", "view",
        // Common context nouns that appear in task descriptions but don't uniquely
        // identify a specific tool action
        "repo", "repository", "file", "files", "branch", "branches",
        "content", "contents", "data", "info", "item", "items",
        "name", "path", "type", "user", "users", "team", "org",
        // Common words that appear in both tasks and tool slugs without
        // uniquely identifying a specific tool
        "message", "messages", "comment", "comments", "release", "releases",
        "latest", "label", "labels", "status", "result", "results",
        "request", "review", "search", "code", "tags", "group",
        "pending", "reply", "issue", "issues",
      ]);
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
        : `\n  — use recall("${key}") ONLY if you need items beyond the preview.`;
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
        `\n  — use recall("${key}") or | transform: to access full data`;

      return { content, stored: { key, value: result } };
    }
  } catch {
    // Not JSON — plain text preview
  }

  // Plain text: first N lines, each line truncated to 120 chars
  const lines = result.split("\n");
  const preview = lines
    .slice(0, previewItems)
    .map((l) => (l.length > 120 ? `${l.slice(0, 120)}…` : l))
    .join("\n");
  const remaining = lines.length - previewItems;
  const moreStr = remaining > 0 ? `\n  ...${remaining} more lines` : "";
  const content =
    `[STORED: ${key} | ${toolName}]\n` +
    preview +
    moreStr +
    `\n  — use recall("${key}") to access full text`;

  return { content, stored: { key, value: result } };
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

/**
 * Gate native parallel tool batches against {@link requiredTools} so optional tools
 * (e.g. http-get) cannot run while a required tool (e.g. file-write) is still missing.
 *
 * - Pre-filters calls that have exceeded their per-tool budget (`maxCallsPerTool`).
 * - If any call targets a missing required tool → return only the first such call.
 * - If calls are all from {@link relevantTools} or satisfied required → allow through.
 * - If calls omit every missing required tool and aren't relevant → `blockedOptionalBatch: true`.
 */
export function gateNativeToolCallsForRequiredTools<T extends { readonly name: string }>(
  calls: readonly T[],
  requiredTools: readonly string[],
  toolsUsed: ReadonlySet<string>,
  relevantTools?: readonly string[],
  toolCallCounts?: Readonly<Record<string, number>>,
  maxCallsPerTool?: Readonly<Record<string, number>>,
): { readonly effective: readonly T[]; readonly blockedOptionalBatch: boolean } {
  // Layer 3: pre-filter calls that have exhausted their per-tool budget.
  const budgeted =
    maxCallsPerTool && toolCallCounts
      ? calls.filter((c) => {
          const max = maxCallsPerTool[c.name];
          return max === undefined || (toolCallCounts[c.name] ?? 0) < max;
        })
      : calls;

  if (requiredTools.length === 0) {
    return { effective: budgeted, blockedOptionalBatch: false };
  }
  const missing = requiredTools.filter((t) => !toolsUsed.has(t));
  if (missing.length === 0) {
    return { effective: budgeted, blockedOptionalBatch: false };
  }
  const towardMissing = budgeted.filter((c) => missing.includes(c.name));
  if (towardMissing.length > 0) {
    return { effective: [towardMissing[0]!], blockedOptionalBatch: false };
  }
  // Allow relevant tools and re-calls of already-satisfied required tools.
  const satisfiedRequired = new Set(requiredTools.filter((t) => toolsUsed.has(t)));
  const allowedSet = new Set([...(relevantTools ?? []), ...satisfiedRequired]);
  if (allowedSet.size > 0) {
    const allowedCalls = budgeted.filter((c) => allowedSet.has(c.name));
    if (allowedCalls.length > 0) {
      return { effective: allowedCalls, blockedOptionalBatch: false };
    }
  }
  // Either all calls were over-budget or none were relevant — redirect to required.
  return { effective: [], blockedOptionalBatch: budgeted.length > 0 || calls.length > 0 };
}
