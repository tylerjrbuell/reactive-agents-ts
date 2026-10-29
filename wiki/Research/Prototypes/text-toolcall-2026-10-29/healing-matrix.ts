// Healing coverage matrix: what NativeFCStrategy.resolveWithDialect does with each malformed shape.
import { Effect } from "effect";
import { NativeFCStrategy } from "../../../../packages/tools/src/tool-calling/native-fc-strategy.ts";
const tools = [{ name: "web-search", paramNames: ["query", "maxResults"] }, { name: "http-get", paramNames: ["url"] }, { name: "file-read", paramNames: ["path"] }, { name: "todo", paramNames: ["action", "items"] }];
const s = new NativeFCStrategy();
const C = (content: string) => ({ content, stopReason: "stop" as const });
const N = (name: string, input: unknown) => ({ content: "", stopReason: "tool_use" as const, toolCalls: [{ id: "1", name, input }] });
const cases: [string, any][] = [
 ["native exact", N("web-search", { query: "x" })],
 ["native alias web_search", N("web_search", { query: "x" })],
 ["native alias WebSearch (camel)", N("WebSearch", { query: "x" })],
 ["native alias 'search'", N("search", { query: "x" })],
 ["native alias functions.web-search", N("functions.web-search", { query: "x" })],
 ["native unknown name", N("math-product", { x: 1 })],
 ["native args as JSON string", N("web-search", '{"query":"x"}')],
 ["native args with alias param (q)", N("web-search", { q: "x" })],
 ["native args wrong type (maxResults:'5')", N("web-search", { query: "x", maxResults: "5" })],
 ["text bare JSON name/arguments", C('{"name":"web-search","arguments":{"query":"x"}}')],
 ["text bare JSON name/parameters", C('{"name": "web-search", "parameters": {"query": "x"}}')],
 ["text fenced ```json", C('```json\n{"name":"web-search","arguments":{"query":"x"}}\n```')],
 ["text JSON after prose (unfenced)", C('Sure, I will search. {"name":"web-search","arguments":{"query":"x"}}')],
 ["text JSON array of 2 calls", C('[{"name":"web-search","arguments":{"query":"a"}},{"name":"http-get","arguments":{"url":"http://a"}}]')],
 ["text 2 fenced blocks", C('```json\n{"name":"web-search","arguments":{"query":"a"}}\n```\n```json\n{"name":"http-get","arguments":{"url":"http://a"}}\n```')],
 ["text 2 JSON objects newline-separated, unfenced", C('{"name":"web-search","arguments":{"query":"a"}}\n{"name":"http-get","arguments":{"url":"http://a"}}')],
 ["text <tool_call>{json}</tool_call> (Qwen/Hermes)", C('<tool_call>\n{"name":"web-search","arguments":{"query":"x"}}\n</tool_call>')],
 ["text marker dialect call:NAME{}", C('<|tool_call>call:web-search{query:"x"}<tool_call|>')],
 ["text <function=..><parameter=..> XML", C('<function=web-search>\n<parameter=query>x</parameter>\n</function>')],
 ["text [TOOL_CALLS][json] (Mistral)", C('[TOOL_CALLS][{"name":"web-search","arguments":{"query":"x"}}]')],
 ["text <|python_tag|>{json}", C('<|python_tag|>{"name":"web-search","parameters":{"query":"x"}}')],
 ["text pseudo fenced web-search(query:\"x\")", C('```\nweb-search(query: "x")\n```')],
 ["text pseudo BARE web-search(query=\"x\")", C('web-search(query="x")')],
 ["text pseudo BARE web_search(\"x\") underscore", C('web_search("x")')],
 ["text OpenAI shape {function:{name,arguments}}", C('{"type":"function","function":{"name":"web-search","arguments":"{\\"query\\":\\"x\\"}"}}')],
 ["text {tool_calls:[...]} wrapper", C('{"tool_calls":[{"function":{"name":"web-search","arguments":{"query":"x"}}}]}')],
 ["text JSON hallucinated name", C('{"name":"math-product","parameters":{"x":12,"y":15}}')],
 ["text JSON name w/ spaces 'Say Hello'", C('{"name":"Say Hello in One Word","parameters":{"query":"x"}}')],
 ["text truncated JSON (missing })", C('{"name":"web-search","arguments":{"query":"x"')],
 ["text garbled parameters{ (observed)", C('{"name":"web-search","parameters{"type":"object","required":["query"]}}')],
 ["text trailing comma JSON", C('{"name":"web-search","arguments":{"query":"x",}}')],
 ["text single-quote JSON", C("{'name':'web-search','arguments':{'query':'x'}}")],
 ["text nameless param-shape", C('{"query":"x","maxResults":3}')],
 ["text name only no args", C('{"name":"todo"}')],
 ["text args as string value", C('{"name":"web-search","arguments":"{\\"query\\":\\"x\\"}"}')],
 ["empty content + stop", C('')],
];
for (const [label, input] of cases) {
  const { result, dialect } = await Effect.runPromise(s.resolveWithDialect(input, tools));
  const r: any = result;
  const detail = r._tag === "tool_calls" ? r.calls.map((c: any) => `${c.name}(${JSON.stringify(c.arguments)})`).join(" + ") : r._tag === "final_answer" ? "FINAL<-" + r.content.slice(0, 40) : r._tag === "thinking" ? "thinking:" + String(r.content).slice(0, 60).replace(/\n/g, " ") : r._tag;
  console.log(`${label.padEnd(52)} | ${r._tag.padEnd(10)} | ${dialect.padEnd(11)} | ${detail}`);
}
