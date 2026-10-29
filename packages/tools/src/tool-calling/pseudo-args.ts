/** Pseudo-call argument parsing (`tool(key: value, ...)`) shared by the text parsers. */

/** Extracts the substring between a balanced `(` at `openIdx` and its matching `)`. */
export function extractBalancedArgs(source: string, openIdx: number): string | null {
    if (source[openIdx] !== "(") return null
    let depth = 0
    let inStr: '"' | "'" | "`" | null = null
    for (let i = openIdx; i < source.length; i++) {
        const ch = source[i]!
        if (inStr) {
            if (ch === "\\") { i++; continue }
            if (ch === inStr) inStr = null
            continue
        }
        if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue }
        if (ch === "(") depth++
        else if (ch === ")") {
            depth--
            if (depth === 0) return source.slice(openIdx + 1, i)
        }
    }
    return null
}

/**
 * Parses pseudo-arg strings into an object. Supports:
 *   - `key: value` and `key=value`
 *   - quoted strings (`"..."`, `'...'`, `` `...` ``)
 *   - numbers, booleans, null
 *   - bare positional values → stored under `input` key
 * Falls back to the raw trimmed text under `input` when no key/value found.
 */
export function parsePseudoArgs(argsRaw: string): Record<string, unknown> {
    const trimmed = argsRaw.trim()
    if (trimmed.length === 0) return {}

    const pairs = splitTopLevelCommas(trimmed)
    const out: Record<string, unknown> = {}
    const positionals: unknown[] = []

    for (const pair of pairs) {
        const kvMatch = pair.match(/^\s*([a-zA-Z_$][\w$-]*)\s*[:=]\s*([\s\S]+)$/)
        if (kvMatch) {
            const key = kvMatch[1]!
            const rawValue = kvMatch[2]!.trim()
            out[key] = coercePseudoValue(rawValue)
        } else {
            positionals.push(coercePseudoValue(pair.trim()))
        }
    }

    if (Object.keys(out).length === 0 && positionals.length === 1) {
        return { input: positionals[0] }
    }
    if (positionals.length > 0 && !("input" in out)) {
        out["input"] = positionals.length === 1 ? positionals[0] : positionals
    }
    return out
}

function splitTopLevelCommas(s: string): string[] {
    const parts: string[] = []
    let depth = 0
    let inStr: '"' | "'" | "`" | null = null
    let start = 0
    for (let i = 0; i < s.length; i++) {
        const ch = s[i]!
        if (inStr) {
            if (ch === "\\") { i++; continue }
            if (ch === inStr) inStr = null
            continue
        }
        if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue }
        if (ch === "(" || ch === "[" || ch === "{") depth++
        else if (ch === ")" || ch === "]" || ch === "}") depth--
        else if (ch === "," && depth === 0) {
            parts.push(s.slice(start, i))
            start = i + 1
        }
    }
    parts.push(s.slice(start))
    return parts.map((p) => p.trim()).filter((p) => p.length > 0)
}

function coercePseudoValue(raw: string): unknown {
    if (raw.length === 0) return raw
    const first = raw[0]
    const last = raw[raw.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === "`" && last === "`")) {
        // Strip outer quotes; unescape common sequences
        return raw.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\'/g, "'")
    }
    if (raw === "true") return true
    if (raw === "false") return false
    if (raw === "null") return null
    if (/^-?\d+$/.test(raw)) return Number(raw)
    if (/^-?\d*\.\d+$/.test(raw)) return Number(raw)
    if (raw.startsWith("{") || raw.startsWith("[")) {
        try { return JSON.parse(raw) } catch { /* fallthrough */ }
    }
    return raw
}
