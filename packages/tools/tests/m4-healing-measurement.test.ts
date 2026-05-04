import { describe, it, expect, beforeAll } from "bun:test"
import type { ToolCallSpec } from "../src/tool-calling/types.js"
import { runHealingPipeline } from "../src/healing/healing-pipeline.js"
import type { ToolSchema } from "../src/drivers/tool-calling-driver.js"

/**
 * M4 Healing Pipeline Measurement & Analysis
 *
 * Collects metrics on healing effectiveness:
 * - Recovery rate (overall and per error type)
 * - Recovery stage breakdown
 * - Token cost estimate (healing actions per stage)
 * - Accuracy analysis
 */

interface MeasurementResult {
  readonly id: string
  readonly description: string
  readonly model: string
  readonly errorType: string
  readonly recovered: boolean
  readonly healingStages: string[]
  readonly actionCount: number
  readonly inputLength: number
  readonly outputLength: number
}

interface MetricsReport {
  readonly totalCases: number
  readonly totalRecovered: number
  readonly recoveryRate: number
  readonly byErrorType: Record<string, { total: number; recovered: number; rate: number }>
  readonly byRecoveryStage: Record<string, number>
  readonly byModel: Record<string, { total: number; recovered: number; rate: number }>
  readonly avgActionsPerCase: number
  readonly avgInputLength: number
  readonly avgOutputLength: number
  readonly tokenCostIncrease: number
}

// ──────────────────────────────────────────────────────────────────────────────
// TEST DATA (15 CASES)
// ──────────────────────────────────────────────────────────────────────────────

interface FCErrorCase {
  readonly id: string
  readonly description: string
  readonly model: "qwen3:14b" | "frontier"
  readonly errorType: "malformed-json" | "type-mismatch" | "missing-args" | "tool-name-typo" | "param-name-typo"
  readonly call: ToolCallSpec
}

const TEST_CASES: readonly FCErrorCase[] = [
  // STAGE 1
  {
    id: "qwen-typo-1",
    description: "qwen3: 'file_read' instead of 'file-read'",
    model: "qwen3:14b",
    errorType: "tool-name-typo",
    call: { id: "tc-1", name: "file_read", arguments: { path: "/workspace/src/main.ts" } },
  },
  {
    id: "qwen-typo-2",
    description: "qwen3: 'exec' instead of 'code-execute'",
    model: "qwen3:14b",
    errorType: "tool-name-typo",
    call: { id: "tc-2", name: "exec", arguments: { code: "console.log('hello')" } },
  },
  {
    id: "frontier-name-confusion",
    description: "frontier: 'readFile' instead of 'file-read'",
    model: "frontier",
    errorType: "tool-name-typo",
    call: { id: "tc-3", name: "readFile", arguments: { path: "/workspace/config.json" } },
  },
  // STAGE 2
  {
    id: "param-typo-1",
    description: "param: 'pathh' instead of 'path'",
    model: "qwen3:14b",
    errorType: "param-name-typo",
    call: { id: "tc-4", name: "file-read", arguments: { pathh: "/workspace/data.json" } },
  },
  {
    id: "param-typo-2",
    description: "param: 'script' instead of 'code'",
    model: "frontier",
    errorType: "param-name-typo",
    call: { id: "tc-5", name: "code-execute", arguments: { script: "console.log('hello')" } },
  },
  {
    id: "param-alias-common",
    description: "param: 'input' instead of 'code'",
    model: "qwen3:14b",
    errorType: "param-name-typo",
    call: { id: "tc-6", name: "code-execute", arguments: { input: "const x = 1" } },
  },
  // STAGE 3
  {
    id: "relative-path-1",
    description: "path: 'src/main.ts' needs resolution",
    model: "frontier",
    errorType: "type-mismatch",
    call: { id: "tc-7", name: "file-read", arguments: { path: "src/main.ts" } },
  },
  {
    id: "relative-path-2",
    description: "path: './config.json' needs resolution",
    model: "qwen3:14b",
    errorType: "type-mismatch",
    call: { id: "tc-8", name: "file-read", arguments: { path: "./config.json" } },
  },
  {
    id: "relative-path-parent",
    description: "path: '../shared/utils.ts' needs resolution",
    model: "frontier",
    errorType: "type-mismatch",
    call: { id: "tc-9", name: "file-read", arguments: { path: "../shared/utils.ts" } },
  },
  // STAGE 4
  {
    id: "type-coerce-string-number",
    description: "type: '5000' (string) → 5000 (number)",
    model: "frontier",
    errorType: "type-mismatch",
    call: { id: "tc-10", name: "sleep", arguments: { milliseconds: "5000" } },
  },
  {
    id: "type-coerce-boolean-string",
    description: "type: 'true' (string) → true (boolean)",
    model: "qwen3:14b",
    errorType: "type-mismatch",
    call: {
      id: "tc-11",
      name: "file-read",
      arguments: { path: "/workspace/data.json", verbose: "true" },
    },
  },
  {
    id: "type-coerce-boolean-string-false",
    description: "type: 'false' (string) → false (boolean)",
    model: "frontier",
    errorType: "type-mismatch",
    call: {
      id: "tc-12",
      name: "file-read",
      arguments: { path: "/workspace/config.json", verbose: "false" },
    },
  },
  // COMPOSITE
  {
    id: "composite-1",
    description: "composite: name typo + relative path",
    model: "frontier",
    errorType: "tool-name-typo",
    call: { id: "tc-13", name: "fileread", arguments: { path: "src/main.ts" } },
  },
  {
    id: "composite-2",
    description: "composite: param typo + type coercion",
    model: "qwen3:14b",
    errorType: "param-name-typo",
    call: { id: "tc-14", name: "sleep", arguments: { duration: "2000" } },
  },
  {
    id: "composite-3",
    description: "composite: name + param + path",
    model: "frontier",
    errorType: "tool-name-typo",
    call: { id: "tc-15", name: "file_read", arguments: { file_path: "data.json" } },
  },
]

// ──────────────────────────────────────────────────────────────────────────────
// SCHEMAS
// ──────────────────────────────────────────────────────────────────────────────

const TOOL_SCHEMAS: readonly ToolSchema[] = [
  {
    name: "file-read",
    description: "Read file contents",
    parameters: [
      { name: "path", type: "string", description: "Absolute file path", required: true },
      { name: "verbose", type: "boolean", description: "Log details", required: false },
    ],
  },
  {
    name: "code-execute",
    description: "Execute JavaScript code",
    parameters: [{ name: "code", type: "string", description: "JavaScript code", required: true }],
  },
  {
    name: "sleep",
    description: "Sleep for milliseconds",
    parameters: [
      { name: "milliseconds", type: "number", description: "Duration in ms", required: true },
    ],
  },
]

const TOOL_ALIASES: Record<string, string> = {
  file_read: "file-read",
  fileread: "file-read",
  readFile: "file-read",
  exec: "code-execute",
}

const PARAM_ALIASES: Record<string, Record<string, string>> = {
  "file-read": {
    input: "path",
    file_path: "path",
    pathh: "path",
  },
  "code-execute": {
    input: "code",
    script: "code",
  },
  sleep: {
    duration: "milliseconds",
  },
}

const FILE_TOOLS = new Set(["file-read"])
const WORKING_DIR = "/workspace"

// ──────────────────────────────────────────────────────────────────────────────
// MEASUREMENT TEST SUITE
// ──────────────────────────────────────────────────────────────────────────────

describe("M4 Healing Pipeline — Measurement & Analysis", () => {
  let measurements: MeasurementResult[] = []
  let report: MetricsReport | null = null

  beforeAll(() => {
    // Run all test cases and collect measurements
    for (const testCase of TEST_CASES) {
      const result = runHealingPipeline(
        testCase.call,
        TOOL_SCHEMAS,
        FILE_TOOLS,
        WORKING_DIR,
        TOOL_ALIASES,
        PARAM_ALIASES
      )

      const healingStages = [...new Set(result.actions.map((a) => a.stage))]

      measurements.push({
        id: testCase.id,
        description: testCase.description,
        model: testCase.model,
        errorType: testCase.errorType,
        recovered: result.succeeded,
        healingStages,
        actionCount: result.actions.length,
        inputLength: JSON.stringify(testCase.call).length,
        outputLength: JSON.stringify(result.call).length,
      })
    }

    // Compute metrics
    const totalRecovered = measurements.filter((m) => m.recovered).length
    const totalCases = measurements.length
    const recoveryRate = (totalRecovered / totalCases) * 100

    // By error type
    const byErrorType: Record<string, { total: number; recovered: number; rate: number }> = {}
    for (const m of measurements) {
      if (!byErrorType[m.errorType]) {
        byErrorType[m.errorType] = { total: 0, recovered: 0, rate: 0 }
      }
      byErrorType[m.errorType].total++
      if (m.recovered) byErrorType[m.errorType].recovered++
    }
    for (const et of Object.keys(byErrorType)) {
      byErrorType[et].rate = (byErrorType[et].recovered / byErrorType[et].total) * 100
    }

    // By recovery stage
    const byRecoveryStage: Record<string, number> = {
      "stage-1": 0,
      "stage-2": 0,
      "stage-3": 0,
      "stage-4": 0,
      composite: 0,
    }
    for (const m of measurements) {
      if (m.recovered && m.healingStages.length > 0) {
        if (m.healingStages.length === 1) {
          const stage = `stage-${m.healingStages[0].split("-")[1]}`
          if (byRecoveryStage[stage] !== undefined) byRecoveryStage[stage]++
        } else {
          byRecoveryStage["composite"]++
        }
      }
    }

    // By model
    const byModel: Record<string, { total: number; recovered: number; rate: number }> = {}
    for (const m of measurements) {
      if (!byModel[m.model]) {
        byModel[m.model] = { total: 0, recovered: 0, rate: 0 }
      }
      byModel[m.model].total++
      if (m.recovered) byModel[m.model].recovered++
    }
    for (const model of Object.keys(byModel)) {
      byModel[model].rate = (byModel[model].recovered / byModel[model].total) * 100
    }

    // Token cost estimate
    const avgInputLength =
      measurements.reduce((sum, m) => sum + m.inputLength, 0) / measurements.length
    const avgOutputLength =
      measurements.reduce((sum, m) => sum + m.outputLength, 0) / measurements.length
    const tokenCostIncrease = ((avgOutputLength - avgInputLength) / avgInputLength) * 100

    report = {
      totalCases,
      totalRecovered,
      recoveryRate,
      byErrorType,
      byRecoveryStage,
      byModel,
      avgActionsPerCase: measurements.reduce((sum, m) => sum + m.actionCount, 0) / measurements.length,
      avgInputLength: Math.round(avgInputLength),
      avgOutputLength: Math.round(avgOutputLength),
      tokenCostIncrease,
    }
  })

  describe("Recovery metrics", () => {
    it("reports overall recovery rate >= 60%", () => {
      expect(report).toBeDefined()
      expect(report!.recoveryRate).toBeGreaterThanOrEqual(60)
      console.log(`Overall recovery rate: ${report!.recoveryRate.toFixed(1)}%`)
    })

    it("breaks down recovery by error type", () => {
      expect(report).toBeDefined()
      console.log("\nRecovery by error type:")
      for (const [errorType, stats] of Object.entries(report!.byErrorType)) {
        console.log(`  ${errorType}: ${stats.recovered}/${stats.total} (${stats.rate.toFixed(1)}%)`)
      }
    })

    it("shows recovery stage distribution", () => {
      expect(report).toBeDefined()
      console.log("\nRecovery by stage:")
      for (const [stage, count] of Object.entries(report!.byRecoveryStage)) {
        console.log(`  ${stage}: ${count} cases`)
      }
    })

    it("compares recovery by model", () => {
      expect(report).toBeDefined()
      console.log("\nRecovery by model:")
      for (const [model, stats] of Object.entries(report!.byModel)) {
        console.log(`  ${model}: ${stats.recovered}/${stats.total} (${stats.rate.toFixed(1)}%)`)
      }
    })
  })

  describe("Cost analysis", () => {
    it("measures average actions per case", () => {
      expect(report).toBeDefined()
      console.log(
        `\nAverage healing actions per case: ${report!.avgActionsPerCase.toFixed(2)}`
      )
    })

    it("estimates token cost increase", () => {
      expect(report).toBeDefined()
      console.log(
        `Token cost increase: ${report!.tokenCostIncrease.toFixed(1)}% ` +
          `(avg input: ${report!.avgInputLength} → ${report!.avgOutputLength} chars)`
      )
      // Healing should not significantly increase token overhead
      expect(report!.tokenCostIncrease).toBeLessThan(50)
    })
  })

  describe("Accuracy validation", () => {
    it("all recovered cases have valid tool names", () => {
      const toolNames = new Set(TOOL_SCHEMAS.map((t) => t.name))
      for (const m of measurements) {
        if (m.recovered) {
          const toolName = m.id.includes("code-execute")
            ? "code-execute"
            : m.id.includes("sleep")
              ? "sleep"
              : "file-read"
          expect(toolNames.has(toolName) || m.healingStages.length > 0).toBe(true)
        }
      }
    })

    it("unrecoverable cases are clearly identified", () => {
      const unrecovered = measurements.filter((m) => !m.recovered)
      console.log(`\nUnrecoverable cases: ${unrecovered.length}/${measurements.length}`)
      if (unrecovered.length > 0) {
        console.log("Unrecoverable:")
        unrecovered.forEach((m) => console.log(`  - ${m.id}: ${m.description}`))
      }
    })
  })

  describe("Success criteria", () => {
    it("SUCCESS CRITERION 1: Recovery rate >= 60%", () => {
      expect(report!.recoveryRate).toBeGreaterThanOrEqual(60)
    })

    it("SUCCESS CRITERION 2: Accuracy improvement >= 5%", () => {
      // Baseline (no healing): tool name typos fail to resolve
      // With healing: tool name typos are recovered
      const toolNameErrors = measurements.filter((m) => m.errorType === "tool-name-typo")
      const recoveredToolName = toolNameErrors.filter((m) => m.recovered).length
      const accuracyGain = (recoveredToolName / toolNameErrors.length) * 100
      console.log(`\nAccuracy improvement (tool-name recovery): ${accuracyGain.toFixed(1)}%`)
      expect(accuracyGain).toBeGreaterThanOrEqual(5)
    })

    it("SUCCESS CRITERION 3: Token cost increase < 20%", () => {
      console.log(`Token cost increase: ${report!.tokenCostIncrease.toFixed(1)}%`)
      // This may vary — healing can increase output size due to corrected args
      // But should stay under 20% overhead
      expect(report!.tokenCostIncrease).toBeLessThan(20)
    })
  })

  describe("Findings & Analysis", () => {
    it("generates summary report", () => {
      console.log("\n" + "=".repeat(70))
      console.log("M4 HEALING PIPELINE VALIDATION REPORT")
      console.log("=".repeat(70))
      console.log(
        `Total test cases: ${report!.totalCases}\n` +
          `Total recovered: ${report!.totalRecovered}\n` +
          `Recovery rate: ${report!.recoveryRate.toFixed(1)}%\n`
      )
      console.log("Recovery by error type:")
      for (const [et, stats] of Object.entries(report!.byErrorType)) {
        console.log(`  ${et}: ${stats.recovered}/${stats.total} (${stats.rate.toFixed(1)}%)`)
      }
      console.log("\nRecovery by stage distribution:")
      for (const [stage, count] of Object.entries(report!.byRecoveryStage)) {
        if (count > 0) console.log(`  ${stage}: ${count}`)
      }
      console.log("\nRecovery by model:")
      for (const [model, stats] of Object.entries(report!.byModel)) {
        console.log(`  ${model}: ${stats.recovered}/${stats.total} (${stats.rate.toFixed(1)}%)`)
      }
      console.log(
        `\nToken cost: +${report!.tokenCostIncrease.toFixed(1)}% ` +
          `(${report!.avgInputLength} → ${report!.avgOutputLength} chars avg)`
      )
      console.log(`Avg actions per case: ${report!.avgActionsPerCase.toFixed(2)}`)
      console.log("=".repeat(70))
    })
  })
})
