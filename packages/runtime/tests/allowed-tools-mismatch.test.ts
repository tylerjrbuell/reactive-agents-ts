import { describe, it, expect } from "bun:test"
import { checkAllowedToolsMismatch } from "../src/index.js"

describe("checkAllowedToolsMismatch", () => {
  it("returns empty array when all allowed tools match registered", () => {
    const result = checkAllowedToolsMismatch(
      ["web-search", "read-file"],
      [{ name: "web-search" }, { name: "read-file" }, { name: "write-file" }],
    )
    expect(result).toEqual([])
  })

  it("returns mismatched names when allowed tools not in registry", () => {
    const result = checkAllowedToolsMismatch(
      ["web-search", "get-library-content"],
      [{ name: "web-search" }, { name: "get-library-docs" }],
    )
    expect(result).toEqual(["get-library-content"])
  })

  it("returns all mismatches when none match", () => {
    const result = checkAllowedToolsMismatch(
      ["foo", "bar"],
      [{ name: "baz" }],
    )
    expect(result).toEqual(["foo", "bar"])
  })

  it("returns empty array for empty allowedTools", () => {
    const result = checkAllowedToolsMismatch([], [{ name: "web-search" }])
    expect(result).toEqual([])
  })

  it("tolerates whitespace typos in allowedTools entries", () => {
    // User may write `['recall', ' get-hn-posts']` (leading space) — the runtime
    // filter trims entries, so the mismatch check must match that behavior or
    // users see a false-positive warning about a tool that works fine.
    const result = checkAllowedToolsMismatch(
      [" recall", "get-hn-posts  "],
      [{ name: "recall" }, { name: "get-hn-posts" }],
    )
    expect(result).toEqual([])
  })
})
