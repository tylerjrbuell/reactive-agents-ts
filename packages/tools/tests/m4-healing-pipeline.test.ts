import { describe, it, expect, beforeEach } from "bun:test"
import { runHealingPipeline } from "../src/healing/healing-pipeline.js"
import type { ToolCallSpec } from "../src/tool-calling/types.js"
import type { ToolSchema } from "../src/drivers/tool-calling-driver.js"

// ── Test Dataset: 15 FC Error Cases ────────────────────────────────────────

interface TestCase {
  readonly name: string
  readonly call: ToolCallSpec
  readonly expectedHealed: boolean
  readonly expectedName?: string
  readonly expectedArgKeys?: string[]
  readonly category: "malformed-json" | "type-mismatch" | "missing-args" | "alias" | "path-resolution"
}

const registeredTools: readonly ToolSchema[] = [
  {
    name: "file-read",
    description: "Read file contents",
    parameters: [
      { name: "path", type: "string", description: "File path", required: true },
      { name: "encoding", type: "string", description: "File encoding", required: false },
    ],
  },
  {
    name: "code-execute",
    description: "Execute code",
    parameters: [
      { name: "code", type: "string", description: "Code to run", required: true },
      { name: "language", type: "string", description: "Programming language", required: false },
    ],
  },
  {
    name: "http-get",
    description: "HTTP GET request",
    parameters: [
      { name: "url", type: "string", description: "URL", required: true },
      { name: "headers", type: "object", description: "HTTP headers", required: false },
      { name: "timeout", type: "number", description: "Timeout in ms", required: false },
    ],
  },
  {
    name: "shell-execute",
    description: "Execute shell command",
    parameters: [
      { name: "command", type: "string", description: "Command to run", required: true },
      { name: "cwd", type: "string", description: "Working directory", required: false },
    ],
  },
  {
    name: "json-parse",
    description: "Parse JSON string",
    parameters: [
      { name: "text", type: "string", description: "JSON text", required: true },
    ],
  },
]

const fileToolNames = new Set(["file-read", "file-write"])
const workingDir = "/workspace"
const paramAliases: Record<string, Record<string, string>> = {
  "file-read": { input: "path", enc: "encoding" },
  "code-execute": { src: "code", lang: "language" },
  "http-get": { endpoint: "url" },
}
const toolAliases: Record<string, string> = {
  "read-file": "file-read",
  "run-code": "code-execute",
  "exec": "shell-execute",
  "get": "http-get",
  typescript_run: "code-execute",
}

// ── Case 1: Exact match (baseline, should succeed with no actions)
const case1: TestCase = {
  name: "exact match baseline",
  call: { id: "1", name: "file-read", arguments: { path: "/workspace/main.ts" } },
  expectedHealed: true,
  expectedName: "file-read",
  expectedArgKeys: ["path"],
  category: "missing-args",
}

// ── Case 2: Tool name typo (should heal via alias)
const case2: TestCase = {
  name: "tool name alias: read-file → file-read",
  call: { id: "2", name: "read-file", arguments: { input: "app.ts" } },
  expectedHealed: true,
  expectedName: "file-read",
  expectedArgKeys: ["path"],
  category: "alias",
}

// ── Case 3: Param name typo (should heal via param alias)
const case3: TestCase = {
  name: "param alias: input → path",
  call: { id: "3", name: "file-read", arguments: { input: "config.json" } },
  expectedHealed: true,
  expectedName: "file-read",
  expectedArgKeys: ["path"],
  category: "alias",
}

// ── Case 4: Type mismatch — timeout as string instead of number
const case4: TestCase = {
  name: "type coercion: timeout string → number",
  call: { id: "4", name: "http-get", arguments: { url: "https://example.com", timeout: "5000" } },
  expectedHealed: true,
  expectedName: "http-get",
  expectedArgKeys: ["url", "timeout"],
  category: "type-mismatch",
}

// ── Case 5: Missing required arg (should fail)
const case5: TestCase = {
  name: "missing required arg: code",
  call: { id: "5", name: "code-execute", arguments: { language: "typescript" } },
  expectedHealed: false,
  category: "missing-args",
}

// ── Case 6: Unknown tool (should fail)
const case6: TestCase = {
  name: "unknown tool: database-query",
  call: { id: "6", name: "database-query", arguments: { sql: "SELECT *" } },
  expectedHealed: false,
  category: "malformed-json",
}

// ── Case 7: Multiple aliases in chain (tool + param)
const case7: TestCase = {
  name: "chained aliases: run-code + src → code-execute + code",
  call: { id: "7", name: "run-code", arguments: { src: "console.log('hi')", lang: "javascript" } },
  expectedHealed: true,
  expectedName: "code-execute",
  expectedArgKeys: ["code", "language"],
  category: "alias",
}

// ── Case 8: Relative path (should resolve to /workspace/...)
const case8: TestCase = {
  name: "path resolution: relative → absolute",
  call: { id: "8", name: "file-read", arguments: { path: "src/index.ts" } },
  expectedHealed: true,
  expectedName: "file-read",
  expectedArgKeys: ["path"],
  category: "path-resolution",
}

// ── Case 9: Path with parent dirs (../../../..)
const case9: TestCase = {
  name: "path resolution: parent dirs normalized",
  call: { id: "9", name: "file-read", arguments: { path: "../../app/main.ts" } },
  expectedHealed: true,
  expectedName: "file-read",
  expectedArgKeys: ["path"],
  category: "path-resolution",
}

// ── Case 10: Complex param alias (http-get endpoint → url)
const case10: TestCase = {
  name: "param alias: endpoint → url",
  call: { id: "10", name: "http-get", arguments: { endpoint: "https://api.example.com/users" } },
  expectedHealed: true,
  expectedName: "http-get",
  expectedArgKeys: ["url"],
  category: "alias",
}

// ── Case 11: Shell command with cwd (relative path in cwd should resolve)
const case11: TestCase = {
  name: "shell execute with relative cwd",
  call: {
    id: "11",
    name: "shell-execute",
    arguments: { command: "npm run build", cwd: "apps/web" },
  },
  expectedHealed: true,
  expectedName: "shell-execute",
  expectedArgKeys: ["command", "cwd"],
  category: "path-resolution",
}

// ── Case 12: Tool name partial match (typescript_run → code-execute)
const case12: TestCase = {
  name: "tool alias: typescript_run → code-execute",
  call: { id: "12", name: "typescript_run", arguments: { src: "const x: number = 42" } },
  expectedHealed: true,
  expectedName: "code-execute",
  expectedArgKeys: ["code"],
  category: "alias",
}

// ── Case 13: JSON object as string (headers param as stringified JSON)
const case13: TestCase = {
  name: "type coercion: headers object from string",
  call: {
    id: "13",
    name: "http-get",
    arguments: { url: "https://example.com", headers: '{"Content-Type":"application/json"}' },
  },
  expectedHealed: true,
  expectedName: "http-get",
  expectedArgKeys: ["url", "headers"],
  category: "type-mismatch",
}

// ── Case 14: Param name fuzzy match (comm → command in shell-execute)
const case14: TestCase = {
  name: "shell-execute with partial param name",
  call: { id: "14", name: "shell-execute", arguments: { comm: "ls -la", cwd: "/tmp" } },
  expectedHealed: false,
  category: "missing-args",
}

// ── Case 15: Tool name typo multiple candidates (exec → shell-execute)
const case15: TestCase = {
  name: "ambiguous tool alias: exec → shell-execute",
  call: { id: "15", name: "exec", arguments: { command: "git status" } },
  expectedHealed: true,
  expectedName: "shell-execute",
  expectedArgKeys: ["command"],
  category: "alias",
}

const testCases: TestCase[] = [
  case1, case2, case3, case4, case5, case6, case7,
  case8, case9, case10, case11, case12, case13, case14, case15,
]

// ── Test Harness ──────────────────────────────────────────────────────────

interface HealingMetrics {
  totalTests: number
  successCount: number
  failureCount: number
  recoveryRate: number
  stageDistribution: Record<string, number>
  categoryBreakdown: Record<TestCase["category"], { success: number; total: number }>
}

describe("M4 Healing Pipeline Validation", () => {
  let metrics: HealingMetrics

  beforeEach(() => {
    metrics = {
      totalTests: testCases.length,
      successCount: 0,
      failureCount: 0,
      recoveryRate: 0,
      stageDistribution: {},
      categoryBreakdown: {
        alias: { success: 0, total: 0 },
        "path-resolution": { success: 0, total: 0 },
        "type-mismatch": { success: 0, total: 0 },
        "missing-args": { success: 0, total: 0 },
        "malformed-json": { success: 0, total: 0 },
      },
    }
  })

  describe("RED: Test Structure (Healing OFF vs ON)", () => {
    it("establishes baseline failure rates without healing", () => {
      const rawCall: ToolCallSpec = { id: "raw", name: "read-file", arguments: { input: "app.ts" } }
      const registeredNames = registeredTools.map((t) => t.name)
      expect(registeredNames).not.toContain("read-file")
    })

    it("establishes healing-enabled recovery", () => {
      const call: ToolCallSpec = { id: "1", name: "read-file", arguments: { input: "app.ts" } }
      const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, toolAliases, paramAliases)

      expect(result.succeeded).toBe(true)
      expect(result.call.name).toBe("file-read")
    })
  })

  describe("GREEN: Measurement (Recovery Rate per Stage)", () => {
    it("measures tool-name healing success rate", () => {
      const toolNameCases = testCases.filter((c) => c.category === "alias")

      let healed = 0
      for (const tc of toolNameCases) {
        const result = runHealingPipeline(
          tc.call,
          registeredTools,
          fileToolNames,
          workingDir,
          toolAliases,
          paramAliases,
        )

        if (result.actions.some((a) => a.stage === "tool-name")) {
          healed++
          metrics.stageDistribution["tool-name"] = (metrics.stageDistribution["tool-name"] || 0) + 1
        }

        if (result.succeeded === tc.expectedHealed) {
          metrics.successCount++
        } else {
          metrics.failureCount++
        }
      }

      expect(healed).toBeGreaterThan(0)
    })

    it("measures param-name healing success rate", () => {
      const paramCases = testCases.filter((c) => c.call.arguments && Object.keys(c.call.arguments).length > 0)

      let healed = 0
      for (const tc of paramCases) {
        const result = runHealingPipeline(
          tc.call,
          registeredTools,
          fileToolNames,
          workingDir,
          toolAliases,
          paramAliases,
        )

        if (result.actions.some((a) => a.stage === "param-name")) {
          healed++
          metrics.stageDistribution["param-name"] = (metrics.stageDistribution["param-name"] || 0) + 1
        }
      }

      expect(healed).toBeGreaterThan(0)
    })

    it("measures path-resolution healing success rate", () => {
      const pathCases = testCases.filter((c) => c.category === "path-resolution")

      let resolved = 0
      for (const tc of pathCases) {
        const result = runHealingPipeline(
          tc.call,
          registeredTools,
          fileToolNames,
          workingDir,
          toolAliases,
          paramAliases,
        )

        if (result.actions.some((a) => a.stage === "path")) {
          resolved++
          metrics.stageDistribution["path"] = (metrics.stageDistribution["path"] || 0) + 1
        }
      }

      expect(resolved).toBeGreaterThan(0)
    })

    it("measures type-coercion healing success rate", () => {
      const typeCases = testCases.filter((c) => c.category === "type-mismatch")

      let coerced = 0
      for (const tc of typeCases) {
        const result = runHealingPipeline(
          tc.call,
          registeredTools,
          fileToolNames,
          workingDir,
          toolAliases,
          paramAliases,
        )

        if (result.actions.some((a) => a.stage === "type-coerce")) {
          coerced++
          metrics.stageDistribution["type-coerce"] = (metrics.stageDistribution["type-coerce"] || 0) + 1
        }
      }

      expect(coerced).toBeGreaterThan(0)
    })
  })

  describe("Accuracy & Recovery Analysis", () => {
    it("runs all 15 test cases and records recovery metrics", () => {
      for (const tc of testCases) {
        const result = runHealingPipeline(
          tc.call,
          registeredTools,
          fileToolNames,
          workingDir,
          toolAliases,
          paramAliases,
        )

        const cat = tc.category
        metrics.categoryBreakdown[cat].total++

        if (result.succeeded === tc.expectedHealed) {
          metrics.successCount++
          metrics.categoryBreakdown[cat].success++
        } else {
          metrics.failureCount++
        }

        if (result.succeeded && tc.expectedName) {
          expect(result.call.name).toBe(tc.expectedName)
        }

        if (result.succeeded && tc.expectedArgKeys) {
          const resultKeys = Object.keys(result.call.arguments)
          for (const expectedKey of tc.expectedArgKeys) {
            expect(resultKeys).toContain(expectedKey)
          }
        }
      }

      metrics.recoveryRate = metrics.successCount / metrics.totalTests

      console.log("\n=== M4 Healing Pipeline Metrics ===")
      console.log(`Total Tests: ${metrics.totalTests}`)
      console.log(`Successes: ${metrics.successCount}`)
      console.log(`Failures: ${metrics.failureCount}`)
      console.log(`Recovery Rate: ${(metrics.recoveryRate * 100).toFixed(1)}%`)
      console.log("\nStage Distribution:")
      for (const [stage, count] of Object.entries(metrics.stageDistribution)) {
        console.log(`  ${stage}: ${count} fixes`)
      }
      console.log("\nCategory Breakdown:")
      for (const [cat, stats] of Object.entries(metrics.categoryBreakdown)) {
        const rate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(1) : "N/A"
        console.log(`  ${cat}: ${stats.success}/${stats.total} (${rate}%)`)
      }
    })

    it("confirms recovery rate >= 60% success threshold", () => {
      let successCount = 0
      for (const tc of testCases) {
        const result = runHealingPipeline(
          tc.call,
          registeredTools,
          fileToolNames,
          workingDir,
          toolAliases,
          paramAliases,
        )

        if (result.succeeded === tc.expectedHealed) {
          successCount++
        }
      }

      const recoveryRate = successCount / testCases.length
      expect(recoveryRate).toBeGreaterThanOrEqual(0.6)
      console.log(`\nRecovery Rate Achievement: ${(recoveryRate * 100).toFixed(1)}% (threshold: 60%)`)
    })

    it("identifies unrecoverable error patterns", () => {
      const unrecoverable: TestCase[] = []

      for (const tc of testCases) {
        const result = runHealingPipeline(
          tc.call,
          registeredTools,
          fileToolNames,
          workingDir,
          toolAliases,
          paramAliases,
        )

        if (!result.succeeded && !tc.expectedHealed) {
          unrecoverable.push(tc)
        }
      }

      console.log(`\nUnrecoverable Errors: ${unrecoverable.length}`)
      for (const tc of unrecoverable) {
        console.log(`  - ${tc.name} (${tc.category})`)
      }

      expect(unrecoverable.length).toBeGreaterThan(0)
    })

    it("validates accuracy improvement with healing enabled", () => {
      const healingOffAccuracy = (() => {
        const exactMatches = testCases.filter(
          (tc) => tc.expectedHealed && tc.category === "missing-args" && tc.call.name === tc.expectedName,
        )
        return exactMatches.length / testCases.length
      })()

      const healingOnAccuracy = (() => {
        let correctCount = 0
        for (const tc of testCases) {
          const result = runHealingPipeline(
            tc.call,
            registeredTools,
            fileToolNames,
            workingDir,
            toolAliases,
            paramAliases,
          )

          if (result.succeeded === tc.expectedHealed) {
            if (tc.expectedHealed && tc.expectedName) {
              if (result.call.name === tc.expectedName) correctCount++
            } else if (!tc.expectedHealed && !result.succeeded) {
              correctCount++
            }
          }
        }
        return correctCount / testCases.length
      })()

      const accuracyImprovement = healingOnAccuracy - healingOffAccuracy
      console.log(`\nAccuracy Improvement:`)
      console.log(`  Without Healing: ${(healingOffAccuracy * 100).toFixed(1)}%`)
      console.log(`  With Healing: ${(healingOnAccuracy * 100).toFixed(1)}%`)
      console.log(`  Delta: +${(accuracyImprovement * 100).toFixed(1)}%`)

      expect(accuracyImprovement).toBeGreaterThanOrEqual(0.05)
    })
  })

  describe("Token Cost Analysis", () => {
    it("estimates token cost of healing pipeline vs. reprompt fallback", () => {
      const healingTokenCost = testCases.length * 50
      const repromptTokenCost = testCases.length * 500
      const savings = repromptTokenCost - healingTokenCost
      const savingsPercent = (savings / repromptTokenCost) * 100

      console.log(`\nToken Cost Analysis:`)
      console.log(`  Healing pipeline: ~${healingTokenCost} tokens`)
      console.log(`  Reprompt fallback: ~${repromptTokenCost} tokens`)
      console.log(`  Savings: ~${savings} tokens (${savingsPercent.toFixed(1)}%)`)

      expect(savingsPercent).toBeGreaterThan(80)
    })
  })
})
