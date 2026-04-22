import { describe, it, expect } from "bun:test"
import { scoreFCResponse, computeFCCapabilityScore, selectToolCallDialect } from "../src/calibration-probe.js"

describe("scoreFCResponse", () => {
  const schema = {
    name: "file-read",
    description: "Read file",
    parameters: [
      { name: "path", type: "string", description: "", required: true },
      { name: "encoding", type: "string", description: "", required: false },
    ],
  }

  it("exact match scores 1.0 on all dimensions", () => {
    const score = scoreFCResponse(
      { name: "file-read", arguments: { path: "/foo.ts" } },
      schema,
      ["file-read", "web-search"],
    )
    expect(score.toolNameAccuracy).toBe(1)
    expect(score.paramNameAccuracy).toBe(1)
    expect(score.requiredParamCompleteness).toBe(1)
  })

  it("wrong tool name scores 0 on toolNameAccuracy", () => {
    const score = scoreFCResponse(
      { name: "typescript/compile", arguments: { path: "/foo.ts" } },
      schema,
      ["file-read", "web-search"],
    )
    expect(score.toolNameAccuracy).toBe(0)
  })

  it("wrong param name scores 0 on paramNameAccuracy", () => {
    const score = scoreFCResponse(
      { name: "file-read", arguments: { input: "/foo.ts" } },
      schema,
      ["file-read", "web-search"],
    )
    expect(score.paramNameAccuracy).toBe(0)
  })

  it("missing required param scores 0 on requiredParamCompleteness", () => {
    const score = scoreFCResponse(
      { name: "file-read", arguments: {} },
      schema,
      ["file-read", "web-search"],
    )
    expect(score.requiredParamCompleteness).toBe(0)
  })
})

describe("computeFCCapabilityScore", () => {
  it("perfect responses produce score 1.0", () => {
    const scores = Array.from({ length: 6 }, () => ({
      toolNameAccuracy: 1,
      paramNameAccuracy: 1,
      typeCompliance: 1,
      requiredParamCompleteness: 1,
      multiToolSelection: 1,
    }))
    expect(computeFCCapabilityScore(scores)).toBe(1)
  })

  it("all-zero responses produce score 0.0", () => {
    const scores = Array.from({ length: 6 }, () => ({
      toolNameAccuracy: 0,
      paramNameAccuracy: 0,
      typeCompliance: 0,
      requiredParamCompleteness: 0,
      multiToolSelection: 0,
    }))
    expect(computeFCCapabilityScore(scores)).toBe(0)
  })
})

describe("selectToolCallDialect", () => {
  it("score >= 0.8 selects native-fc", () => {
    expect(selectToolCallDialect(0.85)).toBe("native-fc")
  })

  it("score < 0.8 selects text-parse", () => {
    expect(selectToolCallDialect(0.65)).toBe("text-parse")
    expect(selectToolCallDialect(0.0)).toBe("text-parse")
  })
})
