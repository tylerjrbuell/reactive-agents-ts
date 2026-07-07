import { createHash } from "node:crypto"
import type { TraceEvent } from "@reactive-agents/trace"
import {
    truncateExchangeText,
    EXCHANGE_SYSTEM_PROMPT_MAX,
    EXCHANGE_MESSAGE_MAX,
} from "@reactive-agents/llm-provider"
import { stableStringify } from "./stable-stringify.js"

/**
 * Exact-replay request key. Hashes systemPrompt + messages so a request is a
 * table hit only when the prompt is byte-identical to what was recorded —
 * this is deliberately narrow (exact-replay only). Any config change that
 * alters the rendered prompt (model swap, template edit, tool-schema change
 * that feeds the prompt, etc.) produces a different key and MISSES by design.
 *
 * PROJECTION CONTRACT — keys are derived from the truncated-flattened
 * projection on BOTH sides of the seam (shared source of truth:
 * `llm-provider/src/exchange-projection.ts`):
 *
 *   1. Message content is FLATTENED text. The record side
 *      (`reasoning/src/kernel/observable-llm.ts`) flattens ContentBlock[]
 *      content via `messageContentToString`; callers hashing live requests
 *      must apply the same flattener before calling this function.
 *   2. Text is TRUNCATED to the record-side caps (`EXCHANGE_SYSTEM_PROMPT_MAX`
 *      for systemPrompt, `EXCHANGE_MESSAGE_MAX` per message). Recorded events
 *      carry capped text while live requests carry full text, so truncation
 *      is applied HERE, inside the hash chokepoint — both sides hash the
 *      identical capped projection (idempotent for already-capped recorded
 *      text).
 *   3. Messages are projected to bare `{role, content}` — recorded events may
 *      carry extra fields (e.g. `truncated: true`) that must not leak into
 *      the hash.
 */
export function exchangeKey(
    systemPrompt: string | undefined,
    messages: readonly { readonly role: string; readonly content: string }[],
): string {
    const cappedSystem = truncateExchangeText(systemPrompt, EXCHANGE_SYSTEM_PROMPT_MAX).text
    const cappedMessages = messages.map((m) => ({
        role: m.role,
        content: truncateExchangeText(m.content, EXCHANGE_MESSAGE_MAX).text ?? "",
    }))
    return createHash("sha256")
        .update(stableStringify({ systemPrompt: cappedSystem ?? "", messages: cappedMessages }))
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

export function buildLLMTable(events: readonly TraceEvent[]): LLMTable {
    const buckets = new Map<string, RecordedExchange[]>()
    for (const ev of events) {
        // The kind check narrows the TraceEvent discriminated union to
        // LLMExchangeEvent (packages/trace/src/events.ts) — no cast needed.
        if (ev.kind !== "llm-exchange") continue
        const key = exchangeKey(ev.systemPrompt, ev.messages)
        const rec: RecordedExchange = { key, response: ev.response }
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
