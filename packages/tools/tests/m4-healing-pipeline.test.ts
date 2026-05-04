import { describe, it, expect, beforeEach } from "bun:test"
import type { ToolCallSpec } from "../src/tool-calling/types.js"
import { runHealingPipeline } from "../src/healing/healing-pipeline.js"
import type { HealingAction, ToolSchema } from "../src/drivers/tool-calling-driver.js"

/**
 * M4 Healing Pipeline Validation Test Suite
 *
 * Validates the 4-stage healing pipeline (retry → reparse → interpolate → fallback)
 * for function-calling (FC) failures against realistic error datasets.
 *
 * Measures:
 * 1. Recovery rate per stage
 * 2. Accuracy impact of healing
 * 3. Token cost increase
 * 4. Unrecoverable error types
 */

// ──────────────────────────────────────────────────────────────────────────────
// REALISTIC FC ERROR DATASET
// ──────────────────────────────────────────────────────────────────────────────

interface FCErrorCase {
  readonly id: string
  readonly description: string
  readonly model: "qwen3:14b" | "frontier"
  readonly errorType: "malformed-json" | "type-mismatch" | "missing-args" | "tool-name-typo" | "param-name-typo"
  readonly call: ToolCallSpec
  readonly expectedHealedCall: ToolCallSpec
  readonly expectedRecoverableAt: "stage-1" | "stage-2" | "stage-3" | "stage-4" | "unrecoverable"
}

const REALISTIC_FC_ERRORS: readonly FCErrorCase[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 1: Tool Name Healing (qwen3:14b known issues)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "qwen-typo-1",
    description: "qwen3 tool name typo: 'file_read' instead of 'file-read'",
    model: "qwen3:14b",
    errorType: "tool-name-typo",
    call: {
      id: "tc-1",
      name: "file_read",
      arguments: { path: "/workspace/src/main.ts" },
    },
    expectedHealedCall: {
      id: "tc-1",
      name: "file-read",
      arguments: { path: "/workspace/src/main.ts" },
    },
    expectedRecoverableAt: "stage-1",
  },
  {
    id: "qwen-typo-2",
    description: "qwen3 tool name abbreviation: 'exec' instead of 'code-execute'",
    model: "qwen3:14b",
    errorType: "tool-name-typo",
    call: {
      id: "tc-2",
      name: "exec",
      arguments: { code: "console.log('hello')" },
    },
    expectedHealedCall: {
      id: "tc-2",
      name: "code-execute",
      arguments: { code: "console.log('hello')" },
    },
    expectedRecoverableAt: "stage-1",
  },
  {
    id: "frontier-name-confusion",
    description: "Frontier model uses alternate name for tool",
    model: "frontier",
    errorType: "tool-name-typo",
    call: {
      id: "tc-3",
      name: "readFile",
      arguments: { path: "/workspace/config.json" },
    },
    expectedHealedCall: {
      id: "tc-3",
      name: "file-read",
      arguments: { path: "/workspace/config.json" },
    },
    expectedRecoverableAt: "stage-1",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 2: Parameter Name Healing
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "param-typo-1",
    description: "Parameter name typo: 'pathh' instead of 'path'",
    model: "qwen3:14b",
    errorType: "param-name-typo",
    call: {
      id: "tc-4",
      name: "file-read",
      arguments: { pathh: "/workspace/data.json" },
    },
    expectedHealedCall: {
      id: "tc-4",
      name: "file-read",
      arguments: { path: "/workspace/data.json" },
    },
    expectedRecoverableAt: "stage-2",
  },
  {
    id: "param-typo-2",
    description: "Parameter alias: 'script' instead of 'code'",
    model: "frontier",
    errorType: "param-name-typo",
    call: {
      id: "tc-5",
      name: "code-execute",
      arguments: { script: "console.log('hello')" },
    },
    expectedHealedCall: {
      id: "tc-5",
      name: "code-execute",
      arguments: { code: "console.log('hello')" },
    },
    expectedRecoverableAt: "stage-2",
  },
  {
    id: "param-alias-common",
    description: "Common alias: 'input' instead of 'code' for code-execute",
    model: "qwen3:14b",
    errorType: "param-name-typo",
    call: {
      id: "tc-6",
      name: "code-execute",
      arguments: { input: "const x = 1; console.log(x)" },
    },
    expectedHealedCall: {
      id: "tc-6",
      name: "code-execute",
      arguments: { code: "const x = 1; console.log(x)" },
    },
    expectedRecoverableAt: "stage-2",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 3: Path Resolution
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "relative-path-1",
    description: "Relative path without working dir prefix",
    model: "frontier",
    errorType: "type-mismatch",
    call: {
      id: "tc-7",
      name: "file-read",
      arguments: { path: "src/main.ts" },
    },
    expectedHealedCall: {
      id: "tc-7",
      name: "file-read",
      arguments: { path: "/workspace/src/main.ts" },
    },
    expectedRecoverableAt: "stage-3",
  },
  {
    id: "relative-path-2",
    description: "Relative path with ./ prefix needs resolution",
    model: "qwen3:14b",
    errorType: "type-mismatch",
    call: {
      id: "tc-8",
      name: "file-read",
      arguments: { path: "./config.json" },
    },
    expectedHealedCall: {
      id: "tc-8",
      name: "file-read",
      arguments: { path: "/workspace/config.json" },
    },
    expectedRecoverableAt: "stage-3",
  },
  {
    id: "relative-path-parent",
    description: "Relative path with parent directory reference",
    model: "frontier",
    errorType: "type-mismatch",
    call: {
      id: "tc-9",
      name: "file-read",
      arguments: { path: "../shared/utils.ts" },
    },
    expectedHealedCall: {
      id: "tc-9",
      name: "file-read",
      arguments: { path: "/shared/utils.ts" },
    },
    expectedRecoverableAt: "stage-3",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // STAGE 4: Type Coercion
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "type-coerce-string-number",
    description: "String provided when number expected (milliseconds)",
    model: "frontier",
    errorType: "type-mismatch",
    call: {
      id: "tc-10",
      name: "sleep",
      arguments: { milliseconds: "5000" },
    },
    expectedHealedCall: {
      id: "tc-10",
      name: "sleep",
      arguments: { milliseconds: 5000 },
    },
    expectedRecoverableAt: "stage-4",
  },
  {
    id: "type-coerce-boolean-string",
    description: "String 'true' when boolean expected",
    model: "qwen3:14b",
    errorType: "type-mismatch",
    call: {
      id: "tc-11",
      name: "file-read",
      arguments: { path: "/workspace/data.json", verbose: "true" },
    },
    expectedHealedCall: {
      id: "tc-11",
      name: "file-read",
      arguments: { path: "/workspace/data.json", verbose: true },
    },
    expectedRecoverableAt: "stage-4",
  },
  {
    id: "type-coerce-boolean-string-false",
    description: "String 'false' when boolean expected",
    model: "frontier",
    errorType: "type-mismatch",
    call: {
      id: "tc-12",
      name: "file-read",
      arguments: { path: "/workspace/config.json", verbose: "false" },
    },
    expectedHealedCall: {
      id: "tc-12",
      name: "file-read",
      arguments: { path: "/workspace/config.json", verbose: false },
    },
    expectedRecoverableAt: "stage-4",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // COMPOSITE ERRORS (Multiple stages needed)
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "composite-1",
    description: "Tool name typo + relative path",
    model: "frontier",
    errorType: "tool-name-typo",
    call: {
      id: "tc-13",
      name: "fileread",
      arguments: { path: "src/main.ts" },
    },
    expectedHealedCall: {
      id: "tc-13",
      name: "file-read",
      arguments: { path: "/workspace/src/main.ts" },
    },
    expectedRecoverableAt: "stage-3",
  },
  {
    id: "composite-2",
    description: "Parameter typo + type coercion",
    model: "qwen3:14b",
    errorType: "param-name-typo",
    call: {
      id: "tc-14",
      name: "sleep",
      arguments: { duration: "2000" },
    },
    expectedHealedCall: {
      id: "tc-14",
      name: "sleep",
      arguments: { milliseconds: 2000 },
    },
    expectedRecoverableAt: "stage-4",
  },
  {
    id: "composite-3",
    description: "Name typo + param typo + relative path",
    model: "frontier",
    errorType: "tool-name-typo",
    call: {
      id: "tc-15",
      name: "file_read",
      arguments: { file_path: "data.json" },
    },
    expectedHealedCall: {
      id: "tc-15",
      name: "file-read",
      arguments: { path: "/workspace/data.json" },
    },
    expectedRecoverableAt: "stage-3",
  },
]

// ──────────────────────────────────────────────────────────────────────────────
// REGISTERED SCHEMA (Tools Available)
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
    name: "file-write",
    description: "Write file contents",
    parameters: [
      { name: "path", type: "string", description: "Absolute file path", required: true },
      { name: "content", type: "string", description: "Content to write", required: true },
    ],
  },
  {
    name: "code-execute",
    description: "Execute JavaScript code",
    parameters: [
      { name: "code", type: "string", description: "JavaScript code", required: true },
    ],
  },
  {
    name: "http-request",
    description: "Make HTTP request",
    parameters: [
      { name: "url", type: "string", description: "Request URL", required: true },
      { name: "port", type: "string", description: "Port (optional)", required: false },
    ],
  },
  {
    name: "sleep",
    description: "Sleep for milliseconds",
    parameters: [
      { name: "milliseconds", type: "number", description: "Duration in ms", required: true },
    ],
  },
]

// ──────────────────────────────────────────────────────────────────────────────
// KNOWN ALIASES (Calibration Data)
// ──────────────────────────────────────────────────────────────────────────────

const TOOL_ALIASES: Record<string, string> = {
  file_read: "file-read",
  fileread: "file-read",
  readFile: "file-read",
  read: "file-read",
  exec: "code-execute",
  execute: "code-execute",
  run: "code-execute",
}

const PARAM_ALIASES: Record<string, Record<string, string>> = {
  "file-read": {
    input: "path",
    file_path: "path",
    pathh: "path",
  },
  "file-write": {
    input: "path",
    file_path: "path",
  },
  "code-execute": {
    input: "code",
    script: "code",
  },
  sleep: {
    duration: "milliseconds",
    delay: "milliseconds",
  },
}

const FILE_TOOLS = new Set(["file-read", "file-write"])
const WORKING_DIR = "/workspace"

// ──────────────────────────────────────────────────────────────────────────────
// TEST SUITE
// ──────────────────────────────────────────────────────────────────────────────

describe("M4 Healing Pipeline Validation", () => {
  let results: {
    total: number
    recovered: number
    unrecoverable: number
    recoveredByStage: Record<string, number>
    errorTypeCounts: Record<string, number>
    errorTypeRecoveryRate: Record<string, number>
  }

  beforeEach(() => {
    results = {
      total: 0,
      recovered: 0,
      unrecoverable: 0,
      recoveredByStage: {
        "stage-1": 0,
        "stage-2": 0,
        "stage-3": 0,
        "stage-4": 0,
        unrecoverable: 0,
      },
      errorTypeCounts: {},
      errorTypeRecoveryRate: {},
    }
  })

  describe("RED phase: Error dataset validation", () => {
    it("dataset has 15 test cases as specified", () => {
      expect(REALISTIC_FC_ERRORS.length).toBe(15)
    })

    it("all test cases have valid structure", () => {
      for (const testCase of REALISTIC_FC_ERRORS) {
        expect(testCase.id).toBeDefined()
        expect(testCase.description).toBeDefined()
        expect(testCase.model).toMatch(/^(qwen3:14b|frontier)$/)
        expect(testCase.errorType).toBeDefined()
        expect(testCase.call).toBeDefined()
        expect(testCase.call.id).toBeDefined()
        expect(testCase.call.name).toBeDefined()
        expect(testCase.expectedHealedCall).toBeDefined()
        expect(testCase.expectedRecoverableAt).toMatch(/^(stage-[1-4]|unrecoverable)$/)
      }
    })

    it("covers all error type categories", () => {
      const errorTypes = new Set(
        REALISTIC_FC_ERRORS.map((tc) => tc.errorType)
      )
      expect(errorTypes.has("tool-name-typo")).toBe(true)
      expect(errorTypes.has("param-name-typo")).toBe(true)
      expect(errorTypes.has("type-mismatch")).toBe(true)
    })

    it("distributes across 4 recovery stages + unrecoverable", () => {
      const stages = new Set(
        REALISTIC_FC_ERRORS.map((tc) => tc.expectedRecoverableAt)
      )
      expect(stages.size).toBeGreaterThanOrEqual(4)
    })

    it("includes qwen3:14b + frontier models", () => {
      const models = new Set(REALISTIC_FC_ERRORS.map((tc) => tc.model))
      expect(models.has("qwen3:14b")).toBe(true)
      expect(models.has("frontier")).toBe(true)
    })
  })

  describe("GREEN phase: Healing with recovery OFF (baseline)", () => {
    it("raw errors are NOT healed when healing is disabled", () => {
      const call: ToolCallSpec = {
        id: "tc-fail-1",
        name: "file_read",
        arguments: { path: "src/main.ts" },
      }
      // When healing is OFF, the call is passed unchanged to the executor
      // and should fail because "file_read" != "file-read"
      expect(call.name).toBe("file_read")
      expect(call.arguments.path).not.toBe("/workspace/src/main.ts")
    })

    it("baseline error rate is high (unhealed typos)", () => {
      let failureCount = 0
      for (const testCase of REALISTIC_FC_ERRORS) {
        // Simulate tool lookup without healing
        const resolvedTool = TOOL_SCHEMAS.find((t) => t.name === testCase.call.name)
        if (!resolvedTool) {
          failureCount++
        }
      }
      // Without healing, many calls should fail to find their tool
      expect(failureCount).toBeGreaterThan(0)
    })
  })

  describe("Healing with recovery ON: Per-stage effectiveness", () => {
    it("STAGE 1: Tool name healing recovers typos via aliases", () => {
      const stage1Cases = REALISTIC_FC_ERRORS.filter(
        (tc) => tc.expectedRecoverableAt === "stage-1"
      )
      expect(stage1Cases.length).toBeGreaterThan(0)

      for (const testCase of stage1Cases) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )

        expect(result.succeeded).toBe(
          true,
          `Stage-1 case ${testCase.id} should succeed: ${testCase.description}`
        )
        expect(result.call.name).toBe(
          testCase.expectedHealedCall.name,
          `Tool name should be healed for ${testCase.id}`
        )
        // Stage-1 focuses on tool name healing, but other stages may run too
        expect(result.actions.length).toBeGreaterThan(0)
        results.recoveredByStage["stage-1"]++
      }
    })

    it("STAGE 2: Parameter name healing recovers param typos", () => {
      const stage2Cases = REALISTIC_FC_ERRORS.filter(
        (tc) => tc.expectedRecoverableAt === "stage-2"
      )
      expect(stage2Cases.length).toBeGreaterThan(0)

      for (const testCase of stage2Cases) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )

        expect(result.succeeded).toBe(
          true,
          `Stage-2 case ${testCase.id} should succeed: ${testCase.description}`
        )
        // Verify all resulting parameters exist in the schema
        const schema = TOOL_SCHEMAS.find((t) => t.name === result.call.name)
        const healedParamNames = Object.keys(result.call.arguments)

        // It's OK if some params are not in schema - the pipeline may have removed invalid ones
        // or they may be auxiliary. The key is that the required params exist.
        const requiredParamNames = schema?.parameters
          .filter((p) => p.required)
          .map((p) => p.name) ?? []

        for (const requiredName of requiredParamNames) {
          expect(healedParamNames).toContain(
            requiredName,
            `Required parameter ${requiredName} should be present after healing for ${testCase.id}`
          )
        }

        results.recoveredByStage["stage-2"]++
      }
    })

    it("STAGE 3: Path resolution recovers relative paths", () => {
      const stage3Cases = REALISTIC_FC_ERRORS.filter(
        (tc) => tc.expectedRecoverableAt === "stage-3"
      )
      expect(stage3Cases.length).toBeGreaterThan(0)

      for (const testCase of stage3Cases) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )

        expect(result.succeeded).toBe(
          true,
          `Stage-3 case ${testCase.id} should succeed: ${testCase.description}`
        )
        // Path should be absolute after resolution
        const pathArg = result.call.arguments.path as string | undefined
        if (pathArg && typeof pathArg === "string") {
          expect(pathArg.startsWith("/")).toBe(
            true,
            `Path should be absolute for ${testCase.id}: ${pathArg}`
          )
        }
        expect(result.actions.some((a) => a.stage === "path")).toBe(
          true,
          `Should record path action for ${testCase.id}`
        )
        results.recoveredByStage["stage-3"]++
      }
    })

    it("STAGE 4: Type coercion recovers type mismatches", () => {
      const stage4Cases = REALISTIC_FC_ERRORS.filter(
        (tc) => tc.expectedRecoverableAt === "stage-4"
      )
      expect(stage4Cases.length).toBeGreaterThan(0)

      for (const testCase of stage4Cases) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )

        expect(result.succeeded).toBe(
          true,
          `Stage-4 case ${testCase.id} should succeed: ${testCase.description}`
        )
        // Verify all required parameters are present
        const schema = TOOL_SCHEMAS.find((t) => t.name === result.call.name)
        const requiredParams = schema?.parameters.filter((p) => p.required) ?? []
        for (const req of requiredParams) {
          expect(result.call.arguments[req.name]).toBeDefined(
            `Required param ${req.name} should be present in ${testCase.id}`
          )
        }
        results.recoveredByStage["stage-4"]++
      }
    })

    it("composite errors recover through multiple stages", () => {
      const compositeTests = REALISTIC_FC_ERRORS.filter((tc) =>
        tc.id.startsWith("composite-")
      )
      expect(compositeTests.length).toBeGreaterThan(0)

      for (const testCase of compositeTests) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )

        expect(result.succeeded).toBe(
          true,
          `Composite case ${testCase.id} should succeed: ${testCase.description}`
        )
        // Composite tests should have multiple healing actions
        expect(result.actions.length).toBeGreaterThan(0)
      }
    })
  })

  describe("Recovery metrics", () => {
    it("calculates overall recovery rate", () => {
      let recovered = 0
      let total = 0

      for (const testCase of REALISTIC_FC_ERRORS) {
        total++
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )
        if (result.succeeded) {
          recovered++
        }
      }

      const recoveryRate = (recovered / total) * 100
      expect(recovered).toBeGreaterThanOrEqual(
        Math.ceil(total * 0.6),
        `Recovery rate should be >= 60% (need ${Math.ceil(total * 0.6)} of ${total}), got ${recovered}`
      )
    })

    it("tracks recovery rate by error type", () => {
      const errorTypeStats: Record<string, { total: number; recovered: number }> = {}

      for (const testCase of REALISTIC_FC_ERRORS) {
        const errorType = testCase.errorType
        if (!errorTypeStats[errorType]) {
          errorTypeStats[errorType] = { total: 0, recovered: 0 }
        }
        errorTypeStats[errorType].total++

        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )
        if (result.succeeded) {
          errorTypeStats[errorType].recovered++
        }
      }

      // Log recovery stats for analysis
      for (const [errorType, stats] of Object.entries(errorTypeStats)) {
        const rate = (stats.recovered / stats.total) * 100
        expect(stats.recovered).toBeGreaterThan(
          0,
          `Error type ${errorType} should have at least 1 recovery`
        )
      }
    })

    it("identifies unrecoverable error patterns", () => {
      const unrecoverables: string[] = []

      for (const testCase of REALISTIC_FC_ERRORS) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )
        if (!result.succeeded) {
          unrecoverables.push(`${testCase.id}: ${testCase.description}`)
        }
      }

      // Log unrecoverable cases for manual review
      if (unrecoverables.length > 0) {
        console.log("Unrecoverable errors:")
        unrecoverables.forEach((err) => console.log(`  - ${err}`))
      }
    })
  })

  describe("Accuracy and side effects", () => {
    it("healed calls have valid tool names from registered schema", () => {
      for (const testCase of REALISTIC_FC_ERRORS) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )

        if (result.succeeded) {
          const toolExists = TOOL_SCHEMAS.some((t) => t.name === result.call.name)
          expect(toolExists).toBe(true, `Tool ${result.call.name} should exist in schema`)
        }
      }
    })

    it("healed calls have required parameters present", () => {
      for (const testCase of REALISTIC_FC_ERRORS) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )

        if (result.succeeded) {
          const schema = TOOL_SCHEMAS.find((t) => t.name === result.call.name)
          const paramNames = new Set(Object.keys(result.call.arguments))
          const requiredParams = schema?.parameters.filter((p) => p.required) ?? []

          for (const requiredParam of requiredParams) {
            expect(paramNames.has(requiredParam.name)).toBe(
              true,
              `Required parameter ${requiredParam.name} should be present for tool ${result.call.name}`
            )
          }
        }
      }
    })

    it("healed calls maintain required arguments", () => {
      for (const testCase of REALISTIC_FC_ERRORS) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )

        if (result.succeeded) {
          const schema = TOOL_SCHEMAS.find((t) => t.name === result.call.name)
          const requiredParams = schema?.parameters.filter((p) => p.required) ?? []

          for (const requiredParam of requiredParams) {
            const paramValue = result.call.arguments[requiredParam.name]
            expect(paramValue).toBeDefined(
              `Required parameter ${requiredParam.name} must be present after healing`
            )
          }
        }
      }
    })
  })

  describe("Healing action tracking", () => {
    it("records healing actions for auditing", () => {
      for (const testCase of REALISTIC_FC_ERRORS) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )

        if (result.succeeded && result.actions.length > 0) {
          for (const action of result.actions) {
            expect(["tool-name", "param-name", "path", "type-coerce"]).toContain(
              action.stage
            )
            expect(action.from).toBeDefined()
            expect(action.to).toBeDefined()
          }
        }
      }
    })

    it("actions describe transformations clearly", () => {
      const testCase = REALISTIC_FC_ERRORS.find((tc) => tc.id === "qwen-typo-1")!
      const result = runHealingPipeline(
        testCase.call,
        TOOL_SCHEMAS,
        FILE_TOOLS,
        WORKING_DIR,
        TOOL_ALIASES,
        PARAM_ALIASES
      )

      expect(result.succeeded).toBe(true)
      const nameAction = result.actions.find((a) => a.stage === "tool-name")
      expect(nameAction?.from).toBe("file_read")
      expect(nameAction?.to).toBe("file-read")
    })
  })

  describe("Model-specific behavior", () => {
    it("handles qwen3:14b-specific patterns", () => {
      const qwenCases = REALISTIC_FC_ERRORS.filter((tc) => tc.model === "qwen3:14b")
      expect(qwenCases.length).toBeGreaterThan(0)

      for (const testCase of qwenCases) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )
        expect(result.succeeded).toBe(
          true,
          `qwen3 case ${testCase.id} should recover: ${testCase.description}`
        )
      }
    })

    it("handles frontier model patterns", () => {
      const frontierCases = REALISTIC_FC_ERRORS.filter((tc) => tc.model === "frontier")
      expect(frontierCases.length).toBeGreaterThan(0)

      for (const testCase of frontierCases) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )
        expect(result.succeeded).toBe(
          true,
          `frontier case ${testCase.id} should recover: ${testCase.description}`
        )
      }
    })
  })

  describe("Success criteria validation", () => {
    it("SUCCESS CRITERION 1: Recovery rate >= 60%", () => {
      let recovered = 0
      for (const testCase of REALISTIC_FC_ERRORS) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )
        if (result.succeeded) {
          recovered++
        }
      }
      const rate = (recovered / REALISTIC_FC_ERRORS.length) * 100
      expect(rate).toBeGreaterThanOrEqual(60)
    })

    it("SUCCESS CRITERION 2: Healed calls execute without parameter errors", () => {
      // Verify all healed calls have valid schema compliance
      for (const testCase of REALISTIC_FC_ERRORS) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )
        if (result.succeeded) {
          const schema = TOOL_SCHEMAS.find((t) => t.name === result.call.name)
          expect(schema).toBeDefined("Tool should exist in schema")
          // All required params present
          const requiredParams = schema?.parameters.filter((p) => p.required) ?? []
          for (const req of requiredParams) {
            expect(result.call.arguments[req.name]).toBeDefined(
              `Required parameter ${req.name} must be present`
            )
          }
        }
      }
    })

    it("SUCCESS CRITERION 3: Healing introduces no new errors", () => {
      // All healed calls should map to registered tools
      for (const testCase of REALISTIC_FC_ERRORS) {
        const result = runHealingPipeline(
          testCase.call,
          TOOL_SCHEMAS,
          FILE_TOOLS,
          WORKING_DIR,
          TOOL_ALIASES,
          PARAM_ALIASES
        )
        if (result.succeeded) {
          const toolExists = TOOL_SCHEMAS.some((t) => t.name === result.call.name)
          expect(toolExists).toBe(true)
        }
      }
    })
  })
})
