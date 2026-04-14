/**
 * kernel/utils/tool-parsing.ts — FC parsing, final-answer extraction, preamble
 * stripping, and safe transform expression evaluation.
 *
 * Extracted from tool-utils.ts. All functions are pure (no Effect dependencies).
 */

// ── Final Answer Parsing ──────────────────────────────────────────────────────

/** Expanded regex matching FINAL ANSWER with optional markdown bold and various colon forms. */
export const FINAL_ANSWER_RE = /(?:\*{0,2})final\s*answer(?:\*{0,2})\s*[:：]?\s*/i;

export function hasFinalAnswer(thought: string): boolean {
  return FINAL_ANSWER_RE.test(thought);
}

export function extractFinalAnswer(thought: string): string {
  const match = thought.match(new RegExp(FINAL_ANSWER_RE.source + "([\\s\\S]*)", "i"));
  return match ? match[1]!.trim() : thought;
}

// ── Preamble Stripping ────────────────────────────────────────────────────────

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

// ── Transform Expression Evaluation ───────────────────────────────────────────

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
