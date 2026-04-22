import { describe, it, expect } from "bun:test"
import { runHealingPipeline } from "../../src/healing/healing-pipeline.js"
import type { ToolCallSpec } from "../../src/tool-calling/types.js"

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
