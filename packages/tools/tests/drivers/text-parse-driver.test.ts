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
