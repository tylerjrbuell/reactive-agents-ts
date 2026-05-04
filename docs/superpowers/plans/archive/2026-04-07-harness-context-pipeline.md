# Harness Context Pipeline Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ICS context-replacement system with a lean, composable pipeline that preserves the native FC conversation thread, compacts intelligently, and delivers highest-signal context to every model tier.

**Architecture:** The native FC conversation thread (`state.messages`) is the single source of truth for what the model sees. ICS is refactored from a context-replacement system to a steering-nudge injector. Tool schemas in the system prompt are tier-compressed (local gets compact one-liners; frontier gets full parameter docs). Microcompact strips old tool result content in-place without breaking conversation structure.

**Tech Stack:** Effect-TS, bun:test, `KernelState` immutable state, `transitionState()`, `KernelMessage` types. All files in `packages/reasoning/src/`.

---

## File Structure

**Modified files:**
- `packages/reasoning/src/strategies/kernel/kernel-state.ts` — remove `synthesizedContext`, add `steeringNudge?: string`, `frozenToolResultIds: ReadonlySet<string>`, `consecutiveLowDeltaCount?: number`
- `packages/reasoning/src/strategies/kernel/phases/think.ts` — remove `hasICS` branch; always use `buildStaticContext`; remove dead `buildDynamicContext` call; consume `steeringNudge` from state
- `packages/reasoning/src/strategies/kernel/phases/context-builder.ts` — remove `synthesizedContext` path; always use native FC thread; append `steeringNudge` as user message
- `packages/reasoning/src/strategies/kernel/phases/act.ts` — remove all ICS-related state transitions
- `packages/reasoning/src/strategies/kernel/utils/ics-coordinator.ts` — return `steeringNudge: string` instead of `SynthesizedContext`; remove all phase-template dispatching
- `packages/reasoning/src/context/message-window.ts` — add microcompact layer; add frozen set tracking; add compaction circuit breaker; add token-delta guard
- `packages/reasoning/src/context/context-engine.ts` — add `buildTierAdaptiveStaticContext()` with tool schema compression per tier; add tool relevance collapsing
- `packages/reasoning/src/strategies/kernel/kernel-runner.ts` — wire steeringNudge from ics-coordinator into state
- `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts` — add `formatToolSchemaMicro()` (name + description one-liner only, ~8 tokens)

**Deleted files (Phase 4 dead code removal):**
- `packages/reasoning/src/context/task-phase.ts` — `classifyTaskPhase` entirely removed
- `packages/reasoning/src/context/synthesis-templates.ts` — all 5 phase template builders removed

**New test files:**
- `packages/reasoning/tests/context/message-window.test.ts` — microcompact + frozen set + circuit breaker tests
- `packages/reasoning/tests/context/tier-tool-compression.test.ts` — tool schema compression per tier

---

## Task 1: Add `steeringNudge` and `frozenToolResultIds` to KernelState

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts:31-105`

**What:** Replace `synthesizedContext?: SynthesizedContext | null` with `steeringNudge?: string` and add `frozenToolResultIds: ReadonlySet<string>`. Remove the `SynthesisTypes` import. Add `consecutiveLowDeltaCount?: number` for the token-delta guard.

- [ ] **Step 1: Write a failing test** confirming new fields exist on a fresh kernel state

```typescript
// packages/reasoning/tests/strategies/kernel/kernel-state.test.ts (new describe block)
import { describe, it, expect } from "bun:test"
import { makeInitialKernelState } from "../../../src/strategies/kernel/kernel-state.js"

describe("KernelState new fields", () => {
  it("has steeringNudge undefined by default", () => {
    const s = makeInitialKernelState({ taskId: "t1", strategy: "reactive", kernelType: "react" })
    expect(s.steeringNudge).toBeUndefined()
  })
  it("has frozenToolResultIds as empty set by default", () => {
    const s = makeInitialKernelState({ taskId: "t1", strategy: "reactive", kernelType: "react" })
    expect(s.frozenToolResultIds.size).toBe(0)
  })
  it("does not have synthesizedContext field", () => {
    const s = makeInitialKernelState({ taskId: "t1", strategy: "reactive", kernelType: "react" })
    expect("synthesizedContext" in s).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
bun test packages/reasoning/tests/strategies/kernel/kernel-state.test.ts -t "new fields"
```
Expected: FAIL — `synthesizedContext` still exists, new fields absent.

- [ ] **Step 3: Update `kernel-state.ts`**

In `KernelState` interface, replace:
```typescript
readonly synthesizedContext?: import("../../context/synthesis-types.js").SynthesizedContext | null;
```
With:
```typescript
/**
 * Steering nudge injected by ICS coordinator for the next think call.
 * Appended as a user message to the FC thread. Cleared after consumption.
 */
readonly steeringNudge?: string;

/**
 * Tool result message IDs whose content has been microcompacted.
 * Content is never re-stripped once frozen — preserves API cache prefix.
 */
readonly frozenToolResultIds: ReadonlySet<string>;

/**
 * Count of consecutive iterations with token-delta < 500.
 * Used by the token-delta diminishing-returns guard.
 */
readonly consecutiveLowDeltaCount?: number;
```

In `makeInitialKernelState()` (or the function that creates initial state), set:
```typescript
steeringNudge: undefined,
frozenToolResultIds: new Set<string>(),
consecutiveLowDeltaCount: 0,
```

Remove the `import` of `SynthesisTypes` if it becomes unused.

- [ ] **Step 4: Run test to verify it passes**

```bash
bun test packages/reasoning/tests/strategies/kernel/kernel-state.test.ts -t "new fields"
```
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/kernel-state.ts packages/reasoning/tests/strategies/kernel/kernel-state.test.ts
git commit -m "feat(kernel): add steeringNudge, frozenToolResultIds, remove synthesizedContext from KernelState"
```

---

## Task 2: Add `formatToolSchemaMicro()` to tool-utils

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts`

**What:** Add a micro-format function that renders each tool as `name: description` (~8 tokens). Used for collapsed/irrelevant tools in tier-compressed system prompts.

- [ ] **Step 1: Write failing test**

```typescript
// packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts (new describe block)
import { describe, it, expect } from "bun:test"
import { formatToolSchemaMicro } from "../../../../src/strategies/kernel/utils/tool-utils.js"

const schema = {
  name: "web-search",
  description: "Search the web for information",
  parameters: [{ name: "query", type: "string", description: "search query", required: true }],
}

describe("formatToolSchemaMicro", () => {
  it("returns name: description with no parameters", () => {
    const result = formatToolSchemaMicro(schema)
    expect(result).toBe("web-search: Search the web for information")
  })
  it("keeps result under 100 chars for typical tools", () => {
    const result = formatToolSchemaMicro(schema)
    expect(result.length).toBeLessThan(100)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts -t "formatToolSchemaMicro"
```
Expected: FAIL — function not exported.

- [ ] **Step 3: Add function to `tool-utils.ts`**

After the existing `formatToolSchemaCompact` function:
```typescript
/**
 * Micro tool format — name and description only, no parameters. ~8 tokens per tool.
 * Used for collapsed/inactive tools in tier-compressed system prompts.
 */
export function formatToolSchemaMicro(tool: ToolSchema): string {
  const desc = tool.description ?? ""
  const truncated = desc.length > 80 ? `${desc.slice(0, 77)}...` : desc
  return `${tool.name}: ${truncated}`
}
```

- [ ] **Step 4: Run to verify pass**

```bash
bun test packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts -t "formatToolSchemaMicro"
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/utils/tool-utils.ts packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts
git commit -m "feat(tools): add formatToolSchemaMicro for lean tier-compressed tool listings"
```

---

## Task 3: Tier-adaptive tool reference in `buildStaticContext`

**Files:**
- Modify: `packages/reasoning/src/context/context-engine.ts:248-268`

**What:** Make `buildStaticContext` tier-adaptive. For `local` tier: required tools get compact format, all others get micro format. For `mid`: compact format for all. For `large`/`frontier`: full format (current behavior). This can halve the system prompt token cost for local models.

- [ ] **Step 1: Write failing test**

```typescript
// packages/reasoning/tests/context/tier-tool-compression.test.ts
import { describe, it, expect } from "bun:test"
import { buildStaticContext } from "../../src/context/context-engine.js"
import type { ContextProfile } from "../../src/context/context-profile.js"

const LOCAL_PROFILE: ContextProfile = {
  tier: "local",
  maxTokens: 4000,
  toolSchemaDetail: "compact",
  compactAfterSteps: 4,
  fullDetailSteps: 2,
  temperature: 0.7,
  toolResultMaxChars: 600,
  messageBudgetFraction: 0.7,
}

const MID_PROFILE: ContextProfile = { ...LOCAL_PROFILE, tier: "mid", maxTokens: 8000, toolSchemaDetail: "compact", messageBudgetFraction: 0.8 }
const FRONTIER_PROFILE: ContextProfile = { ...LOCAL_PROFILE, tier: "frontier", maxTokens: 32000, toolSchemaDetail: "full", messageBudgetFraction: 0.9 }

const tools = [
  { name: "web-search", description: "Search the web", parameters: [{ name: "query", type: "string", description: "search query", required: true }] },
  { name: "read-file", description: "Read file contents", parameters: [{ name: "path", type: "string", description: "file path", required: true }] },
  { name: "write-file", description: "Write file contents", parameters: [{ name: "path", type: "string", description: "file path", required: true }, { name: "content", type: "string", description: "content", required: true }] },
]

describe("buildStaticContext tier compression", () => {
  it("local tier: non-required tools get micro format (name: description only)", () => {
    const ctx = buildStaticContext({
      task: "Search for X",
      profile: LOCAL_PROFILE,
      availableToolSchemas: tools,
      requiredTools: ["web-search"],
    })
    // write-file should appear as micro format (no parameters listed)
    expect(ctx).toContain("write-file: Write file contents")
    // write-file should NOT show parameter details for non-required tools on local
    expect(ctx).not.toMatch(/write-file\([^)]+\) —/)
  })
  it("frontier tier: all tools get full format", () => {
    const ctx = buildStaticContext({
      task: "Search for X",
      profile: FRONTIER_PROFILE,
      availableToolSchemas: tools,
      requiredTools: ["web-search"],
    })
    // Full format shows tool with parameters
    expect(ctx).toMatch(/web-search\(/)
  })
  it("local tier: required tools always get compact format (not micro)", () => {
    const ctx = buildStaticContext({
      task: "Search for X",
      profile: LOCAL_PROFILE,
      availableToolSchemas: tools,
      requiredTools: ["web-search"],
    })
    // web-search is required so it gets at minimum compact format
    expect(ctx).toMatch(/web-search\(/)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/context/tier-tool-compression.test.ts
```
Expected: FAIL — local tier currently uses same format as all others.

- [ ] **Step 3: Update `buildToolReference` in `context-engine.ts`**

The function at line ~340 currently does:
```typescript
if (detail === "names-only") { ... }
if (detail === "names-and-types" || availableToolSchemas.length > 20) { ... compact format ... }
formatToolSchemas(availableToolSchemas)  // full format
```

Add tier-adaptive logic before the existing checks. Import `formatToolSchemaMicro` at the top of the file:
```typescript
import { formatToolSchemas, formatToolSchemaCompact, formatToolSchemaMicro } from "../strategies/kernel/utils/tool-utils.js"
```

Replace `buildToolReference` with tier-adaptive version:
```typescript
function buildToolReference(
  task: string,
  availableToolSchemas: readonly ToolSchema[] | undefined,
  requiredTools: readonly string[] | undefined,
  detail?: string,
  tier?: string,
): string {
  if (!availableToolSchemas || availableToolSchemas.length === 0) return ""

  // Tier-adaptive compression
  if (tier === "local") {
    const required = new Set(requiredTools ?? [])
    const requiredSchemas = availableToolSchemas.filter((t) => required.has(t.name))
    const otherSchemas = availableToolSchemas.filter((t) => !required.has(t.name))
    const lines: string[] = []
    if (requiredSchemas.length > 0) {
      lines.push("Required tools (call these):")
      lines.push(...requiredSchemas.map(formatToolSchemaCompact))
    }
    if (otherSchemas.length > 0) {
      lines.push("Available tools:")
      lines.push(...otherSchemas.map(formatToolSchemaMicro))
    }
    return lines.join("\n")
  }

  if (tier === "mid") {
    const toolLines = availableToolSchemas.map(formatToolSchemaCompact).join("\n")
    return `Available Tools:\n${toolLines}`
  }

  // large / frontier / unspecified — existing behavior
  if (detail === "names-only") {
    const names = availableToolSchemas.map((t) => t.name).join(", ")
    return `Available Tools: ${names}`
  }
  if (detail === "names-and-types" || availableToolSchemas.length > 20) {
    const toolLines = availableToolSchemas.map(formatToolSchemaCompact).join("\n")
    return `Available Tools:\n${toolLines}`
  }
  const toolLines = formatToolSchemas(availableToolSchemas)
  return `Available Tools:\n${toolLines}`
}
```

Update `buildStaticContext` to pass `profile.tier` to `buildToolReference`:
```typescript
sections.push(
  buildToolReference(task, availableToolSchemas, requiredTools, profile.toolSchemaDetail, profile.tier),
)
```

- [ ] **Step 4: Run to verify pass**

```bash
bun test packages/reasoning/tests/context/tier-tool-compression.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Run full reasoning tests to catch regressions**

```bash
bun test packages/reasoning/ --timeout 30000 2>&1 | tail -10
```
Expected: same pass count as baseline (221 pass, 0 fail).

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/context/context-engine.ts packages/reasoning/tests/context/tier-tool-compression.test.ts
git commit -m "feat(context): tier-adaptive tool schema compression — local gets micro/compact, frontier gets full"
```

---

## Task 4: Refactor ICS coordinator to produce `steeringNudge` only

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/utils/ics-coordinator.ts`
- Modify: `packages/reasoning/src/strategies/kernel/kernel-runner.ts` (update call site)

**What:** `ics-coordinator.ts` currently calls `ContextSynthesizerService.synthesize()` which returns a `SynthesizedContext` containing replacement `messages[]`. Refactor it to instead return a `steeringNudge: string | undefined` — a single user message to append. The nudge is tier-adaptive: always generated for local/mid when tools are missing; only near max-iterations for large/frontier.

The nudge content comes from the existing `buildSteeringNudge()` logic in `synthesis-templates.ts` (which is otherwise being removed). Inline the logic directly — it's ~25 lines.

- [ ] **Step 1: Write failing test**

```typescript
// packages/reasoning/tests/strategies/kernel/utils/ics-coordinator.test.ts
import { describe, it, expect } from "bun:test"
import { Effect } from "effect"
import { coordinateICS } from "../../../../src/strategies/kernel/utils/ics-coordinator.js"
import { makeInitialKernelState } from "../../../../src/strategies/kernel/kernel-state.js"

describe("coordinateICS steeringNudge", () => {
  it("returns steeringNudge string when tools are missing (local tier)", async () => {
    const state = makeInitialKernelState({ taskId: "t1", strategy: "reactive", kernelType: "react" })
    const result = await Effect.runPromise(
      coordinateICS(state, {
        task: "Lookup Effect-Ts docs",
        requiredTools: ["resolve-library-id", "get-library-docs"],
        toolsUsed: new Set(),
        availableTools: [
          { name: "resolve-library-id", description: "Resolve library", parameters: [] },
          { name: "get-library-docs", description: "Get docs", parameters: [] },
        ],
        tier: "local",
        iteration: 1,
        maxIterations: 10,
        lastErrors: [],
      })
    )
    expect(typeof result.steeringNudge).toBe("string")
    expect(result.steeringNudge).toContain("resolve-library-id")
  })
  it("returns undefined steeringNudge when all tools used (synthesize phase)", async () => {
    const state = makeInitialKernelState({ taskId: "t1", strategy: "reactive", kernelType: "react" })
    const result = await Effect.runPromise(
      coordinateICS(state, {
        task: "Lookup Effect-Ts docs",
        requiredTools: ["resolve-library-id"],
        toolsUsed: new Set(["resolve-library-id"]),
        availableTools: [],
        tier: "frontier",
        iteration: 2,
        maxIterations: 10,
        lastErrors: [],
      })
    )
    // frontier tier with all tools used + not near max iterations → no nudge needed
    expect(result.steeringNudge).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/strategies/kernel/utils/ics-coordinator.test.ts
```
Expected: FAIL — `coordinateICS` returns `SynthesizedContext`, not `{ steeringNudge }`.

- [ ] **Step 3: Rewrite `ics-coordinator.ts`**

```typescript
/**
 * ICS Coordinator — produces a steering nudge for the next think call.
 *
 * Replaces the old SynthesizedContext replacement system. The native FC
 * conversation thread is never replaced; instead, a steering nudge is
 * appended as a user message when the model needs directional guidance.
 *
 * Nudge frequency is tier-adaptive:
 * - local/mid: always nudge when required tools are missing
 * - large/frontier: only nudge in last 30% of iterations
 */
import { Effect } from "effect"
import type { KernelState } from "../kernel-state.js"

export interface ICSInput {
  readonly task: string
  readonly requiredTools: readonly string[]
  readonly toolsUsed: ReadonlySet<string>
  readonly availableTools: readonly { name: string; description: string; parameters: unknown[] }[]
  readonly tier: string
  readonly iteration: number
  readonly maxIterations: number
  readonly lastErrors: readonly string[]
}

export interface ICSOutput {
  readonly steeringNudge: string | undefined
}

/**
 * Build a steering nudge message for the given state.
 * Returns undefined when no nudge is needed (model is doing fine).
 */
export function coordinateICS(
  _state: KernelState,
  input: ICSInput,
): Effect.Effect<ICSOutput, never, never> {
  return Effect.sync(() => {
    const { requiredTools, toolsUsed, tier, iteration, maxIterations, lastErrors } = input
    const missingTools = requiredTools.filter((t) => !toolsUsed.has(t))
    const urgencyThreshold = maxIterations * 0.7  // last 30%

    // Tier-adaptive nudge frequency
    const shouldNudge =
      tier === "local" || tier === "mid"
        ? missingTools.length > 0  // always nudge local/mid when tools pending
        : iteration >= urgencyThreshold && missingTools.length > 0  // frontier: only near budget

    if (!shouldNudge) return { steeringNudge: undefined }

    const lines: string[] = []
    const completedRequired = requiredTools.filter((t) => toolsUsed.has(t))

    if (completedRequired.length > 0) {
      lines.push(`Completed: ${completedRequired.map((t) => `${t} ✓`).join(", ")}`)
    }

    for (const err of lastErrors) {
      lines.push(`Error: ${err} — skip this tool, use data from other calls`)
    }

    const iterationsLeft = maxIterations - iteration
    const urgency = iterationsLeft <= 2 ? ` (${iterationsLeft} iterations remaining)` : ""

    if (missingTools.length > 0) {
      lines.push(`Now call ${missingTools[0]} with the appropriate arguments.${urgency}`)
    }

    return { steeringNudge: lines.join("\n") }
  })
}
```

- [ ] **Step 4: Update `kernel-runner.ts` call site**

Find the `coordinateICS` call in `kernel-runner.ts` and update it to store `steeringNudge` in state:

```typescript
// Before (old pattern storing SynthesizedContext):
// const synthesized = yield* coordinateICS(state, ...)
// state = transitionState(state, { synthesizedContext: synthesized })

// After:
const icsResult = yield* coordinateICS(state, {
  task: input.task,
  requiredTools: input.requiredTools ?? [],
  toolsUsed: state.toolsUsed,
  availableTools: input.availableToolSchemas ?? [],
  tier: profile.tier ?? "mid",
  iteration: state.iteration,
  maxIterations: (state.meta.maxIterations as number) ?? 10,
  lastErrors: getLastErrors(state),  // extract from recent failed observations
})
if (icsResult.steeringNudge) {
  state = transitionState(state, { steeringNudge: icsResult.steeringNudge })
}
```

Add a helper `getLastErrors(state)` that reads the last 2 failed observation step metadata:
```typescript
function getLastErrors(state: KernelState): readonly string[] {
  return state.steps
    .filter((s) => s.type === "observation" && s.metadata?.observationResult?.success === false)
    .slice(-2)
    .map((s) => s.metadata?.observationResult?.error as string ?? "unknown error")
}
```

- [ ] **Step 5: Run tests to verify pass**

```bash
bun test packages/reasoning/tests/strategies/kernel/utils/ics-coordinator.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/utils/ics-coordinator.ts packages/reasoning/src/strategies/kernel/kernel-runner.ts packages/reasoning/tests/strategies/kernel/utils/ics-coordinator.test.ts
git commit -m "refactor(ics): replace SynthesizedContext replacement with tier-adaptive steeringNudge"
```

---

## Task 5: Remove `hasICS` branch from `think.ts`; consume `steeringNudge`

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts:127-141` (hasICS branch)
- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts:164-180` (dead buildDynamicContext call)

**What:** Remove the `hasICS` branch (lines 127-141) so that `buildStaticContext` is ALWAYS used for the system prompt. Remove the dead `buildDynamicContext` / `thoughtPrompt` construction pipeline (lines 164-180). These 30 lines of code built a `thoughtPrompt` that was passed to `buildConversationMessages` but only used as a fallback when `compactedMessages.length === 0` (never true in practice).

- [ ] **Step 1: Write failing test**

```typescript
// packages/reasoning/tests/strategies/kernel/phases/think.test.ts (add describe block)
// Tests that the system prompt always contains full tool reference regardless of ICS state
import { describe, it, expect } from "bun:test"
// (This is a structural test — verify by reading the source code pattern)
// The unit test mechanism: call handleThinking with a state that has steeringNudge set
// and verify the captured systemPrompt contains tool schemas (not just buildRules output)
```

Since `handleThinking` is hard to unit test in isolation (requires LLMService), write an integration-style test that confirms the think phase sends tool schemas in the system prompt when a steeringNudge is set. Alternatively, verify by inspecting the source after the change:

```typescript
// packages/reasoning/tests/strategies/kernel/phases/think-system-prompt.test.ts
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"

describe("think.ts structural: no hasICS branch", () => {
  it("source does not contain hasICS branch", () => {
    const src = readFileSync("packages/reasoning/src/strategies/kernel/phases/think.ts", "utf8")
    expect(src).not.toContain("const hasICS")
    expect(src).not.toContain("if (hasICS)")
  })
  it("source always calls buildStaticContext", () => {
    const src = readFileSync("packages/reasoning/src/strategies/kernel/phases/think.ts", "utf8")
    expect(src).toContain("buildStaticContext")
  })
  it("source does not call buildDynamicContext", () => {
    const src = readFileSync("packages/reasoning/src/strategies/kernel/phases/think.ts", "utf8")
    expect(src).not.toContain("buildDynamicContext")
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/think-system-prompt.test.ts
```
Expected: FAIL — `hasICS` still present.

- [ ] **Step 3: Remove `hasICS` branch in `think.ts`**

Replace lines 127-141:
```typescript
// REMOVE this entire block:
const hasICS = state.synthesizedContext != null;
let systemPromptText: string;
if (hasICS) {
  const rules = buildRules(augmentedToolSchemas, input.requiredTools, profile.tier);
  systemPromptText = `${patchedBase}\n\n${rules}${toolGuidancePatch ? `\n${toolGuidancePatch}` : ""}`;
} else {
  const staticContext = buildStaticContext({ ... });
  systemPromptText = `${patchedBase}\n\n${staticContext}${toolGuidancePatch ? `\n${toolGuidancePatch}` : ""}`;
}
```

With:
```typescript
// Always use full static context — stable, never replaced by ICS
const staticContext = buildStaticContext({
  task: input.task,
  profile,
  availableToolSchemas: augmentedToolSchemas,
  requiredTools: input.requiredTools,
  environmentContext: input.environmentContext,
});
const systemPromptText = `${patchedBase}\n\n${staticContext}${toolGuidancePatch ? `\n${toolGuidancePatch}` : ""}`;
```

- [ ] **Step 4: Remove dead `buildDynamicContext` pipeline (lines 164-180)**

Replace:
```typescript
let thoughtPrompt = buildDynamicContext({
  task: input.task,
  steps: state.steps,
  availableToolSchemas: augmentedToolSchemas,
  requiredTools: input.requiredTools,
  iteration: state.iteration,
  maxIterations: maxIter,
  profile,
  memories: (state.meta.memories as MemoryItem[] | undefined),
  priorContext: input.priorContext,
});

if (autoForwardSection) {
  thoughtPrompt += `\n\n${autoForwardSection}`;
}

thoughtPrompt += "\n\nThink step-by-step. Use available tools when needed, or provide your final answer directly.";
```

With:
```typescript
// autoForwardSection is still built above; passed directly to buildConversationMessages
// steeringNudge from state is consumed by buildConversationMessages as final user message
```

Remove the `import` of `buildDynamicContext` and `MemoryItem` from `context-engine.ts` if unused after this change.

- [ ] **Step 5: Update `buildConversationMessages` call signature**

The call at line ~222 currently passes `thoughtPrompt` and `autoForwardSection`. After removing `thoughtPrompt`, update to pass only what's needed:

```typescript
const { messages: conversationMessages, updatedState: stateAfterMessages } =
  buildConversationMessages(state, input, profile, adapter, autoForwardSection);
```

- [ ] **Step 6: Run structural test to verify pass**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/think-system-prompt.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 7: Run full kernel test suite**

```bash
bun test packages/reasoning/ --timeout 30000 2>&1 | tail -10
```
Expected: same pass count as baseline.

- [ ] **Step 8: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/phases/think.ts packages/reasoning/tests/strategies/kernel/phases/think-system-prompt.test.ts
git commit -m "fix(think): always use buildStaticContext; remove hasICS branch and dead buildDynamicContext pipeline"
```

---

## Task 6: Update `context-builder.ts` — remove `synthesizedContext` path; consume `steeringNudge`

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/phases/context-builder.ts`

**What:** `buildConversationMessages` currently has an `if (state.synthesizedContext != null)` branch that REPLACES the native FC thread with synthesized messages. Remove this branch. Add: when `state.steeringNudge` is set, append it as a user message to the windowed FC thread and clear it from state.

- [ ] **Step 1: Write failing test**

```typescript
// packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts (new describe block)
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"

describe("context-builder.ts structural: no synthesizedContext path", () => {
  it("source does not reference synthesizedContext", () => {
    const src = readFileSync("packages/reasoning/src/strategies/kernel/phases/context-builder.ts", "utf8")
    expect(src).not.toContain("synthesizedContext")
  })
  it("source consumes steeringNudge", () => {
    const src = readFileSync("packages/reasoning/src/strategies/kernel/phases/context-builder.ts", "utf8")
    expect(src).toContain("steeringNudge")
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts -t "structural"
```
Expected: FAIL.

- [ ] **Step 3: Update `buildConversationMessages` in `context-builder.ts`**

Find the block that checks `state.synthesizedContext != null` and returns synthesized messages. Remove it entirely.

Instead, after computing `compactedMessages` via `applyMessageWindow`, append the steering nudge if present:

```typescript
// Consume steeringNudge: append as final user message, then clear from state
let finalMessages = [...compactedMessages]
let updatedState = state
if (state.steeringNudge) {
  finalMessages = [...finalMessages, { role: "user" as const, content: state.steeringNudge }]
  updatedState = transitionState(state, { steeringNudge: undefined })
}

return { messages: finalMessages.map(toProviderMessage), updatedState }
```

Also update the function signature to remove `thoughtPrompt` parameter (now unused):
```typescript
// Old signature:
export function buildConversationMessages(
  state: KernelState,
  input: ReActKernelInput,
  profile: ContextProfile,
  adapter: ProviderAdapter,
  thoughtPrompt: string,   // ← REMOVE
  autoForwardSection: string,
): { messages: LLMMessage[]; updatedState: KernelState }

// New signature:
export function buildConversationMessages(
  state: KernelState,
  input: ReActKernelInput,
  profile: ContextProfile,
  adapter: ProviderAdapter,
  autoForwardSection: string,
): { messages: LLMMessage[]; updatedState: KernelState }
```

Inside the function, remove any usage of `thoughtPrompt` as a fallback when `compactedMessages.length === 0`. If the FC thread is empty, the model will only see the system prompt — that's correct for the first iteration (before any tool calls).

- [ ] **Step 4: Run test to verify pass**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts -t "structural"
```
Expected: PASS.

- [ ] **Step 5: Run full kernel tests**

```bash
bun test packages/reasoning/ --timeout 30000 2>&1 | tail -10
```
Expected: baseline pass count.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/phases/context-builder.ts packages/reasoning/tests/strategies/kernel/phases/context-builder.test.ts
git commit -m "fix(context-builder): remove synthesizedContext replacement; consume steeringNudge from state"
```

---

## Task 7: Microcompact — upgrade `applyMessageWindow` with in-place content stripping

**Files:**
- Modify: `packages/reasoning/src/context/message-window.ts`
- New test: `packages/reasoning/tests/context/message-window.test.ts`

**What:** Add a microcompact pass that runs BEFORE the sliding window. For each `tool_result` message older than the N most recent full turns, strip the content to a truncation stub `[N chars — use recall("<toolCallId>") to retrieve]` and mark the message ID in `frozenToolResultIds`. Messages in the frozen set are NEVER re-stripped (preserves the API cache prefix from the first request that included full content). The circuit breaker: if 3+ consecutive compaction passes each produce less than 500 token savings, stop attempting.

- [ ] **Step 1: Write failing tests**

```typescript
// packages/reasoning/tests/context/message-window.test.ts
import { describe, it, expect } from "bun:test"
import { applyMessageWindowWithCompact } from "../../src/context/message-window.js"
import type { KernelMessage } from "../../src/strategies/kernel/kernel-state.js"

function makeToolResult(id: string, content: string): KernelMessage {
  return { role: "tool_result", toolCallId: id, toolName: "some-tool", content }
}
function makeAssistant(toolCallId: string): KernelMessage {
  return { role: "assistant", content: "calling tool", toolCalls: [{ id: toolCallId, name: "some-tool", arguments: {} }] }
}

const BIG_CONTENT = "x".repeat(2000)

describe("microcompact", () => {
  it("strips old tool result content to stub", () => {
    const messages: KernelMessage[] = [
      { role: "user", content: "task" },
      makeAssistant("tc1"),
      makeToolResult("tc1", BIG_CONTENT),
      makeAssistant("tc2"),
      makeToolResult("tc2", BIG_CONTENT),
      makeAssistant("tc3"),
      makeToolResult("tc3", "small result"),
    ]
    const { messages: compacted } = applyMessageWindowWithCompact(messages, {
      tier: "local",
      maxTokens: 4000,
      frozenToolResultIds: new Set(),
      keepFullTurns: 1,
    })
    const tc1Result = compacted.find((m) => m.role === "tool_result" && (m as any).toolCallId === "tc1")
    expect((tc1Result as any)?.content).toContain("[2000 chars")
    // Recent result should be preserved
    const tc3Result = compacted.find((m) => m.role === "tool_result" && (m as any).toolCallId === "tc3")
    expect((tc3Result as any)?.content).toBe("small result")
  })

  it("never strips frozen tool result IDs", () => {
    const messages: KernelMessage[] = [
      { role: "user", content: "task" },
      makeAssistant("tc1"),
      makeToolResult("tc1", BIG_CONTENT),
      makeAssistant("tc2"),
      makeToolResult("tc2", "recent"),
    ]
    const { messages: compacted } = applyMessageWindowWithCompact(messages, {
      tier: "local",
      maxTokens: 4000,
      frozenToolResultIds: new Set(["tc1"]),  // tc1 is frozen
      keepFullTurns: 1,
    })
    const tc1Result = compacted.find((m) => m.role === "tool_result" && (m as any).toolCallId === "tc1")
    // Frozen — content must be preserved as-is
    expect((tc1Result as any)?.content).toBe(BIG_CONTENT)
  })

  it("returns newlyFrozenIds with stripped result IDs", () => {
    const messages: KernelMessage[] = [
      { role: "user", content: "task" },
      makeAssistant("tc1"),
      makeToolResult("tc1", BIG_CONTENT),
      makeAssistant("tc2"),
      makeToolResult("tc2", "recent"),
    ]
    const { newlyFrozenIds } = applyMessageWindowWithCompact(messages, {
      tier: "local",
      maxTokens: 4000,
      frozenToolResultIds: new Set(),
      keepFullTurns: 1,
    })
    expect(newlyFrozenIds.has("tc1")).toBe(true)
    expect(newlyFrozenIds.has("tc2")).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/context/message-window.test.ts
```
Expected: FAIL — `applyMessageWindowWithCompact` not exported.

- [ ] **Step 3: Add microcompact to `message-window.ts`**

Add the new export function (keep existing `applyMessageWindow` for backwards compat, or update its call sites):

```typescript
/** Tier-adaptive full-turn counts for microcompact. */
const KEEP_FULL_TURNS: Record<string, number> = {
  local: 2,
  mid: 3,
  large: 5,
  frontier: 8,
}

export interface CompactInput {
  readonly tier: string
  readonly maxTokens: number
  readonly frozenToolResultIds: ReadonlySet<string>
  readonly keepFullTurns?: number
}

export interface CompactResult {
  readonly messages: readonly KernelMessage[]
  readonly newlyFrozenIds: ReadonlySet<string>
}

/**
 * Microcompact + sliding window.
 *
 * Pass 1 — Microcompact: strip content of tool_result messages older than
 *           keepFullTurns, unless their ID is in frozenToolResultIds.
 *           Returns newlyFrozenIds for the caller to persist in state.
 *
 * Pass 2 — Sliding window: keep first user message (task) + last N full turns.
 *           Older turns get summarized into "[Prior work: called X → snippet]".
 */
export function applyMessageWindowWithCompact(
  messages: readonly KernelMessage[],
  opts: CompactInput,
): CompactResult {
  const keepFullTurns = opts.keepFullTurns ?? KEEP_FULL_TURNS[opts.tier] ?? 3

  // ── Identify turn groups (assistant+toolResults pairs) ──────────────────
  type TurnGroup = { assistantIdx: number; resultIdxs: number[] }
  const turns: TurnGroup[] = []
  let currentTurn: TurnGroup | null = null

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role === "assistant" && "toolCalls" in msg && msg.toolCalls?.length) {
      if (currentTurn) turns.push(currentTurn)
      currentTurn = { assistantIdx: i, resultIdxs: [] }
    } else if (msg.role === "tool_result" && currentTurn) {
      currentTurn.resultIdxs.push(i)
    }
  }
  if (currentTurn) turns.push(currentTurn)

  // ── Pass 1: Microcompact old turns ──────────────────────────────────────
  const mutable = [...messages] as KernelMessage[]
  const newlyFrozenIds = new Set<string>()
  const oldTurns = turns.slice(0, Math.max(0, turns.length - keepFullTurns))

  for (const turn of oldTurns) {
    for (const idx of turn.resultIdxs) {
      const msg = mutable[idx]!
      if (msg.role !== "tool_result") continue
      const id = (msg as any).toolCallId as string
      if (opts.frozenToolResultIds.has(id)) continue  // never re-strip frozen

      const content = (msg as any).content as string
      if (content.length > 200) {
        ;(mutable[idx] as any) = {
          ...msg,
          content: `[${content.length} chars — use recall("${id}") to retrieve]`,
        }
        newlyFrozenIds.add(id)
      }
    }
  }

  // ── Pass 2: Sliding window (keep first user message + last N turns) ─────
  // If within budget, return microcompacted messages as-is.
  // Simple estimation: 1 char ≈ 0.25 tokens
  const estimatedTokens = mutable.reduce((sum, m) => {
    const c = (m as any).content ?? ""
    return sum + Math.ceil((typeof c === "string" ? c : JSON.stringify(c)).length / 4)
  }, 0)

  const budget = Math.floor(opts.maxTokens * 0.75)
  if (estimatedTokens <= budget) {
    return { messages: mutable, newlyFrozenIds }
  }

  // Over budget: keep first user message + recent N turns
  const firstUser = mutable.find((m) => m.role === "user")
  const recentTurnIdxs = new Set(
    turns
      .slice(-keepFullTurns)
      .flatMap((t) => [t.assistantIdx, ...t.resultIdxs]),
  )
  const oldSummaryParts = turns.slice(0, Math.max(0, turns.length - keepFullTurns)).map((t) => {
    const assistantMsg = mutable[t.assistantIdx]!
    const toolNames = ("toolCalls" in assistantMsg ? assistantMsg.toolCalls ?? [] : [])
      .map((tc: any) => tc.name)
      .join(", ")
    const snippet = t.resultIdxs
      .map((i) => {
        const c = (mutable[i] as any)?.content ?? ""
        return typeof c === "string" ? c.slice(0, 60) : ""
      })
      .join("; ")
    return toolNames ? `called ${toolNames} → ${snippet}` : ""
  }).filter(Boolean)

  const windowed: KernelMessage[] = []
  if (firstUser) windowed.push(firstUser)
  if (oldSummaryParts.length > 0) {
    windowed.push({ role: "user", content: `[Prior work: ${oldSummaryParts.join(" | ")}]` })
  }
  for (let i = 0; i < mutable.length; i++) {
    if (recentTurnIdxs.has(i)) windowed.push(mutable[i]!)
  }

  return { messages: windowed, newlyFrozenIds }
}
```

- [ ] **Step 4: Run tests to verify pass**

```bash
bun test packages/reasoning/tests/context/message-window.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 5: Wire `applyMessageWindowWithCompact` into `context-builder.ts`**

Replace the `applyMessageWindow(state.messages, profile)` call in `buildConversationMessages` with:

```typescript
const { messages: compactedMessages, newlyFrozenIds } = applyMessageWindowWithCompact(
  state.messages,
  {
    tier: profile.tier ?? "mid",
    maxTokens: profile.maxTokens,
    frozenToolResultIds: state.frozenToolResultIds,
  },
)
// Persist newly frozen IDs into state
if (newlyFrozenIds.size > 0) {
  state = transitionState(state, {
    frozenToolResultIds: new Set([...state.frozenToolResultIds, ...newlyFrozenIds]),
  })
}
```

- [ ] **Step 6: Run full reasoning tests**

```bash
bun test packages/reasoning/ --timeout 30000 2>&1 | tail -10
```
Expected: baseline pass count.

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/context/message-window.ts packages/reasoning/src/strategies/kernel/phases/context-builder.ts packages/reasoning/tests/context/message-window.test.ts
git commit -m "feat(compaction): microcompact pass — strip old tool result content; track frozenToolResultIds"
```

---

## Task 8: Token-delta diminishing-returns guard in `kernel-runner.ts`

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/kernel-runner.ts`

**What:** After each successful (non-max_tokens) think call, compute token delta vs. previous iteration. If 2 consecutive deltas are < 500 tokens AND iteration >= 3 (enough work done), trigger early exit with the current output. Persisted in `consecutiveLowDeltaCount` on KernelState.

- [ ] **Step 1: Write failing test**

```typescript
// packages/reasoning/tests/strategies/kernel/utils/token-delta-guard.test.ts
import { describe, it, expect } from "bun:test"
import { shouldExitOnLowDelta } from "../../../../src/strategies/kernel/kernel-runner.js"

describe("token-delta diminishing-returns guard", () => {
  it("returns false when iteration < 3", () => {
    expect(shouldExitOnLowDelta({ iteration: 2, tokenDelta: 100, consecutiveLowDeltaCount: 2 })).toBe(false)
  })
  it("returns false when delta >= 500", () => {
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 600, consecutiveLowDeltaCount: 2 })).toBe(false)
  })
  it("returns false on first low delta (count must be >= 2)", () => {
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 100, consecutiveLowDeltaCount: 1 })).toBe(false)
  })
  it("returns true on 2nd consecutive low delta at iteration >= 3", () => {
    expect(shouldExitOnLowDelta({ iteration: 4, tokenDelta: 100, consecutiveLowDeltaCount: 2 })).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/strategies/kernel/utils/token-delta-guard.test.ts
```
Expected: FAIL — `shouldExitOnLowDelta` not exported.

- [ ] **Step 3: Add `shouldExitOnLowDelta` export to `kernel-runner.ts`**

```typescript
/** Guard: exit when model stops making progress (2 consecutive low-delta iterations). */
export function shouldExitOnLowDelta(opts: {
  iteration: number
  tokenDelta: number
  consecutiveLowDeltaCount: number
}): boolean {
  const { iteration, tokenDelta, consecutiveLowDeltaCount } = opts
  return iteration >= 3 && tokenDelta < 500 && consecutiveLowDeltaCount >= 2
}
```

Wire it into the post-think section of the kernel runner loop:
```typescript
const prevTokens = state.tokens
// ... think phase runs ...
const tokenDelta = state.tokens - prevTokens
const lowDelta = tokenDelta < 500
const newConsecutiveLowDelta = lowDelta ? (state.consecutiveLowDeltaCount ?? 0) + 1 : 0
state = transitionState(state, { consecutiveLowDeltaCount: newConsecutiveLowDelta })

if (shouldExitOnLowDelta({ iteration: state.iteration, tokenDelta, consecutiveLowDeltaCount: newConsecutiveLowDelta })) {
  yield* hooks.onLog(state, `[token-delta-guard] Early exit: 2 consecutive iterations with <500 token delta`)
  return transitionState(state, {
    status: "done",
    meta: { ...state.meta, terminatedBy: "low_delta_guard" },
  })
}
```

- [ ] **Step 4: Run to verify pass**

```bash
bun test packages/reasoning/tests/strategies/kernel/utils/token-delta-guard.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/kernel-runner.ts packages/reasoning/tests/strategies/kernel/utils/token-delta-guard.test.ts
git commit -m "feat(kernel): token-delta diminishing-returns guard — early exit after 2 consecutive low-delta iterations"
```

---

## Task 9: `allowedTools` mismatch warning at bootstrap

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts` (around the `classifyToolRelevance` section, lines ~954-986)

**What:** After tool registration is complete, check whether each name in `allowedTools` matches a registered tool. Log a clear warning for any mismatches. This prevents the silent failure where `scratch.ts` specified `context7/get-library-content` (not a real tool) and the harness silently ran without it.

- [ ] **Step 1: Write failing test**

```typescript
// packages/runtime/tests/allowed-tools-mismatch.test.ts
import { describe, it, expect } from "bun:test"
import { checkAllowedToolsMismatch } from "../../src/execution-engine.js"

describe("allowedTools mismatch warning", () => {
  it("returns empty array when all allowed tools match registered", () => {
    const mismatches = checkAllowedToolsMismatch(
      ["web-search", "read-file"],
      [{ name: "web-search" }, { name: "read-file" }, { name: "write-file" }],
    )
    expect(mismatches).toEqual([])
  })
  it("returns mismatched names when allowed tools not in registry", () => {
    const mismatches = checkAllowedToolsMismatch(
      ["web-search", "get-library-content"],
      [{ name: "web-search" }, { name: "get-library-docs" }],
    )
    expect(mismatches).toEqual(["get-library-content"])
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/runtime/tests/allowed-tools-mismatch.test.ts
```
Expected: FAIL — `checkAllowedToolsMismatch` not exported.

- [ ] **Step 3: Add `checkAllowedToolsMismatch` to `execution-engine.ts`**

Add as an exported pure function:
```typescript
/** Returns allowedTools names that don't match any registered tool name. */
export function checkAllowedToolsMismatch(
  allowedTools: readonly string[],
  registeredTools: readonly { name: string }[],
): string[] {
  const registered = new Set(registeredTools.map((t) => t.name))
  return allowedTools.filter((name) => !registered.has(name))
}
```

Wire it in the bootstrap section (after tools are registered, before the first iteration):
```typescript
if (input.allowedTools && input.allowedTools.length > 0) {
  const mismatches = checkAllowedToolsMismatch(input.allowedTools, availableToolSchemas)
  if (mismatches.length > 0) {
    yield* Effect.logWarning(
      `[allowedTools] The following tools were specified but are NOT registered: ${mismatches.join(", ")}. ` +
      `Registered tools: ${availableToolSchemas.map((t) => t.name).join(", ")}`
    )
  }
}
```

- [ ] **Step 4: Run to verify pass**

```bash
bun test packages/runtime/tests/allowed-tools-mismatch.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/runtime/src/execution-engine.ts packages/runtime/tests/allowed-tools-mismatch.test.ts
git commit -m "feat(runtime): warn on allowedTools mismatch at bootstrap — prevents silent tool unavailability"
```

---

## Task 10: Remove dead code — `classifyTaskPhase`, `synthesis-templates.ts`, `synthesizedContext`

**Files:**
- Delete: `packages/reasoning/src/context/task-phase.ts`
- Delete: `packages/reasoning/src/context/synthesis-templates.ts`
- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts` — remove `synthesizedContext` import/field (already done in Task 1)
- Modify: `packages/reasoning/src/strategies/kernel/phases/act.ts` — remove any ICS transitions
- Check: `packages/reasoning/src/context/synthesis-types.ts` — delete if only used by deleted files
- Check: `packages/reasoning/src/context/context-synthesizer.ts` — `ContextSynthesizerService` is only called from `ics-coordinator.ts`; delete after ics-coordinator is rewritten (Task 4)
- Check: `packages/reasoning/src/strategies/kernel/kernel-hooks.ts:16` — remove `SynthesizedContext` import and any hook that fires with synthesized context

- [ ] **Step 1: Write failing tests**

```typescript
// packages/reasoning/tests/context/dead-code-removal.test.ts
import { describe, it, expect } from "bun:test"
import { existsSync } from "fs"

describe("dead code removal", () => {
  it("task-phase.ts has been deleted", () => {
    expect(existsSync("packages/reasoning/src/context/task-phase.ts")).toBe(false)
  })
  it("synthesis-templates.ts has been deleted", () => {
    expect(existsSync("packages/reasoning/src/context/synthesis-templates.ts")).toBe(false)
  })
  it("context-synthesizer.ts has been deleted", () => {
    expect(existsSync("packages/reasoning/src/context/context-synthesizer.ts")).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/context/dead-code-removal.test.ts
```
Expected: FAIL — files still exist.

- [ ] **Step 3: Grep for all import sites**

```bash
grep -r "task-phase\|synthesis-templates\|classifyTaskPhase\|synthesizedContext\|SynthesisTypes\|synthesis-types\|context-synthesizer\|ContextSynthesizerService" packages/reasoning/src/ --include="*.ts" -l
```

Files to update:
- `packages/reasoning/src/strategies/kernel/kernel-hooks.ts` — remove `SynthesizedContext` import (line 16) and the `onSynthesized` hook if present
- `packages/reasoning/src/index.ts` — remove re-exports of `SynthesizedContext`, `ContextSynthesizerService`, `classifyTaskPhase`
- `packages/reasoning/src/services/reasoning-service.ts` — remove `ContextSynthesizerService` layer wiring

- [ ] **Step 4: Delete the files**

```bash
rm packages/reasoning/src/context/task-phase.ts
rm packages/reasoning/src/context/synthesis-templates.ts
rm packages/reasoning/src/context/context-synthesizer.ts
```

Check if `synthesis-types.ts` is still imported anywhere after deletions:
```bash
grep -r "synthesis-types" packages/reasoning/src/ --include="*.ts"
```
If only imported by deleted files — delete it too:
```bash
rm packages/reasoning/src/context/synthesis-types.ts  # only if no remaining importers
```

- [ ] **Step 5: Run to verify pass**

```bash
bun test packages/reasoning/tests/context/dead-code-removal.test.ts
```
Expected: PASS.

- [ ] **Step 6: Run full test suite**

```bash
bun test packages/reasoning/ --timeout 30000 2>&1 | tail -10
```
Expected: baseline pass count (no regressions from removals).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(reasoning): delete dead ICS phase-template code — task-phase.ts, synthesis-templates.ts, synthesizedContext"
```

---

## Task 11: Fix `scratch.ts` tool name and run end-to-end validation

**Files:**
- Modify: `scratch.ts`

**What:** Fix the `allowedTools` bug — `context7/get-library-content` → `context7/get-library-docs`. Run `scratch.ts` to validate the full pipeline works end-to-end with the new harness on a local model + MCP stdio transport.

- [ ] **Step 1: Fix the tool name in `scratch.ts`**

In `scratch.ts` line 42, change:
```typescript
// Old:
allowedTools: [
  'context7/resolve-library-id',
  'context7/get-library-content',  // ← wrong
],
// New:
allowedTools: [
  'context7/resolve-library-id',
  'context7/get-library-docs',  // ← correct
],
```

- [ ] **Step 2: Run end-to-end validation**

```bash
bun run scratch.ts 2>&1 | tee /tmp/scratch-after.txt
```

Expected outcome:
- Bootstrap warning NO LONGER appears (tool names match)
- ICS coordinator produces steeringNudge for local/mid tier when tools pending
- Model calls `resolve-library-id` first, then `get-library-docs`
- No context-replacement loops
- Final answer contains Effect-TS summary

- [ ] **Step 3: Commit**

```bash
git add scratch.ts
git commit -m "fix(scratch): correct context7 tool name — get-library-docs (was get-library-content)"
```

---

## Task 12: Run full test suite and verify baseline

- [ ] **Step 1: Run all tests**

```bash
bun test --timeout 30000 2>&1 | tail -20
```
Expected: ≥ 221 pass (kernel suite), 0 regressions from changes.

- [ ] **Step 2: Run reasoning suite specifically**

```bash
bun test packages/reasoning/ --timeout 30000 2>&1 | tail -5
```
Expected: ≥ 221 pass, 0 fail.

- [ ] **Step 3: Run runtime suite**

```bash
bun test packages/runtime/ --timeout 30000 2>&1 | tail -5
```
Expected: baseline pass count.

- [ ] **Step 4: Final commit if any loose ends**

```bash
git status
# Stage any missed files
git commit -m "chore: final cleanup — remove unused imports post-ICS refactor"
```

---

## Task 13: Add `recall` and `find` to FC tool schemas when enabled

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts:92-97` (augmentedToolSchemas construction)

**Root cause from test analysis:** ALL four models score D (0/1) on "Tools" because `recall` is documented in the harness skill text and auto-forward messages (`use recall("${storedKey}") for full content`) but is **never added to `augmentedToolSchemas`**. Only `brief` and `pulse` are conditionally injected. `recall` and `find` are MetaToolHandlers in `act.ts` that handle FC calls — but the model can't make those calls because the schemas are absent from the FC tool list. GPT-4o-mini responded by calling `recall(...)` as JavaScript via `code-execute`; gemini got `[Tool 'recall' not found]`. Neither worked.

- [ ] **Step 1: Write failing test**

```typescript
// packages/reasoning/tests/strategies/kernel/phases/think-meta-tools.test.ts
import { describe, it, expect } from "bun:test"
import { readFileSync } from "fs"

// Structural: when metaTools.recall is enabled, recallTool schema appears in FC list
describe("think.ts meta-tool FC schema injection", () => {
  it("source injects recall schema when metaTools.recall is truthy", () => {
    const src = readFileSync("packages/reasoning/src/strategies/kernel/phases/think.ts", "utf8")
    // Must see a conditional like: input.metaTools?.recall ? [recallTool...] : []
    expect(src).toMatch(/metaTools\?\.\brecall\b/)
    expect(src).toContain("recallTool")
  })
  it("source injects find schema when metaTools.find is truthy", () => {
    const src = readFileSync("packages/reasoning/src/strategies/kernel/phases/think.ts", "utf8")
    expect(src).toMatch(/metaTools\?\.\bfind\b/)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/think-meta-tools.test.ts
```
Expected: FAIL — recall not conditionally injected.

- [ ] **Step 3: Add recall and find to `augmentedToolSchemas` in `think.ts`**

Import `recallTool` and `findTool` at the top of think.ts (they already exist in `@reactive-agents/tools`):
```typescript
import {
  finalAnswerTool,
  shouldShowFinalAnswer,
  detectCompletionGaps,
  briefTool,
  pulseTool,
  recallTool,   // ADD
  findTool,     // ADD (if exported)
  type ToolCallSpec,
  type ResolverInput,
} from "@reactive-agents/tools"
```

Update `augmentedToolSchemas` construction:
```typescript
const augmentedToolSchemas: readonly ToolSchema[] = [
  ...(input.availableToolSchemas ?? []),
  ...(finalAnswerVisible ? [{ name: finalAnswerTool.name, description: finalAnswerTool.description, parameters: finalAnswerTool.parameters }] : []),
  ...(input.metaTools?.brief ? [{ name: briefTool.name, description: briefTool.description, parameters: briefTool.parameters }] : []),
  ...(input.metaTools?.pulse ? [{ name: pulseTool.name, description: pulseTool.description, parameters: pulseTool.parameters }] : []),
  ...(input.metaTools?.recall ? [{ name: recallTool.name, description: recallTool.description, parameters: recallTool.parameters }] : []),
  // find tool: inject when metaTools.find is enabled
  ...(input.metaTools?.find ? [{ name: "find", description: "Search documents, memory, or the web automatically.", parameters: [{ name: "query", type: "string", description: "What to search for", required: true }] }] : []),
] as readonly ToolSchema[]
```

- [ ] **Step 4: Run test to verify pass**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/think-meta-tools.test.ts
```
Expected: PASS.

- [ ] **Step 5: Run full kernel tests**

```bash
bun test packages/reasoning/ --timeout 30000 2>&1 | tail -5
```
Expected: baseline pass count.

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/phases/think.ts packages/reasoning/tests/strategies/kernel/phases/think-meta-tools.test.ts
git commit -m "fix(think): inject recall and find into FC tool schemas when metaTools enabled — fixes 0/1 tools pass rate"
```

---

## Task 14: Termination oracle hard gate — force exit when `readyToAnswer=true`

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/kernel-runner.ts`
- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts` (add `readyToAnswerNudgeCount?: number`)

**Root cause from test analysis:** GPT-4o-mini looped 38 iterations on the recall test. At iteration 7, `pulse()` returned `readyToAnswer=true` with empty `blockers[]`. The kernel logs this. The model ignored it and called `pulse()` six more times. The termination oracle is advisory — there is no enforcing hard gate. When the oracle evaluates ready AND the model ignores the signal for 2+ consecutive iterations, the harness must force the exit programmatically.

**Design:** Two-stage escalation:
1. **Stage 1**: When oracle says ready → inject a mandatory user message: "You are ready to answer. Call `final-answer` now. This is required." Track `readyToAnswerNudgeCount`.
2. **Stage 2**: After 2 such nudges with no `final-answer` call → force synthesize output from `state.output ?? accumulatedContent` and terminate with `terminatedBy: "oracle_forced"`.

- [ ] **Step 1: Write failing test**

```typescript
// packages/reasoning/tests/strategies/kernel/kernel-runner-oracle-gate.test.ts
import { describe, it, expect } from "bun:test"
import { shouldForceOracleExit } from "../../../src/strategies/kernel/kernel-runner.js"

describe("oracle hard gate", () => {
  it("returns false when oracle not ready", () => {
    expect(shouldForceOracleExit({ oracleReady: false, readyToAnswerNudgeCount: 0 })).toBe(false)
  })
  it("returns false on first oracle-ready signal (stage 1: nudge first)", () => {
    expect(shouldForceOracleExit({ oracleReady: true, readyToAnswerNudgeCount: 0 })).toBe(false)
  })
  it("returns true after 2 nudges with oracle still ready", () => {
    expect(shouldForceOracleExit({ oracleReady: true, readyToAnswerNudgeCount: 2 })).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/strategies/kernel/kernel-runner-oracle-gate.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Add `readyToAnswerNudgeCount` to `KernelState`**

In `kernel-state.ts`, add to the `KernelState` interface:
```typescript
/** Count of iterations where oracle said ready but model hasn't called final-answer yet. */
readonly readyToAnswerNudgeCount?: number;
```

In `makeInitialKernelState`, set `readyToAnswerNudgeCount: 0`.

- [ ] **Step 4: Export `shouldForceOracleExit` from `kernel-runner.ts`**

```typescript
export function shouldForceOracleExit(opts: {
  oracleReady: boolean
  readyToAnswerNudgeCount: number
}): boolean {
  return opts.oracleReady && opts.readyToAnswerNudgeCount >= 2
}
```

Wire it into the post-think section of the kernel runner loop:

```typescript
// After think phase, evaluate termination oracle
const oracleResult = evaluateTermination(state, defaultEvaluators)
const oracleReady = oracleResult.shouldTerminate
const nudgeCount = state.readyToAnswerNudgeCount ?? 0

if (oracleReady) {
  if (shouldForceOracleExit({ oracleReady, readyToAnswerNudgeCount: nudgeCount })) {
    // Stage 2: force exit — model has been nudged twice and still hasn't called final-answer
    yield* hooks.onLog(state, `[oracle-gate] Forcing exit after ${nudgeCount} ignored ready signals`)
    const forcedOutput = state.output ?? accumulatedContent ?? "Task complete."
    return transitionState(state, {
      status: "done",
      output: forcedOutput,
      meta: { ...state.meta, terminatedBy: "oracle_forced" },
    })
  } else {
    // Stage 1: inject mandatory steering nudge
    state = transitionState(state, {
      readyToAnswerNudgeCount: nudgeCount + 1,
      steeringNudge: "You are ready to answer. Call `final-answer` now with your complete response. This is mandatory.",
    })
  }
} else {
  // Oracle not ready — reset nudge count
  if (nudgeCount > 0) {
    state = transitionState(state, { readyToAnswerNudgeCount: 0 })
  }
}
```

- [ ] **Step 5: Run test to verify pass**

```bash
bun test packages/reasoning/tests/strategies/kernel/kernel-runner-oracle-gate.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 6: Run full reasoning tests**

```bash
bun test packages/reasoning/ --timeout 30000 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/kernel-state.ts packages/reasoning/src/strategies/kernel/kernel-runner.ts packages/reasoning/tests/strategies/kernel/kernel-runner-oracle-gate.test.ts
git commit -m "feat(kernel): oracle hard gate — force final-answer exit after 2 ignored readyToAnswer signals"
```

---

## Task 15: Context pressure hard gate — narrow to final-answer when budget exhausted

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/phases/think.ts` (augmentedToolSchemas narrowing)
- Modify: `packages/reasoning/src/strategies/kernel/kernel-runner.ts` (pressure detection)

**Root cause from test analysis:** GPT-4o-mini hit "critical" context pressure (15,585 tokens, 0 headroom) but continued looping. When the context budget is exhausted the model has no useful tokens left to reason with — every additional iteration degrades rather than improves the output. The harness must intervene: narrow available FC tools to ONLY `final-answer`, force the model to exit cleanly.

**Design:** In the context-builder/think phase, when estimated tokens exceed 95% of the tier budget, replace `augmentedToolSchemas` with only `[finalAnswerTool]`. This makes `final-answer` the only callable tool, forcing the model's next action to be a structured exit.

- [ ] **Step 1: Write failing test**

```typescript
// packages/reasoning/tests/strategies/kernel/phases/think-pressure-gate.test.ts
import { describe, it, expect } from "bun:test"
import { shouldNarrowToFinalAnswerOnly } from "../../../src/strategies/kernel/phases/think.js"

describe("context pressure hard gate", () => {
  it("returns false when under budget", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 3000, maxTokens: 8000 })).toBe(false)
  })
  it("returns false at 94% (just under threshold)", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 7500, maxTokens: 8000 })).toBe(false)
  })
  it("returns true at 95% budget", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 7600, maxTokens: 8000 })).toBe(true)
  })
  it("returns true above 95%", () => {
    expect(shouldNarrowToFinalAnswerOnly({ estimatedTokens: 8000, maxTokens: 8000 })).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/think-pressure-gate.test.ts
```
Expected: FAIL.

- [ ] **Step 3: Add `shouldNarrowToFinalAnswerOnly` to `think.ts`**

```typescript
/** Returns true when token pressure is critical — only final-answer should be offered. */
export function shouldNarrowToFinalAnswerOnly(opts: {
  estimatedTokens: number
  maxTokens: number
}): boolean {
  return opts.estimatedTokens / opts.maxTokens >= 0.95
}
```

Wire it in the `augmentedToolSchemas` construction (after tokens are estimated from `state.tokens`):
```typescript
const pressureCritical = shouldNarrowToFinalAnswerOnly({
  estimatedTokens: state.tokens,
  maxTokens: profile.maxTokens,
})

// When context budget is exhausted, narrow to final-answer only — forces clean exit
const effectiveSchemas = pressureCritical
  ? [{ name: finalAnswerTool.name, description: finalAnswerTool.description, parameters: finalAnswerTool.parameters }]
  : augmentedToolSchemas

// Use effectiveSchemas everywhere after this point (llmTools, filteredToolSchemas, buildToolSchemas call)
```

Also inject a user steering message when pressure is critical (via `steeringNudge` mechanism):
```typescript
if (pressureCritical && !state.steeringNudge) {
  state = transitionState(state, {
    steeringNudge: "Context budget exhausted. You must call `final-answer` now with your best response based on what you know.",
  })
}
```

- [ ] **Step 4: Run test to verify pass**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/think-pressure-gate.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/phases/think.ts packages/reasoning/tests/strategies/kernel/phases/think-pressure-gate.test.ts
git commit -m "feat(think): context pressure hard gate — narrow to final-answer only when budget >95% exhausted"
```

---

## Task 16: Consecutive meta-tool deduplication — prevent pulse/brief spam

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/phases/guard.ts`
- Modify: `packages/reasoning/src/strategies/kernel/kernel-state.ts` (add `lastMetaToolCall?: string`)

**Root cause from test analysis:** cogito:14b called `brief()` twice consecutively with identical args and no state change between calls. GPT-4o-mini called `pulse()` six consecutive times after receiving `readyToAnswer=true` each time. These are pure signal-degradation loops — the model is stuck in a meta-introspection spiral rather than making progress. The guard should detect consecutive identical meta-tool calls and return a cached result + inject "stop repeating" nudge instead of re-executing.

- [ ] **Step 1: Write failing test**

```typescript
// packages/reasoning/tests/strategies/kernel/phases/guard-meta-dedup.test.ts
import { describe, it, expect } from "bun:test"
import { isConsecutiveMetaToolSpam } from "../../../src/strategies/kernel/phases/guard.js"

describe("meta-tool deduplication guard", () => {
  it("returns false on first meta-tool call", () => {
    expect(isConsecutiveMetaToolSpam({ toolName: "pulse", lastMetaToolCall: undefined, consecutiveCount: 0 })).toBe(false)
  })
  it("returns false on second different meta-tool", () => {
    expect(isConsecutiveMetaToolSpam({ toolName: "brief", lastMetaToolCall: "pulse", consecutiveCount: 1 })).toBe(false)
  })
  it("returns false on second same meta-tool (first repeat, warn but allow)", () => {
    expect(isConsecutiveMetaToolSpam({ toolName: "pulse", lastMetaToolCall: "pulse", consecutiveCount: 1 })).toBe(false)
  })
  it("returns true on third consecutive same meta-tool call", () => {
    expect(isConsecutiveMetaToolSpam({ toolName: "pulse", lastMetaToolCall: "pulse", consecutiveCount: 2 })).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify fail**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/guard-meta-dedup.test.ts
```

- [ ] **Step 3: Add `lastMetaToolCall` and `consecutiveMetaToolCount` to `KernelState`**

```typescript
readonly lastMetaToolCall?: string;
readonly consecutiveMetaToolCount?: number;
```

- [ ] **Step 4: Export `isConsecutiveMetaToolSpam` from `guard.ts` and wire into guard chain**

```typescript
export function isConsecutiveMetaToolSpam(opts: {
  toolName: string
  lastMetaToolCall: string | undefined
  consecutiveCount: number
}): boolean {
  const META_TOOLS = new Set(["brief", "pulse", "find", "recall"])
  if (!META_TOOLS.has(opts.toolName)) return false
  return opts.toolName === opts.lastMetaToolCall && opts.consecutiveCount >= 2
}
```

In `guard.ts`, add a guard that fires when `isConsecutiveMetaToolSpam` returns true:
```typescript
// Returns GuardOutcome.block with message when meta-tool spam detected
export const metaToolDedupGuard: Guard = (tc, state) => {
  const isMeta = META_TOOL_SET.has(tc.name)
  if (!isMeta) return { outcome: "allow" }
  const lastMeta = state.lastMetaToolCall
  const count = state.consecutiveMetaToolCount ?? 0
  if (isConsecutiveMetaToolSpam({ toolName: tc.name, lastMetaToolCall: lastMeta, consecutiveCount: count })) {
    return {
      outcome: "block",
      reason: `You just called ${tc.name} ${count} times in a row. Nothing has changed. Stop calling ${tc.name} and either use a task tool or call final-answer.`,
    }
  }
  return { outcome: "allow" }
}
```

Add `metaToolDedupGuard` to `defaultGuards[]`. Update `lastMetaToolCall` and `consecutiveMetaToolCount` in the kernel state after each tool call in `act.ts`:
```typescript
// After each tool call dispatch in act.ts:
const isMeta = META_TOOL_SET.has(tc.name)
const prevLast = state.lastMetaToolCall
const prevCount = state.consecutiveMetaToolCount ?? 0
state = transitionState(state, {
  lastMetaToolCall: isMeta ? tc.name : undefined,
  consecutiveMetaToolCount: isMeta && tc.name === prevLast ? prevCount + 1 : (isMeta ? 1 : 0),
})
```

- [ ] **Step 5: Run test to verify pass**

```bash
bun test packages/reasoning/tests/strategies/kernel/phases/guard-meta-dedup.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/reasoning/src/strategies/kernel/kernel-state.ts packages/reasoning/src/strategies/kernel/phases/guard.ts packages/reasoning/src/strategies/kernel/phases/act.ts packages/reasoning/tests/strategies/kernel/phases/guard-meta-dedup.test.ts
git commit -m "feat(guard): meta-tool dedup guard — block pulse/brief spam after 2 consecutive identical calls"
```

---

## Task 17: Dynamic sub-agent 0-token bug investigation and fix

**Files:**
- Investigate: `packages/runtime/src/execution-engine.ts` (classify → requiredTools threading)
- Investigate: `packages/reasoning/src/strategies/kernel/phases/think.ts` (fast-path with requiredTools)

**Root cause from test analysis:** Dynamic sub-agent test fails on Gemini and GPT-4o-mini with exactly `0 iters, 0 tok, ~2.9s, success=false`. The classify phase fires and correctly identifies `spawn-agent` as required (taking 2.8s for the LLM call). Then the think phase runs ~100ms and produces 0 tokens. cogito:14b passes the same test (6 iters, 6,156 tok), meaning it's not a universal failure. The most likely causes: (a) `effectiveRequiredTools` from classify not being threaded into `input.requiredTools` for some code path, causing the fast-path in think.ts to fire despite spawn-agent being required; or (b) a provider-specific LLM failure (rate limit, empty response) being silently swallowed.

- [ ] **Step 1: Add diagnostic logging to the think phase for 0-token exits**

In `think.ts`, after the stream consume loop, log when 0 tokens were accumulated:
```typescript
if (accumulatedUsage.totalTokens === 0 && accumulatedContent.length === 0 && accumulatedToolCalls.length === 0) {
  yield* hooks.onLog(state, `[think] WARNING: LLM returned 0 tokens at iteration ${state.iteration}. stopReason=${accumulatedStopReason}. hasRequiredTools=${hasRequiredTools}. fast-path-eligible=${state.iteration === 0 && !hasRequiredTools}`)
}
```

- [ ] **Step 2: Add diagnostic in execution engine for the 0-token completion path**

Near line 1349-1360 where `strategyFallback: true` is set, add logging:
```typescript
yield* obs.info(`[engine] WARN: strategy fallback triggered — 0 tok. classify.required=${effectiveRequiredTools?.join(",")}`)
```

- [ ] **Step 3: Run the dynamic sub-agent test in isolation for Gemini to capture the diagnostic**

```bash
bun run packages/benchmarks/run-single.ts --test "dynamic-sub-agent" --provider gemini 2>&1 | grep -E "WARNING|WARN|0 tok|fast-path|strategyFallback"
```

- [ ] **Step 4: Fix based on diagnostic findings**

Based on the diagnostic output, apply one of:
- **If fast-path fired incorrectly**: ensure `hasRequiredTools = (input.requiredTools?.length ?? 0) > 0` is evaluated AFTER `effectiveRequiredTools` is passed in (check execution-engine line ~1323 threading)
- **If provider error swallowed**: surface the error properly rather than returning 0 tokens; emit a retry or fail loudly

- [ ] **Step 5: Commit fix**

```bash
git add packages/runtime/src/execution-engine.ts packages/reasoning/src/strategies/kernel/phases/think.ts
git commit -m "fix(engine): surface dynamic sub-agent 0-token failure — add diagnostic logging and fix requiredTools threading"
```

---

## Summary of Changes

| Phase | What Changed | Why |
|-------|-------------|-----|
| Task 1 | `KernelState`: `synthesizedContext` → `steeringNudge`, `frozenToolResultIds` | Foundation for new pipeline |
| Task 2 | `formatToolSchemaMicro()` in tool-utils | Lean tool listing for local tier |
| Task 3 | Tier-adaptive `buildStaticContext` — local gets compact/micro, frontier gets full | Halve system prompt tokens for local |
| Task 4 | ICS coordinator → `steeringNudge: string` only, tier-adaptive frequency | Replace context replacement with directional guidance |
| Task 5 | Remove `hasICS` branch; always `buildStaticContext`; remove dead `buildDynamicContext` | System prompt always carries tool schemas + env |
| Task 6 | `context-builder.ts`: remove `synthesizedContext` path; consume `steeringNudge` | Native FC thread is always the context |
| Task 7 | Microcompact: strip old tool result content; track `frozenToolResultIds` | Lean messages without losing conversation structure |
| Task 8 | Token-delta guard: exit when model stops making progress | Prevent runaway iterations on stalled tasks |
| Task 9 | `allowedTools` mismatch warning at bootstrap | Surface the `scratch.ts`-class bug immediately |
| Task 10 | Delete `task-phase.ts`, `synthesis-templates.ts`, `synthesizedContext` | Remove ~430 lines of dead code |
| Task 11 | Fix `scratch.ts` tool name; end-to-end validation | Confirm the pipeline works |
| Task 12 | Full test suite baseline verification | Zero regressions |
| **Task 13** | **`recall` and `find` injected into FC schemas when `metaTools` enabled** | **Fix universal 0/1 tools pass rate — D grade across all models** |
| **Task 14** | **Oracle hard gate: force exit after 2 ignored `readyToAnswer` signals** | **Fix 38-iteration explosion on GPT-4o-mini; enforce termination oracle** |
| **Task 15** | **Context pressure hard gate: narrow to `final-answer` only at 95% budget** | **Prevent continued looping when context is exhausted** |
| **Task 16** | **Meta-tool dedup guard: block 3rd consecutive identical meta-tool call** | **Stop pulse/brief spam loops on cogito/local models** |
| **Task 17** | **Dynamic sub-agent 0-token bug: diagnose and fix requiredTools threading** | **Fix consistent 50% subagent failure rate on Gemini/OpenAI** |
