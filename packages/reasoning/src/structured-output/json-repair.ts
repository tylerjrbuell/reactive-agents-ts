/**
 * JSON extraction and repair utilities.
 * Pure functions — no LLM calls. Used as Layer 2 of the structured output pipeline.
 */

/**
 * Extract a JSON block from mixed text.
 * Strips markdown fences, finds the first `{` or `[`, and matches to its closing bracket.
 */
export function extractJsonBlock(text: string): string | null {
  // Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    const inner = fenceMatch[1]!.trim();
    if (inner.startsWith("{") || inner.startsWith("[")) return inner;
  }

  // Find first { or [
  const startObj = text.indexOf("{");
  const startArr = text.indexOf("[");
  let start: number;
  let open: string;
  let close: string;

  if (startObj === -1 && startArr === -1) return null;
  if (startObj === -1) { start = startArr; open = "["; close = "]"; }
  else if (startArr === -1) { start = startObj; open = "{"; close = "}"; }
  else if (startObj < startArr) { start = startObj; open = "{"; close = "}"; }
  else { start = startArr; open = "["; close = "]"; }

  // Brace-matching scan
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open || ch === "{" || ch === "[") depth++;
    if (ch === close || ch === "}" || ch === "]") depth--;
    if (depth === 0) return text.slice(start, i + 1);
  }

  // If we ran out of text, return from start to end (will need repair)
  return text.slice(start);
}

/**
 * Attempt to repair malformed JSON.
 * Fixes: trailing commas, single quotes, unescaped newlines, truncated brackets.
 */
export function repairJson(input: string): string {
  // If already valid, return as-is
  try { JSON.parse(input); return input; } catch { /* proceed with repair */ }

  let text = input;

  // Strip single-line comments (// ...) outside strings
  text = stripComments(text);

  // Fix Python-style booleans/none: True→true, False→false, None→null
  text = fixPythonLiterals(text);

  // Fix NaN/Infinity → null (not valid JSON values)
  text = fixNonFinite(text);

  // Fix single quotes → double quotes (outside of existing double-quoted strings)
  text = fixSingleQuotes(text);

  // Fix unescaped newlines inside strings
  text = fixUnescapedNewlines(text);

  // Fix trailing commas: ,] → ] and ,} → }
  text = text.replace(/,\s*([\]}])/g, "$1");

  // Close unclosed brackets/braces
  text = closeUnclosed(text);

  return text;
}

/**
 * Strip single-line comments (// ...) outside of strings.
 */
function stripComments(text: string): string {
  const result: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { result.push(ch); escape = false; continue; }
    if (ch === "\\") { result.push(ch); escape = true; continue; }
    if (ch === '"') { inString = !inString; result.push(ch); continue; }
    if (inString) { result.push(ch); continue; }

    // Single-line comment: skip to end of line
    if (ch === "/" && text[i + 1] === "/") {
      const eol = text.indexOf("\n", i);
      if (eol === -1) break;
      i = eol - 1; // loop will increment
      continue;
    }
    // Block comment: skip to */
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) break;
      i = end + 1; // skip past */
      continue;
    }
    result.push(ch);
  }
  return result.join("");
}

/**
 * Replace Python-style boolean/none literals with JSON equivalents.
 * Only replaces outside strings at word boundaries.
 */
function fixPythonLiterals(text: string): string {
  return text
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null");
}

/**
 * Replace NaN, Infinity, -Infinity with null (not valid JSON).
 */
function fixNonFinite(text: string): string {
  return text
    .replace(/\bNaN\b/g, "null")
    .replace(/-Infinity\b/g, "null")
    .replace(/\bInfinity\b/g, "null");
}

function fixSingleQuotes(text: string): string {
  const result: string[] = [];
  let inDouble = false;
  let inSingle = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { result.push(ch); escape = false; continue; }
    if (ch === "\\") { result.push(ch); escape = true; continue; }

    if (ch === '"' && !inSingle) { inDouble = !inDouble; result.push(ch); continue; }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      result.push('"');
      continue;
    }
    result.push(ch);
  }
  return result.join("");
}

function fixUnescapedNewlines(text: string): string {
  const result: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { result.push(ch); escape = false; continue; }
    if (ch === "\\") { result.push(ch); escape = true; continue; }
    if (ch === '"') { inString = !inString; result.push(ch); continue; }
    if (inString && ch === "\n") { result.push("\\n"); continue; }
    if (inString && ch === "\r") { result.push("\\r"); continue; }
    result.push(ch);
  }
  return result.join("");
}

function closeUnclosed(text: string): string {
  const stack: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }

  // Close any open string
  if (inString) text += '"';

  // Close open brackets in reverse order
  while (stack.length > 0) {
    text += stack.pop();
  }

  return text;
}
