import { describe, it, expect } from "bun:test"
import { Schema } from "effect"
import { ModelCalibrationSchema } from "../src/calibration.js"

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
      fcCapabilityScore: 0.92,
      knownToolAliases: { "typescript/compile": "code-execute" },
      knownParamAliases: { "file-read": { input: "path" } },
      toolSuccessRateByName: { "file-read": 0.85 },
      interventionResponseRate: 1.5,
      interventionResponseSamples: 7,
    })
    expect(result.toolCallDialect).toBe("native-fc")
    expect(result.fcCapabilityScore).toBe(0.92)
    expect(result.knownToolAliases?.["typescript/compile"]).toBe("code-execute")
    expect(result.knownParamAliases?.["file-read"]?.["input"]).toBe("path")
    expect(result.interventionResponseRate).toBe(1.5)
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
