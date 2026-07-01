import { describe, it, expect } from "bun:test";
import { resolveThinking } from "../src/providers/local.js"; // @internal export for test

const showCapable = { show: async (_opts: { model: string }) => ({ capabilities: ["thinking"] }) };
const showIncapable = { show: async (_opts: { model: string }) => ({ capabilities: ["tools"] }) };

describe("local resolveThinking delegates tri-state, keeps async capability probe", () => {
    it("undefined → undefined (off)", async () => {
        expect(await resolveThinking(showCapable, "qwen3:14b-test-undef", undefined)).toBeUndefined();
    });
    it("true + capable → true", async () => {
        expect(await resolveThinking(showCapable, "qwen3:14b-test-capable", true)).toBe(true);
    });
    it("true + incapable → false/undefined (degrade, no throw)", async () => {
        const r = await resolveThinking(showIncapable, "granite3.3-test-incapable", true);
        expect(r === false || r === undefined).toBe(true);
    });
    it("false → undefined (off)", async () => {
        expect(await resolveThinking(showCapable, "qwen3:14b-test-false", false)).toBeUndefined();
    });
});
