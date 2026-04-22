import { describe, it, expect } from "bun:test"
import { NativeFCDriver } from "../../src/drivers/native-fc-driver.js"

const mockTools = [
  {
    name: "file-read",
    description: "Read a file",
    parameters: [{ name: "path", type: "string", description: "File path", required: true }],
  },
]

describe("NativeFCDriver", () => {
  const driver = new NativeFCDriver()

  it("mode is native-fc", () => {
    expect(driver.mode).toBe("native-fc")
  })

  it("buildPromptInstructions returns empty string", () => {
    expect(driver.buildPromptInstructions(mockTools)).toBe("")
  })

  it("extractCalls returns empty array (native FC is parsed by think.ts)", () => {
    expect(driver.extractCalls("any text", mockTools)).toEqual([])
  })

  it("formatToolResult wraps in plain text", () => {
    const formatted = driver.formatToolResult("file-read", { content: "hello" }, false)
    expect(typeof formatted).toBe("string")
    expect(formatted.length).toBeGreaterThan(0)
  })
})
