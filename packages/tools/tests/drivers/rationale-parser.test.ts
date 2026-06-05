import { describe, it, expect } from "bun:test"
import { extractRationale, parseRationaleBlocks } from "../../src/drivers/rationale-parser.js"

describe("extractRationale", () => {
  it("returns Rationale for valid object", () => {
    const r = extractRationale({ rationale: { why: "tool fits task", confidence: 0.8 } })
    expect(r).toEqual({ why: "tool fits task", confidence: 0.8 })
  })

  it("returns undefined for missing why", () => {
    expect(extractRationale({ rationale: { confidence: 0.5 } })).toBeUndefined()
  })

  it("returns undefined when rationale is not an object", () => {
    expect(extractRationale({ rationale: "nope" })).toBeUndefined()
  })

  it("truncates why over 280 chars to 280", () => {
    const r = extractRationale({ rationale: { why: "x".repeat(281) } })
    expect(r?.why).toHaveLength(280)
  })

  it("drops out-of-range confidence", () => {
    const r = extractRationale({ rationale: { why: "ok", confidence: 1.5 } })
    expect(r).toEqual({ why: "ok" })
  })
})

describe("parseRationaleBlocks", () => {
  it("returns empty map on empty input", () => {
    expect(parseRationaleBlocks("").size).toBe(0)
  })

  it("parses a single block with explicit call attribute", () => {
    const out = parseRationaleBlocks(`<rationale call="1">{"why":"fetch commits","confidence":0.9}</rationale>`)
    expect(out.get(1)).toEqual({ why: "fetch commits", confidence: 0.9 })
  })

  it("parses multiple blocks in order", () => {
    const text = `
      <rationale call="1">{"why":"list commits"}</rationale>
      blah blah
      <rationale call="2">{"why":"write summary","confidence":0.7}</rationale>
    `
    const out = parseRationaleBlocks(text)
    expect(out.size).toBe(2)
    expect(out.get(1)?.why).toBe("list commits")
    expect(out.get(2)?.why).toBe("write summary")
  })

  it("falls back to sequential numbering when call attr missing", () => {
    const text = `<rationale>{"why":"a"}</rationale><rationale>{"why":"b"}</rationale>`
    const out = parseRationaleBlocks(text)
    expect(out.get(1)?.why).toBe("a")
    expect(out.get(2)?.why).toBe("b")
  })

  it("skips malformed JSON gracefully", () => {
    const text = `<rationale call="1">not json</rationale><rationale call="2">{"why":"ok"}</rationale>`
    const out = parseRationaleBlocks(text)
    expect(out.has(1)).toBe(false)
    expect(out.get(2)?.why).toBe("ok")
  })

  it("ignores blocks without a valid why", () => {
    const text = `<rationale call="1">{"confidence":0.9}</rationale>`
    expect(parseRationaleBlocks(text).size).toBe(0)
  })

  it("parses a fenced JSON body with trailing prose", () => {
    const text =
      "<rationale call=\"1\">```json\n{\"why\":\"fetch commits\",\"confidence\":0.9}\n```\nThis is my reasoning.</rationale>"
    const out = parseRationaleBlocks(text)
    expect(out.get(1)).toEqual({ why: "fetch commits", confidence: 0.9 })
  })

  it("truncates a why over 280 chars instead of dropping the block", () => {
    const text = `<rationale call="1">{"why":"${"x".repeat(400)}"}</rationale>`
    const out = parseRationaleBlocks(text)
    expect(out.get(1)?.why).toHaveLength(280)
  })

  it("maps three colliding call=1 blocks to distinct sequential keys", () => {
    const text = `
      <rationale call="1">{"why":"first"}</rationale>
      <rationale call="1">{"why":"second"}</rationale>
      <rationale call="1">{"why":"third"}</rationale>
    `
    const out = parseRationaleBlocks(text)
    expect(out.size).toBe(3)
    expect(out.get(1)?.why).toBe("first")
    expect(out.get(2)?.why).toBe("second")
    expect(out.get(3)?.why).toBe("third")
  })
})
