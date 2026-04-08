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
})
