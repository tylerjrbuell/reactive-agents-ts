import { describe, it, expect } from "bun:test";
import { Effect, Runtime } from "effect";
import { detectToolCallShape } from "../../src/tool-calling/index.js";
import { NativeFCStrategy } from "../../src/tool-calling/native-fc-strategy.js";

const known = ["web-search", "http-get", "file-read", "todo"];
const strategy = new NativeFCStrategy();
const tools = known.map((name) => ({ name }));
const run = <A>(e: Effect.Effect<A, never>) => Runtime.runSync(Runtime.defaultRuntime)(e);

const positives: [string, string][] = [
  ["hallucinated name", '{"name":"book_flight","parameters":{"to":"NYC"}}'],
  ["fenced hallucinated", '```json\n{"name":"unknown-tool","arguments":{}}\n```'],
  ["array of calls", '[{"name":"nope","arguments":{"a":1}},{"name":"nada","arguments":{}}]'],
  ["garbled parameters{", '{"name": "web-serch", "parameters{"query": "x"}}'],
  ["truncated JSON", '{"name":"book_flight","arguments":{"to":"NY'],
  ["JSON after prose", 'Sure, calling it now: {"name":"book_flight","arguments":{"to":"NYC"}}'],
  ["<tool_call> markup", '<tool_call>{"name":"nope"}</tool_call>'],
  ["bare name(...)", 'search_web("xrp price")'],
  ["bare known name()", "todo()"],
  ["Mistral", '[TOOL_CALLS] [{"name":"nope","arguments":{}}]'],
  ["python_tag", '<|python_tag|>{"name":"nope","parameters":{}}'],
  ["function xml", "<function=nope><parameter=a>1</parameter></function>"],
  ["tool_calls wrapper", '{"tool_calls":[{"function":{"name":"nope","arguments":"{}"}}]}'],
];

const negatives: [string, string][] = [
  ["legit JSON answer", '{"result": 180}'],
  ["JSON with name field only", '{"name":"Alice","age":30}'],
  ["prose with braces", "Use a set literal like {1, 2, 3} in Python; the answer is 42."],
  ["plain answer", "The capital of France is Paris."],
  ["prose mentioning call syntax", "I would call f(x) here, then explain the result in detail."],
  ["array answer", "[1, 2, 3]"],
  ["empty", "   "],
];

describe("detectToolCallShape", () => {
  for (const [label, c] of positives) {
    it(`shaped: ${label}`, () => expect(detectToolCallShape(c, known).shaped).toBe(true));
  }
  for (const [label, c] of negatives) {
    it(`not shaped: ${label}`, () => expect(detectToolCallShape(c, known).shaped).toBe(false));
  }
  it("recovers called names", () => {
    expect(detectToolCallShape('{"name":"book_flight","arguments":{}}', known).names).toEqual(["book_flight"]);
  });
});

describe("NativeFCStrategy.extract — shaped-but-unresolved is never final_answer", () => {
  for (const [label, c] of positives) {
    it(`reprompts: ${label}`, () => {
      const r = run(strategy.resolve({ content: c, stopReason: "end_turn" }, tools));
      expect(r._tag).not.toBe("final_answer");
      if (r._tag === "thinking") expect(r.reason).toBe("unresolved-tool-call");
    });
  }
  for (const [label, c] of negatives.slice(0, 6)) {
    it(`finalizes: ${label}`, () => {
      const r = run(strategy.resolve({ content: c, stopReason: "end_turn" }, tools));
      expect(r._tag).toBe("final_answer");
    });
  }
});
