/**
 * Deterministic JSON serialization (object keys sorted recursively) — the
 * canonical input normalizer for replay hash keys. Shared by tool-table.ts
 * (tool-call args hashing) and llm-table.ts (exchange request-key hashing).
 */
export function stableStringify(v: unknown): string {
    if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]"
    const obj = v as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}"
}
