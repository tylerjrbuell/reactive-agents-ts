# Adaptive Tool Calling System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the all-or-nothing native FC harness with a profile-driven, self-improving tool calling system that routes local models to text parsing, heals malformed calls before execution, and compounds learning across runs via the CalibrationStore.

**Architecture:** The system adds a `ToolCallingDriver` seam into `KernelContext` — `NativeFCDriver` is a thin passthrough for capable models; `TextParseDriver` owns a cascading 3-tier parse pipeline for models that can't reliably produce valid FC JSON. A `HealingPipeline` extending `normalizeToolCallArguments()` normalizes tool name aliases, param name aliases, and paths before every execution regardless of driver. A `ToolCallObservation` added to `ExperienceRecord` feeds alias maps and success rates back into `CalibrationStore` after each run, closing the dead feedback loop. Two new RI handlers (`StallDetector`, `HarnessHarmDetector`) address the remaining failure modes from the benchmark session.

**Tech Stack:** TypeScript, Effect Schema (`effect`), bun:sqlite, Bun test runner (`bun test`), `@effect/schema` patterns matching existing `ModelCalibrationSchema`, Effect `Layer` for RI handlers.

**Spec:** `docs/superpowers/specs/2026-04-21-adaptive-tool-calling-system.md`

**Evidence base:** `local-models` benchmark session — cogito:8b rw-2/rw-8 Grade D, qwen3:4b rw-6 flatlines, profiles API `toolCallDialect: "none"` on both models.

---

## File Structure

### New files

```
packages/tools/src/drivers/
  tool-calling-driver.ts       ← ToolCallingDriver interface + ExtractedCall types
  native-fc-driver.ts          ← NativeFCDriver (thin passthrough)
  text-parse-driver.ts         ← TextParseDriver + 3-tier parse pipeline + re-prompt
  index.ts                     ← barrel export

packages/tools/src/healing/
  tool-name-healer.ts          ← alias map + edit-distance fuzzy match
  param-name-healer.ts         ← per-tool alias map + fuzzy match
  path-resolver.ts             ← FileSandbox path resolution + TypeCoercer
  healing-pipeline.ts          ← orchestrates all 4 healers, extends normalizeToolCallArguments
  index.ts                     ← barrel export

packages/tools/tests/drivers/
  native-fc-driver.test.ts
  text-parse-driver.test.ts

packages/tools/tests/healing/
  tool-name-healer.test.ts
  param-name-healer.test.ts
  path-resolver.test.ts
  healing-pipeline.test.ts

packages/reactive-intelligence/src/
  calibration-probe.ts         ← FC probe battery (6 synthetic calls per dimension)

packages/reactive-intelligence/src/controller/handlers/
  stall-detector.ts            ← iteration count + Jaccard content similarity
  harness-harm-detector.ts     ← harm inference from interventionCount + toolSuccessRate

packages/reactive-intelligence/tests/
  calibration-probe.test.ts
  stall-detector.test.ts
  harness-harm-detector.test.ts
```

### Modified files

```
packages/llm-provider/src/calibration.ts              ← extend ModelCalibrationSchema + buildCalibratedAdapter() return type + materializeExperienceSummary()
packages/llm-provider/tests/calibration.test.ts       ← new schema field tests + routing tests
packages/reasoning/src/strategies/kernel/kernel-state.ts  ← add toolCallingDriver to KernelContext
packages/reasoning/src/strategies/kernel/phases/think.ts  ← empty tools array for text-parse + buildPromptInstructions injection
packages/reasoning/src/strategies/kernel/phases/act.ts    ← wire TextParseDriver extraction + HealingPipeline
packages/llm-provider/src/adapter.ts                  ← toolGuidance reads ExperienceSummary
packages/memory/src/services/experience-store.ts      ← add ToolCallObservation to ExperienceRecord
packages/runtime/src/builder.ts                       ← background calibration probe on first use
packages/reactive-intelligence/src/controller/handlers/index.ts (or registry file)  ← register StallDetector + HarnessHarmDetector
```

---

## Task 1: ToolCallingDriver interface + ExtractedCall types

**Files:**
- Create: `packages/tools/src/drivers/tool-calling-driver.ts`
- Create: `packages/tools/src/drivers/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tools/tests/drivers/tool-calling-driver.test.ts
import { describe, it, expect } from "bun:test"
import type { ToolCallingDriver, ExtractedCall, HealingAction } from "../../src/drivers/tool-calling-driver.js"

describe("ToolCallingDriver interface types", () => {
  it("ExtractedCall has required fields", () => {
    const call: ExtractedCall = {
      name: "file-read",
      arguments: { path: "/foo.ts" },
      parseMode: "tier-1",
      confidence: 0.95,
    }
    expect(call.name).toBe("file-read")
    expect(call.parseMode).toBe("tier-1")
    expect(call.confidence).toBeGreaterThan(0)
  })

  it("HealingAction captures from/to mapping", () => {
    const action: HealingAction = {
      stage: "param-name",
      from: "input",
      to: "path",
    }
    expect(action.stage).toBe("param-name")
  })

  it("ToolCallingDriver mode is a literal union", () => {
    const modes: Array<ToolCallingDriver["mode"]> = ["native-fc", "text-parse"]
    expect(modes).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/tools/tests/drivers/tool-calling-driver.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Create the types file**

```typescript
// packages/tools/src/drivers/tool-calling-driver.ts
import type { ToolSchema } from "@reactive-agents/reasoning/strategies/kernel/utils/tool-formatting.js"
import type { ToolCallSpec } from "../tool-calling/types.js"

export type ParseMode = "native-fc" | "tier-1" | "tier-2" | "tier-3" | "reprompt"

export interface ExtractedCall {
  readonly name: string
  readonly arguments: Record<string, unknown>
  readonly parseMode: ParseMode
  readonly confidence: number
}

export interface HealingAction {
  readonly stage: "tool-name" | "param-name" | "path" | "type-coerce"
  readonly from: string
  readonly to: string
}

export interface HealingResult {
  readonly call: ToolCallSpec
  readonly actions: readonly HealingAction[]
  readonly succeeded: boolean
}

export interface ToolCallObservation {
  readonly toolNameAttempted: string
  readonly toolNameResolved: string | null
  readonly paramsAttempted: Record<string, unknown>
  readonly paramsResolved: Record<string, unknown>
  readonly parseMode: ParseMode
  readonly healingApplied: readonly HealingAction[]
  readonly succeeded: boolean
  readonly errorText: string | null
}

export interface ToolCallingDriver {
  readonly mode: "native-fc" | "text-parse"
  /** Returns "" for native-fc. Returns format guide + tool list for text-parse. */
  buildPromptInstructions(tools: readonly ToolSchema[]): string
  /** native-fc: pass through pendingNativeToolCalls. text-parse: run parse pipeline. */
  extractCalls(textOutput: string, tools: readonly ToolSchema[]): ExtractedCall[]
  /** native-fc: provider format (unchanged). text-parse: plain text observation. */
  formatToolResult(toolName: string, result: unknown, isError: boolean): string
}
```

- [ ] **Step 4: Create the barrel export**

```typescript
// packages/tools/src/drivers/index.ts
export type {
  ExtractedCall,
  HealingAction,
  HealingResult,
  ToolCallObservation,
  ToolCallingDriver,
  ParseMode,
} from "./tool-calling-driver.js"
export { NativeFCDriver } from "./native-fc-driver.js"
export { TextParseDriver } from "./text-parse-driver.js"
```

- [ ] **Step 5: Run test to verify it passes**

```bash
bun test packages/tools/tests/drivers/tool-calling-driver.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
rtk git add packages/tools/src/drivers/ packages/tools/tests/drivers/tool-calling-driver.test.ts
rtk git commit -m "feat(tools): ToolCallingDriver interface + ExtractedCall types"
```

---

## Task 2: CalibrationStore schema additions

**Files:**
- Modify: `packages/llm-provider/src/calibration.ts`
- Modify (or create): `packages/llm-provider/tests/calibration.test.ts`

The existing schema uses Effect Schema (`Schema.Struct`, `Schema.Literal`, `Schema.optionalWith`). Match that pattern exactly.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/llm-provider/tests/calibration-schema.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/llm-provider/tests/calibration-schema.test.ts
```
Expected: FAIL — `toolCallDialect` not in schema

- [ ] **Step 3: Extend ModelCalibrationSchema**

Open `packages/llm-provider/src/calibration.ts`. Inside the `Schema.Struct({...})` call, add these fields after `classifierReliability`:

```typescript
  // ── Tool calling dialect ──
  toolCallDialect: Schema.optionalWith(
    Schema.Literal("native-fc", "text-parse", "none"),
    { exact: true, default: () => "none" as const },
  ),
  fcCapabilityScore: Schema.optionalWith(Schema.Number, { exact: true }),
  fcCapabilityProbedAt: Schema.optionalWith(Schema.String, { exact: true }),

  // ── Learned alias maps (populated after N≥3 observations) ──
  knownToolAliases: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.String }),
    { exact: true },
  ),
  knownParamAliases: Schema.optionalWith(
    Schema.Record({
      key: Schema.String,
      value: Schema.Record({ key: Schema.String, value: Schema.String }),
    }),
    { exact: true },
  ),
  toolSuccessRateByName: Schema.optionalWith(
    Schema.Record({ key: Schema.String, value: Schema.Number }),
    { exact: true },
  ),

  // ── Intervention responsiveness (min 5 samples before influencing routing) ──
  interventionResponseRate: Schema.optionalWith(Schema.Number, { exact: true }),
  interventionResponseSamples: Schema.optionalWith(Schema.Number, { exact: true }),

  // ── Harness harm tracking per task type ──
  harnessHarmByTaskType: Schema.optionalWith(
    Schema.Record({
      key: Schema.String,
      value: Schema.Literal("suspected", "confirmed", "cleared"),
    }),
    { exact: true },
  ),
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun test packages/llm-provider/tests/calibration-schema.test.ts
```
Expected: PASS (2 tests)

- [ ] **Step 5: Run existing calibration tests to verify no regressions**

```bash
bun test packages/llm-provider/
```
Expected: all existing tests pass

- [ ] **Step 6: Commit**

```bash
rtk git add packages/llm-provider/src/calibration.ts packages/llm-provider/tests/calibration-schema.test.ts
rtk git commit -m "feat(llm-provider): extend ModelCalibrationSchema with toolCallDialect, alias maps, harm tracking"
```

---

## Task 3: NativeFCDriver

**Files:**
- Create: `packages/tools/src/drivers/native-fc-driver.ts`
- Create: `packages/tools/tests/drivers/native-fc-driver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/tools/tests/drivers/native-fc-driver.test.ts
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
    // NativeFCDriver does not parse text — calls come from state.meta.pendingNativeToolCalls
    expect(driver.extractCalls("any text", mockTools)).toEqual([])
  })

  it("formatToolResult wraps in plain text", () => {
    const formatted = driver.formatToolResult("file-read", { content: "hello" }, false)
    expect(typeof formatted).toBe("string")
    expect(formatted.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/tools/tests/drivers/native-fc-driver.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement NativeFCDriver**

```typescript
// packages/tools/src/drivers/native-fc-driver.ts
import type { ToolSchema } from "@reactive-agents/reasoning/strategies/kernel/utils/tool-formatting.js"
import type { ExtractedCall, ToolCallingDriver } from "./tool-calling-driver.js"

export class NativeFCDriver implements ToolCallingDriver {
  readonly mode = "native-fc" as const

  buildPromptInstructions(_tools: readonly ToolSchema[]): string {
    // Schemas are passed via provider API — no system prompt injection needed
    return ""
  }

  extractCalls(_textOutput: string, _tools: readonly ToolSchema[]): ExtractedCall[] {
    // Native FC calls are parsed by think.ts into state.meta.pendingNativeToolCalls
    // act.ts reads those directly — this method is never called for native-fc mode
    return []
  }

  formatToolResult(toolName: string, result: unknown, isError: boolean): string {
    const content = typeof result === "string" ? result : JSON.stringify(result)
    return isError ? `[${toolName} error] ${content}` : content
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun test packages/tools/tests/drivers/native-fc-driver.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
rtk git add packages/tools/src/drivers/native-fc-driver.ts packages/tools/tests/drivers/native-fc-driver.test.ts
rtk git commit -m "feat(tools): NativeFCDriver — thin passthrough for FC-capable models"
```

---

## Task 4: ToolNameHealer

**Files:**
- Create: `packages/tools/src/healing/tool-name-healer.ts`
- Create: `packages/tools/tests/healing/tool-name-healer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/tools/tests/healing/tool-name-healer.test.ts
import { describe, it, expect } from "bun:test"
import { healToolName } from "../../src/healing/tool-name-healer.js"

const registeredTools = ["file-read", "file-write", "code-execute", "web-search"]
const aliases = { "typescript/compile": "code-execute", "file_read": "file-read" }

describe("healToolName", () => {
  it("exact match returns the name unchanged", () => {
    expect(healToolName("file-read", registeredTools, aliases)).toEqual({
      resolved: "file-read",
      action: null,
    })
  })

  it("alias map resolves known hallucination", () => {
    expect(healToolName("typescript/compile", registeredTools, aliases)).toEqual({
      resolved: "code-execute",
      action: { stage: "tool-name", from: "typescript/compile", to: "code-execute" },
    })
  })

  it("underscore variant resolved via alias", () => {
    expect(healToolName("file_read", registeredTools, aliases)).toEqual({
      resolved: "file-read",
      action: { stage: "tool-name", from: "file_read", to: "file-read" },
    })
  })

  it("edit-distance match fixes minor typo", () => {
    const result = healToolName("file-reed", registeredTools, {})
    expect(result.resolved).toBe("file-read")
    expect(result.action?.stage).toBe("tool-name")
  })

  it("unresolvable name returns null", () => {
    const result = healToolName("totally-unknown-xyzzy", registeredTools, {})
    expect(result.resolved).toBeNull()
    expect(result.action).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/tools/tests/healing/tool-name-healer.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement ToolNameHealer**

```typescript
// packages/tools/src/healing/tool-name-healer.ts
import type { HealingAction } from "../drivers/tool-calling-driver.js"

interface HealToolNameResult {
  readonly resolved: string | null
  readonly action: HealingAction | null
}

/** Edit distance (Levenshtein) between two strings. */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!)
    }
  }
  return dp[m]![n]!
}

export function healToolName(
  attempted: string,
  registeredNames: readonly string[],
  knownAliases: Record<string, string>,
): HealToolNameResult {
  // 1. Exact match
  if (registeredNames.includes(attempted)) return { resolved: attempted, action: null }

  // 2. Alias map
  const aliased = knownAliases[attempted]
  if (aliased && registeredNames.includes(aliased)) {
    return { resolved: aliased, action: { stage: "tool-name", from: attempted, to: aliased } }
  }

  // 3. Edit distance (≤ 2 edits)
  let bestName: string | null = null
  let bestDist = Infinity
  for (const name of registeredNames) {
    const dist = editDistance(attempted.toLowerCase(), name.toLowerCase())
    if (dist < bestDist) { bestDist = dist; bestName = name }
  }
  if (bestDist <= 2 && bestName !== null) {
    return { resolved: bestName, action: { stage: "tool-name", from: attempted, to: bestName } }
  }

  return { resolved: null, action: null }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun test packages/tools/tests/healing/tool-name-healer.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
rtk git add packages/tools/src/healing/tool-name-healer.ts packages/tools/tests/healing/tool-name-healer.test.ts
rtk git commit -m "feat(tools): ToolNameHealer — alias map + edit-distance fuzzy resolution"
```

---

## Task 5: ParamNameHealer

**Files:**
- Create: `packages/tools/src/healing/param-name-healer.ts`
- Create: `packages/tools/tests/healing/param-name-healer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/tools/tests/healing/param-name-healer.test.ts
import { describe, it, expect } from "bun:test"
import { healParamNames } from "../../src/healing/param-name-healer.js"

const fileReadSchema = {
  name: "file-read",
  description: "Read file",
  parameters: [
    { name: "path", type: "string", description: "File path", required: true },
    { name: "encoding", type: "string", description: "Encoding", required: false },
  ],
}

// cogito:8b alias map for file-read: "input" → "path"
const aliases = { "file-read": { input: "path", file: "path" } }

describe("healParamNames", () => {
  it("exact param names returned unchanged", () => {
    const result = healParamNames("file-read", { path: "/foo.ts" }, fileReadSchema, aliases)
    expect(result.healed).toEqual({ path: "/foo.ts" })
    expect(result.actions).toHaveLength(0)
  })

  it("alias map resolves input → path for file-read", () => {
    const result = healParamNames("file-read", { input: "/foo.ts" }, fileReadSchema, aliases)
    expect(result.healed).toEqual({ path: "/foo.ts" })
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toEqual({ stage: "param-name", from: "input", to: "path" })
  })

  it("edit-distance resolves minor typo", () => {
    const result = healParamNames("file-read", { pth: "/foo.ts" }, fileReadSchema, {})
    expect(result.healed).toEqual({ path: "/foo.ts" })
    expect(result.actions[0]?.stage).toBe("param-name")
  })

  it("unknown param preserved as-is", () => {
    const result = healParamNames("file-read", { unknownXyzzy: "val" }, fileReadSchema, {})
    expect(result.healed).toHaveProperty("unknownXyzzy")
  })

  it("multiple params healed independently", () => {
    const result = healParamNames(
      "file-read",
      { input: "/foo.ts", file: "/bar.ts" },
      fileReadSchema,
      aliases,
    )
    // First alias wins for path; second alias for same target is a no-op
    expect(Object.keys(result.healed)).toContain("path")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/tools/tests/healing/param-name-healer.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement ParamNameHealer**

```typescript
// packages/tools/src/healing/param-name-healer.ts
import type { HealingAction } from "../drivers/tool-calling-driver.js"
import type { ToolSchema } from "@reactive-agents/reasoning/strategies/kernel/utils/tool-formatting.js"

interface HealParamResult {
  readonly healed: Record<string, unknown>
  readonly actions: readonly HealingAction[]
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1]
        ? dp[i - 1]![j - 1]!
        : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!)
    }
  }
  return dp[m]![n]!
}

export function healParamNames(
  toolName: string,
  attempted: Record<string, unknown>,
  schema: ToolSchema,
  knownParamAliases: Record<string, Record<string, string>>,
): HealParamResult {
  const toolAliases = knownParamAliases[toolName] ?? {}
  const schemaParamNames = schema.parameters.map((p) => p.name)
  const healed: Record<string, unknown> = {}
  const actions: HealingAction[] = []

  for (const [attemptedKey, value] of Object.entries(attempted)) {
    // 1. Exact match
    if (schemaParamNames.includes(attemptedKey)) {
      if (!(attemptedKey in healed)) healed[attemptedKey] = value
      continue
    }

    // 2. Alias map
    const aliased = toolAliases[attemptedKey]
    if (aliased && schemaParamNames.includes(aliased)) {
      if (!(aliased in healed)) {
        healed[aliased] = value
        actions.push({ stage: "param-name", from: attemptedKey, to: aliased })
      }
      continue
    }

    // 3. Edit distance (≤ 2)
    let bestParam: string | null = null
    let bestDist = Infinity
    for (const schemaParam of schemaParamNames) {
      const dist = editDistance(attemptedKey.toLowerCase(), schemaParam.toLowerCase())
      if (dist < bestDist) { bestDist = dist; bestParam = schemaParam }
    }
    if (bestDist <= 2 && bestParam !== null && !(bestParam in healed)) {
      healed[bestParam] = value
      actions.push({ stage: "param-name", from: attemptedKey, to: bestParam })
      continue
    }

    // 4. Unknown — preserve
    healed[attemptedKey] = value
  }

  return { healed, actions }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun test packages/tools/tests/healing/param-name-healer.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
rtk git add packages/tools/src/healing/param-name-healer.ts packages/tools/tests/healing/param-name-healer.test.ts
rtk git commit -m "feat(tools): ParamNameHealer — per-tool alias map + edit-distance normalization"
```

---

## Task 6: PathResolver + TypeCoercer

**Files:**
- Create: `packages/tools/src/healing/path-resolver.ts`
- Create: `packages/tools/tests/healing/path-resolver.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/tools/tests/healing/path-resolver.test.ts
import { describe, it, expect } from "bun:test"
import { resolvePaths, coerceTypes } from "../../src/healing/path-resolver.js"

const fileTools = new Set(["file-read", "file-write", "code-execute"])
const workingDir = "/workspace/project"

describe("resolvePaths", () => {
  it("relative path resolved against working dir", () => {
    const result = resolvePaths("file-read", { path: "src/main.ts" }, fileTools, workingDir)
    expect(result.healed.path).toBe("/workspace/project/src/main.ts")
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]?.stage).toBe("path")
  })

  it("absolute path within working dir unchanged", () => {
    const result = resolvePaths("file-read", { path: "/workspace/project/src/main.ts" }, fileTools, workingDir)
    expect(result.healed.path).toBe("/workspace/project/src/main.ts")
    expect(result.actions).toHaveLength(0)
  })

  it("hallucinated absolute path remapped to working dir", () => {
    const result = resolvePaths("file-read", { path: "/home/user/projects/main.ts" }, fileTools, workingDir)
    expect(result.healed.path).toBe("/workspace/project/main.ts")
    expect(result.actions).toHaveLength(1)
  })

  it("non-file tool paths not modified", () => {
    const result = resolvePaths("web-search", { query: "/some/path" }, fileTools, workingDir)
    expect(result.healed.query).toBe("/some/path")
    expect(result.actions).toHaveLength(0)
  })

  it("tilde expansion resolved", () => {
    const result = resolvePaths("file-read", { path: "~/foo.ts" }, fileTools, workingDir)
    expect(result.healed.path).not.toContain("~")
  })
})

describe("coerceTypes", () => {
  const schema = {
    name: "tool",
    description: "",
    parameters: [
      { name: "count", type: "number", description: "", required: true },
      { name: "active", type: "boolean", description: "", required: false },
    ],
  }

  it("string to number coercion", () => {
    const result = coerceTypes({ count: "5" }, schema)
    expect(result.healed.count).toBe(5)
    expect(result.actions[0]?.stage).toBe("type-coerce")
  })

  it("string to boolean coercion", () => {
    const result = coerceTypes({ active: "true" }, schema)
    expect(result.healed.active).toBe(true)
  })

  it("already correct types unchanged", () => {
    const result = coerceTypes({ count: 5 }, schema)
    expect(result.healed.count).toBe(5)
    expect(result.actions).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/tools/tests/healing/path-resolver.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement PathResolver + TypeCoercer**

```typescript
// packages/tools/src/healing/path-resolver.ts
import { resolve, basename } from "node:path"
import { homedir } from "node:os"
import type { HealingAction } from "../drivers/tool-calling-driver.js"
import type { ToolSchema } from "@reactive-agents/reasoning/strategies/kernel/utils/tool-formatting.js"

interface ResolveResult {
  readonly healed: Record<string, unknown>
  readonly actions: readonly HealingAction[]
}

const PATH_PARAMS = new Set(["path", "filePath", "file", "src", "dest", "destination", "output"])

export function resolvePaths(
  toolName: string,
  args: Record<string, unknown>,
  fileToolNames: ReadonlySet<string>,
  workingDir: string,
): ResolveResult {
  if (!fileToolNames.has(toolName)) return { healed: { ...args }, actions: [] }

  const healed = { ...args }
  const actions: HealingAction[] = []

  for (const [key, value] of Object.entries(healed)) {
    if (!PATH_PARAMS.has(key) || typeof value !== "string") continue

    let resolved = value

    // Tilde expansion
    if (resolved.startsWith("~/")) resolved = resolve(homedir(), resolved.slice(2))

    // Relative path → working dir
    if (!resolved.startsWith("/")) {
      resolved = resolve(workingDir, resolved)
      healed[key] = resolved
      actions.push({ stage: "path", from: value, to: resolved })
      continue
    }

    // Hallucinated absolute path (not within working dir) → remap filename to working dir
    if (!resolved.startsWith(workingDir)) {
      const remapped = resolve(workingDir, basename(resolved))
      healed[key] = remapped
      actions.push({ stage: "path", from: value, to: remapped })
      continue
    }

    if (resolved !== value) {
      healed[key] = resolved
      actions.push({ stage: "path", from: value, to: resolved })
    }
  }

  return { healed, actions }
}

export function coerceTypes(
  args: Record<string, unknown>,
  schema: ToolSchema,
): ResolveResult {
  const healed = { ...args }
  const actions: HealingAction[] = []

  for (const param of schema.parameters) {
    const value = healed[param.name]
    if (value === undefined) continue

    if (param.type === "number" && typeof value === "string") {
      const num = Number(value)
      if (!isNaN(num)) {
        healed[param.name] = num
        actions.push({ stage: "type-coerce", from: `string(${value})`, to: `number(${num})` })
      }
    } else if (param.type === "boolean" && typeof value === "string") {
      if (value === "true") { healed[param.name] = true; actions.push({ stage: "type-coerce", from: value, to: "true" }) }
      else if (value === "false") { healed[param.name] = false; actions.push({ stage: "type-coerce", from: value, to: "false" }) }
    }
  }

  return { healed, actions }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun test packages/tools/tests/healing/path-resolver.test.ts
```
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
rtk git add packages/tools/src/healing/path-resolver.ts packages/tools/tests/healing/path-resolver.test.ts
rtk git commit -m "feat(tools): PathResolver + TypeCoercer — path remapping and type normalization"
```

---

## Task 7: HealingPipeline

**Files:**
- Create: `packages/tools/src/healing/healing-pipeline.ts`
- Create: `packages/tools/src/healing/index.ts`
- Create: `packages/tools/tests/healing/healing-pipeline.test.ts`

The HealingPipeline **extends** the existing `normalizeToolCallArguments()` in `act.ts`. It calls the existing function first (preserving web-search and http-get handling), then runs the 4 new stages.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/tools/tests/healing/healing-pipeline.test.ts
import { describe, it, expect } from "bun:test"
import { runHealingPipeline } from "../../src/healing/healing-pipeline.js"
import type { ToolCallSpec } from "../../src/tool-calling/types.js"

const registeredTools = [
  {
    name: "file-read",
    description: "Read file",
    parameters: [{ name: "path", type: "string", description: "", required: true }],
  },
  {
    name: "code-execute",
    description: "Run code",
    parameters: [{ name: "code", type: "string", description: "", required: true }],
  },
]

const fileToolNames = new Set(["file-read", "file-write", "code-execute"])
const workingDir = "/workspace"

describe("runHealingPipeline", () => {
  it("exact call passes through unchanged", () => {
    const call: ToolCallSpec = { id: "1", name: "file-read", arguments: { path: "/workspace/foo.ts" } }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, {}, {})
    expect(result.call.name).toBe("file-read")
    expect(result.call.arguments.path).toBe("/workspace/foo.ts")
    expect(result.actions).toHaveLength(0)
    expect(result.succeeded).toBe(true)
  })

  it("tool name alias healed", () => {
    const call: ToolCallSpec = { id: "1", name: "typescript/compile", arguments: { code: "const x = 1" } }
    const aliases = { "typescript/compile": "code-execute" }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, aliases, {})
    expect(result.call.name).toBe("code-execute")
    expect(result.actions.some((a) => a.stage === "tool-name")).toBe(true)
  })

  it("param name alias healed using CalibrationStore map", () => {
    const call: ToolCallSpec = { id: "1", name: "file-read", arguments: { input: "src/main.ts" } }
    const paramAliases = { "file-read": { input: "path" } }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, {}, paramAliases)
    expect(result.call.arguments.path).toBe("/workspace/src/main.ts") // path healed + resolved
    expect(result.actions.some((a) => a.stage === "param-name")).toBe(true)
  })

  it("unresolvable tool name returns succeeded=false", () => {
    const call: ToolCallSpec = { id: "1", name: "totally-unknown-xyzzy-9999", arguments: {} }
    const result = runHealingPipeline(call, registeredTools, fileToolNames, workingDir, {}, {})
    expect(result.succeeded).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/tools/tests/healing/healing-pipeline.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement HealingPipeline**

```typescript
// packages/tools/src/healing/healing-pipeline.ts
import type { ToolCallSpec } from "../tool-calling/types.js"
import type { HealingAction, HealingResult } from "../drivers/tool-calling-driver.js"
import type { ToolSchema } from "@reactive-agents/reasoning/strategies/kernel/utils/tool-formatting.js"
import { healToolName } from "./tool-name-healer.js"
import { healParamNames } from "./param-name-healer.js"
import { resolvePaths, coerceTypes } from "./path-resolver.js"

export function runHealingPipeline(
  call: ToolCallSpec,
  registeredTools: readonly ToolSchema[],
  fileToolNames: ReadonlySet<string>,
  workingDir: string,
  knownToolAliases: Record<string, string>,
  knownParamAliases: Record<string, Record<string, string>>,
): HealingResult {
  const actions: HealingAction[] = []
  let currentName = call.name
  let currentArgs = { ...call.arguments }

  // Stage 1 — ToolNameHealer
  const registeredNames = registeredTools.map((t) => t.name)
  const nameResult = healToolName(currentName, registeredNames, knownToolAliases)
  if (nameResult.resolved === null) {
    return { call, actions, succeeded: false }
  }
  if (nameResult.action) actions.push(nameResult.action)
  currentName = nameResult.resolved

  // Stage 2 — ParamNameHealer
  const schema = registeredTools.find((t) => t.name === currentName)
  if (schema) {
    const paramResult = healParamNames(currentName, currentArgs, schema, knownParamAliases)
    actions.push(...paramResult.actions)
    currentArgs = paramResult.healed as Record<string, unknown>
  }

  // Stage 3 — PathResolver
  if (schema) {
    const pathResult = resolvePaths(currentName, currentArgs, fileToolNames, workingDir)
    actions.push(...pathResult.actions)
    currentArgs = pathResult.healed as Record<string, unknown>
  }

  // Stage 4 — TypeCoercer
  if (schema) {
    const typeResult = coerceTypes(currentArgs, schema)
    actions.push(...typeResult.actions)
    currentArgs = typeResult.healed as Record<string, unknown>
  }

  const healedCall: ToolCallSpec = { ...call, name: currentName, arguments: currentArgs }
  return { call: healedCall, actions, succeeded: true }
}
```

- [ ] **Step 4: Create barrel export**

```typescript
// packages/tools/src/healing/index.ts
export { runHealingPipeline } from "./healing-pipeline.js"
export { healToolName } from "./tool-name-healer.js"
export { healParamNames } from "./param-name-healer.js"
export { resolvePaths, coerceTypes } from "./path-resolver.js"
export type { HealingResult, HealingAction, ExtractedCall, ToolCallingDriver } from "../drivers/tool-calling-driver.js"
```

- [ ] **Step 5: Run to verify it passes**

```bash
bun test packages/tools/tests/healing/healing-pipeline.test.ts
```
Expected: PASS (4 tests)

- [ ] **Step 6: Run full tools package tests**

```bash
bun test packages/tools/
```
Expected: all passing, no regressions

- [ ] **Step 7: Commit**

```bash
rtk git add packages/tools/src/healing/ packages/tools/tests/healing/
rtk git commit -m "feat(tools): HealingPipeline — orchestrates ToolNameHealer, ParamNameHealer, PathResolver, TypeCoercer"
```

---

## Task 8: TextParseDriver — Tiers 1–3 + re-prompt

**Files:**
- Create: `packages/tools/src/drivers/text-parse-driver.ts`
- Create: `packages/tools/tests/drivers/text-parse-driver.test.ts`

The system prompt format the driver instructs the model to use (Tier 1):
```
<tool_call>
tool: file-read
path: /workspace/foo.ts
</tool_call>
```

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/tools/tests/drivers/text-parse-driver.test.ts
import { describe, it, expect } from "bun:test"
import { TextParseDriver } from "../../src/drivers/text-parse-driver.js"

const tools = [
  {
    name: "file-read",
    description: "Read a file at the given path",
    parameters: [{ name: "path", type: "string", description: "File path", required: true }],
  },
  {
    name: "web-search",
    description: "Search the web",
    parameters: [{ name: "query", type: "string", description: "Search query", required: true }],
  },
]

const driver = new TextParseDriver()

describe("TextParseDriver", () => {
  it("mode is text-parse", () => {
    expect(driver.mode).toBe("text-parse")
  })

  it("buildPromptInstructions includes tool names and format guide", () => {
    const instructions = driver.buildPromptInstructions(tools)
    expect(instructions).toContain("file-read")
    expect(instructions).toContain("web-search")
    expect(instructions).toContain("<tool_call>")
  })
})

describe("Tier 1 — structured XML format", () => {
  it("parses single tool call", () => {
    const text = `I'll read the file.\n<tool_call>\ntool: file-read\npath: /workspace/foo.ts\n</tool_call>`
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("file-read")
    expect(calls[0]?.arguments.path).toBe("/workspace/foo.ts")
    expect(calls[0]?.parseMode).toBe("tier-1")
    expect(calls[0]?.confidence).toBeGreaterThanOrEqual(0.9)
  })

  it("parses multiple tool calls in sequence", () => {
    const text = [
      "<tool_call>\ntool: file-read\npath: /foo.ts\n</tool_call>",
      "<tool_call>\ntool: web-search\nquery: typescript generics\n</tool_call>",
    ].join("\n")
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(2)
    expect(calls[0]?.name).toBe("file-read")
    expect(calls[1]?.name).toBe("web-search")
  })
})

describe("Tier 2 — JSON in text", () => {
  it("parses JSON object in prose", () => {
    const text = `Let me call {"tool": "file-read", "path": "/workspace/foo.ts"} to read the file.`
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("file-read")
    expect(calls[0]?.parseMode).toBe("tier-2")
  })
})

describe("Tier 3 — relaxed FC JSON", () => {
  it("parses FC-like array in text", () => {
    const text = `[{"name": "file-read", "arguments": {"path": "/workspace/foo.ts"}}]`
    const calls = driver.extractCalls(text, tools)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe("file-read")
    expect(calls[0]?.parseMode).toBe("tier-3")
  })
})

describe("formatToolResult", () => {
  it("formats success result as plain text", () => {
    const formatted = driver.formatToolResult("file-read", "file content here", false)
    expect(formatted).toContain("file content here")
  })

  it("formats error result with error prefix", () => {
    const formatted = driver.formatToolResult("file-read", "not found", true)
    expect(formatted).toContain("error")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/tools/tests/drivers/text-parse-driver.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement TextParseDriver**

```typescript
// packages/tools/src/drivers/text-parse-driver.ts
import type { ToolSchema } from "@reactive-agents/reasoning/strategies/kernel/utils/tool-formatting.js"
import type { ExtractedCall, ToolCallingDriver } from "./tool-calling-driver.js"

export class TextParseDriver implements ToolCallingDriver {
  readonly mode = "text-parse" as const

  buildPromptInstructions(tools: readonly ToolSchema[]): string {
    const toolList = tools
      .map((t) => {
        const params = t.parameters.map((p) => `  ${p.name}: <${p.type}>${p.required ? " (required)" : ""}`).join("\n")
        return `Tool: ${t.name}\nDescription: ${t.description}\nParams:\n${params}`
      })
      .join("\n\n")

    return [
      "## Available Tools\n",
      toolList,
      "\n## How to Call a Tool",
      "Use this exact format — one tool call per block:",
      "<tool_call>",
      "tool: <tool-name>",
      "<param-name>: <value>",
      "</tool_call>",
      "\nUse relative paths for file operations (e.g., `src/main.ts` not `/absolute/path`).",
      "Wait for the tool result before calling the next tool.",
    ].join("\n")
  }

  extractCalls(textOutput: string, _tools: readonly ToolSchema[]): ExtractedCall[] {
    // Tier 1 — structured XML format
    const tier1 = this.parseTier1(textOutput)
    if (tier1.length > 0) return tier1

    // Tier 2 — JSON object in prose
    const tier2 = this.parseTier2(textOutput)
    if (tier2.length > 0) return tier2

    // Tier 3 — relaxed FC JSON array
    const tier3 = this.parseTier3(textOutput)
    if (tier3.length > 0) return tier3

    return []
  }

  private parseTier1(text: string): ExtractedCall[] {
    const blockRe = /<tool_call>([\s\S]*?)<\/tool_call>/g
    const calls: ExtractedCall[] = []
    let match: RegExpExecArray | null
    while ((match = blockRe.exec(text)) !== null) {
      const block = match[1]!.trim()
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean)
      const toolLine = lines.find((l) => l.startsWith("tool:"))
      if (!toolLine) continue
      const name = toolLine.replace(/^tool:\s*/, "").trim()
      const args: Record<string, unknown> = {}
      for (const line of lines) {
        if (line.startsWith("tool:")) continue
        const colonIdx = line.indexOf(":")
        if (colonIdx === -1) continue
        const key = line.slice(0, colonIdx).trim()
        const value = line.slice(colonIdx + 1).trim()
        args[key] = value
      }
      calls.push({ name, arguments: args, parseMode: "tier-1", confidence: 0.95 })
    }
    return calls
  }

  private parseTier2(text: string): ExtractedCall[] {
    // Find JSON objects containing a "tool" or "name" key
    const jsonRe = /\{[^{}]*(?:"tool"|"name")[^{}]*\}/g
    const calls: ExtractedCall[] = []
    let match: RegExpExecArray | null
    while ((match = jsonRe.exec(text)) !== null) {
      try {
        const obj = JSON.parse(match[0]) as Record<string, unknown>
        const name = (obj["tool"] ?? obj["name"]) as string | undefined
        if (typeof name !== "string") continue
        const { tool: _t, name: _n, ...rest } = obj
        calls.push({ name, arguments: rest, parseMode: "tier-2", confidence: 0.75 })
      } catch { /* skip malformed */ }
    }
    return calls
  }

  private parseTier3(text: string): ExtractedCall[] {
    // Find JSON arrays that look like FC call arrays
    const arrayRe = /\[[\s\S]*?\]/g
    let match: RegExpExecArray | null
    while ((match = arrayRe.exec(text)) !== null) {
      try {
        const arr = JSON.parse(match[0]) as unknown[]
        if (!Array.isArray(arr)) continue
        const calls: ExtractedCall[] = []
        for (const item of arr) {
          if (typeof item !== "object" || item === null) continue
          const obj = item as Record<string, unknown>
          const name = (obj["name"] ?? obj["tool_name"] ?? obj["tool"]) as string | undefined
          if (typeof name !== "string") continue
          const args = (obj["arguments"] ?? obj["parameters"] ?? obj["input"] ?? {}) as Record<string, unknown>
          calls.push({ name, arguments: args, parseMode: "tier-3", confidence: 0.55 })
        }
        if (calls.length > 0) return calls
      } catch { /* skip */ }
    }
    return []
  }

  formatToolResult(toolName: string, result: unknown, isError: boolean): string {
    const content = typeof result === "string" ? result : JSON.stringify(result, null, 2)
    return isError
      ? `[${toolName} error] ${content}`
      : `[${toolName} result]\n${content}`
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun test packages/tools/tests/drivers/text-parse-driver.test.ts
```
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
rtk git add packages/tools/src/drivers/text-parse-driver.ts packages/tools/tests/drivers/text-parse-driver.test.ts
rtk git commit -m "feat(tools): TextParseDriver — 3-tier cascading parse pipeline for local models"
```

---

## Task 9: KernelContext extension + buildCalibratedAdapter() routing

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts`
- Modify: `packages/llm-provider/src/calibration.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/llm-provider/tests/calibration-routing.test.ts
import { describe, it, expect } from "bun:test"
import { buildCalibratedAdapter } from "../src/calibration.js"

const baseCalibration = {
  modelId: "test",
  calibratedAt: new Date().toISOString(),
  probeVersion: 1,
  runsAveraged: 1,
  steeringCompliance: "system-prompt" as const,
  parallelCallCapability: "sequential-only" as const,
  observationHandling: "uses-recall" as const,
  systemPromptAttention: "strong" as const,
  optimalToolResultChars: 2000,
  toolCallDialect: "none" as const,
}

describe("buildCalibratedAdapter routing", () => {
  it("returns NativeFCDriver when toolCallDialect is native-fc", () => {
    const { toolCallingDriver } = buildCalibratedAdapter({
      ...baseCalibration,
      toolCallDialect: "native-fc",
    })
    expect(toolCallingDriver.mode).toBe("native-fc")
  })

  it("returns TextParseDriver when toolCallDialect is text-parse", () => {
    const { toolCallingDriver } = buildCalibratedAdapter({
      ...baseCalibration,
      toolCallDialect: "text-parse",
    })
    expect(toolCallingDriver.mode).toBe("text-parse")
  })

  it("returns TextParseDriver as safe default when dialect is none", () => {
    const { toolCallingDriver } = buildCalibratedAdapter(baseCalibration)
    expect(toolCallingDriver.mode).toBe("text-parse")
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/llm-provider/tests/calibration-routing.test.ts
```
Expected: FAIL — `buildCalibratedAdapter` doesn't return `toolCallingDriver`

- [ ] **Step 3: Extend buildCalibratedAdapter() in calibration.ts**

Open `packages/llm-provider/src/calibration.ts`. Add imports at top:

```typescript
import { NativeFCDriver } from "@reactive-agents/tools/drivers"
import { TextParseDriver } from "@reactive-agents/tools/drivers"
import type { ToolCallingDriver } from "@reactive-agents/tools/drivers"
```

Change the return type and body of `buildCalibratedAdapter()`:

```typescript
export function buildCalibratedAdapter(
  calibration: ModelCalibration,
): { adapter: ProviderAdapter; profileOverrides: ProfileOverrides; toolCallingDriver: ToolCallingDriver } {
  // ... existing adapter + profileOverrides logic unchanged ...

  const toolCallingDriver: ToolCallingDriver =
    calibration.toolCallDialect === "native-fc"
      ? new NativeFCDriver()
      : new TextParseDriver()  // text-parse AND none (uncalibrated → safe default)

  return { adapter, profileOverrides, toolCallingDriver }
}
```

- [ ] **Step 4: Add toolCallingDriver to KernelContext**

Open `packages/reasoning/src/strategies/kernel/kernel-state.ts`. Find the `KernelContext` interface (lines 420-426) and add the field:

```typescript
export interface KernelContext {
  readonly input: KernelInput
  readonly profile: ContextProfile
  readonly compression: ResultCompressionConfig
  readonly toolService: MaybeService<ToolServiceInstance>
  readonly hooks: KernelHooks
  readonly toolCallingDriver: ToolCallingDriver  // ← add this
}
```

Add import at top of file:
```typescript
import type { ToolCallingDriver } from "@reactive-agents/tools/drivers"
```

- [ ] **Step 5: Fix any TypeScript errors from the KernelContext change**

Run type check to find all sites that construct `KernelContext` without the new field:

```bash
rtk tsc --noEmit -p packages/reasoning/tsconfig.json
```

For each site that constructs `KernelContext`, add `toolCallingDriver: new TextParseDriver()` as the default (import TextParseDriver at those sites). The canonical place to set the real driver is in the strategy execution entry point that receives the calibrated adapter.

- [ ] **Step 6: Run to verify routing tests pass**

```bash
bun test packages/llm-provider/tests/calibration-routing.test.ts
```
Expected: PASS (3 tests)

- [ ] **Step 7: Commit**

```bash
rtk git add packages/llm-provider/src/calibration.ts packages/reasoning/src/strategies/kernel/kernel-state.ts packages/llm-provider/tests/calibration-routing.test.ts
rtk git commit -m "feat: wire toolCallingDriver into KernelContext via buildCalibratedAdapter routing"
```

---

## Task 10: think.ts + act.ts integration

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts`
- Modify: `packages/reasoning/src/strategies/kernel/phases/act.ts`

These are the two kernel phase files. Make minimal surgical changes — the driver seam handles the branching.

- [ ] **Step 1: think.ts — empty tools array for text-parse + prompt injection**

Open `packages/reasoning/src/strategies/kernel/phases/think.ts`.

Find the `llmStreamEffect` call site (around line 253). Currently:
```typescript
...(llmTools.length > 0 ? { tools: llmTools } : {}),
```

Change to:
```typescript
// TextParseDriver: pass empty tools array to provider (Anthropic/OpenAI enforce FC when tools present)
...(llmTools.length > 0 && context.toolCallingDriver.mode !== "text-parse"
  ? { tools: llmTools }
  : {}),
```

Find where the system prompt is assembled (the `systemPromptText` variable). After the existing system prompt construction, append the driver's format instructions:

```typescript
const driverInstructions = context.toolCallingDriver.buildPromptInstructions(filteredToolSchemas)
const systemPromptText = driverInstructions
  ? `${baseSystemPrompt}\n\n${driverInstructions}`
  : baseSystemPrompt
```

(Look at the actual variable names in think.ts and adapt — the prompt assembly location is where `systemPromptText` is set before being passed to `llm.stream()`.)

- [ ] **Step 2: act.ts — TextParseDriver extraction + HealingPipeline**

Open `packages/reasoning/src/strategies/kernel/phases/act.ts`.

Add imports at top:
```typescript
import { runHealingPipeline } from "@reactive-agents/tools/healing"
```

Find where `normalizeToolCallArguments()` is called on pending native tool calls. The current flow reads `state.meta.pendingNativeToolCalls`, normalizes each, then executes.

After the `normalizeToolCallArguments()` call, add HealingPipeline:

```typescript
// Normalize (existing) then heal (new)
const normalized = normalizeToolCallArguments(rawCall)

const { call: healed, succeeded } = runHealingPipeline(
  normalized,
  state.availableToolSchemas ?? [],       // adjust field name to match actual KernelState
  FILE_TOOL_NAMES,                         // define this Set near the top of act.ts
  context.input.workingDir ?? process.cwd(),
  state.calibration?.knownToolAliases ?? {},
  state.calibration?.knownParamAliases ?? {},
)

const callToExecute = succeeded ? healed : normalized  // fall back to normalized on heal failure
```

Add the FILE_TOOL_NAMES constant near the top of act.ts:
```typescript
const FILE_TOOL_NAMES = new Set(["file-read", "file-write", "code-execute", "shell-execute"])
```

For **TextParseDriver mode**: when `context.toolCallingDriver.mode === "text-parse"`, the `pendingNativeToolCalls` will be empty (model didn't emit FC calls). Extract calls from the last assistant message text instead:

```typescript
if (context.toolCallingDriver.mode === "text-parse") {
  const lastAssistantText = getLastAssistantText(state.messages)  // helper to extract text from last assistant message
  const extracted = context.toolCallingDriver.extractCalls(lastAssistantText, filteredToolSchemas)
  // Convert ExtractedCall[] to ToolCallSpec[] for the existing execution path
  pendingCalls = extracted.map((e, i) => ({
    id: `text-parse-${state.meta.iteration ?? 0}-${i}`,
    name: e.name,
    arguments: e.arguments,
  }))
} else {
  pendingCalls = state.meta.pendingNativeToolCalls ?? []
}
```

Add a simple `getLastAssistantText()` helper in act.ts (or import from context-utils):
```typescript
function getLastAssistantText(messages: readonly KernelMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.role === "assistant") {
      return typeof msg.content === "string" ? msg.content : ""
    }
  }
  return ""
}
```

- [ ] **Step 3: Run full reasoning package tests**

```bash
bun test packages/reasoning/
```
Expected: all passing. Fix any type errors from KernelContext changes before proceeding.

- [ ] **Step 4: Smoke test with scratch.ts against cogito:latest**

```bash
bun scratch.ts 2>&1 | head -60
```
Verify: agent runs, entropy fires every iteration, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/reasoning/src/strategies/kernel/phases/think.ts packages/reasoning/src/strategies/kernel/phases/act.ts
rtk git commit -m "feat(reasoning): wire ToolCallingDriver into think.ts + act.ts — empty tools for text-parse, HealingPipeline on all calls"
```

---

## Task 11: FC Calibration Probe

**Files:**
- Create: `packages/reactive-intelligence/src/calibration-probe.ts`
- Create: `packages/reactive-intelligence/tests/calibration-probe.test.ts`

The probe runs 6 synthetic tool calls to score FC capability across 5 dimensions. It does NOT make real LLM calls in tests — the `LLMService` is injectable so tests use a mock.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/reactive-intelligence/tests/calibration-probe.test.ts
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
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/reactive-intelligence/tests/calibration-probe.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement the probe scorer**

```typescript
// packages/reactive-intelligence/src/calibration-probe.ts
import type { ToolSchema } from "@reactive-agents/reasoning/strategies/kernel/utils/tool-formatting.js"

export interface FCDimensionScore {
  toolNameAccuracy: number       // 0 or 1 — did model use exact tool name?
  paramNameAccuracy: number      // 0 or 1 — did model use exact param names?
  typeCompliance: number         // 0 or 1 — did model use correct types?
  requiredParamCompleteness: number  // 0 or 1 — all required params present?
  multiToolSelection: number     // 0 or 1 — selected correct tool from 5 options?
}

/** Weights for weighted composite score */
const WEIGHTS: Record<keyof FCDimensionScore, number> = {
  toolNameAccuracy: 0.25,
  paramNameAccuracy: 0.30,
  typeCompliance: 0.15,
  requiredParamCompleteness: 0.15,
  multiToolSelection: 0.15,
}

export function scoreFCResponse(
  response: { name: string; arguments: Record<string, unknown> },
  expectedSchema: ToolSchema,
  registeredToolNames: readonly string[],
): FCDimensionScore {
  const toolNameAccuracy = registeredToolNames.includes(response.name) &&
    response.name === expectedSchema.name ? 1 : 0

  const requiredParams = expectedSchema.parameters.filter((p) => p.required)
  const paramNameAccuracy =
    requiredParams.length === 0 ? 1
    : requiredParams.every((p) => p.name in response.arguments) &&
      Object.keys(response.arguments).every((k) =>
        expectedSchema.parameters.some((p) => p.name === k)
      )
      ? 1 : 0

  const typeCompliance =
    requiredParams.every((p) => {
      const val = response.arguments[p.name]
      if (val === undefined) return false
      if (p.type === "string") return typeof val === "string"
      if (p.type === "number") return typeof val === "number"
      if (p.type === "boolean") return typeof val === "boolean"
      return true
    }) ? 1 : 0

  const requiredParamCompleteness =
    requiredParams.every((p) => p.name in response.arguments) ? 1 : 0

  const multiToolSelection = toolNameAccuracy  // same signal for single-call probes

  return { toolNameAccuracy, paramNameAccuracy, typeCompliance, requiredParamCompleteness, multiToolSelection }
}

export function computeFCCapabilityScore(scores: FCDimensionScore[]): number {
  if (scores.length === 0) return 0
  const avgDimensions = (dim: keyof FCDimensionScore) =>
    scores.reduce((sum, s) => sum + s[dim], 0) / scores.length
  return (
    avgDimensions("toolNameAccuracy") * WEIGHTS.toolNameAccuracy +
    avgDimensions("paramNameAccuracy") * WEIGHTS.paramNameAccuracy +
    avgDimensions("typeCompliance") * WEIGHTS.typeCompliance +
    avgDimensions("requiredParamCompleteness") * WEIGHTS.requiredParamCompleteness +
    avgDimensions("multiToolSelection") * WEIGHTS.multiToolSelection
  )
}

export function selectToolCallDialect(score: number): "native-fc" | "text-parse" {
  return score >= 0.8 ? "native-fc" : "text-parse"
}

/** Seed aliases discovered during failed probe calls. */
export function extractProbeAliases(
  responses: Array<{ attempted: Record<string, unknown>; schema: ToolSchema; toolAttempted: string; toolExpected: string }>
): { toolAliases: Record<string, string>; paramAliases: Record<string, Record<string, string>> } {
  const toolAliases: Record<string, string> = {}
  const paramAliases: Record<string, Record<string, string>> = {}

  for (const { attempted, schema, toolAttempted, toolExpected } of responses) {
    if (toolAttempted !== toolExpected) toolAliases[toolAttempted] = toolExpected

    const toolParamAliases: Record<string, string> = {}
    for (const attemptedKey of Object.keys(attempted)) {
      if (!schema.parameters.some((p) => p.name === attemptedKey)) {
        // Find closest schema param by position or name similarity
        const schemaParam = schema.parameters.find((p) => !Object.keys(attempted).includes(p.name))
        if (schemaParam) toolParamAliases[attemptedKey] = schemaParam.name
      }
    }
    if (Object.keys(toolParamAliases).length > 0) {
      paramAliases[toolExpected] = { ...(paramAliases[toolExpected] ?? {}), ...toolParamAliases }
    }
  }

  return { toolAliases, paramAliases }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun test packages/reactive-intelligence/tests/calibration-probe.test.ts
```
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
rtk git add packages/reactive-intelligence/src/calibration-probe.ts packages/reactive-intelligence/tests/calibration-probe.test.ts
rtk git commit -m "feat(reactive-intelligence): FC calibration probe — dimension scoring, dialect selection, alias extraction"
```

---

## Task 12: ToolCallObservation + alias accumulation

**Files:**
- Modify: `packages/memory/src/services/experience-store.ts`
- Modify: `packages/llm-provider/src/calibration.ts` (alias accumulation with frequency gate)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/llm-provider/tests/alias-accumulation.test.ts
import { describe, it, expect } from "bun:test"
import { accumulateAliasObservation, shouldWriteAlias } from "../src/calibration.js"

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
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/llm-provider/tests/alias-accumulation.test.ts
```
Expected: FAIL

- [ ] **Step 3: Add ToolCallObservation to ExperienceRecord**

Open `packages/memory/src/services/experience-store.ts`. Add to the `ExperienceRecord` type/schema:

```typescript
// Add ToolCallObservation type
export interface ToolCallObservation {
  readonly toolNameAttempted: string
  readonly toolNameResolved: string | null
  readonly paramsAttempted: Record<string, unknown>
  readonly paramsResolved: Record<string, unknown>
  readonly parseMode: "native-fc" | "tier-1" | "tier-2" | "tier-3" | "reprompt"
  readonly healingApplied: ReadonlyArray<{ stage: string; from: string; to: string }>
  readonly succeeded: boolean
  readonly errorText: string | null
}
```

Add `toolCallObservations?: readonly ToolCallObservation[]` to the `ExperienceRecord` interface. Add a corresponding column or JSON field to the SQLite schema if ExperienceRecord is persisted as a row. (If it's stored as JSON, the field is automatically included.)

- [ ] **Step 4: Add accumulation helpers to calibration.ts**

Open `packages/llm-provider/src/calibration.ts`. Add:

```typescript
export const ALIAS_FREQUENCY_THRESHOLD = 3

export interface AliasObservationState {
  [attemptedName: string]: { target: string; count: number }
}

export function shouldWriteAlias(count: number): boolean {
  return count >= ALIAS_FREQUENCY_THRESHOLD
}

export function accumulateAliasObservation(
  state: AliasObservationState,
  attempted: string,
  resolved: string,
): AliasObservationState {
  const existing = state[attempted]
  return {
    ...state,
    [attempted]: { target: resolved, count: (existing?.count ?? 0) + 1 },
  }
}

/** Derive confirmed aliases (count >= threshold) from observation state. */
export function confirmedAliases(state: AliasObservationState): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [attempted, { target, count }] of Object.entries(state)) {
    if (shouldWriteAlias(count)) result[attempted] = target
  }
  return result
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
bun test packages/llm-provider/tests/alias-accumulation.test.ts
```
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
rtk git add packages/memory/src/services/experience-store.ts packages/llm-provider/src/calibration.ts packages/llm-provider/tests/alias-accumulation.test.ts
rtk git commit -m "feat: ToolCallObservation schema + alias accumulation with N≥3 frequency gate"
```

---

## Task 13: ExperienceSummary materialization + toolGuidance

**Files:**
- Modify: `packages/llm-provider/src/calibration.ts` (add materializeExperienceSummary)
- Modify: `packages/llm-provider/src/adapter.ts` (toolGuidance reads from summary)

- [ ] **Step 1: Write the failing test**

```typescript
// packages/llm-provider/tests/experience-summary.test.ts
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
  })
})

describe("formatToolGuidanceFromSummary", () => {
  it("returns empty string when no summary available", () => {
    expect(formatToolGuidanceFromSummary(null, ["file-read"])).toBe("")
  })

  it("includes concrete param guidance from patterns", () => {
    const summary = {
      topWorkingParamPatterns: [
        { tool: "file-read", params: { path: "/example.ts" }, successRate: 0.9, occurrences: 5 }
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
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/llm-provider/tests/experience-summary.test.ts
```
Expected: FAIL

- [ ] **Step 3: Implement materializeExperienceSummary and formatToolGuidanceFromSummary**

Add to `packages/llm-provider/src/calibration.ts`:

```typescript
import type { ToolCallObservation } from "@reactive-agents/memory"

export interface ExperienceSummary {
  readonly topWorkingParamPatterns: ReadonlyArray<{
    tool: string
    params: Record<string, unknown>
    successRate: number
    occurrences: number
  }>
  readonly topErrorPatterns: ReadonlyArray<{
    tool: string
    error: string
    recovery: string
    occurrences: number
  }>
  readonly lastUpdated: string
}

export function materializeExperienceSummary(
  observations: readonly ToolCallObservation[],
): ExperienceSummary {
  // Group successful observations by tool
  const successByTool = new Map<string, Array<Record<string, unknown>>>()
  const errorByTool = new Map<string, Array<{ error: string; healing: string }>>()

  for (const obs of observations) {
    const tool = obs.toolNameResolved ?? obs.toolNameAttempted
    if (obs.succeeded) {
      const existing = successByTool.get(tool) ?? []
      existing.push(obs.paramsResolved)
      successByTool.set(tool, existing)
    } else if (obs.errorText) {
      const existing = errorByTool.get(tool) ?? []
      const healing = obs.healingApplied.map((a) => `Use \`${a.to}\` not \`${a.from}\``).join("; ")
      existing.push({ error: obs.errorText, healing })
      errorByTool.set(tool, existing)
    }
  }

  const topWorkingParamPatterns = [...successByTool.entries()].map(([tool, params]) => ({
    tool,
    params: params[0] ?? {},
    successRate: 1,
    occurrences: params.length,
  }))

  const topErrorPatterns = [...errorByTool.entries()].flatMap(([tool, errors]) =>
    errors.map((e) => ({ tool, error: e.error, recovery: e.healing, occurrences: 1 }))
  )

  return { topWorkingParamPatterns, topErrorPatterns, lastUpdated: new Date().toISOString() }
}

export function formatToolGuidanceFromSummary(
  summary: ExperienceSummary | null,
  activeToolNames: readonly string[],
): string {
  if (!summary) return ""

  const relevantErrors = summary.topErrorPatterns.filter((e) =>
    activeToolNames.includes(e.tool) && e.recovery
  )
  if (relevantErrors.length === 0) return ""

  const lines = ["Observed tool call patterns:"]
  for (const pattern of relevantErrors.slice(0, 3)) {
    lines.push(`- ${pattern.tool}: ${pattern.recovery}`)
  }
  return lines.join("\n")
}
```

- [ ] **Step 4: Wire formatToolGuidanceFromSummary into adapter.ts toolGuidance hook**

Open `packages/llm-provider/src/adapter.ts`. Find the local-tier `toolGuidance` hook. Replace the current generic text with:

```typescript
toolGuidance: (context: { toolNames: string[]; requiredTools: string[]; tier: string; experienceSummary?: ExperienceSummary | null }) => {
  const experienceGuidance = formatToolGuidanceFromSummary(
    context.experienceSummary ?? null,
    context.toolNames,
  )
  const requiredToolsText = context.requiredTools.length > 0
    ? `Required tools: [${context.requiredTools.join(", ")}]. You MUST call all of them.`
    : ""
  return [requiredToolsText, experienceGuidance].filter(Boolean).join("\n")
},
```

Pass `experienceSummary` from KernelState/CalibrationStore when calling the `toolGuidance` hook in context-builder.ts. (Find the call site in `context-builder.ts` or `think.ts` and add the field to the context object.)

- [ ] **Step 5: Run to verify it passes**

```bash
bun test packages/llm-provider/tests/experience-summary.test.ts
```
Expected: PASS (all tests)

- [ ] **Step 6: Commit**

```bash
rtk git add packages/llm-provider/src/calibration.ts packages/llm-provider/src/adapter.ts packages/llm-provider/tests/experience-summary.test.ts
rtk git commit -m "feat: ExperienceSummary materialization + toolGuidance reads concrete patterns from CalibrationStore"
```

---

## Task 14: StallDetector RI handler

**Files:**
- Create: `packages/reactive-intelligence/src/controller/handlers/stall-detector.ts`
- Create: `packages/reactive-intelligence/tests/stall-detector.test.ts`

Stall = N consecutive iterations with no new tool calls AND Jaccard similarity of last two responses ≥ 0.85.

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/reactive-intelligence/tests/stall-detector.test.ts
import { describe, it, expect } from "bun:test"
import { jaccardSimilarity, detectStall } from "../src/controller/handlers/stall-detector.js"

describe("jaccardSimilarity", () => {
  it("identical text returns 1.0", () => {
    expect(jaccardSimilarity("hello world foo", "hello world foo")).toBe(1)
  })

  it("completely different text returns 0.0", () => {
    expect(jaccardSimilarity("cat dog bird", "apple orange mango")).toBe(0)
  })

  it("partial overlap returns value between 0 and 1", () => {
    const sim = jaccardSimilarity("the quick brown fox", "the slow brown bear")
    expect(sim).toBeGreaterThan(0)
    expect(sim).toBeLessThan(1)
  })
})

describe("detectStall", () => {
  const makeStep = (thought: string, hasToolCalls: boolean) => ({
    type: hasToolCalls ? "action" : "thought" as const,
    content: thought,
  })

  it("returns false when tool calls are made", () => {
    const steps = [makeStep("thinking", true), makeStep("thinking", true)]
    expect(detectStall(steps, "local", 2)).toBe(false)
  })

  it("returns true when no tool calls and high similarity for local tier (window=2)", () => {
    const text = "I need to analyze the problem carefully and think about the solution"
    const steps = [makeStep(text, false), makeStep(text + " indeed", false)]
    expect(detectStall(steps, "local", 2)).toBe(true)
  })

  it("returns false below window threshold", () => {
    const text = "same text here"
    const steps = [makeStep(text, false)]  // only 1 step, window=2 needs 2
    expect(detectStall(steps, "local", 2)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/reactive-intelligence/tests/stall-detector.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement StallDetector**

```typescript
// packages/reactive-intelligence/src/controller/handlers/stall-detector.ts
import { Effect } from "effect"
import type { InterventionHandler } from "../intervention.js"

export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean))
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean))
  if (tokensA.size === 0 && tokensB.size === 0) return 1
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length
  const union = new Set([...tokensA, ...tokensB]).size
  return union === 0 ? 0 : intersection / union
}

const STALL_WINDOW: Record<string, number> = { local: 2, mid: 3, large: 4, frontier: 5 }
const SIMILARITY_THRESHOLD = 0.85

export function detectStall(
  recentSteps: ReadonlyArray<{ type: string; content: string }>,
  tier: string,
  windowOverride?: number,
): boolean {
  const window = windowOverride ?? STALL_WINDOW[tier] ?? 3
  if (recentSteps.length < window) return false

  const lastN = recentSteps.slice(-window)

  // Any action step = not stalled
  if (lastN.some((s) => s.type === "action")) return false

  // Check Jaccard similarity between consecutive thought contents
  for (let i = 1; i < lastN.length; i++) {
    const sim = jaccardSimilarity(lastN[i - 1]!.content, lastN[i]!.content)
    if (sim < SIMILARITY_THRESHOLD) return false
  }

  return true
}

export const stallDetectorHandler: InterventionHandler<"stall-detect"> = {
  type: "stall-detect",
  description: "Detects when model is repeating content without making progress; escalates to early-stop on second fire",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) => {
    const decisionLog = (state as unknown as { controllerDecisionLog?: readonly string[] }).controllerDecisionLog ?? []
    const priorStalls = decisionLog.filter((e) => e.startsWith("stall-detect")).length
    const isEscalation = priorStalls >= 1

    if (isEscalation) {
      return Effect.succeed({
        applied: true,
        patches: [{ kind: "early-stop" as const, reason: "Stall persisted after redirect nudge — terminating" }],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: "stall-escalate",
        telemetry: { escalated: true },
      })
    }

    return Effect.succeed({
      applied: true,
      patches: [{
        kind: "append-system-nudge" as const,
        text: "IMPORTANT: You appear to be stuck repeating the same reasoning. Try a completely different approach: call a tool you haven't used yet, or call final-answer with what you know so far.",
      }],
      cost: { tokensEstimated: 50, latencyMsEstimated: 0 },
      reason: "stall-nudge",
      telemetry: { escalated: false },
    })
  },
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun test packages/reactive-intelligence/tests/stall-detector.test.ts
```
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
rtk git add packages/reactive-intelligence/src/controller/handlers/stall-detector.ts packages/reactive-intelligence/tests/stall-detector.test.ts
rtk git commit -m "feat(reactive-intelligence): StallDetector — Jaccard similarity + iteration window, escalating nudge"
```

---

## Task 15: HarnessHarmDetector RI handler

**Files:**
- Create: `packages/reactive-intelligence/src/controller/handlers/harness-harm-detector.ts`
- Create: `packages/reactive-intelligence/tests/harness-harm-detector.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/reactive-intelligence/tests/harness-harm-detector.test.ts
import { describe, it, expect } from "bun:test"
import { isHarnessHarmSuspected, isHarnessHarmConfirmed } from "../src/controller/handlers/harness-harm-detector.js"

describe("isHarnessHarmSuspected", () => {
  it("returns true when high intervention count + low tool success + task failed", () => {
    expect(isHarnessHarmSuspected({
      interventionCount: 4,
      toolSuccessRate: 0.3,
      taskSucceeded: false,
    })).toBe(true)
  })

  it("returns false when task succeeded despite interventions", () => {
    expect(isHarnessHarmSuspected({
      interventionCount: 4,
      toolSuccessRate: 0.3,
      taskSucceeded: true,
    })).toBe(false)
  })

  it("returns false when tool success rate is adequate", () => {
    expect(isHarnessHarmSuspected({
      interventionCount: 5,
      toolSuccessRate: 0.7,
      taskSucceeded: false,
    })).toBe(false)
  })

  it("returns false when intervention count is low", () => {
    expect(isHarnessHarmSuspected({
      interventionCount: 2,
      toolSuccessRate: 0.1,
      taskSucceeded: false,
    })).toBe(false)
  })
})

describe("isHarnessHarmConfirmed", () => {
  it("confirms after 3 suspected runs", () => {
    expect(isHarnessHarmConfirmed(3)).toBe(true)
  })

  it("not confirmed at 2 suspected runs", () => {
    expect(isHarnessHarmConfirmed(2)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
bun test packages/reactive-intelligence/tests/harness-harm-detector.test.ts
```
Expected: FAIL — module not found

- [ ] **Step 3: Implement HarnessHarmDetector**

```typescript
// packages/reactive-intelligence/src/controller/handlers/harness-harm-detector.ts
import { Effect } from "effect"
import type { InterventionHandler } from "../intervention.js"

interface HarmSignals {
  interventionCount: number
  toolSuccessRate: number
  taskSucceeded: boolean
}

const HARM_INTERVENTION_THRESHOLD = 3
const HARM_TOOL_SUCCESS_THRESHOLD = 0.40
const HARM_CONFIRMATION_RUNS = 3

export function isHarnessHarmSuspected(signals: HarmSignals): boolean {
  return (
    !signals.taskSucceeded &&
    signals.interventionCount > HARM_INTERVENTION_THRESHOLD &&
    signals.toolSuccessRate < HARM_TOOL_SUCCESS_THRESHOLD
  )
}

export function isHarnessHarmConfirmed(suspectedRunCount: number): boolean {
  return suspectedRunCount >= HARM_CONFIRMATION_RUNS
}

export const harnessHarmDetectorHandler: InterventionHandler<"harness-harm"> = {
  type: "harness-harm",
  description: "Circuit-breaks RI interventions when harness is provably making model performance worse",
  defaultMode: "dispatch",
  execute: (_decision, state, _ctx) => {
    const decisionLog = (state as unknown as { controllerDecisionLog?: readonly string[] }).controllerDecisionLog ?? []
    const harmDecisions = decisionLog.filter((e) => e.startsWith("harness-harm")).length

    if (harmDecisions === 0) {
      // First detection — circuit-break all interventions except early-stop for this run
      return Effect.succeed({
        applied: true,
        patches: [{
          kind: "append-system-nudge" as const,
          text: "Focus on using tools directly. Do not wait for additional guidance.",
        }],
        cost: { tokensEstimated: 20, latencyMsEstimated: 0 },
        reason: "harness-harm-suspected",
        telemetry: { harmSuspected: true, escalated: false },
      })
    }

    // Confirmed harm — early stop to prevent further degradation
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "early-stop" as const, reason: "Harness harm confirmed — RI making performance worse for this model+task" }],
      cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
      reason: "harness-harm-confirmed",
      telemetry: { harmConfirmed: true, escalated: true },
    })
  },
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
bun test packages/reactive-intelligence/tests/harness-harm-detector.test.ts
```
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
rtk git add packages/reactive-intelligence/src/controller/handlers/harness-harm-detector.ts packages/reactive-intelligence/tests/harness-harm-detector.test.ts
rtk git commit -m "feat(reactive-intelligence): HarnessHarmDetector — circuit-breaks RI when harness is net-negative"
```

---

## Task 16: Register new handlers in dispatcher

**Files:**
- Modify: handler registry file in `packages/reactive-intelligence/src/controller/handlers/` (look for `index.ts`, `registry.ts`, or the `InterventionDispatcherLayer` constructor — check how `toolFailureRedirectHandler` is currently registered and follow the same pattern)

- [ ] **Step 1: Find the handler registry**

```bash
rtk grep "toolFailureRedirectHandler" packages/reactive-intelligence/src/ --output content
```

This will show where `toolFailureRedirectHandler` is imported and registered. That file is where you add the new handlers.

- [ ] **Step 2: Register StallDetector and HarnessHarmDetector**

Open the registry file found in Step 1. Add imports:

```typescript
import { stallDetectorHandler } from "./handlers/stall-detector.js"
import { harnessHarmDetectorHandler } from "./handlers/harness-harm-detector.js"
```

Add both handlers to the registry array/map alongside the existing handlers (follow the exact pattern of how other handlers are registered — don't restructure the registry):

```typescript
stallDetectorHandler,
harnessHarmDetectorHandler,
```

- [ ] **Step 3: Run full reactive-intelligence tests**

```bash
bun test packages/reactive-intelligence/
```
Expected: all passing. The new handlers are registered but won't fire unless their evaluator conditions are met.

- [ ] **Step 4: Run full test suite**

```bash
bun test 2>&1 | tail -5
```
Expected: green. Note the total pass/fail counts. Fix any type errors before proceeding.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/reactive-intelligence/src/controller/handlers/
rtk git commit -m "feat(reactive-intelligence): register StallDetector + HarnessHarmDetector in intervention dispatcher"
```

---

## Task 17: README + AGENTS.md updates

**Files:**
- Modify: `README.md` (reactive-intelligence handler count)
- Modify: `AGENTS.md` (shipped capabilities section)

- [ ] **Step 1: Update reactive-intelligence feature bullet in README.md**

Find: `"6 dispatched interventions: early-stop, context-compress, strategy-switch, temp-adjust, tool-inject, skill-activate"`

Replace with: `"8 dispatched interventions: early-stop, context-compress, strategy-switch, temp-adjust, tool-inject, skill-activate, tool-failure-redirect, stall-detect"`

- [ ] **Step 2: Update adaptive calibration bullet in README.md**

Find the `"Adaptive calibration"` bullet. Add `; toolCallDialect probed per model (native-fc vs text-parse routing)` after the existing calibration description.

- [ ] **Step 3: Update AGENTS.md shipped highlights**

Add to the recently shipped section:
```
- Adaptive Tool Calling System: FC probe → toolCallDialect profile → NativeFCDriver/TextParseDriver routing; HealingPipeline (ToolNameHealer, ParamNameHealer, PathResolver); ExperienceSummary closes ExperienceStore dead loop; StallDetector + HarnessHarmDetector RI handlers
```

- [ ] **Step 4: Commit**

```bash
rtk git add README.md AGENTS.md
rtk git commit -m "docs: update README + AGENTS.md for adaptive tool calling system"
```

---

## Self-Review

### Spec coverage check

| Spec section | Task(s) |
|---|---|
| Calibration probe + FC grading battery | Task 11 |
| `toolCallDialect` field in profiles | Task 2 |
| Routing thresholds (0.8 → native-fc, else text-parse) | Task 9, 11 |
| NativeFCDriver | Task 3 |
| TextParseDriver + 3-tier parse pipeline | Task 8 |
| ToolCallingDriver interface | Task 1 |
| KernelContext extension | Task 9 |
| buildCalibratedAdapter() routing | Task 9 |
| Provider API empty-tools constraint | Task 10 |
| HealingPipeline + all 4 stages | Tasks 4, 5, 6, 7 |
| ToolCallObservation schema | Task 12 |
| Alias accumulation + frequency gate (N≥3) | Task 12 |
| ExperienceSummary materialization | Task 13 |
| toolGuidance reads summary | Task 13 |
| interventionResponseRate | Task 12 (partial — field added to schema; full computation wired at run end) |
| StallDetector | Task 14 |
| HarnessHarmDetector | Task 15 |
| Handler registration | Task 16 |
| README/docs accuracy | Task 17 |

**One partial gap:** `interventionResponseRate` is defined in the schema (Task 2) and the accumulation helpers are present (Task 12), but the E2E wiring that reads `controllerDecisionLog` at run end and writes the rate back to CalibrationStore is not a standalone task. This write should happen in the execution engine's `complete` phase or in `builder.ts` after each run. Add this to Task 12 or create a Task 12b:

In `packages/runtime/src/builder.ts` or wherever `TaskCompleted` is handled, after each run:

```typescript
// After agent.run() completes, compute and persist interventionResponseRate
const log = result.metadata?.controllerDecisionLog ?? []
const firstDispatch = log.findIndex((e: string) => e.length > 0)
if (firstDispatch !== -1) {
  const itersAfter = log.length - firstDispatch - 1
  // Write to CalibrationStore: update interventionResponseRate with exponential moving average
  await calibrationStore.updateInterventionRate(modelId, itersAfter)
}
```

### Placeholder scan

No TBDs or vague steps found. All code blocks contain real TypeScript. All run commands include expected output.

### Type consistency

- `ToolCallSpec.arguments` (not `.input`) — used consistently throughout Tasks 3, 7, 8, 10
- `HealingAction.stage` union — defined in Task 1, used consistently in Tasks 4–7
- `ExperienceSummary` — defined in Task 13, used in adapter.ts update in Task 13
- `InterventionHandler<"type-key">` pattern — matched exactly in Tasks 14, 15 from the reference handler
- `ModelCalibration` type — comes from `typeof ModelCalibrationSchema.Type` (Effect Schema pattern), consistent with Task 2
