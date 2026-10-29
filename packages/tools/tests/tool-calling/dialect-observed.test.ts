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

// ── F5: text dialect parsers. One positive per parser, one negative per parser.
const dtools = [
    { name: "web-search", paramNames: ["query", "maxResults"] },
    { name: "http-get", paramNames: ["url"] },
    { name: "todo", paramNames: ["action"] },
];
const resolveText = (content: string) =>
    run(strategy.resolveWithDialect({ content, stopReason: "end_turn" }, dtools));

describe("F5 text dialect parsers", () => {
    const positives: [string, string, string, Record<string, unknown>][] = [
        ["Hermes/Qwen <tool_call>{json}", '<tool_call>\n{"name":"web-search","arguments":{"query":"x"}}\n</tool_call>', "web-search", { query: "x" }],
        ["tool_calls wrapper", '{"tool_calls":[{"name":"web-search","arguments":{"query":"x"}}]}', "web-search", { query: "x" }],
        ["OpenAI function wrapper", '{"type":"function","function":{"name":"web-search","arguments":"{\\"query\\":\\"x\\"}"}}', "web-search", { query: "x" }],
        ["array of calls", '[{"name":"web-search","arguments":{"query":"x"}}]', "web-search", { query: "x" }],
        ["JSON after prose", 'Let me look that up. {"name":"web-search","arguments":{"query":"x"}}', "web-search", { query: "x" }],
        ["Mistral [TOOL_CALLS]", '[TOOL_CALLS] [{"name":"web-search","arguments":{"query":"x"}}]', "web-search", { query: "x" }],
        ["Llama <|python_tag|>", '<|python_tag|>{"name":"web-search","parameters":{"query":"x"}}', "web-search", { query: "x" }],
        ["<function=..> XML", "<function=web-search><parameter=query>x</parameter></function>", "web-search", { query: "x" }],
        ["bare known name(...)", 'web-search(query="x")', "web-search", { query: "x" }],
        ["trailing comma repair", '{"name":"web-search","arguments":{"query":"x",},}', "web-search", { query: "x" }],
        ["single-quote repair", "{'name':'web-search','arguments':{'query':'x'}}", "web-search", { query: "x" }],
        ["truncation repair (missing closers)", '{"name":"web-search","arguments":{"query":"x"', "web-search", { query: "x" }],
        ["healed name (underscore)", '{"name":"web_search","arguments":{"query":"x"}}', "web-search", { query: "x" }],
    ];
    for (const [label, content, name, args] of positives) {
        it(`resolves: ${label}`, () => {
            const r = resolveText(content);
            expect(r.result._tag).toBe("tool_calls");
            if (r.result._tag === "tool_calls") {
                expect(r.result.calls[0]!.name).toBe(name);
                expect(r.result.calls[0]!.arguments).toEqual(args);
            }
        });
    }

    it("resolves multiple unfenced objects into multiple calls", () => {
        const r = resolveText(
            '{"name":"web-search","arguments":{"query":"a"}}\n{"name":"http-get","arguments":{"url":"https://e.com"}}',
        );
        expect(r.result._tag).toBe("tool_calls");
        if (r.result._tag === "tool_calls") expect(r.result.calls.map((c) => c.name)).toEqual(["web-search", "http-get"]);
    });

    const negatives: [string, string][] = [
        ["prose merely mentioning a tool", "I could use web-search to find that, or http-get for the page."],
        ["prose mentioning call syntax mid-sentence", "Try web-search(query=x) later, once you have the details sorted."],
        ["unknown tool in <tool_call>", '<tool_call>{"name":"rm-rf","arguments":{}}</tool_call>'],
        ["unknown tool in array", '[{"name":"nope","arguments":{}}]'],
        ["unknown name in XML", "<function=nope><parameter=a>1</parameter></function>"],
        ["ambiguous truncation inside a string is not repaired", '{"name":"web-search","arguments":{"query":"unfinis'],
        ["name key without args for non-tool", '{"name":"Alice","age":3}'],
        ["short-name overheal: task is not todo", '{"name":"task","arguments":{}}'],
    ];
    for (const [label, content] of negatives) {
        it(`does not execute: ${label}`, () => {
            const r = resolveText(content);
            expect(r.result._tag).not.toBe("tool_calls");
        });
    }
});
