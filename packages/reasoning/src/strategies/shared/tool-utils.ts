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
 * Evaluate a transform expression in-process with `result` bound to the tool output.
 * Returns serialized result string, or an error string prefixed with "[Transform error:" on failure.
 * Runs synchronously via new Function() — for pure data transforms only (no side effects).
 */
export function evaluateTransform(expr: string, result: unknown): string {
  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("result", `return (${expr})`);
    const output = fn(result) as unknown;
    if (typeof output === "string") return output;
    return JSON.stringify(output, null, 2);
  } catch (e) {
    return `[Transform error: ${e instanceof Error ? e.message : String(e)}] — fix the expression or remove | transform:`;
  }
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
