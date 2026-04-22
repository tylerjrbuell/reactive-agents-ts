import { describe, it, expect } from "bun:test"
import { accumulateAliasObservation, confirmedAliases, shouldWriteAlias } from "../src/calibration.js"

describe("shouldWriteAlias", () => {
  it("returns false below frequency threshold", () => {
    expect(shouldWriteAlias(2)).toBe(false)  // N < 3 — noise
  })

  it("returns true at threshold", () => {
    expect(shouldWriteAlias(3)).toBe(true)
  })

  it("returns true above threshold", () => {
    expect(shouldWriteAlias(10)).toBe(true)
  })
})

describe("accumulateAliasObservation", () => {
  it("increments count for known alias", () => {
    const state = { "input": { target: "path", count: 2 } }
    const updated = accumulateAliasObservation(state, "input", "path")
    expect(updated["input"]!.count).toBe(3)
  })

  it("creates new entry for unseen alias", () => {
    const updated = accumulateAliasObservation({}, "command", "path")
    expect(updated["command"]!.count).toBe(1)
    expect(updated["command"]!.target).toBe("path")
  })
})

describe("confirmedAliases", () => {
  it("excludes entries with count below threshold", () => {
    const state = {
      "input": { target: "path", count: 1 },
      "cmd": { target: "command", count: 2 },
    }
    const result = confirmedAliases(state)
    expect(Object.keys(result)).toHaveLength(0)
  })

  it("includes entries with count at or above threshold", () => {
    const state = {
      "input": { target: "path", count: 3 },
      "cmd": { target: "command", count: 5 },
      "low": { target: "other", count: 2 },
    }
    const result = confirmedAliases(state)
    expect(result["input"]).toBe("path")
    expect(result["cmd"]).toBe("command")
    expect(result["low"]).toBeUndefined()
  })
})
