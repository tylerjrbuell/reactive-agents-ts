// Seam pin: healing/literal-newlines.ts, the literal backslash-n repair for
// prose file content. Direct import so a behavior change here lands with this pin.
// Witness: tool-result budget spike 2026-11-07, gpt-4o-mini lh-1 wrote
// report.md / sources.md as one line with literal "\n" between URLs.
import { describe, it, expect } from "bun:test"
import { isTextFilePath, TEXT_FILE_EXTENSIONS, unescapeLiteralNewlines } from "../../src/healing/literal-newlines.js"
import { isJsonFilePath } from "../../src/healing/json-repair.js"

describe("unescapeLiteralNewlines", () => {
  it("unescapes the live witness: markdown with literal \\n between URL lines", () => {
    const witness = "# Sources\\n\\n- https://a.example/x\\n- https://b.example/y\\n"
    const r = unescapeLiteralNewlines(witness)
    expect(r).toEqual({ text: "# Sources\n\n- https://a.example/x\n- https://b.example/y\n", count: 4 })
  })

  it("unescapes \\r\\n to one newline and \\t to a tab", () => {
    const r = unescapeLiteralNewlines("a\\r\\nb\\tc\\nd")
    expect(r).toEqual({ text: "a\nb\tc\nd", count: 3 })
  })

  it("leaves other backslashes alone, including an escaped backslash before n", () => {
    const r = unescapeLiteralNewlines("C:\\\\new\\nline \\d+\\nend")
    expect(r).toEqual({ text: "C:\\\\new\nline \\d+\nend", count: 2 })
  })

  it("CONTROL: content with any real newline is untouched", () => {
    expect(unescapeLiteralNewlines("line one\nliteral \\n here \\n there")).toBeUndefined()
  })

  it("CONTROL: a single literal \\n is untouched", () => {
    expect(unescapeLiteralNewlines("use \\n to break a line")).toBeUndefined()
  })

  it("CONTROL: tabs alone never trigger it", () => {
    expect(unescapeLiteralNewlines("a\\tb\\tc")).toBeUndefined()
  })
})

describe("isTextFilePath", () => {
  it("matches prose extensions case-insensitively and nothing else", () => {
    for (const p of ["/w/report.md", "/w/R.MD", "/w/a.txt", "/w/a.markdown", "/w/a.rst", "/w/a.csv"]) {
      expect(isTextFilePath(p)).toBe(true)
    }
    for (const p of ["/w/a.ts", "/w/a.json", "/w/a.py", "/w/md", "/w.md/readme"]) {
      expect(isTextFilePath(p)).toBe(false)
    }
    expect(TEXT_FILE_EXTENSIONS.has(".json")).toBe(false)
  })

  it("the shared extension helper keeps isJsonFilePath behavior", () => {
    expect(isJsonFilePath("/w/out.json")).toBe(true)
    expect(isJsonFilePath("/w.json/readme")).toBe(false)
    expect(isJsonFilePath("noext")).toBe(false)
  })
})
