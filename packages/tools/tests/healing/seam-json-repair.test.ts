// Seam pin: healing/json-repair.ts, the one JSON repair primitive in tools.
// Direct import so a behavior change here lands with this pin.
import { describe, it, expect } from "bun:test"
import { isJsonFilePath, repairJsonLenient, repairJsonQuotes } from "../../src/healing/json-repair.js"
import { parseLenient } from "../../src/tool-calling/lenient-json.js"
import { writeContentRejection } from "../../src/skills/file-operations.js"

/** Drop backslashes that sit before a double quote. */
const unescapeQuotes = (s: string): string => s.replace(/\\"/g, '"')

describe("repairJsonQuotes (deliverable content)", () => {
  it("repairs the live witness: an unescaped quoted phrase inside a string value", () => {
    const witness = '{"q": "What is the "component model"?"}'
    const r = repairJsonQuotes(witness)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual({ q: 'What is the "component model"?' })
    expect(unescapeQuotes(r.text)).toBe(witness)
    expect(r.edits).toEqual([
      { kind: "escape-quote", at: witness.indexOf('"component') },
      { kind: "escape-quote", at: witness.indexOf('"?"') },
    ])
  })

  it("repairs a benchmark shape: array of objects, several fields, quote then comma", () => {
    const text =
      '[{"id": "Q1", "question": "What is the WASI Preview 2 "component model", what does it add?", "answer": "It adds "worlds"."}]\n'
    const r = repairJsonQuotes(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value).toEqual([
      {
        id: "Q1",
        question: 'What is the WASI Preview 2 "component model", what does it add?',
        answer: 'It adds "worlds".',
      },
    ])
  })

  it("returns valid JSON untouched with zero edits", () => {
    const text = '{"a": "say \\"hi\\"", "b": [1, 2]}'
    const r = repairJsonQuotes(text)
    expect(r).toEqual({ ok: true, value: { a: 'say "hi"', b: [1, 2] }, text, edits: [] })
  })

  it("refuses an ambiguous case: two escape sets both parse", () => {
    // Parses as ["a \"b", 1, "c"] AND as ["a \"b\", 1, \"c"]; no visible
    // `", "` separator or key pins either reading.
    expect(repairJsonQuotes('["a "b", 1, "c"]')).toEqual({ ok: false, reason: "ambiguous" })
  })

  it("a visible quote-comma-quote separator is structural, so string arrays stay unambiguous", () => {
    const r = repairJsonQuotes('["a "b", "c"]')
    expect(r.ok && r.value).toEqual(['a "b', "c"])
  })

  it("refuses when the only repair would swallow a key the input visibly declares", () => {
    // The one parse is {"note": "use, \"id\": 5 here"}: it hides the visible key "id".
    const r = repairJsonQuotes('{"note": "use, "id": 5 here"}')
    expect(r.ok).toBe(false)
  })

  it("never lets an earlier value swallow a later visible key (no false ambiguity)", () => {
    const r = repairJsonQuotes('{"a": "x "y" z", "b": "w"}')
    expect(r.ok && r.value).toEqual({ a: 'x "y" z', b: "w" })
  })

  it("refuses non-quote defects: trailing comma, single quotes, truncation, prose", () => {
    for (const text of ['{"a": 1,}', "{'a': 1}", '{"a": [1, 2', "Here is the file: {}"]) {
      expect(repairJsonQuotes(text)).toEqual({ ok: false, reason: "unrepairable" })
    }
  })
})

describe("repairJsonLenient (tool-call arguments) keeps lenient-json behavior", () => {
  it("drops trailing commas, converts single quotes, closes truncation", () => {
    expect(parseLenient("{'a': 1, 'b': [2,],}")).toEqual({ a: 1, b: [2] })
    expect(parseLenient('{"a": [1, 2')).toEqual({ a: [1, 2] })
    const r = repairJsonLenient("{'a': 1,}")
    expect(r.ok && r.edits.map((e) => e.kind)).toEqual(["single-quote", "drop-trailing-comma"])
  })

  it("refuses a dangling key and an unterminated string", () => {
    expect(parseLenient('{"a":')).toBeUndefined()
    expect(parseLenient('{"a": "x')).toBeUndefined()
  })
})

describe("isJsonFilePath", () => {
  it("matches JSON extensions case-insensitively and nothing else", () => {
    expect(isJsonFilePath("/w/out.json")).toBe(true)
    expect(isJsonFilePath("/w/OUT.JSON")).toBe(true)
    expect(isJsonFilePath("/w/rows.jsonl")).toBe(true)
    expect(isJsonFilePath("/w/out.json.md")).toBe(false)
    expect(isJsonFilePath("/w.json/readme")).toBe(false)
  })
})

describe("file-write refusal text is unchanged for unrepairable .json content", () => {
  it("still names the parse error and asks for the JSON value itself", () => {
    const msg = writeContentRejection("/w/out.json", '{"a": 1,}')
    expect(msg).toStartWith("Refusing to write out.json: the content is not valid JSON (")
    expect(msg).toEndWith(
      "Pass `content` as the JSON value itself (an object or array, not a string); " +
        "it is saved as valid JSON. No prose, no explanation, no code fence.",
    )
  })
})
