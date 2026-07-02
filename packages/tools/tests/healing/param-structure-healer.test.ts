import { describe, it, expect } from "bun:test"
import {
  unwrapWrappedArgs,
  remapSingleMissingRequired,
} from "../../src/healing/param-structure-healer.js"
import { runHealingPipeline } from "../../src/healing/healing-pipeline.js"
import type { ToolCallSpec } from "../../src/tool-calling/types.js"

// Live-bench evidenced schema (public-competitor-bench 2026-07-02, rw-8):
// file-write(path, content, encoding?) — models nested args under `input`.
const fileWriteSchema = {
  name: "file-write",
  description: "Write file",
  parameters: [
    { name: "path", type: "string", description: "File path", required: true },
    { name: "content", type: "string", description: "Content", required: true },
    { name: "encoding", type: "string", description: "Encoding", required: false },
  ],
}

describe("unwrapWrappedArgs — shape A: args nested under wrapper key", () => {
  it("unwraps {input:{path,content}} to top level", () => {
    const result = unwrapWrappedArgs(
      { input: { path: "foo.txt", content: "hello" } },
      fileWriteSchema,
    )
    expect(result.healed).toEqual({ path: "foo.txt", content: "hello" })
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toEqual({
      stage: "param-structure",
      from: "input",
      to: "path,content",
    })
  })

  it("unwraps `args` wrapper", () => {
    const result = unwrapWrappedArgs(
      { args: { path: "foo.txt", content: "hello" } },
      fileWriteSchema,
    )
    expect(result.healed).toEqual({ path: "foo.txt", content: "hello" })
    expect(result.actions[0]?.stage).toBe("param-structure")
  })

  it("unwraps `params` and `arguments` wrappers", () => {
    for (const wrapper of ["params", "arguments"]) {
      const result = unwrapWrappedArgs(
        { [wrapper]: { path: "foo.txt", content: "hello" } },
        fileWriteSchema,
      )
      expect(result.healed).toEqual({ path: "foo.txt", content: "hello" })
    }
  })

  it("merges with sibling top-level args without overwriting them", () => {
    const result = unwrapWrappedArgs(
      { input: { path: "foo.txt", content: "nested" }, content: "top" },
      fileWriteSchema,
    )
    expect(result.healed).toEqual({ path: "foo.txt", content: "top" })
  })

  it("NEGATIVE: wrapper object whose keys do NOT match schema → untouched", () => {
    const args = { input: { foo: 1, bar: 2 } }
    const result = unwrapWrappedArgs(args, fileWriteSchema)
    expect(result.healed).toEqual(args)
    expect(result.actions).toHaveLength(0)
  })

  it("NEGATIVE: wrapper object with a partially unknown key → untouched", () => {
    const args = { input: { path: "foo.txt", junk: 1 } }
    const result = unwrapWrappedArgs(args, fileWriteSchema)
    expect(result.healed).toEqual(args)
    expect(result.actions).toHaveLength(0)
  })

  it("NEGATIVE: wrapper key that IS a schema param → untouched", () => {
    const schema = {
      name: "echo",
      description: "Echo",
      parameters: [{ name: "input", type: "object", description: "", required: true }],
    }
    const args = { input: { input: {} } }
    const result = unwrapWrappedArgs(args, schema)
    expect(result.healed).toEqual(args)
    expect(result.actions).toHaveLength(0)
  })

  it("NEGATIVE: non-object wrapper value → untouched", () => {
    const args = { input: "foo.txt" }
    const result = unwrapWrappedArgs(args, fileWriteSchema)
    expect(result.healed).toEqual(args)
    expect(result.actions).toHaveLength(0)
  })

  it("NEGATIVE: empty wrapper object → untouched", () => {
    const args = { input: {} }
    const result = unwrapWrappedArgs(args, fileWriteSchema)
    expect(result.healed).toEqual(args)
    expect(result.actions).toHaveLength(0)
  })

  it("NEGATIVE: two qualifying wrapper keys (ambiguous) → untouched", () => {
    const args = {
      input: { path: "a.txt", content: "x" },
      args: { path: "b.txt", content: "y" },
    }
    const result = unwrapWrappedArgs(args, fileWriteSchema)
    expect(result.healed).toEqual(args)
    expect(result.actions).toHaveLength(0)
  })
})

describe("remapSingleMissingRequired — shape B: one missing required + one unknown", () => {
  it("remaps {filename, content} → {path, content}", () => {
    const result = remapSingleMissingRequired(
      { filename: "foo.txt", content: "hello" },
      fileWriteSchema,
    )
    expect(result.healed).toEqual({ path: "foo.txt", content: "hello" })
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toEqual({ stage: "param-name", from: "filename", to: "path" })
  })

  it("NEGATIVE: multiple missing required → untouched", () => {
    const args = { destination: "foo.txt" } // missing path AND content
    const result = remapSingleMissingRequired(args, fileWriteSchema)
    expect(result.healed).toEqual(args)
    expect(result.actions).toHaveLength(0)
  })

  it("NEGATIVE: multiple unknown params → untouched (ambiguous)", () => {
    const args = { filename: "foo.txt", body: "x", content: "hello" }
    const result = remapSingleMissingRequired(args, fileWriteSchema)
    expect(result.healed).toEqual(args)
    expect(result.actions).toHaveLength(0)
  })

  it("NEGATIVE: unknown param of incompatible type → untouched", () => {
    const args = { filename: 42, content: "hello" } // path expects string
    const result = remapSingleMissingRequired(args, fileWriteSchema)
    expect(result.healed).toEqual(args)
    expect(result.actions).toHaveLength(0)
  })

  it("NEGATIVE: nothing missing → untouched even with unknown extra", () => {
    const args = { path: "foo.txt", content: "hello", extra: "x" }
    const result = remapSingleMissingRequired(args, fileWriteSchema)
    expect(result.healed).toEqual(args)
    expect(result.actions).toHaveLength(0)
  })
})

// ── Pipeline integration: the evidenced live-bench failure shapes ────────────

const registeredTools = [fileWriteSchema]
const fileToolNames = new Set(["file-write"])
const workingDir = "/workspace"

describe("runHealingPipeline — structural healing integration", () => {
  it("heals the evidenced qwen3 shape: file-write({input:{path,content}})", () => {
    const call: ToolCallSpec = {
      id: "1",
      name: "file-write",
      arguments: { input: { path: "report.md", content: "# hi" } },
    }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, {}, {})
    expect(result.succeeded).toBe(true)
    // Unwrapped AND path-resolved (unwrap runs before the path stage)
    expect(result.call.arguments).toEqual({
      path: "/workspace/report.md",
      content: "# hi",
    })
    expect(result.actions.some((a) => a.stage === "param-structure")).toBe(true)
  })

  it("heals single-missing-required remap, then resolves the path", () => {
    const call: ToolCallSpec = {
      id: "1",
      name: "file-write",
      arguments: { filename: "report.md", content: "# hi" },
    }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, {}, {})
    expect(result.call.arguments).toEqual({
      path: "/workspace/report.md",
      content: "# hi",
    })
    expect(
      result.actions.some((a) => a.stage === "param-name" && a.from === "filename" && a.to === "path"),
    ).toBe(true)
  })

  it("remap runs AFTER alias healing: alias resolves first, no false remap", () => {
    // `file` aliases to `path`; the unknown `mood` must NOT be remapped to content
    // because after aliasing only `content` is missing and `mood` is incompatible? —
    // here content IS missing and mood is a string, so remap fills it deterministically.
    // Instead verify the alias path: {file, content} needs no remap at all.
    const call: ToolCallSpec = {
      id: "1",
      name: "file-write",
      arguments: { file: "report.md", content: "# hi" },
    }
    const paramAliases = { "file-write": { file: "path" } }
    const result = runHealingPipeline(
      call, registeredTools, fileToolNames, workingDir, {}, paramAliases,
    )
    expect(result.call.arguments).toEqual({
      path: "/workspace/report.md",
      content: "# hi",
    })
    expect(result.actions.some((a) => a.stage === "param-name" && a.from === "file")).toBe(true)
  })

  it("well-formed call still passes through with zero actions", () => {
    const call: ToolCallSpec = {
      id: "1",
      name: "file-write",
      arguments: { path: "/workspace/report.md", content: "# hi" },
    }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, {}, {})
    expect(result.call.arguments).toEqual({ path: "/workspace/report.md", content: "# hi" })
    expect(result.actions).toHaveLength(0)
  })
})
