import { describe, it, expect } from "bun:test"
import { resolvePaths, coerceTypes } from "../../src/healing/path-resolver.js"

const fileTools = new Set(["file-read", "file-write", "code-execute"])
const workingDir = "/workspace/project"

describe("resolvePaths", () => {
  it("relative path resolved against working dir", () => {
    const result = resolvePaths("file-read", { path: "src/main.ts" }, fileTools, workingDir)
    expect(result.healed.path).toBe("/workspace/project/src/main.ts")
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]?.stage).toBe("path")
  })

  it("absolute path within working dir unchanged", () => {
    const result = resolvePaths("file-read", { path: "/workspace/project/src/main.ts" }, fileTools, workingDir)
    expect(result.healed.path).toBe("/workspace/project/src/main.ts")
    expect(result.actions).toHaveLength(0)
  })

  // F9 (09-UNIFIED-PROGRAM.md §6.6): the healer used to silently rewrite an
  // out-of-root absolute path to `<workingDir>/<basename>` BEFORE the tool
  // ever ran. The tool then wrote successfully at the rewritten path, but
  // terminal verification checked the path the model originally referenced
  // and reported the run FAILED next to a file that was written correctly.
  // The single confinement authority is file-operations.ts's own
  // `Path traversal detected:` throw — the healer must not pre-empt it by
  // rewriting the argument. An out-of-root absolute path must pass through
  // unchanged so that throw is what actually fires.
  it("out-of-root absolute path passes through unchanged (no silent remap)", () => {
    const result = resolvePaths("file-read", { path: "/home/user/projects/main.ts" }, fileTools, workingDir)
    expect(result.healed.path).toBe("/home/user/projects/main.ts")
    expect(result.actions).toHaveLength(0)
  })

  it("non-file tool paths not modified", () => {
    const result = resolvePaths("web-search", { query: "/some/path" }, fileTools, workingDir)
    expect(result.healed.query).toBe("/some/path")
    expect(result.actions).toHaveLength(0)
  })

  it("tilde expansion resolved", () => {
    const result = resolvePaths("file-read", { path: "~/foo.ts" }, fileTools, workingDir)
    expect(result.healed.path).not.toContain("~")
  })
})

describe("coerceTypes", () => {
  const schema = {
    name: "tool",
    description: "",
    parameters: [
      { name: "count", type: "number", description: "", required: true },
      { name: "active", type: "boolean", description: "", required: false },
    ],
  }

  it("string to number coercion", () => {
    const result = coerceTypes({ count: "5" }, schema)
    expect(result.healed.count).toBe(5)
    expect(result.actions[0]?.stage).toBe("type-coerce")
  })

  it("string to boolean coercion", () => {
    const result = coerceTypes({ active: "true" }, schema)
    expect(result.healed.active).toBe(true)
  })

  it("already correct types unchanged", () => {
    const result = coerceTypes({ count: 5 }, schema)
    expect(result.healed.count).toBe(5)
    expect(result.actions).toHaveLength(0)
  })
})
