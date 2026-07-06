import { createHash } from "node:crypto"
import type { TraceEvent } from "@reactive-agents/trace"

function stableStringify(v: unknown): string {
    if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"
    if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]"
    const obj = v as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}"
}

/**
 * Exact-replay request key. Hashes systemPrompt + messages so a request is a
 * table hit only when the prompt is byte-identical to what was recorded —
 * this is deliberately narrow (exact-replay only). Any config change that
 * alters the rendered prompt (model swap, template edit, tool-schema change
 * that feeds the prompt, etc.) produces a different key and MISSES by design.
 */
export function exchangeKey(
    systemPrompt: string | undefined,
    messages: readonly { readonly role: string; readonly content: string }[],
): string {
    return createHash("sha256")
        .update(stableStringify({ systemPrompt: systemPrompt ?? "", messages }))
        .digest("hex")
        .slice(0, 16)
}

export interface RecordedExchangeResponse {
    readonly content: string
    readonly toolCalls?: readonly { readonly name: string; readonly arguments?: unknown }[]
    readonly stopReason?: string
    readonly tokensIn?: number
    readonly tokensOut?: number
}

export interface RecordedExchange {
    readonly key: string
    readonly response: RecordedExchangeResponse
}

export interface LLMTable {
    /** FIFO-dispense the next recorded exchange for this request key; undefined when exhausted/missing. */
    next(key: string): RecordedExchange | undefined
    readonly size: number
}

interface LLMExchangeShape {
    readonly kind: "llm-exchange"
    readonly systemPrompt?: string
    readonly messages: readonly { readonly role: string; readonly content: string }[]
    readonly response: RecordedExchangeResponse
}

export function buildLLMTable(events: readonly TraceEvent[]): LLMTable {
    const buckets = new Map<string, RecordedExchange[]>()
    for (const ev of events) {
        if (ev.kind !== "llm-exchange") continue
        const e = ev as unknown as LLMExchangeShape
        const key = exchangeKey(e.systemPrompt, e.messages)
        const rec: RecordedExchange = { key, response: e.response }
        const list = buckets.get(key) ?? []
        list.push(rec)
        buckets.set(key, list)
    }
    const cursors = new Map<string, number>()
    let total = 0
    for (const arr of buckets.values()) total += arr.length
    return {
        size: total,
        next(key) {
            const arr = buckets.get(key)
            if (!arr) return undefined
            const i = cursors.get(key) ?? 0
            if (i >= arr.length) return undefined
            cursors.set(key, i + 1)
            return arr[i]
        },
    }
}
