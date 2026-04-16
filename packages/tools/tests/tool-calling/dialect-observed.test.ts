import { describe, it, expect } from "bun:test";
import { NativeFCStrategy } from "../../src/tool-calling/native-fc-strategy.js";
import type { ResolverInput } from "../../src/tool-calling/types.js";
import { Effect, Runtime } from "effect";

const strategy = new NativeFCStrategy();
const run = <A>(effect: Effect.Effect<A, never>) =>
    Runtime.runSync(Runtime.defaultRuntime)(effect);
const tools = [{ name: "web-search", paramNames: ["query", "maxResults"] }];

describe("resolveWithDialect", () => {
    it("reports 'native-fc' when native tool_calls are present", () => {
        const input: ResolverInput = {
            content: "",
            toolCalls: [{ id: "1", name: "web-search", input: { query: "x" } }],
            stopReason: "tool_use",
        };
        const resolved = run(strategy.resolveWithDialect(input, tools));
        expect(resolved.dialect).toBe("native-fc");
        expect(resolved.result._tag).toBe("tool_calls");
    });

    it("reports 'fenced-json' when a JSON block with name field fires", () => {
        const input: ResolverInput = {
            content:
                '```json\n{"name":"web-search","arguments":{"query":"x"}}\n```',
            stopReason: "end_turn",
        };
        const resolved = run(strategy.resolveWithDialect(input, tools));
        expect(resolved.dialect).toBe("fenced-json");
        expect(resolved.result._tag).toBe("tool_calls");
    });

    it("reports 'pseudo-code' when tool-name(args) syntax is detected", () => {
        const input: ResolverInput = {
            content: '```javascript\nweb-search(query: "test")\n```',
            stopReason: "end_turn",
        };
        const resolved = run(strategy.resolveWithDialect(input, tools));
        expect(resolved.dialect).toBe("pseudo-code");
        expect(resolved.result._tag).toBe("tool_calls");
    });

    it("reports 'nameless-shape' when JSON shape-matching fires", () => {
        const input: ResolverInput = {
            content: '```json\n{"query": "test", "maxResults": 5}\n```',
            stopReason: "end_turn",
        };
        const resolved = run(strategy.resolveWithDialect(input, tools));
        expect(resolved.dialect).toBe("nameless-shape");
        expect(resolved.result._tag).toBe("tool_calls");
    });

    it("reports 'none' when no tool call is extracted", () => {
        const input: ResolverInput = {
            content: "just some narrative text about web searching",
            stopReason: "end_turn",
        };
        const resolved = run(strategy.resolveWithDialect(input, tools));
        expect(resolved.dialect).toBe("none");
    });

    it("native FC takes priority over text fallbacks", () => {
        const input: ResolverInput = {
            content:
                '```json\n{"name":"web-search","arguments":{"query":"ignored"}}\n```',
            toolCalls: [
                { id: "1", name: "web-search", input: { query: "native" } },
            ],
            stopReason: "tool_use",
        };
        const resolved = run(strategy.resolveWithDialect(input, tools));
        expect(resolved.dialect).toBe("native-fc");
    });
});
