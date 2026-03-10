/**
 * shared/tool-utils.ts — Pure tool parsing and formatting utilities.
 *
 * Extracted from reactive.ts and tree-of-thought.ts to eliminate duplication
 * across reasoning strategies. All functions are pure (no Effect dependencies).
 */

// ── Tool Parsing ──────────────────────────────────────────────────────────────

export function hasFinalAnswer(thought: string): boolean {
  return /final answer:/i.test(thought);
}

export function extractFinalAnswer(thought: string): string {
  const match = thought.match(/final answer:\s*([\s\S]*)/i);
  return match ? match[1]!.trim() : thought;
}

/**
 * Parse a bare tool call (no ACTION: prefix) from text.
 * Matches patterns like `tool_name({...})` or `namespace/tool_name({...})`.
 * Used to detect when a model writes a tool call inside FINAL ANSWER.
 */
export function parseBareToolCall(
  text: string,
): { tool: string; input: string } | null {
  // Match: optional-namespace/tool_name({json})
  const match = text.match(/^([\w\/\-]+)\s*\(/);
  if (!match) return null;
  // Reuse parseToolRequest by prepending ACTION: prefix
  return parseToolRequest(`ACTION: ${text}`);
}

/**
 * Parse a single ACTION request from a thought string.
 * Returns tool name, input JSON string, and optional transform expression.
 * Handles:
 * - Namespaced MCP tool names (e.g. "github/list_commits")
 * - Nested JSON args via brace-matching (not regex)
 * - Empty-arg tools with "()"
 * - Optional "| transform: <expr>" suffix
 */
export function parseToolRequest(
  thought: string,
): { tool: string; input: string; transform?: string } | null {
  // Split on " | transform: " before parsing the action args
  const pipeIdx = thought.indexOf(" | transform: ");
  const actionPart = pipeIdx >= 0 ? thought.slice(0, pipeIdx) : thought;
  const transformExpr =
    pipeIdx >= 0 ? thought.slice(pipeIdx + " | transform: ".length).split("\n")[0].trim() : undefined;

  const base = parseToolRequestBase(actionPart);
  if (!base) return null;
  return { ...base, transform: transformExpr };
}

/**
 * Internal: parse just the tool name and args (no transform).
 * Copied verbatim from reactive.ts parseToolRequest().
 */
function parseToolRequestBase(
  thought: string,
): { tool: string; input: string } | null {
  // Match the ACTION prefix and tool name — allow '/' for namespaced MCP tools
  // e.g. "filesystem/list_directory" or "github/search_repos"
  const prefixMatch = thought.match(/ACTION:\s*([\w\/\-]+)\(/i);
  if (!prefixMatch) return null;

  const tool = prefixMatch[1];
  const argsStart = (prefixMatch.index ?? 0) + prefixMatch[0].length;
  const rest = thought.slice(argsStart);

  // Empty parens — tool takes no arguments (e.g. filesystem/list_allowed_directories())
  if (rest.trimStart().startsWith(")")) {
    return { tool, input: "{}" };
  }

  // If args start with '{', use brace-matching to extract the JSON object
  if (rest.trimStart().startsWith("{")) {
    const trimOffset = rest.length - rest.trimStart().length;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = trimOffset; i < rest.length; i++) {
      const ch = rest[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          return { tool, input: rest.slice(trimOffset, i + 1) };
        }
      }
    }
  }

  // Fallback: greedy regex (captures up to last ')' in thought, allows empty args)
  const match = thought.match(/ACTION:\s*[\w\/\-]+\((.*?)\)/is);
  return match ? { tool, input: match[1] } : null;
}

/** Return ALL ACTION requests found in a thought, in order of appearance.
 * Used to skip duplicate actions and advance to the next uncompleted step
 * when the model writes a multi-step plan in a single thought. */
export function parseAllToolRequests(
  thought: string,
): Array<{ tool: string; input: string; transform?: string }> {
  const results: Array<{ tool: string; input: string; transform?: string }> = [];
  const re = /ACTION:/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(thought)) !== null) {
    const slice = thought.slice(match.index);
    const req = parseToolRequest(slice);
    if (req) results.push(req);
  }
  return results;
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

// ── Multi-tool Execution Groups ──────────────────────────────────────────────

export interface ToolRequestGroup {
  mode: "single" | "parallel" | "chain";
  requests: { tool: string; input: string; transform?: string }[];
}

const SIDE_EFFECT_PREFIXES = [
  "send_", "create_", "delete_", "push_", "merge_", "fork_",
  "update_", "assign_", "remove_",
];

/**
 * Parse a thought into a ToolRequestGroup.
 *
 * - Single ACTION → { mode: "single" }
 * - ACTION + THEN → { mode: "chain" }  (chain takes precedence over parallel)
 * - Multiple ACTION (no side-effects) → { mode: "parallel", max 3 }
 * - Multiple ACTION with side-effect tool → { mode: "single" } (first only)
 */
export function parseToolRequestGroup(thought: string): ToolRequestGroup {
  // Chain mode: THEN: keyword present — must be checked before length guard
  // because THEN: lines are not ACTION: lines (parseAllToolRequests won't find them).
  const hasThen = /\nTHEN:/i.test(thought);
  if (hasThen) {
    const lines = thought.split("\n");
    const chainRequests: { tool: string; input: string; transform?: string }[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^ACTION:/i.test(trimmed)) {
        const req = parseToolRequest(trimmed);
        if (req) chainRequests.push(req);
      } else if (/^THEN:/i.test(trimmed)) {
        const normalized = trimmed.replace(/^THEN:\s*/i, "ACTION: ");
        const req = parseToolRequest(normalized);
        if (req) chainRequests.push(req);
      }
    }
    if (chainRequests.length > 0) {
      return { mode: "chain", requests: chainRequests.slice(0, 3) };
    }
  }

  const allRequests = parseAllToolRequests(thought);
  if (allRequests.length <= 1) {
    return { mode: "single", requests: allRequests };
  }

  // Parallel mode: check for side-effect tools
  const hasSideEffect = allRequests.some((req) =>
    SIDE_EFFECT_PREFIXES.some((p) => req.tool.toLowerCase().includes(p)),
  );
  if (hasSideEffect) {
    // Side-effect tools must run one at a time — return only first
    return { mode: "single", requests: [allRequests[0]!] };
  }

  return { mode: "parallel", requests: allRequests.slice(0, 3) };
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

      const remaining = parsed.length - previewItems;
      const moreStr = remaining > 0 ? `\n  ...${remaining} more` : "";
      const content =
        `[STORED: ${key} | ${toolName}]\n` +
        `Type: Array(${parsed.length}) | Schema: ${schema}\n` +
        `Preview (first ${Math.min(previewItems, parsed.length)}):\n` +
        items +
        moreStr +
        `\n  — use scratchpad-read("${key}") or | transform: to access full data`;

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
        `\n  — use scratchpad-read("${key}") or | transform: to access full data`;

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
    `\n  — use scratchpad-read("${key}") to access full text`;

  return { content, stored: { key, value: result } };
}
