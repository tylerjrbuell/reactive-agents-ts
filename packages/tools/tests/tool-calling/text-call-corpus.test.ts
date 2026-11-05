// Run: bun test packages/tools/tests/tool-calling/text-call-corpus.test.ts --timeout 15000
//
// Parser corpus (canonical tool-call extraction, D1 + D4 —
// wiki/Architecture/Design-Specs/2026-11-03-canonical-tool-call-extraction.md).
// Every positive is a REAL cogito:8b shape from the H3 traces (RC-2 object
// literal, RC-3 camelCase + shell-fence CLI forms); every negative is a reply
// that must stay an answer. Driven through the public NativeFCStrategy entry
// point the kernel's assistant-turn boundary calls, so it pins end-to-end
// behavior, not a private helper.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { NativeFCStrategy } from "../../src/tool-calling/native-fc-strategy.js";
import type { ResolverToolHint, ToolCallResult } from "../../src/tool-calling/types.js";

const strategy = new NativeFCStrategy();

/** This turn's callable surface, with the schema facts the parser anchors on. */
const surface: readonly ResolverToolHint[] = [
  { name: "file-read", paramNames: ["path", "encoding"], requiredParams: ["path"], riskLevel: "medium" },
  { name: "file-write", paramNames: ["path", "content", "encoding"], requiredParams: ["path", "content"], riskLevel: "medium" },
  { name: "web-search", paramNames: ["query", "maxResults"], requiredParams: ["query"], riskLevel: "medium" },
];

const resolve = (content: string): ToolCallResult =>
  Effect.runSync(strategy.resolve({ content, stopReason: "end_turn" }, surface));

const fence = (lang: string, body: string): string => "```" + lang + "\n" + body + "\n```";

describe("text-call corpus — real cogito shapes parse to typed args", () => {
  const positives: [string, string, string, Record<string, unknown>][] = [
    ["RC-2 object literal (double quotes)", fence("javascript", 'file-read({ path: "data/sales.csv", encoding: "utf-8" })'), "file-read", { path: "data/sales.csv", encoding: "utf-8" }],
    ["RC-2 object literal (single quotes)", fence("javascript", "file-read({ path: 'data/sales.csv' })"), "file-read", { path: "data/sales.csv" }],
    ["RC-3 camelCase name", fence("javascript", 'fileRead({ path: "data/sales.csv" })'), "file-read", { path: "data/sales.csv" }],
    ["RC-3 CLI key=value in shell fence", fence("bash", 'file-read path="data/sales.csv"'), "file-read", { path: "data/sales.csv" }],
    ["RC-3 CLI single positional to the sole required param", fence("bash", "file-read /home/user/data/sales.csv"), "file-read", { path: "/home/user/data/sales.csv" }],
    ["RC-3 CLI --path flag", fence("sh", "file-read --path data/sales.csv"), "file-read", { path: "data/sales.csv" }],
    ["fenced JSON call", fence("json", '{"name":"file-read","arguments":{"path":"data/sales.csv"}}'), "file-read", { path: "data/sales.csv" }],
    ["call form with key: value pairs", fence("javascript", 'web-search(query: "XRP price", maxResults: 1)'), "web-search", { query: "XRP price", maxResults: 1 }],
    ["single positional literal to the sole required param", fence("python", 'file-read("data/sales.csv")'), "file-read", { path: "data/sales.csv" }],
    ["two positional literals bind in declared order", fence("javascript", 'fileRead("/abs/sales.csv", "utf-8")'), "file-read", { path: "/abs/sales.csv", encoding: "utf-8" }],
  ];
  for (const [label, content, name, args] of positives) {
    it(label, () => {
      const r = resolve(content);
      expect(r._tag).toBe("tool_calls");
      if (r._tag === "tool_calls") {
        expect(r.calls).toHaveLength(1);
        expect(r.calls[0]!.name).toBe(name);
        expect(r.calls[0]!.arguments).toEqual(args);
      }
    });
  }
});

describe("text-call corpus — tool-call-shaped but unparseable reprompts, never executes", () => {
  const unparseable: [string, string][] = [
    ["embedded assignment of an effectful tool", fence("javascript", 'const data = fileRead("data/sales.csv");\nconst mean = average(data);')],
    ["non-literal expression value", fence("javascript", 'file-write({ path: "out.txt", content: roundedMean.toString() })')],
    ["CLI flag that is not a declared param", fence("bash", "file-read --recursive data")],
    ["positional to a tool with two required params", fence("javascript", 'file-write("out.txt")')],
    ["embedded two-positional call to an effectful tool (D7c gate still holds)", fence("javascript", 'const x = fileRead("/abs/sales.csv", "utf-8");')],
    ["surplus positional beyond declared params", fence("javascript", 'fileRead("/abs/sales.csv", "utf-8", "extra")')],
  ];
  for (const [label, content] of unparseable) {
    it(label, () => {
      const r = resolve(content);
      expect(r._tag).toBe("thinking");
      if (r._tag === "thinking") expect(r.reason).toBe("unresolved-tool-call");
    });
  }

  it("an embedded effectful call with literal args reprompts with the exact standalone call to restate", () => {
    const r = resolve(fence("javascript", 'const x = fileRead("/abs/a.txt", "utf-8");'));
    expect(r._tag).toBe("thinking");
    if (r._tag !== "thinking") return;
    expect(r.reason).toBe("unresolved-tool-call");
    expect(r.content).toContain('call it on its own: file-read {"path":"/abs/a.txt","encoding":"utf-8"}');
  });

  it("an embedded effectful call with non-literal args keeps the arg reason and names no args", () => {
    const r = resolve(fence("javascript", "const x = fileRead(dataPath);"));
    expect(r._tag).toBe("thinking");
    if (r._tag !== "thinking") return;
    expect(r.content).not.toContain("call it on its own:");
    expect(r.content).not.toContain('{"path"');
  });

  it("the reprompt hint names the tool and its params", () => {
    const r = resolve(fence("javascript", 'file-write({ path: "out.txt", content: roundedMean.toString() })'));
    expect(r._tag).toBe("thinking");
    if (r._tag === "thinking") {
      expect(r.content).toContain("file-write");
      expect(r.content).toContain("path");
      expect(r.content).toContain("content");
    }
  });
});

describe("text-call corpus — negatives stay answers", () => {
  const negatives: [string, string][] = [
    ["JSON answer", '{"result":180}'],
    ["code-answer fence", fence("python", "import statistics\nprint(statistics.mean([1, 2, 3]))")],
    ["shell code answer with no tool", fence("bash", "ls -la data/")],
    ["prose naming a tool", "I used file-read to open data/sales.csv and the mean is 21.83."],
    ["prose with a call mid-sentence", 'I would call file-read(path: "x") here, then report the mean.'],
  ];
  for (const [label, content] of negatives) {
    it(label, () => expect(resolve(content)._tag).toBe("final_answer"));
  }
});

describe("D4 pin — a text-sourced literal is never stringified into an argument", () => {
  // RC-2: the old pseudo-arg path kept `{ path: "x" }` as an `input` STRING,
  // which the structure healer then remapped into `path` (ENOENT). Every call
  // the parser emits must carry typed values only — never a serialized
  // argument literal under any key.
  const corpus = [
    fence("javascript", 'file-read({ path: "data/sales.csv", encoding: "utf-8" })'),
    fence("javascript", "file-read({ path: 'data/sales.csv' })"),
    fence("javascript", 'fileRead({ path: "data/sales.csv" })'),
    fence("javascript", 'file-write({ path: "out.txt", content: roundedMean.toString() })'),
    fence("javascript", "file-read(dataPath)"),
  ];
  for (const content of corpus) {
    it(`no literal leak: ${content.split("\n")[1]}`, () => {
      const r = resolve(content);
      if (r._tag !== "tool_calls") return;
      for (const c of r.calls) {
        expect("input" in c.arguments).toBe(false);
        for (const v of Object.values(c.arguments)) {
          if (typeof v === "string") expect(/^\s*[{(]/.test(v)).toBe(false);
        }
      }
    });
  }
});
