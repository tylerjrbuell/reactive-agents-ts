import { describe, it, expect } from "bun:test";
import {
    resolveThinking,
    widenNumPredictForThinking,
    THINKING_NUM_PREDICT_ALLOWANCE,
} from "../src/providers/local.js"; // @internal exports for test
import { resolveCapability } from "../src/capability-resolver.js";

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
    // Off-switch fix (2026-10-23, introspective-harness probe): Ollama runs
    // thinking SERVER-SIDE when the `think` param is absent (bonsai-2:27b,
    // qwen3 family), so the old false→omit collapse silently ignored an
    // explicit thinking:false while widening +6000 tokens for it. Contract
    // now: false + capable → false (send think:false); false + non-capable →
    // undefined (omit — nothing to switch off; think:true errors there and a
    // false is pointless).
    it("false + capable → false (explicit think:false suppresses server-side thinking)", async () => {
        expect(await resolveThinking(showCapable, "qwen3:14b-test-offswitch", false)).toBe(false);
    });
    it("false + non-capable → undefined (param omitted, nothing to switch off)", async () => {
        expect(await resolveThinking(showIncapable, "granite3.3-test-offswitch", false)).toBeUndefined();
    });
    // Capability-record short-circuit: a resolved record answers the question
    // without the /api/show client probe — proven by pairing each record with
    // the CONTRADICTING show mock (record wins, probe never consulted).
    it("false + capable static-table record → false (probe not consulted)", async () => {
        const capable = resolveCapability("ollama", "qwen3:14b");
        expect(await resolveThinking(showIncapable, "record-capable-offswitch", false, capable)).toBe(false);
    });
    it("false + incapable static-table record → undefined (probe not consulted)", async () => {
        const incapable = resolveCapability("ollama", "cogito:14b");
        expect(await resolveThinking(showCapable, "record-incapable-offswitch", false, incapable)).toBeUndefined();
    });
    it("undefined + capable → undefined (server-side default preserved, no probe-driven opt-in)", async () => {
        expect(await resolveThinking(showCapable, "qwen3:14b-test-undef2", undefined)).toBeUndefined();
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
    it("explicit think:false does NOT widen even on a capable model (off-switch pays nothing)", () => {
        expect(widenNumPredictForThinking(4096, false, thinking)).toBe(4096);
    });
});
