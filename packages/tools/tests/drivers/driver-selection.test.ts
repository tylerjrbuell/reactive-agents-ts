import { describe, it, expect } from "bun:test"
import { NativeFCDriver, TextParseDriver } from "../../src/drivers/index.js"

function selectDriver(dialect: string | undefined) {
  return dialect === "native-fc" ? new NativeFCDriver() : new TextParseDriver()
}

describe("driver selection by toolCallDialect", () => {
  it("native-fc → NativeFCDriver", () => {
    expect(selectDriver("native-fc").mode).toBe("native-fc")
  })
  it("text-parse → TextParseDriver", () => {
    expect(selectDriver("text-parse").mode).toBe("text-parse")
  })
  it("none (uncalibrated) → TextParseDriver safe default", () => {
    expect(selectDriver("none").mode).toBe("text-parse")
  })
  it("undefined → TextParseDriver safe default", () => {
    expect(selectDriver(undefined).mode).toBe("text-parse")
  })
})
