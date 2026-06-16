/**
 * Best-effort parse of a streaming JSON prefix. Strips markdown fences + leading prose,
 * closes open brackets/strings, JSON.parse; returns {} if unparseable. Client-side render aid —
 * the server already steered + validated the object; this just renders progressive partials.
 */
export function parsePartialObject(buf: string): Record<string, unknown> {
  let s = buf.trim();
  // strip leading ```json / ``` fence and trailing ```
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  // skip leading prose: start at first '{'
  const open = s.indexOf("{");
  if (open < 0) return {};
  s = s.slice(open);
  // try as-is, then progressively close open structures
  const tryParse = (x: string): Record<string, unknown> | null => {
    try {
      const v = JSON.parse(x);
      return v && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(s);
  if (direct) return direct;
  // walk tracking string/escape + bracket stack; cut at last stable boundary then close
  const stack: string[] = [];
  let inStr = false, esc = false, lastCut = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (inStr) {
      if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c === "{" ? "}" : "]");
    else if (c === "}" || c === "]") stack.pop();
    if (!inStr && (c === "," || c === "}" || c === "]")) lastCut = i;
  }
  const base = lastCut >= 0 ? s.slice(0, lastCut + 1) : s;
  const closed = base.replace(/,\s*$/, "") + [...stack].reverse().join("");
  return tryParse(closed) ?? tryParse(base + [...stack].reverse().join("")) ?? {};
}
