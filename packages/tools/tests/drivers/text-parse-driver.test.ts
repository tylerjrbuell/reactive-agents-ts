import { describe, it, expect } from "bun:test"
import { TextParseDriver } from "../../src/drivers/text-parse-driver.js"

const tools = [
  {
    name: "file-read",
    description: "Read a file at the given path",
    parameters: [{ name: "path", type: "string", description: "File path", required: true }],
  },
  {
    name: "web-search",
    description: "Search the web",
    parameters: [{ name: "query", type: "string", description: "Search query", required: true }],
  },
]

const driver = new TextParseDriver()

describe("TextParseDriver", () => {
  it("mode is text-parse", () => {
    expect(driver.mode).toBe("text-parse")
  })

  it("buildPromptInstructions includes tool names and the new format guide", () => {
    const instructions = driver.buildPromptInstructions(tools)
    expect(instructions).toContain("file-read")
    expect(instructions).toContain("web-search")
    expect(instructions).toContain("<tool_use>")
    // Collision pin: the taught text must NEVER contain the host runtime's own
    // qwen tool-call trigger token (Ollama qwen35.go/qwen3coder.go key on it;
    // emitting it poisons the stream -> EOF). See buildPromptInstructions JSDoc.
    expect(instructions).not.toContain("<tool_call>")
    expect(instructions).not.toContain("</tool_call>")
  })
})

describe("Tier 1 — structured XML format", () => {
  it("parses single tool call", () => {
    const text = `I'll read the file.\n<tool_call>\ntool: file-read\npath: /workspace/foo.ts\n</tool_call>`
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("file-read")
    expect(calls[0]?.arguments.path).toBe("/workspace/foo.ts")
    expect(calls[0]?.parseMode).toBe("tier-1")
    expect(calls[0]?.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("parses multiple tool calls in sequence", () => {
    const text = [
      "<tool_call>\ntool: file-read\npath: /foo.ts\n</tool_call>",
      "<tool_call>\ntool: web-search\nquery: typescript generics\n</tool_call>",
    ].join("\n")
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.name).toBe("file-read")
    expect(calls[1]?.name).toBe("web-search")
  })
})

// ─── Tier 1 (wrapper-tolerant): bare param-line blocks ──────────────────────
// W3c measured gap (fixtures/post-w3, qwen2.5-coder:14b): at temp 0 the coder
// emits the taught `tool: <name>` + param lines but DROPS both `<tool_call>`
// wrapper tags, so the wrapped-only tier parsed 0 calls (shadow would-have 0/5;
// act 0/5 executed). These fixtures are the VERBATIM `llm-exchange` response
// bodies from the committed traces (runIds in each test), not a guessed shape.

describe("Tier 1 (wrapper-tolerant): bare param-line blocks", () => {
  // Verbatim head of trace 01M4TYJZZKR32AP7C80HX9SQ4H (w3-shadow-coder14b run 1):
  // two unwrapped file-reads separated by a `---` rule.
  const bareReadsRuleSeparated = [
    "tool: file-read",
    "path: sales-q1.txt",
    "encoding: utf-8",
    "",
    "---",
    "",
    "tool: file-read",
    "path: sales-q2.txt",
    "encoding: utf-8",
  ].join("\n")

  // Verbatim file-write block of trace 01M4TYKSSYR90C7AKYKEM0T5B2 (run 2):
  // a YAML block-scalar `content: |` value with interior blank lines.
  const bareWriteBlockScalar = [
    "tool: file-write",
    "path: report.md",
    "content: |",
    "  ## Summary",
    "  This report summarizes the sales data for the first and second quarters.",
    "",
    "  ## Totals",
    "  - ProductA: 180 (Q1: 100, Q2: 80)",
    "  - ProductB: 270 (Q1: 150, Q2: 120)",
    "  - ProductC: 380 (Q1: 200, Q2: 180)",
    "  - Grand Total: 830",
    "",
    "  ## Recommendation",
    "  ProductA is declining as its revenue decreased from Q1 to Q2.",
    "encoding: utf-8",
  ].join("\n")

  it("parses a bare block with no wrapper tags", () => {
    const calls = driver.extractCalls(bareReadsRuleSeparated, tools)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.name).toBe("file-read")
    expect(calls[0]?.arguments).toEqual({ path: "sales-q1.txt", encoding: "utf-8" })
    expect(calls[1]?.arguments).toEqual({ path: "sales-q2.txt", encoding: "utf-8" })
    // Same tier label as the wrapped path: this IS structured tier-1, tolerant
    // of the wrapper, not of the grammar.
    expect(calls[0]?.parseMode).toBe("tier-1")
    expect(calls[0]?.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("parses a bare block whose param value is a YAML block scalar", () => {
    const calls = driver.extractCalls(bareWriteBlockScalar, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("file-write")
    expect(calls[0]?.arguments.encoding).toBe("utf-8")
    const content = calls[0]?.arguments.content as string
    // Interior blank line preserved; block-scalar indentation stripped; the
    // trailing `encoding: utf-8` line is NOT swallowed into the value. Default
    // `|` clip chomping keeps ONE trailing break (YAML semantics).
    expect(content).toBe(
      [
        "## Summary",
        "This report summarizes the sales data for the first and second quarters.",
        "",
        "## Totals",
        "- ProductA: 180 (Q1: 100, Q2: 80)",
        "- ProductB: 270 (Q1: 150, Q2: 120)",
        "- ProductC: 380 (Q1: 200, Q2: 180)",
        "- Grand Total: 830",
        "",
        "## Recommendation",
        "ProductA is declining as its revenue decreased from Q1 to Q2.",
      ].join("\n") + "\n",
    )
  })

  it("parses interleaved prose + separators + inline `${...}` value (run 1 full shape)", () => {
    // Verbatim structural excerpt of 01M4TYJZZKR32AP7C80HX9SQ4H: two reads,
    // prose with markdown headings/fences in between, then an unwrapped
    // file-write whose `content:` value is an inline template reference.
    const text = [
      "tool: file-read",
      "path: sales-q1.txt",
      "encoding: utf-8",
      "",
      "---",
      "",
      "tool: file-read",
      "path: sales-q2.txt",
      "encoding: utf-8",
      "",
      "---",
      "",
      "Let's assume the content of `sales-q1.txt` is as follows:",
      "",
      "**Step 1: Parse the content of both files.**",
      "",
      "tool: file-write",
      "path: report.md",
      "content: ${reportContent}",
      "encoding: utf-8",
      "",
      "---",
      "",
      "This will generate the `report.md` file.",
    ].join("\n")
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(3)
    expect(calls.map((c) => c.name)).toEqual(["file-read", "file-read", "file-write"])
    expect(calls[2]?.arguments.path).toBe("report.md")
    expect(calls[2]?.arguments.content).toBe("${reportContent}")
    // The bold markdown and prose lines are NOT absorbed as params.
    expect(calls[2]?.arguments["**Step 1"]).toBeUndefined()
  })

  it("tolerates a leading prose line before the first bare block (run 3 shape)", () => {
    const text = [
      "Let's start by reading the contents of both files.",
      "",
      "tool: file-read",
      "path: sales-q1.txt",
      "",
      "---",
      "",
      "tool: file-read",
      "path: sales-q2.txt",
    ].join("\n")
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.arguments).toEqual({ path: "sales-q1.txt" })
    expect(calls[1]?.arguments).toEqual({ path: "sales-q2.txt" })
  })

  it("tolerates a bare block wrapped in a fenced code block", () => {
    const text = [
      "Here is the call:",
      "```",
      "tool: web-search",
      "query: typescript generics",
      "```",
    ].join("\n")
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("web-search")
    expect(calls[0]?.arguments).toEqual({ query: "typescript generics" })
  })

  it("does NOT invent calls from prose that merely contains colons", () => {
    const text = [
      "Note: this is a plan, not a call.",
      "**Step 1: think**",
      "- ProductA: 180",
      "The tool: is useful.",
    ].join("\n")
    expect(driver.extractCalls(text, tools)).toHaveLength(0)
  })

  it("prefers the wrapped taught block when present (unchanged precedence)", () => {
    const text = [
      "<tool_call>\ntool: file-read\npath: /foo.ts\n</tool_call>",
      "tool: web-search",
      "query: should not be reached",
    ].join("\n")
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("file-read")
  })

  // GH #243 pin preserved: the wrapper-tolerant path accepts the SAME taught
  // grammar the builder emits, minus the wrapper tags, derived from the live
  // builder output, never re-typed. If builder and parser drift, this breaks.
  it("accepts the taught example block with its wrapper lines stripped (builder-derived)", () => {
    const built = driver.buildPromptInstructions(tools)
    const match = /<tool_use>\n([\s\S]*?)\n<\/tool_use>/.exec(built)
    expect(match).not.toBeNull()
    const inner = match![1]!
    const calls = driver.extractCalls(inner, tools)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls[0]?.name).toBe("<tool-name>")
    expect(calls[0]?.arguments["<param-name>"]).toBe("<value>")
  })

  // W3c round 2 - delimiter collision fix (Ollama qwen parser trigger).
  it("round 2: the NEW taught `<tool_use>` wrapper round-trips (builder-derived)", () => {
    const built = driver.buildPromptInstructions(tools)
    const match = /<tool_use>\n([\s\S]*?)\n<\/tool_use>/.exec(built)
    expect(match).not.toBeNull()
    const inner = match![1]!
    const wrapped = `<tool_use>\n${inner}\n</tool_use>`
    const calls = driver.extractCalls(wrapped, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("<tool-name>")
    expect(calls[0]?.arguments["<param-name>"]).toBe("<value>")
  })

  it("round 2: the LEGACY `<tool_call>` wrapped form still parses (additive back-compat)", () => {
    const text = "<tool_call>\ntool: file-read\npath: /foo.ts\n</tool_call>"
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("file-read")
    expect(calls[0]?.arguments).toEqual({ path: "/foo.ts" })
  })
})

// ─── Hardening (W3c review round 1) ──────────────────────────────────────────
// Three real corruption paths for the models the bare path exists for.

describe("Tier 1 (wrapper-tolerant): hardening", () => {
  it("indent symmetry: an INDENTED bare block parses WITH its params (not empty args)", () => {
    // Finding 1: TOOL_LINE_RE allowed leading indent but PARAM_LINE_RE anchored
    // at col 0, so a block nested in a numbered explanation opened with {} args.
    const text = [
      "1. First, read the inputs:",
      "   tool: file-read",
      "   path: sales-q1.txt",
      "   encoding: utf-8",
    ].join("\n")
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("file-read")
    expect(calls[0]?.arguments).toEqual({ path: "sales-q1.txt", encoding: "utf-8" })
  })

  it("indented block: a following param at the block indent is NOT swallowed into a block scalar", () => {
    const text = [
      "   tool: file-write",
      "   path: out.md",
      "   content: |",
      "     hello",
      "   encoding: utf-8",
    ].join("\n")
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.arguments.content).toBe("hello\n")
    expect(calls[0]?.arguments.encoding).toBe("utf-8")
  })

  it("mid-param prose ends the list: documented truncation, not a silent prose-skipper", () => {
    // Finding 2: a later param after an interleaved sentence is DROPPED (loud:
    // upstream required-param validation rejects). Genuine in-list prose
    // tolerance was rejected (FP on data-sample lines between blocks).
    const text = [
      "tool: file-write",
      "path: report.md",
      "Here is the content:",
      "content: |",
      "  hello",
      "encoding: utf-8",
    ].join("\n")
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("file-write")
    expect(calls[0]?.arguments).toEqual({ path: "report.md" })
  })

  it("a lone `tool:` line in prose with no params is NOT a call (no empty-args dispatch)", () => {
    // Review minor: the real FP shape. A bare opener without the taught
    // param-line structure must not open a `{}` call (which could execute a
    // no-required-param tool).
    const text = [
      "The model was taught to emit a call, for example:",
      "tool: file-read",
      "and then keep reasoning.",
    ].join("\n")
    expect(driver.extractCalls(text, tools)).toHaveLength(0)
  })

  // ── Finding 3: exact value per block-scalar style + chomping ───────────────
  const scalarWrite = (header: string, bodyLines: readonly string[]): string =>
    [
      "tool: file-write",
      "path: out.md",
      `content: ${header}`,
      ...bodyLines.map((l) => (l === "" ? "" : "  " + l)),
      "encoding: utf-8",
    ].join("\n")
  const contentOf = (text: string): unknown =>
    driver.extractCalls(text, tools)[0]?.arguments.content

  it("`|` literal, default clip: keeps one trailing break", () => {
    expect(contentOf(scalarWrite("|", ["alpha", "beta"]))).toBe("alpha\nbeta\n")
  })

  it("`|-` strip: no trailing break", () => {
    expect(contentOf(scalarWrite("|-", ["alpha", "beta"]))).toBe("alpha\nbeta")
  })

  it("`|+` keep: retains trailing blank line(s)", () => {
    expect(contentOf(scalarWrite("|+", ["alpha", ""]))).toBe("alpha\n\n")
  })

  it("`>` folded, default clip: single breaks fold to spaces, blank line = paragraph break", () => {
    expect(contentOf(scalarWrite(">", ["alpha", "beta", "", "gamma"]))).toBe("alpha beta\ngamma\n")
  })

  it("`>-` folded strip: no trailing break", () => {
    expect(contentOf(scalarWrite(">-", ["alpha", "beta"]))).toBe("alpha beta")
  })
})

describe("Tier 2 — JSON in text", () => {
  it("parses JSON object in prose", () => {
    const text = `Let me call {"tool": "file-read", "path": "/workspace/foo.ts"} to read the file.`
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("file-read")
    expect(calls[0]?.parseMode).toBe("tier-2")
  })
})

describe("Tier 3 — relaxed FC JSON", () => {
  it("parses FC-like array in text", () => {
    const text = `[{"name": "file-read", "arguments": {"path": "/workspace/foo.ts"}}]`
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("file-read")
    expect(calls[0]?.parseMode).toBe("tier-3")
  })
})

describe("rationale extraction (v0.11.x)", () => {
  it("tier-3: captures rationale.why from the call object", () => {
    const text = `[{"name": "web-search", "arguments": {"query": "anthropic"}, "rationale": {"why": "needs fresh data"}}]`
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.rationale?.why).toBe("needs fresh data")
  })

  it("tier-3: captures full rationale with refs/alternatives/confidence", () => {
    const text = `[{
      "name": "web-search",
      "arguments": {"query": "x"},
      "rationale": {
        "why": "fresh data required",
        "refs": ["scratch:goal", "obs:1"],
        "alternatives": [{"option": "use cache", "rejectedBecause": "stale"}],
        "confidence": 0.85
      }
    }]`
    const calls = driver.extractCalls(text, tools)
    expect(calls[0]?.rationale?.refs).toEqual(["scratch:goal", "obs:1"])
    expect(calls[0]?.rationale?.alternatives).toHaveLength(1)
    expect(calls[0]?.rationale?.confidence).toBe(0.85)
  })

  it("tier-3: omits rationale when call has none (backwards-compat)", () => {
    const text = `[{"name": "web-search", "arguments": {"query": "x"}}]`
    const calls = driver.extractCalls(text, tools)
    expect(calls[0]?.rationale).toBeUndefined()
  })

  it("tier-3: drops malformed rationale silently (empty why)", () => {
    const text = `[{"name": "web-search", "arguments": {"query": "x"}, "rationale": {"why": ""}}]`
    const calls = driver.extractCalls(text, tools)
    expect(calls[0]?.rationale).toBeUndefined()
  })

  it("tier-3: truncates rationale with why over 280 chars to 280", () => {
    const long = "x".repeat(281)
    const text = `[{"name": "web-search", "arguments": {"query": "x"}, "rationale": {"why": ${JSON.stringify(long)}}}]`
    const calls = driver.extractCalls(text, tools)
    expect(calls[0]?.rationale?.why).toHaveLength(280)
  })
})

describe("formatToolResult", () => {
  it("formats success result as plain text", () => {
    const formatted = driver.formatToolResult("file-read", "file content here", false)
    expect(formatted).toContain("file content here")
  })

  it("formats error result with error prefix", () => {
    const formatted = driver.formatToolResult("file-read", "not found", true)
    expect(formatted.toLowerCase()).toContain("error")
  })
})
