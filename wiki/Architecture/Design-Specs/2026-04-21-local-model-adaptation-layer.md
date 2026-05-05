# Local Model Adaptation Layer (LMAL) — Architecture Design

**Date:** 2026-04-21  
**Status:** DESIGN SPEC — Ready for Implementation Planning  
**Authors:** Tyler Buell  
**Evidence Base:** live `local-models` benchmark session (qwen3:4b, cogito:8b vs rw-2/3/6/8/9)

---

## Problem Statement

The vision promises: *"The right engineering makes any model production-capable — great agents aren't locked to flagship models."* The benchmark data from this session exposes exactly where the harness currently fails that promise.

The benchmark revealed three distinct, reproducible failure domains:

### Domain 1: Schema Mismatch (100% tool failure rate)

cogito:8b deterministically uses `input` as a universal parameter name for every tool it calls. When exhausted, it tries `command`. Neither is the correct parameter for any tool in the schema.

```
rw-6 run 3 (cogito:8b ra-full):
  ✗ code-execute  — "input" (needs "code")
  ✗ file-read     — "input" (needs "path")
  ✗ web-search    — "input" (needs "query")
  ✗ crypto-price  — "input" (needs "coins")
  ✗ git-cli       — "input" (needs "command")
  ✗ find          — "input" (needs "query")
  Result: max_iterations, 40,575 tokens, 0 successful tool calls
```

cogito:8b also hallucinates tool namespaces:
```
rw-8 (cogito:8b ra-full):
  ✗ typescript/compile  — ToolNotFoundError
  ✗ typescript/execute  — ToolNotFoundError
  ✗ code-execute        — "command" (needs "code")
  Result: 25,117 tokens, 133s, Grade D diverging
```

qwen3:4b is more targeted — it uses `filePath` instead of `path` for file-write:
```
rw-3 (qwen3:4b ra-full):
  ✗ file-write — "filePath" (needs "path")
```

### Domain 2: Spatial Context Mismatch (path hallucination)

qwen3:4b deterministically generates wrong absolute path prefixes — a training artifact from its dataset containing similar but non-matching filesystem structures. The model cannot be prompted out of this because it's a deterministic generation bias.

```
rw-6 (qwen3:4b):
  Model generates: /home/tyler-than/tylerbuell/Documents/...
  Actual path:     /home/tylerbuell/Documents/...
  Result: ENOENT on every file operation
```

### Domain 3: Behavioral Loop / Harness Harm

The harness's reactive intelligence layer, when applied to local models without tier-adaptive thresholds, produces worse outcomes than no harness at all:

```
rw-2 results:
  qwen3:4b  bare-llm:  small tokens (~1200-1900), clean termination
  qwen3:4b  ra-full:   Grade B flat (run 1), Grade B flat delta=0.000 (run 2), Grade B flat delta=0.000 (run 3)
  cogito:8b bare-llm:  small tokens, clean termination
  cogito:8b ra-full:   Grade D diverging × 3 (10,709–12,308 tokens each)

rw-8 results:
  cogito:8b bare-llm:  ~1,380–1,499 tokens, highly consistent
  cogito:8b ra-full:   Grade D diverging (25,117 tokens, 133s)

Pattern: ra-full harness actively harms cogito:8b on information-retrieval tasks.
         qwen3:4b ra-full stalls at entropy delta=0.000 with no RI intervention.
```

---

## Architectural Response: The Local Model Adaptation Layer

This is not a patch collection. It's a coherent cross-cutting layer that makes model-tier a first-class concept across all kernel phases. Every component is driven by a single `ModelTierProfile` resolved at `agent.build()` time.

```
┌────────────────────────────────────────────────────────────────────┐
│                    AGENT BUILD TIME                                │
│                                                                    │
│   model: "cogito:8b"                                               │
│       ↓                                                            │
│   ModelProfileResolver.resolve("cogito:8b")                        │
│       ↓                                                            │
│   ModelTierProfile { tier: "local", ... }                          │
│       ↓                    ↓                    ↓                  │
│  SchemaSimplifier      FileSandbox          RIController           │
│  (context-builder)    (tool registry)       (stall thresholds)     │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│                    AGENT RUN TIME                                  │
│                                                                    │
│   think.ts → parseToolCalls()                                      │
│       ↓                                                            │
│   ┌─────────────────────────────┐                                  │
│   │     HEALING PIPELINE        │  ← NEW: between think and act   │
│   │  1. ToolNameHealer          │                                  │
│   │  2. ParamNameHealer         │                                  │
│   │  3. ParamInferenceHealer    │                                  │
│   └─────────────────────────────┘                                  │
│       ↓                                                            │
│   act.ts → executeTools()                                          │
│       ↓                                                            │
│   FileSandbox (path resolution, transparent to tool)               │
│       ↓                                                            │
│   RI Controller (every iteration)                                  │
│       ↓                                                            │
│   StallDetector / HarnessHarmDetector                              │
└────────────────────────────────────────────────────────────────────┘
```

---

## Component 1: ModelTierProfile

The single source of truth for all tier-adaptive behavior. Resolved once at `agent.build()` and propagated through `AgentContext` (alongside existing `contextProfile`).

```typescript
// packages/runtime/src/profiles/model-tier-profile.ts

export interface ModelTierProfile {
  // Identification
  readonly modelPattern: string | RegExp
  readonly tier: "local" | "standard" | "large" | "frontier"
  readonly displayName: string

  // Schema adaptation (drives context-builder.ts behavior)
  readonly schemaVerbosity: "full" | "required-only"
  readonly injectToolExamples: boolean
  readonly toolCallFormat: "native-fc" | "programmatic"

  // Healing configuration (drives HealingPipeline)
  readonly universalParamAlias?: string          // e.g. "input" → correct per tool
  readonly paramAliases: {
    readonly [toolId: string]: {
      readonly [wrongName: string]: string        // wrong → correct param name
    }
  }
  readonly toolNameAliases: {
    readonly [hallucinated: string]: string       // hallucinated → real tool id
  }
  readonly toolNameFuzzyThreshold: number        // 0–1 levenshtein similarity floor

  // Sandbox (drives FileSandbox)
  readonly fileToolSandbox: boolean
  readonly sandboxPromptStyle: "relative-only" | "explicit-dir"

  // RI tuning (drives RI controller configuration)
  readonly stallDetectionWindow: number          // iterations before stall fires
  readonly entropyDivergenceGrade: "C" | "D"     // grade threshold for harm detection
  readonly harnessHarmRunThreshold: number       // diverging runs before circuit-break

  // Execution bounds
  readonly preferredStrategy: "reactive" | "plan-execute" | "react"
  readonly maxIterations: number
  readonly softTokenCap: number                  // warn + early-stop above this
}
```

### Built-in Profiles

```typescript
// packages/runtime/src/profiles/builtin-profiles.ts

export const BUILTIN_PROFILES: readonly ModelTierProfile[] = [
  {
    modelPattern: /^cogito:/,
    tier: "local",
    displayName: "Cogito (local)",
    schemaVerbosity: "required-only",
    injectToolExamples: true,
    toolCallFormat: "native-fc",
    universalParamAlias: "input",
    paramAliases: {
      "code-execute": { input: "code", command: "code", script: "code" },
      "file-read":    { input: "path", filePath: "path", file: "path" },
      "file-write":   { input: "path", filePath: "path", file: "path" },
      "web-search":   { input: "query", search: "query" },
      "git-cli":      { input: "command", cmd: "command" },
      "find":         { input: "query", search: "query" },
      "gh-cli":       { input: "command", cmd: "command" },
    },
    toolNameAliases: {
      "typescript/compile":  "code-execute",
      "typescript/execute":  "code-execute",
      "typescript/run":      "code-execute",
      "node/execute":        "code-execute",
      "node/run":            "code-execute",
      "python/execute":      "code-execute",
      "python/run":          "code-execute",
      "bash/execute":        "code-execute",
      "shell/execute":       "code-execute",
      "execute_code":        "code-execute",
      "run_code":            "code-execute",
      "search_web":          "web-search",
      "read_file":           "file-read",
      "write_file":          "file-write",
    },
    toolNameFuzzyThreshold: 0.65,
    fileToolSandbox: true,
    sandboxPromptStyle: "relative-only",
    stallDetectionWindow: 2,
    entropyDivergenceGrade: "D",
    harnessHarmRunThreshold: 2,
    preferredStrategy: "reactive",              // plan-execute causes 133s runs
    maxIterations: 15,
    softTokenCap: 15_000,
  },
  {
    modelPattern: /^qwen3:/,
    tier: "local",
    displayName: "Qwen3 (local)",
    schemaVerbosity: "required-only",
    injectToolExamples: true,
    toolCallFormat: "native-fc",
    universalParamAlias: undefined,
    paramAliases: {
      "file-write": { filePath: "path", filename: "path" },
      "file-read":  { filePath: "path", filename: "path" },
    },
    toolNameAliases: {},
    toolNameFuzzyThreshold: 0.7,
    fileToolSandbox: true,                      // fixes deterministic path hallucination
    sandboxPromptStyle: "explicit-dir",
    stallDetectionWindow: 2,
    entropyDivergenceGrade: "D",
    harnessHarmRunThreshold: 3,
    preferredStrategy: "plan-execute",          // works well for qwen3
    maxIterations: 20,
    softTokenCap: 20_000,
  },
  {
    modelPattern: /^(llama|mistral|phi|gemma|deepseek):/,
    tier: "local",
    displayName: "Generic local model",
    schemaVerbosity: "required-only",
    injectToolExamples: true,
    toolCallFormat: "native-fc",
    universalParamAlias: undefined,
    paramAliases: {},
    toolNameAliases: {},
    toolNameFuzzyThreshold: 0.7,
    fileToolSandbox: true,
    sandboxPromptStyle: "relative-only",
    stallDetectionWindow: 3,
    entropyDivergenceGrade: "D",
    harnessHarmRunThreshold: 3,
    preferredStrategy: "reactive",
    maxIterations: 20,
    softTokenCap: 25_000,
  },
  {
    modelPattern: /^(claude-|gpt-4|gemini-)/,
    tier: "frontier",
    displayName: "Frontier model",
    schemaVerbosity: "full",
    injectToolExamples: false,
    toolCallFormat: "native-fc",
    universalParamAlias: undefined,
    paramAliases: {},
    toolNameAliases: {},
    toolNameFuzzyThreshold: 0.9,
    fileToolSandbox: false,
    sandboxPromptStyle: "explicit-dir",
    stallDetectionWindow: 5,
    entropyDivergenceGrade: "D",
    harnessHarmRunThreshold: 5,
    preferredStrategy: "reactive",
    maxIterations: 30,
    softTokenCap: 100_000,
  },
]
```

### Profile Resolution

```typescript
// packages/runtime/src/profiles/model-profile-resolver.ts

export class ModelProfileResolver {
  private profiles: ModelTierProfile[]

  constructor(custom: ModelTierProfile[] = []) {
    // Custom profiles override built-in; order matters for pattern matching
    this.profiles = [...custom, ...BUILTIN_PROFILES]
  }

  resolve(modelId: string): ModelTierProfile {
    for (const profile of this.profiles) {
      const pattern = profile.modelPattern
      const matches = typeof pattern === "string"
        ? modelId.startsWith(pattern)
        : pattern.test(modelId)
      if (matches) return profile
    }
    return FRONTIER_PROFILE  // safe fallback — no healing, no sandbox
  }
}
```

---

## Component 2: Tool Call Healing Pipeline

The highest-ROI component. Placed between `think.ts` (tool call parsing) and `act.ts` (tool dispatch). Operates transparently — the tool layer never knows a correction occurred. Corrections are fully logged via `ToolCallHealed` events.

### Interface

```typescript
// packages/tools/src/healing/tool-call-healer.ts

export interface ToolCall {
  readonly toolId: string
  readonly params: Record<string, unknown>
  readonly callId: string
}

export interface Correction {
  readonly type: "tool-name" | "param-name" | "param-infer"
  readonly from: string
  readonly to: string
  readonly confidence: number
  readonly reason: string
}

export interface HealingResult {
  readonly original: ToolCall
  readonly healed: ToolCall
  readonly corrections: ReadonlyArray<Correction>
  readonly wasModified: boolean
}

export interface HealingContext {
  readonly profile: ModelTierProfile
  readonly availableTools: ReadonlyArray<ToolDefinition>
  readonly iteration: number
}

export interface Healer {
  readonly id: string
  readonly priority: number   // lower = runs first
  heal(call: ToolCall, context: HealingContext): HealingResult
}

export class HealingPipeline {
  constructor(private readonly healers: ReadonlyArray<Healer>) {}

  process(calls: ReadonlyArray<ToolCall>, context: HealingContext): ReadonlyArray<HealingResult> {
    return calls.map(call => {
      let current = call
      const allCorrections: Correction[] = []

      for (const healer of this.healers.sort((a, b) => a.priority - b.priority)) {
        const result = healer.heal(current, context)
        current = result.healed
        allCorrections.push(...result.corrections)
      }

      return {
        original: call,
        healed: current,
        corrections: allCorrections,
        wasModified: allCorrections.length > 0,
      }
    })
  }
}
```

### Healer 1: ToolNameHealer

Resolves hallucinated tool names. Uses profile aliases first, then fuzzy matching.

```typescript
// packages/tools/src/healing/healers/tool-name-healer.ts

export class ToolNameHealer implements Healer {
  readonly id = "tool-name-healer"
  readonly priority = 10  // runs first — wrong tool name means wrong params too

  heal(call: ToolCall, ctx: HealingContext): HealingResult {
    const { toolNameAliases, toolNameFuzzyThreshold } = ctx.profile
    const availableIds = ctx.availableTools.map(t => t.id)

    // Tool exists — no healing needed
    if (availableIds.includes(call.toolId)) {
      return { original: call, healed: call, corrections: [], wasModified: false }
    }

    // Check static alias table
    const aliased = toolNameAliases[call.toolId]
    if (aliased && availableIds.includes(aliased)) {
      return this.buildResult(call, aliased, "tool-name", 1.0, "static alias")
    }

    // Fuzzy match: split on / and -, compare parts
    const best = this.fuzzyMatch(call.toolId, availableIds, toolNameFuzzyThreshold)
    if (best) {
      return this.buildResult(call, best.toolId, "tool-name", best.similarity, "fuzzy match")
    }

    // No match found — return original (will produce ToolNotFoundError with suggestions)
    return { original: call, healed: call, corrections: [], wasModified: false }
  }

  private fuzzyMatch(name: string, candidates: string[], threshold: number) {
    // Normalize: "typescript/compile" → ["typescript", "compile"]
    const nameParts = name.toLowerCase().replace(/[/_-]/g, " ").split(" ")

    let best: { toolId: string; similarity: number } | null = null
    for (const candidate of candidates) {
      const candParts = candidate.toLowerCase().replace(/[/_-]/g, " ").split(" ")
      const similarity = this.partSimilarity(nameParts, candParts)
      if (similarity >= threshold && (!best || similarity > best.similarity)) {
        best = { toolId: candidate, similarity }
      }
    }
    return best
  }

  private partSimilarity(a: string[], b: string[]): number {
    // Jaccard similarity on word parts
    const setA = new Set(a)
    const setB = new Set(b)
    const intersection = [...setA].filter(x => setB.has(x)).length
    const union = new Set([...a, ...b]).size
    return intersection / union
  }

  private buildResult(
    call: ToolCall, newId: string, type: Correction["type"],
    confidence: number, reason: string
  ): HealingResult {
    const healed = { ...call, toolId: newId }
    return {
      original: call, healed,
      corrections: [{ type, from: call.toolId, to: newId, confidence, reason }],
      wasModified: true,
    }
  }
}
```

### Healer 2: ParamNameHealer

Resolves wrong parameter names using profile aliases and universal alias.

```typescript
// packages/tools/src/healing/healers/param-name-healer.ts

export class ParamNameHealer implements Healer {
  readonly id = "param-name-healer"
  readonly priority = 20

  heal(call: ToolCall, ctx: HealingContext): HealingResult {
    const { paramAliases, universalParamAlias } = ctx.profile
    const toolAliases = paramAliases[call.toolId] ?? {}
    const tool = ctx.availableTools.find(t => t.id === call.toolId)
    if (!tool) return { original: call, healed: call, corrections: [], wasModified: false }

    const required = tool.schema.required ?? []
    let params = { ...call.params }
    const corrections: Correction[] = []

    // Apply static aliases for this tool
    for (const [wrong, correct] of Object.entries(toolAliases)) {
      if (wrong in params && !(correct in params)) {
        params[correct] = params[wrong]
        delete params[wrong]
        corrections.push({ type: "param-name", from: wrong, to: correct, confidence: 1.0, reason: "static alias" })
      }
    }

    // Apply universal alias (e.g. cogito's "input" for everything)
    if (universalParamAlias && universalParamAlias in params) {
      const missingRequired = required.filter(r => !(r in params))
      if (missingRequired.length === 1) {
        const target = missingRequired[0]!
        params[target] = params[universalParamAlias]
        delete params[universalParamAlias]
        corrections.push({
          type: "param-name",
          from: universalParamAlias,
          to: target,
          confidence: 0.9,
          reason: "universal alias → only missing required param"
        })
      }
    }

    const healed = { ...call, params }
    return { original: call, healed, corrections, wasModified: corrections.length > 0 }
  }
}
```

### Healer 3: ParamInferenceHealer

When exactly one required param is missing and exactly one unknown param is present, infer the mapping.

```typescript
// packages/tools/src/healing/healers/param-inference-healer.ts

export class ParamInferenceHealer implements Healer {
  readonly id = "param-inference-healer"
  readonly priority = 30

  heal(call: ToolCall, ctx: HealingContext): HealingResult {
    const tool = ctx.availableTools.find(t => t.id === call.toolId)
    if (!tool) return { original: call, healed: call, corrections: [], wasModified: false }

    const required = tool.schema.required ?? []
    const knownParams = Object.keys(tool.schema.properties ?? {})
    const passedParams = Object.keys(call.params)

    const missingRequired = required.filter(r => !(r in call.params))
    const unknownPassed = passedParams.filter(p => !knownParams.includes(p))

    // Only infer when exactly 1 missing ↔ 1 unknown
    if (missingRequired.length !== 1 || unknownPassed.length !== 1) {
      return { original: call, healed: call, corrections: [], wasModified: false }
    }

    const target = missingRequired[0]!
    const source = unknownPassed[0]!
    const params = { ...call.params, [target]: call.params[source] }
    delete params[source]

    return {
      original: call,
      healed: { ...call, params },
      corrections: [{
        type: "param-infer",
        from: source, to: target,
        confidence: 0.8,
        reason: "1 missing required ↔ 1 unknown param"
      }],
      wasModified: true,
    }
  }
}
```

### Integration Point in act.ts

```typescript
// packages/reasoning/src/strategies/kernel/phases/act.ts (modified)

// After parseToolCalls(), before executeTools():
const rawCalls = parseToolCalls(llmResponse)

const healingPipeline = context.healingPipeline  // injected via KernelContext
const healingResults = healingPipeline.process(rawCalls, {
  profile: context.modelProfile,
  availableTools: context.tools,
  iteration: state.iteration,
})

// Emit events for observability
for (const result of healingResults.filter(r => r.wasModified)) {
  context.eventBus.emit({
    _tag: "ToolCallHealed",
    toolId: result.original.toolId,
    corrections: result.corrections,
    iteration: state.iteration,
  })
}

const callsToExecute = healingResults.map(r => r.healed)
// ... existing tool dispatch logic
```

---

## Component 3: Working Directory Sandbox

Eliminates the path hallucination class of failures entirely. The model never needs to know or produce absolute paths — it works with relative paths, and the sandbox resolves them transparently.

### Implementation

```typescript
// packages/tools/src/sandbox/file-sandbox.ts

const FILE_TOOL_IDS = new Set(["file-read", "file-write", "file-list", "file-delete", "file-move"])

export function createFileSandbox(workingDir: string): ToolTransformer {
  return (tool: ToolDefinition): ToolDefinition => {
    if (!FILE_TOOL_IDS.has(tool.id)) return tool

    return {
      ...tool,
      execute: async (params: Record<string, unknown>) => {
        const rawPath = params.path as string | undefined
        if (!rawPath) return tool.execute(params)

        const resolvedPath = resolveSandboxedPath(rawPath, workingDir)
        return tool.execute({ ...params, path: resolvedPath })
      }
    }
  }
}

function resolveSandboxedPath(inputPath: string, workingDir: string): string {
  // Relative path → resolve against workingDir
  if (!isAbsolute(inputPath)) {
    return join(workingDir, inputPath)
  }

  // Absolute path within workingDir → use as-is
  if (inputPath.startsWith(workingDir)) {
    return inputPath
  }

  // Absolute path outside workingDir (path hallucination) → 
  // extract basename and place in workingDir
  return join(workingDir, basename(inputPath))
}
```

### System Prompt Injection

The sandbox prompt style (from `ModelTierProfile`) drives what the model is told:

**`relative-only`** (for models with severe hallucination):
```
Your file working directory is set for this task. Use relative paths only:
  file-read(path: "data.csv")
  file-write(path: "output.md", content: "...")
Do NOT use absolute paths.
```

**`explicit-dir`** (for models that need anchoring):
```
Working directory for this task: ./task-workspace/
All files are in this directory. Example usage:
  file-read(path: "data.csv")  — reads ./task-workspace/data.csv
```

---

## Component 4: Schema Simplifier

Reduces tool schema complexity for local-tier models. Operates in `context-builder.ts` during `buildToolSchemas()`. Two behaviors driven by `schemaVerbosity`:

**`required-only`**: Strip optional parameters from tool schemas. cogito:8b sees fewer valid field names, reducing the surface area for confusion.

```typescript
// packages/reasoning/src/strategies/kernel/phases/context-builder.ts (modified)

function buildToolSchemasForProfile(
  tools: ReadonlyArray<ToolDefinition>,
  profile: ModelTierProfile
): ReadonlyArray<ToolSchema> {
  if (profile.schemaVerbosity === "full") {
    return tools.map(buildFullSchema)
  }

  return tools.map(tool => ({
    name: tool.id,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: Object.fromEntries(
        (tool.schema.required ?? []).map(key => [
          key,
          tool.schema.properties[key]
        ])
      ),
      required: tool.schema.required,
    }
  }))
}
```

**`injectToolExamples: true`**: Append tool call examples to the system prompt. Frontier models don't need this; local models benefit significantly.

```typescript
function buildToolExamplesBlock(tools: ReadonlyArray<ToolDefinition>): string {
  const examples = tools.map(tool => {
    const requiredParams = tool.schema.required ?? []
    const exampleParams = requiredParams.map(p => {
      const schema = tool.schema.properties[p]
      const exValue = schema?.examples?.[0] ?? getTypeExample(schema?.type)
      return `${p}: ${JSON.stringify(exValue)}`
    }).join(", ")
    return `  ${tool.id}(${exampleParams})`
  })

  return [
    "Tool call format — use EXACTLY these parameter names:",
    ...examples,
    ""
  ].join("\n")
}
```

For cogito:8b this generates:
```
Tool call format — use EXACTLY these parameter names:
  code-execute(code: "console.log('hello')", language: "javascript")
  file-read(path: "data.csv")
  file-write(path: "output.md", content: "# Report")
  web-search(query: "TypeScript best practices 2025")
  git-cli(command: "status")
```

This directly counters the `input` hallucination by showing the model exactly what parameter names to use, once, at the start of every run.

---

## Component 5: Stall-Aware RI Handler

Extends the existing `InterventionHandler` interface in `packages/reactive-intelligence`. The stall pattern — entropy delta ≈ 0.000 for N consecutive iterations — is now addressable.

### Evidence from session

```
qwen3:4b rw-2 ra-full:
  Run 2: Grade B flat, Mean: 0.150, Delta: 0.000   ← pure flatline
  Run 3: Grade B flat, Mean: 0.150, Delta: 0.000   ← same flatline

This means the model reached entropy 0.150 on iteration 1 and never moved.
Every subsequent iteration was identical behavior. No RI intervention fired.
```

### Implementation

```typescript
// packages/reactive-intelligence/src/controller/handlers/stall-detector.ts

export function createStallDetector(profile: ModelTierProfile): InterventionHandler {
  return {
    id: "stall-detector",
    priority: 85,

    evaluate(state: KernelState, context: RIContext): InterventionDecision {
      const n = profile.stallDetectionWindow
      if (context.entropyHistory.length < n) return { action: "none" }

      const recentDeltas = context.entropyHistory
        .slice(-n)
        .map(e => Math.abs(e.delta ?? 0))

      const isStalled = recentDeltas.every(d => d < 0.015)
      if (!isStalled) return { action: "none" }

      const stalledFor = recentDeltas.length

      // Stage 1: corrective injection
      if (stalledFor <= n + 1) {
        return {
          action: "inject-guidance",
          payload: {
            role: "user",
            content:
              "Your current approach is producing the same result repeatedly. " +
              "Switch to a completely different method, try different parameters, " +
              "or provide your best current answer using final_answer.",
          },
          reason: `Stall detected: entropy delta < 0.015 for ${stalledFor} iterations`,
        }
      }

      // Stage 2: early-stop (model cannot break out of stall)
      return {
        action: "early-stop",
        reason: `Stall persists after guidance: ${stalledFor} iterations at delta ≈ 0`,
      }
    }
  }
}
```

### Tier-Adaptive Registration

The stall detector is registered with tier-appropriate window:

```typescript
// In RI controller setup:
const stallDetector = createStallDetector(modelProfile)
riController.registerHandler(stallDetector)
```

For cogito:8b (`stallDetectionWindow: 2`): fires after 2 identical iterations.  
For frontier models (`stallDetectionWindow: 5`): more tolerance for natural exploration.

---

## Component 6: Harness Harm Circuit Breaker

The most architecturally nuanced component. cogito:8b ra-full produced Grade D diverging on rw-2 (3/3 runs) and rw-8 (1/3 runs). This means the harness configuration is actively worse than no harness for this model on these task types.

### Detection Strategy

In-run detection uses entropy grade trajectory:

```typescript
// packages/reactive-intelligence/src/controller/handlers/harness-harm-detector.ts

export function createHarnessHarmDetector(profile: ModelTierProfile): InterventionHandler {
  return {
    id: "harness-harm-detector",
    priority: 95,  // runs before stall detector

    evaluate(state: KernelState, context: RIContext): InterventionDecision {
      if (context.iteration < 3) return { action: "none" }

      // Check if entropy is trending upward (diverging) consistently
      const recent = context.entropyHistory.slice(-3)
      const isDiverging = recent.length >= 3 &&
        recent.every((e, i) => i === 0 || e.composite > recent[i - 1]!.composite)

      const currentGrade = context.currentEntropyGrade  // "A"|"B"|"C"|"D"
      const isGradeD = currentGrade === profile.entropyDivergenceGrade

      if (isDiverging && isGradeD && context.iteration >= 4) {
        return {
          action: "switch-strategy",
          payload: {
            strategy: "react",  // fall back to simplest strategy
            disableRI: true,    // stop intervening — RI is causing harm
          },
          reason: "Entropy diverging under RI — switching to bare reactive strategy",
        }
      }

      return { action: "none" }
    }
  }
}
```

### Cross-Run Tracking (Benchmark Context)

In the benchmark runner, track harness harm across runs of the same task+variant:

```typescript
// packages/benchmarks/src/runner.ts (extended)

interface VariantRunAccumulator {
  grades: Array<"A" | "B" | "C" | "D">
  harnessHarmCount: number
}

// After each run completes and is graded:
if (grade === "D" && variant.id !== "bare-llm") {
  accumulator.harnessHarmCount++
  if (accumulator.harnessHarmCount >= profile.harnessHarmRunThreshold) {
    // Emit HarnessHarmDetected — surfaced in SessionReport
    report.harnessHarmWarnings.push({
      taskId, variantId, modelId,
      message: `${accumulator.harnessHarmCount}/${runs} runs Grade D — harness may be harming this model on this task type`
    })
  }
}
```

---

## Data Flow: Full Picture

```
agent.build()
  ├── ModelProfileResolver.resolve(modelId)        → ModelTierProfile
  ├── SchemaSimplifier.configure(profile)           → stored in AgentContext
  ├── FileSandbox.configure(profile, workingDir)    → tool registry wrapped
  └── RIController.configure(profile)               → handlers registered with tier thresholds

agent.run(task)
  │
  context-builder.ts (per iteration)
  ├── buildSystemPrompt()
  │     ├── base system prompt
  │     ├── [if profile.injectToolExamples] tool call format block
  │     └── [if profile.fileToolSandbox] working directory guidance
  └── buildToolSchemas()
        └── [if profile.schemaVerbosity === "required-only"] strip optional params

  think.ts (per iteration)
  └── LLM call → raw tool calls

  [HEALING PIPELINE] (per iteration, per tool call)
  ├── ToolNameHealer      → resolve hallucinated tool names
  ├── ParamNameHealer     → resolve wrong param names via aliases
  ├── ParamInferenceHealer → infer 1-missing ↔ 1-unknown
  └── emit ToolCallHealed events for each correction

  act.ts (per iteration)
  ├── execute healed tool calls
  └── file tools → FileSandbox.resolvePath() → actual filesystem

  RI Controller (per iteration)
  ├── HarnessHarmDetector → monitor entropy divergence trajectory
  ├── StallDetector       → fire on delta ≈ 0 for N iterations
  └── existing handlers   → early-stop, strategy-switch, temp-adjust
```

---

## Expected Impact

Based on the benchmark evidence:

| Failure | Before | After | Fix |
|---|---|---|---|
| cogito:8b rw-6 run 3 (6 tool failures) | max_iterations, 40,575 tok | final_answer, ~8,000 tok | ParamNameHealer |
| cogito:8b rw-8 typescript/compile × 4 | 25,117 tok, Grade D | ~10,000 tok, Grade B | ToolNameHealer |
| qwen3:4b rw-6 ENOENT on file ops | task fails | task succeeds | FileSandbox |
| qwen3:4b rw-2 entropy flatline | wasted ~6 iterations | early-stop at iter 2-3 | StallDetector |
| cogito:8b rw-2 Grade D × 3 | 30,000+ tok per run | circuit-break + bare reactive | HarnessHarmDetector |

The healing middleware alone eliminates the dominant failure mode for cogito:8b. Combined with the sandbox and stall detector, the expected harness lift for local models moves from **negative** (cogito rw-2/rw-8) to **positive** — which is the only result consistent with the vision's Pillar 2 claim.

---

## Package Structure

```
packages/tools/src/
  healing/
    index.ts
    tool-call-healer.ts          ← HealingPipeline, interfaces
    healers/
      tool-name-healer.ts
      param-name-healer.ts
      param-inference-healer.ts
  sandbox/
    index.ts
    file-sandbox.ts

packages/runtime/src/
  profiles/
    index.ts
    model-tier-profile.ts        ← ModelTierProfile interface
    model-profile-resolver.ts    ← resolver
    builtin-profiles.ts          ← cogito, qwen3, llama, frontier profiles

packages/reactive-intelligence/src/
  controller/handlers/
    stall-detector.ts            ← createStallDetector(profile)
    harness-harm-detector.ts     ← createHarnessHarmDetector(profile)

packages/reasoning/src/strategies/kernel/
  phases/
    act.ts                       ← modified: HealingPipeline before dispatch
    context-builder.ts           ← modified: SchemaSimplifier + tool examples
  kernel-state.ts                ← KernelContext extended: modelProfile, healingPipeline
```

---

## Implementation Priority

| Priority | Component | Complexity | Token ROI |
|---|---|---|---|
| 1 | ParamNameHealer + ToolNameHealer | Low | Eliminates 100% failure runs |
| 2 | FileSandbox | Low | Fixes path hallucination class |
| 3 | ModelTierProfile + Resolver | Medium | Infrastructure for everything else |
| 4 | SchemaSimplifier + tool examples | Low | Reduces confusion at source |
| 5 | StallDetector RI handler | Medium | Stops entropy flatline waste |
| 6 | HarnessHarmDetector | High | Prevents harness harm at runtime |

Items 1-2 can ship independently without the profile infrastructure — hardcode cogito and qwen3 behavior directly for a fast first result, then generalize via profiles.

---

## Open Design Questions

1. **Healing telemetry**: Should `ToolCallHealed` events appear in the metrics dashboard? Suggest yes — healing frequency per model is a key signal for profile quality and benchmark analysis.

2. **Programmatic tool calling**: The vision roadmap describes LLM-generated code blocks instead of JSON FC. This is a `toolCallFormat: "programmatic"` profile option and addresses the schema hallucination problem at the source rather than the healing layer. Worth designing as Phase 2 of this system.

3. **Profile community contributions**: As the framework gains users on diverse local models, the `paramAliases` and `toolNameAliases` tables will grow. Consider a community registry pattern (similar to ESLint config packages) where profiles can be published and composed.

4. **Benchmark-driven profile discovery**: The benchmark suite can automatically generate profile suggestions. If a model produces >50% ToolValidationErrors with parameter name X, suggest adding X to that tool's alias map. Close the loop between benchmarking and profile improvement.

---

_Status: DESIGN COMPLETE — Ready for implementation planning via `superpowers:writing-plans`_  
_Evidence: Session log `/tmp/.../biymlmunj.output`, monitor events April 21 2026_
