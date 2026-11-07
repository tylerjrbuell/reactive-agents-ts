import { describe, it, expect } from "bun:test"
import { runHealingPipeline } from "../../src/healing/healing-pipeline.js"
import type { ToolCallSpec } from "../../src/tool-calling/types.js"
import { fileWriteTool } from "../../src/skills/file-operations.js"

const registeredTools = [
  {
    name: "file-read",
    description: "Read file",
    parameters: [{ name: "path", type: "string", description: "", required: true }],
  },
  {
    name: "code-execute",
    description: "Run code",
    parameters: [{ name: "code", type: "string", description: "", required: true }],
  },
]

const fileToolNames = new Set(["file-read", "file-write", "code-execute"])
const workingDir = "/workspace"

describe("runHealingPipeline", () => {
  it("exact call passes through unchanged", () => {
    const call: ToolCallSpec = { id: "1", name: "file-read", arguments: { path: "/workspace/foo.ts" } }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, {}, {})
    expect(result.call.name).toBe("file-read")
    expect(result.call.arguments.path).toBe("/workspace/foo.ts")
    expect(result.actions).toHaveLength(0)
    expect(result.succeeded).toBe(true)
  })

  it("tool name alias healed", () => {
    const call: ToolCallSpec = { id: "1", name: "typescript/compile", arguments: { code: "const x = 1" } }
    const aliases = { "typescript/compile": "code-execute" }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, aliases, {})
    expect(result.call.name).toBe("code-execute")
    expect(result.actions.some((a) => a.stage === "tool-name")).toBe(true)
  })

  it("param name alias healed using CalibrationStore map", () => {
    const call: ToolCallSpec = { id: "1", name: "file-read", arguments: { input: "src/main.ts" } }
    const paramAliases = { "file-read": { input: "path" } }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, {}, paramAliases)
    expect(result.call.arguments.path).toBe("/workspace/src/main.ts") // path healed + resolved
    expect(result.actions.some((a) => a.stage === "param-name")).toBe(true)
  })

  it("unresolvable tool name returns succeeded=false", () => {
    const call: ToolCallSpec = { id: "1", name: "totally-unknown-xyzzy-9999", arguments: {} }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, {}, {})
    expect(result.succeeded).toBe(false)
  })
})

// Value-shape stage: a JSON value sent to a `file-content` parameter becomes
// its JSON text (bench lh-1, qwen3:4b, 2026-11-06: 40 of 123 .json writes were
// refused for double-escaping errors in JSON nested inside a JSON string).
// Keyed by the parameter's declared semantic, never by tool name.
// RED-ON-CUT: drop stage 3b from runHealingPipeline and the JSON-value cases fail.
describe("runHealingPipeline value-shape stage (file-content)", () => {
  const heal = (content: unknown) =>
    runHealingPipeline(
      { id: "1", name: "file-write", arguments: { path: "/workspace/out.json", content } },
      [fileWriteTool], fileToolNames, workingDir, {}, {},
    )

  it("file-write declares content as file-content", () => {
    const content = fileWriteTool.parameters.find((p) => p.name === "content")
    expect(content?.semantic).toBe("file-content")
    expect(content?.type).toBe("string")
  })

  it("serializes an object as 2-space JSON plus a newline and records the action", () => {
    const value = { question: 'What is the "component model"?', n: 2 }
    const result = heal(value)
    expect(result.call.arguments.content).toBe(`${JSON.stringify(value, null, 2)}\n`)
    expect(result.actions).toContainEqual({ stage: "value-shape", from: "content:object", to: "content:json-text" })
  })

  it("serializes an array", () => {
    const value = [{ name: "LanceDB" }, { name: "Qdrant" }]
    expect(heal(value).call.arguments.content).toBe(`${JSON.stringify(value, null, 2)}\n`)
  })

  it("serializes number and boolean as JSON text (before the type coercer)", () => {
    expect(heal(42).call.arguments.content).toBe("42\n")
    expect(heal(true).call.arguments.content).toBe("true\n")
  })

  it("leaves null alone, so it stays a missing-parameter error", () => {
    const result = heal(null)
    expect(result.call.arguments.content).toBeNull()
    expect(result.actions.some((a) => a.stage === "value-shape")).toBe(false)
  })

  it("CONTROL: a string is untouched byte-for-byte and records no value-shape action", () => {
    const text = '{"a":1,  "b":[2]}'
    const result = heal(text)
    expect(result.call.arguments.content).toBe(text)
    expect(result.actions.some((a) => a.stage === "value-shape")).toBe(false)
  })

  it("CONTROL: a parameter without the semantic is never reshaped", () => {
    const call: ToolCallSpec = { id: "1", name: "code-execute", arguments: { code: { a: 1 } } }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, {}, {})
    expect(result.call.arguments.code).toEqual({ a: 1 })
    expect(result.actions.some((a) => a.stage === "value-shape")).toBe(false)
  })
})

// Leverage scan 2026-11-07 item 1: 41 of 46 refused .json contents carried a
// quote copied from the task text. The value-shape stage escapes those quotes
// (json-repair.ts repairJsonQuotes) so file-write saves valid JSON.
// RED-ON-CUT: drop the string branch in healValueShapes and the repair case fails.
describe("runHealingPipeline value-shape stage: .json quote repair", () => {
  const heal = (path: string, content: unknown) =>
    runHealingPipeline(
      { id: "1", name: "file-write", arguments: { path, content } },
      [fileWriteTool], fileToolNames, workingDir, {}, {},
    )

  it("escapes unescaped inner quotes in a .json string content and records the action", () => {
    const witness = '{"q": "What is the "component model"?"}'
    const result = heal("/workspace/out.json", witness)
    const content = result.call.arguments.content as string
    expect(JSON.parse(content)).toEqual({ q: 'What is the "component model"?' })
    expect(content.replace(/\\"/g, '"')).toBe(witness)
    expect(result.actions).toContainEqual({
      stage: "value-shape",
      from: "content:invalid-json",
      to: "content:json-quotes-escaped(2)",
    })
  })

  it("CONTROL: a non-.json path keeps the broken string as written", () => {
    const text = '{"q": "the "x" model"}'
    const result = heal("/workspace/notes.txt", text)
    expect(result.call.arguments.content).toBe(text)
    expect(result.actions.some((a) => a.stage === "value-shape")).toBe(false)
  })

  it("CONTROL: a trailing comma is not a quote defect and stays for file-write to refuse", () => {
    const text = '{"a": 1,}'
    const result = heal("/workspace/out.json", text)
    expect(result.call.arguments.content).toBe(text)
    expect(result.actions.some((a) => a.stage === "value-shape")).toBe(false)
  })
})
