import { describe, it, expect } from "bun:test"
import { materializeExperienceSummary, formatToolGuidanceFromSummary } from "../src/calibration.js"
import type { ToolCallObservation } from "@reactive-agents/memory"

describe("materializeExperienceSummary", () => {
  it("produces top working patterns from observations", () => {
    const observations: ToolCallObservation[] = [
      {
        toolNameAttempted: "file-read",
        toolNameResolved: "file-read",
        paramsAttempted: { path: "/foo.ts" },
        paramsResolved: { path: "/foo.ts" },
        parseMode: "native-fc",
        healingApplied: [],
        succeeded: true,
        errorText: null,
      },
    ]
    const summary = materializeExperienceSummary(observations)
    expect(summary.topWorkingParamPatterns).toHaveLength(1)
    expect(summary.topWorkingParamPatterns[0]?.tool).toBe("file-read")
  })

  it("surfaces top error patterns from failures", () => {
    const observations: ToolCallObservation[] = [
      {
        toolNameAttempted: "file-read",
        toolNameResolved: "file-read",
        paramsAttempted: { input: "/foo.ts" },
        paramsResolved: { path: "/foo.ts" },
        parseMode: "tier-1",
        healingApplied: [{ stage: "param-name", from: "input", to: "path" }],
        succeeded: false,
        errorText: "Unknown parameter: input",
      },
    ]
    const summary = materializeExperienceSummary(observations)
    expect(summary.topErrorPatterns.some((e) => e.tool === "file-read")).toBe(true)
    const errorEntry = summary.topErrorPatterns.find((e) => e.tool === "file-read")
    expect(errorEntry?.recovery).toContain("path")
  })
})

describe("formatToolGuidanceFromSummary", () => {
  it("returns empty string when no summary available", () => {
    expect(formatToolGuidanceFromSummary(null, ["file-read"])).toBe("")
  })

  it("includes concrete param guidance from patterns", () => {
    const summary = {
      topWorkingParamPatterns: [
        { tool: "file-read", params: { path: "/example.ts" }, successRate: 1, occurrences: 5 }
      ],
      topErrorPatterns: [
        { tool: "file-read", error: "Unknown parameter: input", recovery: "Use `path` not `input`", occurrences: 3 }
      ],
      lastUpdated: new Date().toISOString(),
    }
    const guidance = formatToolGuidanceFromSummary(summary, ["file-read"])
    expect(guidance).toContain("path")
    expect(guidance).toContain("file-read")
  })

  it("returns empty string when tool not in active list", () => {
    const summary = {
      topWorkingParamPatterns: [],
      topErrorPatterns: [
        { tool: "file-read", error: "err", recovery: "fix", occurrences: 1 }
      ],
      lastUpdated: new Date().toISOString(),
    }
    expect(formatToolGuidanceFromSummary(summary, ["web-search"])).toBe("")
  })
})
