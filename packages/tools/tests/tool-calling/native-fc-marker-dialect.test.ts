import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { NativeFCStrategy } from "../../src/tool-calling/native-fc-strategy.js";
import type { ResolverInput } from "../../src/tool-calling/types.js";

const strategy = new NativeFCStrategy();
const tools = [{ name: "umami-get-top-pages" }, { name: "web-search" }];
const run = (input: ResolverInput) => Effect.runSync(strategy.resolve(input, tools));

describe("NativeFCStrategy tool-call marker dialect", () => {
  it("parses <|tool_call>call:NAME{k: v}<tool_call|> into a tool call", () => {
    const r = run({
      content: '<|tool_call>call:umami_get_top_pages{website_id: "abc-123", limit: 5}<tool_call|>',
      stopReason: "end_turn",
    });
    expect(r._tag).toBe("tool_calls");
    if (r._tag === "tool_calls") {
      expect(r.calls[0]!.name).toBe("umami-get-top-pages");
      expect(r.calls[0]!.arguments).toEqual({ website_id: "abc-123", limit: 5 });
    }
  });

  it("tolerates JSON args in the dialect", () => {
    const r = run({
      content: '<|tool_call>call:web-search{"query": "xrp"}<tool_call|>',
      stopReason: "end_turn",
    });
    expect(r._tag).toBe("tool_calls");
    if (r._tag === "tool_calls") expect(r.calls[0]!.arguments).toEqual({ query: "xrp" });
  });

  it("returns thinking (not final_answer) for an unresolvable name with a marker", () => {
    for (const content of [
      '<|tool_call>call:mystery_api.fetch_widgets{website_id: "x", limit: 5}<tool_call|>',
      '<tool_call>{"name":"nope"}</tool_call>',
      "<tool_use>nope</tool_use>",
    ]) {
      expect(run({ content, stopReason: "end_turn" })._tag).toBe("thinking");
    }
  });

  it("keeps ordinary prose mentioning tool_call as final_answer", () => {
    const r = run({
      content: "The tool_call field in the schema is optional.",
      stopReason: "end_turn",
    });
    expect(r._tag).toBe("final_answer");
  });
});
