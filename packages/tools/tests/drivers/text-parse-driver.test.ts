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

  it("buildPromptInstructions includes tool names and format guide", () => {
    const instructions = driver.buildPromptInstructions(tools)
    expect(instructions).toContain("file-read")
    expect(instructions).toContain("web-search")
    expect(instructions).toContain("<tool_call>")
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
