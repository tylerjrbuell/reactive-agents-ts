import { describe, it, expect } from "bun:test"
import { Schema } from "effect"
import { ModelCalibrationSchema, clearCalibrationCache, loadCalibration } from "../src/calibration.js"

describe("ModelCalibrationSchema new fields", () => {
  it("accepts toolCallDialect native-fc", () => {
    const base = {
      modelId: "test-model",
      calibratedAt: new Date().toISOString(),
      probeVersion: 1,
      runsAveraged: 1,
      steeringCompliance: "system-prompt" as const,
      parallelCallCapability: "sequential-only" as const,
      observationHandling: "uses-recall" as const,
      systemPromptAttention: "strong" as const,
      optimalToolResultChars: 2000,
    }
    const result = Schema.decodeUnknownSync(ModelCalibrationSchema)({
      ...base,
      toolCallDialect: "native-fc",
      knownToolAliases: { "typescript/compile": "code-execute" },
      knownParamAliases: { "file-read": { input: "path" } },
    })
    expect(result.toolCallDialect).toBe("native-fc")
    expect(result.knownToolAliases?.["typescript/compile"]).toBe("code-execute")
    expect(result.knownParamAliases?.["file-read"]?.["input"]).toBe("path")
  })

  it("defaults toolCallDialect to none when absent", () => {
    const base = {
      modelId: "test-model",
      calibratedAt: new Date().toISOString(),
      probeVersion: 1,
      runsAveraged: 1,
      steeringCompliance: "system-prompt" as const,
      parallelCallCapability: "sequential-only" as const,
      observationHandling: "uses-recall" as const,
      systemPromptAttention: "strong" as const,
      optimalToolResultChars: 2000,
    }
    const result = Schema.decodeUnknownSync(ModelCalibrationSchema)(base)
    expect(result.toolCallDialect).toBe("none")
  })
})

describe("ModelCalibrationSchema actOrAnswer", () => {
  const base = {
    modelId: "test-model",
    calibratedAt: "2026-11-06T00:00:00.000Z",
    probeVersion: 1,
    runsAveraged: 1,
    steeringCompliance: "system-prompt" as const,
    parallelCallCapability: "sequential-only" as const,
    observationHandling: "uses-recall" as const,
    systemPromptAttention: "strong" as const,
    optimalToolResultChars: 2000,
  }

  for (const value of ["proactive", "retry", "off"] as const) {
    it(`accepts actOrAnswer "${value}"`, () => {
      const result = Schema.decodeUnknownSync(ModelCalibrationSchema)({ ...base, actOrAnswer: value })
      expect(result.actOrAnswer).toBe(value)
    })
  }

  it("rejects an unknown actOrAnswer string", () => {
    expect(() =>
      Schema.decodeUnknownSync(ModelCalibrationSchema)({ ...base, actOrAnswer: "always" }),
    ).toThrow()
  })

  it("leaves actOrAnswer absent when not provided (unknown, not defaulted)", () => {
    const result = Schema.decodeUnknownSync(ModelCalibrationSchema)(base)
    expect("actOrAnswer" in result).toBe(false)
  })

  it("ships cogito:8b as proactive and qwen3:4b as retry", () => {
    clearCalibrationCache()
    expect(loadCalibration("cogito:8b")?.actOrAnswer).toBe("proactive")
    expect(loadCalibration("qwen3:4b")?.actOrAnswer).toBe("retry")
  })
})
