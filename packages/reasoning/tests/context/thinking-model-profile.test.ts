import { describe, it, expect } from "bun:test"
import { applyCapabilityMaxTokens, CONTEXT_PROFILES } from "../../src/context/context-profile.js"

describe("B2 — thinking-aware context profile", () => {
    it("threads supportsThinkingMode from the capability table into profile.thinkingModel", () => {
        const p = applyCapabilityMaxTokens(CONTEXT_PROFILES.local, "ollama", "qwen3:14b", undefined)
        expect(p.thinkingModel).toBe(true)
    })

    it("non-thinking local models stay unflagged", () => {
        const p = applyCapabilityMaxTokens(CONTEXT_PROFILES.local, "ollama", "cogito:8b", undefined)
        expect(p.thinkingModel ?? false).toBe(false)
    })

    it("caller-provided maxTokens still wins but thinkingModel is threaded anyway", () => {
        const base = { ...CONTEXT_PROFILES.local, maxTokens: 12345 }
        const p = applyCapabilityMaxTokens(base, "ollama", "qwen3:14b", 12345)
        expect(p.maxTokens).toBe(12345)
        expect(p.thinkingModel).toBe(true)
    })
})
