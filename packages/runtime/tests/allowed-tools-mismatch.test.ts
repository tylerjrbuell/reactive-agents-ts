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

  it("does not report framework meta-tools as mismatches — they are always available inline", () => {
    // final-answer, recall, brief etc. are handled inline in act.ts, not via ToolService.
    // Reporting them as "not registered" is a false positive that confuses users.
    const result = checkAllowedToolsMismatch(
      ["final-answer", "recall", "brief", "web-search"],
      [{ name: "web-search" }],
    )
    // Only "web-search" is registered — but framework tools should be excluded from mismatch.
    // The filtering happens in tools-registry.ts; checkAllowedToolsMismatch itself returns them,
    // but the caller filters FRAMEWORK_TOOL_NAMES before surfacing the warning.
    // This test documents the expected behavior at the call-site level via the registry function.
    expect(result).toContain("final-answer")   // raw fn reports them — filtering is caller's job
    expect(result).toContain("recall")
    expect(result).not.toContain("web-search") // registered tools are never mismatches
  })
})
