import { describe, it, expect } from "bun:test";
import {
    resolveThinking,
    widenNumPredictForThinking,
    THINKING_NUM_PREDICT_ALLOWANCE,
} from "../src/providers/local.js"; // @internal exports for test

const showCapable = { show: async (_opts: { model: string }) => ({ capabilities: ["thinking"] }) };
const showIncapable = { show: async (_opts: { model: string }) => ({ capabilities: ["tools"] }) };

describe("local resolveThinking delegates tri-state, keeps async capability probe", () => {
    it("undefined → undefined (off)", async () => {
        expect(await resolveThinking(showCapable, "qwen3:14b-test-undef", undefined)).toBeUndefined();
    });
    it("true + capable → true", async () => {
        expect(await resolveThinking(showCapable, "qwen3:14b-test-capable", true)).toBe(true);
    });
    it("true + incapable → undefined (degrade, no throw)", async () => {
        const r = await resolveThinking(showIncapable, "granite3.3-test-incapable", true);
        expect(r).toBeUndefined();
    });
    it("false → undefined (off)", async () => {
        expect(await resolveThinking(showCapable, "qwen3:14b-test-false", false)).toBeUndefined();
    });
});

// B2/P1 (2026-07-07): Ollama counts thinking tokens against num_predict and
// qwen3-family models think by default even with the `think` param omitted —
// flat caller budgets (2048/4096) starved the visible answer (empty-content
// done_reason=length turns; 113k wasted tokens across the qwen3:14b bench).
describe("widenNumPredictForThinking", () => {
    const thinking = { supportsThinkingMode: true };
    const plain = { supportsThinkingMode: false };

    it("undefined budget stays undefined (Ollama default cap)", () => {
        expect(widenNumPredictForThinking(undefined, true, thinking)).toBeUndefined();
    });
    it("explicit think:true widens", () => {
        expect(widenNumPredictForThinking(2048, true, plain)).toBe(2048 + THINKING_NUM_PREDICT_ALLOWANCE);
    });
    it("think omitted + thinking-capable model widens (default-on thinking)", () => {
        expect(widenNumPredictForThinking(4096, undefined, thinking)).toBe(4096 + THINKING_NUM_PREDICT_ALLOWANCE);
    });
    it("think omitted + non-thinking model stays flat", () => {
        expect(widenNumPredictForThinking(4096, undefined, plain)).toBe(4096);
    });
    it("capability without the flag stays flat", () => {
        expect(widenNumPredictForThinking(4096, undefined, {})).toBe(4096);
    });
});
