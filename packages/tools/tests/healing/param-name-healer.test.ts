import { describe, it, expect } from "bun:test"
import { healParamNames } from "../../src/healing/param-name-healer.js"

const fileReadSchema = {
  name: "file-read",
  description: "Read file",
  parameters: [
    { name: "path", type: "string", description: "File path", required: true },
    { name: "encoding", type: "string", description: "Encoding", required: false },
  ],
}

// cogito:8b alias map for file-read: "input" → "path"
const aliases = { "file-read": { input: "path", file: "path" } }

describe("healParamNames", () => {
  it("exact param names returned unchanged", () => {
    const result = healParamNames("file-read", { path: "/foo.ts" }, fileReadSchema, aliases)
    expect(result.healed).toEqual({ path: "/foo.ts" })
    expect(result.actions).toHaveLength(0)
  })

  it("alias map resolves input → path for file-read", () => {
    const result = healParamNames("file-read", { input: "/foo.ts" }, fileReadSchema, aliases)
    expect(result.healed).toEqual({ path: "/foo.ts" })
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toEqual({ stage: "param-name", from: "input", to: "path" })
  })

  it("edit-distance resolves minor typo", () => {
    const result = healParamNames("file-read", { pth: "/foo.ts" }, fileReadSchema, {})
    expect(result.healed).toEqual({ path: "/foo.ts" })
    expect(result.actions[0]?.stage).toBe("param-name")
  })

  it("unknown param preserved as-is", () => {
    const result = healParamNames("file-read", { unknownXyzzy: "val" }, fileReadSchema, {})
    expect(result.healed).toHaveProperty("unknownXyzzy")
  })

  it("multiple params healed independently", () => {
    const result = healParamNames(
      "file-read",
      { input: "/foo.ts", file: "/bar.ts" },
      fileReadSchema,
      aliases,
    )
    // First alias wins for path; second alias for same target is a no-op (already filled)
    expect(Object.keys(result.healed)).toContain("path")
  })
})
