// Run: bun test packages/tools/tests/tool-calling/seam-assistant-text-parser.test.ts --timeout 15000
//
// Direct-import seam pin for the ONE assistant-text tool-call parser and its
// ONE argument grammar (canonical tool-call extraction D1). The strategy-level
// corpus lives in text-call-corpus.test.ts; this file pins the parser's own
// contract: result union, provenance, tier order, the embedded-form risk gate
// and the argument grammar arms.
import { describe, it, expect } from "bun:test";
import { parseAssistantToolCalls, parseCallArgs } from "../../src/tool-calling/index.js";
import type { ResolverToolHint } from "../../src/tool-calling/types.js";

const surface: readonly ResolverToolHint[] = [
  { name: "file-read", paramNames: ["path", "encoding"], requiredParams: ["path"], riskLevel: "medium" },
  { name: "get-time", paramNames: ["timezone"], requiredParams: [], riskLevel: "low" },
  { name: "web-search", paramNames: ["query", "maxResults"], requiredParams: ["query"], riskLevel: "medium" },
];
const fileRead = surface[0]!;
const fence = (lang: string, body: string): string => "```" + lang + "\n" + body + "\n```";

describe("parseAssistantToolCalls — result union", () => {
  it("none for an ordinary reply", () => {
    expect(parseAssistantToolCalls("The mean is 21.83.", surface)).toEqual({ _tag: "none" });
  });

  it("none on an empty surface (names resolve only against the surface)", () => {
    expect(parseAssistantToolCalls(fence("js", 'file-read("x")'), [])._tag).toBe("none");
  });

  it("parsed calls carry provenance: source, dialect, tier, argParse, span, form", () => {
    const content = "Reading it now.\n" + fence("javascript", 'fileRead({ path: "data.csv" })');
    const r = parseAssistantToolCalls(content, surface);
    expect(r._tag).toBe("parsed");
    if (r._tag !== "parsed") return;
    const call = r.calls[0]!;
    expect(call.name).toBe("file-read");
    expect(call.arguments).toEqual({ path: "data.csv" });
    expect(call.extraction).toMatchObject({
      source: "text",
      dialect: "call",
      tier: "call-form",
      argParse: "lenient-json",
      form: "standalone",
    });
    expect(content.slice(call.extraction.span.start, call.extraction.span.end)).toBe('fileRead({ path: "data.csv" })');
  });

  it("unparseable names the tool and carries a reason", () => {
    const r = parseAssistantToolCalls(fence("js", "file-read({ path: dataPath })"), surface);
    expect(r._tag).toBe("unparseable");
    if (r._tag === "unparseable") {
      expect(r.names).toEqual(["file-read"]);
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("a call-shaped reply that matches no tier is unparseable (shape fallback)", () => {
    const r = parseAssistantToolCalls('{"name":"book_flight","arguments":{"to":"NYC"}}', surface);
    expect(r).toEqual({ _tag: "unparseable", names: ["book_flight"], reason: expect.any(String) });
  });
});

describe("parseAssistantToolCalls — tiers", () => {
  it("taught markup wins over everything else", () => {
    const content = "<tool_use>\ntool: file-read\npath: data.csv\n</tool_use>\n" + fence("js", 'web-search(query: "x")');
    const r = parseAssistantToolCalls(content, surface);
    expect(r._tag).toBe("parsed");
    if (r._tag === "parsed") {
      expect(r.calls.map((c) => c.name)).toEqual(["file-read"]);
      expect(r.calls[0]!.extraction.tier).toBe("taught-markup");
    }
  });

  it("an unknown name in a wrapped taught block is unparseable, not dropped", () => {
    const r = parseAssistantToolCalls("<tool_use>\ntool: rm-rf\npath: /\n</tool_use>", surface);
    expect(r._tag).toBe("unparseable");
  });

  it("CLI form is schema-anchored and tagged cli-form", () => {
    const r = parseAssistantToolCalls(fence("bash", "web-search --query 'xrp price' --max-results 3"), surface);
    expect(r._tag).toBe("parsed");
    if (r._tag === "parsed") {
      expect(r.calls[0]!.arguments).toEqual({ query: "xrp price", maxResults: "3" });
      expect(r.calls[0]!.extraction.tier).toBe("cli-form");
    }
  });

  it("CLI form inside a non-shell fence is not read", () => {
    expect(parseAssistantToolCalls(fence("python", "file-read data.csv"), surface)._tag).toBe("none");
  });

  it("a code identifier never resolves by semantic guessing (requests.get is not a tool)", () => {
    const http: readonly ResolverToolHint[] = [{ name: "http-get", paramNames: ["url"], requiredParams: ["url"] }];
    expect(parseAssistantToolCalls(fence("python", 'r = requests.get("https://x.dev")'), http)._tag).toBe("none");
  });
});

describe("parseAssistantToolCalls — embedded form risk gate (D7c)", () => {
  it("an embedded call to a low-risk tool executes, tagged embedded", () => {
    const r = parseAssistantToolCalls(fence("js", 'const t = getTime({ timezone: "UTC" });'), surface);
    expect(r._tag).toBe("parsed");
    if (r._tag === "parsed") {
      expect(r.calls[0]!.name).toBe("get-time");
      expect(r.calls[0]!.extraction.form).toBe("embedded");
    }
  });

  it("an embedded call to a non-low-risk tool is unparseable", () => {
    const r = parseAssistantToolCalls(fence("js", 'const d = await fileRead("data.csv");'), surface);
    expect(r._tag).toBe("unparseable");
  });

  it("a missing riskLevel counts as not-low", () => {
    const bare: readonly ResolverToolHint[] = [{ name: "get-time", paramNames: ["timezone"] }];
    expect(parseAssistantToolCalls(fence("js", 'const t = getTime({ timezone: "UTC" });'), bare)._tag).toBe("unparseable");
  });
});

describe("parseCallArgs — the one argument grammar", () => {
  const cases: [string, string, Record<string, unknown>, string][] = [
    ["empty", "", {}, "empty"],
    ["JSON object", '{"path":"a.txt"}', { path: "a.txt" }, "json"],
    ["lenient: unquoted keys, single quotes, trailing comma", "{ path: 'a.txt', encoding: 'utf-8', }", { path: "a.txt", encoding: "utf-8" }, "lenient-json"],
    ["key: value pairs", 'path: "a.txt", encoding: "utf-8"', { path: "a.txt", encoding: "utf-8" }, "key-value"],
    ["key=value pairs with typed literals", "query=\"x\", maxResults=3", { query: "x", maxResults: 3 }, "key-value"],
    ["single positional to the sole required param", '"a.txt"', { path: "a.txt" }, "positional"],
  ];
  for (const [label, raw, args, argParse] of cases) {
    it(label, () => expect(parseCallArgs(raw, fileRead)).toEqual({ _tag: "ok", args, argParse }));
  }

  const rejects: [string, string][] = [
    ["method-call expression value", "{ path: name.toString() }"],
    ["bare identifier value", "path: dataPath"],
    ["bare identifier positional", "dataPath"],
    ["template with interpolation", "`${dir}/a.txt`"],
    ["concatenation", '"data/" + name'],
    ["two positionals", '"a.txt", "utf-8"'],
  ];
  for (const [label, raw] of rejects) {
    it(`unparseable: ${label}`, () => expect(parseCallArgs(raw, fileRead)._tag).toBe("unparseable"));
  }
});
