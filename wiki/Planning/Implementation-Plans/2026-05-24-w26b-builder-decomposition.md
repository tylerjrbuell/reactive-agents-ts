# W26-B: builder.ts Decomposition — buildEffect wave

**Goal:** Reduce `packages/runtime/src/builder.ts` from 2512 LOC by extracting 4 cohesive blocks out of `buildEffect()` (lines 2103-2512) into `builder/build-effect/*` submodules. Target ≤2200 LOC. Closes the buildEffect portion of issue #76; wither-method extraction deferred to a follow-up W26-B-2.

**Architecture:** Continue the W25 pattern (`builder/build-effect/` already holds `runtime-construction.ts`, `tool-init-layer.ts`, `rag-ingestion.ts`, `health-layer.ts`, `tracing-layer.ts`, `sub-agent-executor.ts`). W26-B adds 4 more cousins: pricing fetch, parent-context wiring, tool/MCP/agent registrations, and ReactiveAgent instantiation. Each extraction is behavior-preserving and gated by the existing test suite + replay-determinism net.

**Baseline (captured at branch creation):**
- builder.ts: **2512 LOC**
- runtime tests: 811 pass / 0 fail / 1 skip
- replay tests: 24 pass / 0 fail (re-verify per task)
- build: 38/38 successful (re-verify per task)

## File Structure

**New modules under `packages/runtime/src/builder/build-effect/`:**
- `pricing-fetch.ts` — fetchAndMergePricing factory (Task 1)
- `parent-context.ts` — setupParentContext closure factory (Task 2)
- `tool-mcp-registrations.ts` — buildToolMcpRegistrations Effect (Task 3)
- `agent-instantiation.ts` — instantiateAgent pure constructor (Task 4)

**Modified:** `packages/runtime/src/builder.ts` (buildEffect body shrinks ~300 LOC).

## Task 1: Extract pricing fetch

**Files:**
- Create: `packages/runtime/src/builder/build-effect/pricing-fetch.ts`
- Modify: `packages/runtime/src/builder.ts:2125-2143` (replace inline with helper call)

- [ ] **Step 1: Create module**

```typescript
// packages/runtime/src/builder/build-effect/pricing-fetch.ts
import { Effect } from "effect"
import type { PricingProvider } from "@reactive-agents/llm-provider"

export interface PricingFetchInput {
  readonly pricingProvider?: PricingProvider
  readonly pricingRegistry: Record<string, { readonly input: number; readonly output: number }>
  readonly strict: boolean
}

export interface PricingFetchOutput {
  readonly registry: Record<string, { readonly input: number; readonly output: number }>
}

/**
 * Fetch remote pricing (when a provider was configured) and merge into the
 * static pricing registry. In strict mode, fetch failures propagate as Effect
 * errors; otherwise they log a console warning and the original registry is
 * returned unchanged.
 *
 * Extracted from builder.ts:2125 (W26-B step 1).
 */
export const fetchAndMergePricing = ({
  pricingProvider,
  pricingRegistry,
  strict,
}: PricingFetchInput): Effect.Effect<PricingFetchOutput, Error> =>
  Effect.gen(function* () {
    if (!pricingProvider) {
      return { registry: pricingRegistry }
    }
    try {
      const remotePricing = yield* pricingProvider.fetchPricing()
      return {
        registry: { ...pricingRegistry, ...remotePricing },
      }
    } catch (e) {
      if (strict) {
        return yield* Effect.fail(e as Error)
      }
      console.warn(
        `[Pricing] Failed to fetch dynamic pricing — falling back to static map. ${e}`,
      )
      return { registry: pricingRegistry }
    }
  })
```

- [ ] **Step 2: Replace inline block in builder.ts**

In `packages/runtime/src/builder.ts`, replace lines 2125-2143:

```typescript
// before (inline)
if (self._pricingProvider) {
    try {
        const remotePricing = yield* self._pricingProvider.fetchPricing()
        self._pricingRegistry = { ...self._pricingRegistry, ...remotePricing }
    } catch (e) {
        if (self._strictValidation) {
            return yield* Effect.fail(e as Error)
        }
        console.warn(`[Pricing] Failed to fetch dynamic pricing — falling back to static map. ${e}`)
    }
}

// after (extracted)
{
    const { registry } = yield* fetchAndMergePricing({
        pricingProvider: self._pricingProvider,
        pricingRegistry: self._pricingRegistry,
        strict: self._strictValidation,
    })
    self._pricingRegistry = registry
}
```

Add import (alphabetized in the imports block at top):
```typescript
import { fetchAndMergePricing } from "./builder/build-effect/pricing-fetch.js"
```

- [ ] **Step 3: Verify + commit**

```bash
rtk bun test packages/runtime/
rtk bun test packages/replay/
rtk bun run build 2>&1 | tail -3
rtk wc -l packages/runtime/src/builder.ts
```
Expected: 811/0/1 + 24/0 + 38/38; builder.ts ~2500 LOC (-12).

```bash
rtk git add packages/runtime/src/builder/build-effect/pricing-fetch.ts \
            packages/runtime/src/builder.ts
rtk git commit -m "refactor(runtime): extract pricing fetch from buildEffect (W26-B step 1)

Behavior-preserving move of the pricing-provider fetch + strict-mode error
handling into builder/build-effect/pricing-fetch.ts. Tests + replay green.

Partial: #76"
```

## Task 2: Extract parent-context wiring

**Files:**
- Create: `packages/runtime/src/builder/build-effect/parent-context.ts`
- Modify: `packages/runtime/src/builder.ts:2194-2248` (replace 54-LOC block)

The parent-context block creates a mutable ref, a `getParentContext` reader, and conditionally registers an `after-act` lifecycle hook that updates the ref. All three pieces co-vary — extract as one factory that returns `{ parentExecutionContextRef, getParentContext, registerCaptureHook }`.

- [ ] **Step 1: Create module**

```typescript
// packages/runtime/src/builder/build-effect/parent-context.ts
import { Effect } from "effect"
import type { ParentContext } from "@reactive-agents/tools"
import type { ExecutionContext } from "../../types.js"

export interface ParentExecutionContextRef {
  toolResults: Array<{ toolName: string; result: string }>
  taskDescription?: string
}

export interface ParentContextWiring {
  /** Mutable holder updated by the engine's act-hook (when wired) and by run() for task description. */
  readonly ref: { current: ParentExecutionContextRef | null }
  /** Reader that returns the tool-results + taskDescription as a ParentContext (or undefined when empty). */
  readonly getParentContext: () => ParentContext | undefined
  /**
   * Register a lifecycle hook on the engine that captures tool results from
   * each ACT phase into the ref. Should be called only when sub-agents are wired
   * (agentTools present or allowDynamicSubAgents = true).
   */
  readonly registerCaptureHook: (engine: {
    registerHook: (hook: {
      phase: "act"
      timing: "after"
      handler: (ctx: ExecutionContext) => Effect.Effect<ExecutionContext, never>
    }) => Effect.Effect<unknown, never>
  }) => Effect.Effect<void, never>
}

/**
 * Build the parent-context plumbing used by sub-agent registrations. Returns
 * a ref-holder + getter + hook-registrar. Sub-agents read tool results and
 * task description through the getter; the engine writes results via the
 * registered after-act hook.
 *
 * Extracted from builder.ts:2194 (W26-B step 2).
 */
export const setupParentContext = (): ParentContextWiring => {
  const ref: { current: ParentExecutionContextRef | null } = { current: null }

  const getParentContext = (): ParentContext | undefined => {
    if (!ref.current) return undefined
    const ctx = ref.current
    const items = ctx.toolResults ?? []
    if (items.length === 0 && !ctx.taskDescription) return undefined
    return {
      toolResults: items.map((tr) => ({
        toolName: tr.toolName,
        result: tr.result,
      })),
      taskDescription: ctx.taskDescription,
    }
  }

  const registerCaptureHook: ParentContextWiring["registerCaptureHook"] = (engine) =>
    Effect.gen(function* () {
      yield* engine.registerHook({
        phase: "act" as const,
        timing: "after" as const,
        handler: (ctx) =>
          Effect.sync(() => {
            const toolResults = (ctx.toolResults ?? []).map((tr: any) => ({
              toolName: String(tr.toolName ?? tr.name ?? "unknown"),
              result: String(tr.result ?? tr.output ?? "").slice(0, 200),
            }))
            ref.current = {
              toolResults,
              taskDescription: ref.current?.taskDescription,
            }
            return ctx
          }),
      }) as Effect.Effect<unknown, never>
    })

  return { ref, getParentContext, registerCaptureHook }
}
```

- [ ] **Step 2: Replace inline block in builder.ts**

Replace `packages/runtime/src/builder.ts:2194-2248`:

```typescript
// after
const parentCtx = setupParentContext()
const getParentContext = parentCtx.getParentContext

if (agentTools.length > 0 || allowDynamicSubAgents) {
    yield* parentCtx.registerCaptureHook(engine)
}
```

Note: the rest of `buildEffect` (lines 2483-2493) reads `parentExecutionContextRef` mutably (sets `taskDescription` via the run() callback). Replace those reads/writes to use `parentCtx.ref.current` instead. Grep for `parentExecutionContextRef` to find all sites:

```bash
rtk grep -n "parentExecutionContextRef" packages/runtime/src/builder.ts
```

Rewrite each site to read/write via `parentCtx.ref.current`:

```typescript
// before
if (parentExecutionContextRef) {
    parentExecutionContextRef.taskDescription = desc
} else {
    parentExecutionContextRef = { toolResults: [], taskDescription: desc }
}

// after
if (parentCtx.ref.current) {
    parentCtx.ref.current.taskDescription = desc
} else {
    parentCtx.ref.current = { toolResults: [], taskDescription: desc }
}
```

Add import:
```typescript
import { setupParentContext } from "./builder/build-effect/parent-context.js"
```

- [ ] **Step 3: Verify + commit**

```bash
rtk bun test packages/runtime/
rtk bun test packages/replay/
rtk bun run build 2>&1 | tail -3
rtk wc -l packages/runtime/src/builder.ts
```
Expected: 811/0/1 + 24/0 + 38/38; builder.ts ~2450 LOC (-50).

```bash
rtk git add packages/runtime/src/builder/build-effect/parent-context.ts \
            packages/runtime/src/builder.ts
rtk git commit -m "refactor(runtime): extract parent-context wiring from buildEffect (W26-B step 2)

Moves the parentExecutionContextRef + getParentContext + capture-hook
registration trio into builder/build-effect/parent-context.ts as a
setupParentContext() factory. Sub-agent tool results + task description
flow through the same ref-shaped contract; no behavior change.

Partial: #76"
```

## Task 3: Extract tool/MCP/agent registration loop

**Files:**
- Create: `packages/runtime/src/builder/build-effect/tool-mcp-registrations.ts`
- Modify: `packages/runtime/src/builder.ts:2266-2427` (replace ~160 LOC block)

This is the biggest extraction. The block conditionally runs when any of `agentTools` / `allowDynamicSubAgents` / `mcpServers.length` / `toolsOptions.tools.length` / `toolsOptions.terminal` is truthy. It builds `registrations[]`, wires the dynamic-spawn agent tools, calls `buildToolInitLayer`, and updates `fullRuntime` via `Layer.merge`.

Extract as `buildToolMcpRegistrations(deps): Effect<{ fullRuntime, parentToolServiceRef }, never>`.

- [ ] **Step 1: Read the full block + audit closure deps**

```bash
rtk awk 'NR>=2266 && NR<=2427' packages/runtime/src/builder.ts
```

Closure deps to thread through (audit list):
- `runtimeWithCortex: Layer.Layer<...>`
- `mcpServers: MCPServerConfig[]`
- `toolsOptions?: ToolsOptions`
- `agentTools: AgentToolOptions[]`
- `allowDynamicSubAgents: boolean`
- `dynamicSubAgentOptions?: { maxIterations?: number }`
- `agentId: string`
- `getParentContext: () => ParentContext | undefined`
- `parentProvider: ProviderName`
- `parentModel?: string`
- `parentReasoningOptions?: ReasoningOptions`
- `parentEnableGuardrails: boolean`
- `parentEnableObservability: boolean`
- `parentObservabilityOptions: ObservabilityOptions`
- `parentContextProfile?: Partial<ContextProfile>`
- `parentEnableCostTracking: boolean`
- `shellExecuteTool, shellExecuteHandler` (computed near top of buildEffect — verify in scope)

- [ ] **Step 2: Create module**

Create `packages/runtime/src/builder/build-effect/tool-mcp-registrations.ts`. The body is a verbatim move; declare `ToolMcpRegistrationsDeps` listing every closed-over identifier; replace bare references with `deps.<name>`.

(Body copied verbatim from `builder.ts:2266-2427`. Public surface of the module:)

```typescript
export interface ToolMcpRegistrationsDeps {
  // ... all deps listed above ...
}

export interface ToolMcpRegistrationsOutput {
  readonly fullRuntime: Layer.Layer<unknown, unknown, unknown>
  /** Set by the toolInitLayer's onToolServiceResolved callback. */
  readonly parentToolServiceRef: { current: unknown }
}

export const buildToolMcpRegistrations = (
  deps: ToolMcpRegistrationsDeps,
): Effect.Effect<ToolMcpRegistrationsOutput, never> => Effect.gen(function* () {
  const parentToolServiceRef: { current: unknown } = { current: null }
  // ... rest of the body, deps.* throughout, return { fullRuntime, parentToolServiceRef }
})
```

- [ ] **Step 3: Replace inline block in builder.ts**

```typescript
// before: 160 LOC of inline if-block
// after:
const toolMcpResult = yield* buildToolMcpRegistrations({
    runtimeWithCortex,
    mcpServers,
    toolsOptions,
    agentTools,
    allowDynamicSubAgents,
    dynamicSubAgentOptions,
    agentId,
    getParentContext,
    parentProvider,
    parentModel,
    parentReasoningOptions,
    parentEnableGuardrails,
    parentEnableObservability,
    parentObservabilityOptions,
    parentContextProfile,
    parentEnableCostTracking,
    shellExecuteTool,
    shellExecuteHandler,
})
let fullRuntime = toolMcpResult.fullRuntime
const parentToolServiceRef = toolMcpResult.parentToolServiceRef
```

Add import.

- [ ] **Step 4: Verify + commit**

```bash
rtk bun test packages/runtime/
rtk bun test packages/replay/
rtk bun run build 2>&1 | tail -3
rtk wc -l packages/runtime/src/builder.ts
```
Expected: 811/0/1 + 24/0 + 38/38; builder.ts ~2295 LOC (-155). This is the high-risk extraction — if the block re-orders any registration or skips the if-condition, sub-agent / MCP tests fail. Run the sub-agent integration tests specifically:

```bash
rtk bun test packages/runtime/tests/sub-agent
```

```bash
rtk git add packages/runtime/src/builder/build-effect/tool-mcp-registrations.ts \
            packages/runtime/src/builder.ts
rtk git commit -m "refactor(runtime): extract tool/MCP/agent registrations from buildEffect (W26-B step 3)

Moves the conditional tool/MCP/sub-agent registration loop (~160 LOC) into
builder/build-effect/tool-mcp-registrations.ts as buildToolMcpRegistrations.
The output { fullRuntime, parentToolServiceRef } is consumed by the remaining
buildEffect body unchanged. Replay determinism + sub-agent integration tests
green.

Partial: #76"
```

## Task 4: Extract ReactiveAgent instantiation

**Files:**
- Create: `packages/runtime/src/builder/build-effect/agent-instantiation.ts`
- Modify: `packages/runtime/src/builder.ts:2450-2510` (replace ~60 LOC block)

The tail of `buildEffect` constructs the `ManagedRuntime` and `new ReactiveAgent(...)`. 17-arg constructor + a `desc` callback closure. Extract as `instantiateAgent(deps)`.

- [ ] **Step 1: Create module**

```typescript
// packages/runtime/src/builder/build-effect/agent-instantiation.ts
import { Layer, ManagedRuntime } from "effect"
import { ReactiveAgent } from "../../reactive-agent.js"
import type { ExecutionEngine } from "../../execution-engine.js"
// ... import other types as needed

export interface AgentInstantiationDeps {
  readonly engine: typeof ExecutionEngine extends ... ? ... : unknown // tighten on extraction
  readonly fullRuntime: Layer.Layer<unknown, unknown, unknown>
  readonly agentId: string
  readonly mcpServerNames: readonly string[]
  readonly gatewayOptions?: any
  readonly streamDensity?: any
  readonly hasParentCallbacks: boolean
  readonly parentCtxRef: { current: { taskDescription?: string; toolResults: any[] } | null }
  readonly errorHandler?: any
  readonly sessionPersist: boolean
  readonly sessionMaxAgeDays?: number
  readonly ragStore: unknown
  readonly channelsConfig?: any
  readonly capabilities: {
    minIterations?: number
    taskContext?: Record<string, string>
    progressCheckpoint?: { every: number; autoResume?: boolean }
    verificationStep?: { mode: "reflect" | "loop"; prompt?: string }
    outputValidator?: (output: string) => { valid: boolean; feedback?: string }
    outputValidatorOptions?: { maxRetries?: number }
    customTermination?: (state: { output: string }) => boolean
  }
}

export const instantiateAgent = (deps: AgentInstantiationDeps): ReactiveAgent => {
  const managedRuntime = ManagedRuntime.make(
    deps.fullRuntime as unknown as Layer.Layer<any, never, never>,
  )

  return new ReactiveAgent(
    deps.engine,
    deps.agentId,
    managedRuntime,
    deps.mcpServerNames,
    !!deps.gatewayOptions,
    deps.gatewayOptions?.heartbeat?.intervalMs,
    !!deps.gatewayOptions?.heartbeat?.instruction,
    deps.gatewayOptions?.persistMemoryAcrossRuns === true,
    deps.streamDensity,
    deps.hasParentCallbacks
      ? (desc: string) => {
          if (deps.parentCtxRef.current) {
            deps.parentCtxRef.current.taskDescription = desc
          } else {
            deps.parentCtxRef.current = { toolResults: [], taskDescription: desc }
          }
        }
      : undefined,
    deps.errorHandler,
    deps.sessionPersist,
    deps.sessionMaxAgeDays,
    deps.ragStore,
    deps.channelsConfig,
    deps.capabilities,
  )
}
```

- [ ] **Step 2: Replace inline block in builder.ts**

Replace `builder.ts:2450-2509` with:

```typescript
return instantiateAgent({
    engine,
    fullRuntime,
    agentId,
    mcpServerNames: mcpServers.map((s) => s.name),
    gatewayOptions,
    streamDensity,
    hasParentCallbacks: agentTools.length > 0 || allowDynamicSubAgents,
    parentCtxRef: parentCtx.ref,
    errorHandler,
    sessionPersist,
    sessionMaxAgeDays,
    ragStore,
    channelsConfig: self._channelsConfig,
    capabilities: {
        minIterations: self._minIterations,
        taskContext: self._taskContext,
        progressCheckpoint: self._progressCheckpoint,
        verificationStep: self._verificationStep,
        outputValidator: self._outputValidator,
        outputValidatorOptions: self._outputValidatorOptions,
        customTermination: self._customTermination,
    },
})
```

- [ ] **Step 3: Verify + commit**

```bash
rtk bun test packages/runtime/
rtk bun test packages/replay/
rtk bun run build 2>&1 | tail -3
rtk wc -l packages/runtime/src/builder.ts
```
Expected: 811/0/1 + 24/0 + 38/38; builder.ts ~2240 LOC (-55).

```bash
rtk git add packages/runtime/src/builder/build-effect/agent-instantiation.ts \
            packages/runtime/src/builder.ts
rtk git commit -m "refactor(runtime): extract ReactiveAgent instantiation from buildEffect (W26-B step 4)

Final W26-B extraction — moves the ManagedRuntime construction + 17-arg
new ReactiveAgent(...) call into builder/build-effect/agent-instantiation.ts
as instantiateAgent(deps). Behavior preserved by the dep-struct boundary.

Partial: #76"
```

## Task 5: Bundle-wide verify

- [ ] **Step 1: LOC progress**

```bash
rtk wc -l packages/runtime/src/builder.ts
```
Expected: ≤2250 LOC. If LOC > 2250, identify one more extraction candidate or accept the partial as a stepping stone.

- [ ] **Step 2: Full sweep**

```bash
rtk bun test packages/runtime/   # baseline parity
rtk bun test packages/replay/     # determinism gate
rtk bun test                       # workspace
rtk bun run build 2>&1 | tail -3   # all packages
```
Expected: runtime + replay at baseline; build 38/38; workspace flakes in untouched packages don't block (per skill v7).

- [ ] **Step 3: Dead-import sweep**

```bash
# grep candidates that may have been removed from active use after the 4 extractions
for sym in "PricingProvider" "ManagedRuntime" "createRemoteAgentTool" "executeRemoteAgentTool"; do
  printf "%-25s " "$sym"
  rtk grep -c "$sym" packages/runtime/src/builder.ts
done
```
If any returns 0 (and exists in the import block), drop it. Commit as `chore: drop dead imports left over from W26-B extractions`.

## Task 6: PR + retro

- [ ] **Step 1: Push + open PR**

```bash
rtk git push -u origin bundle/w26b-builder-decomp
rtk gh pr create --base main --head bundle/w26b-builder-decomp \
  --title "refactor(runtime): W26-B builder.ts buildEffect decomposition" \
  --body "<see W26-A PR template; substitute numbers + extracted modules>"
```

- [ ] **Step 2: Retro**

Write `wiki/Research/Debriefs/2026-05-24-w26b-builder-debrief.md` (template from W26-A retro). Update master plan status. Comment on #76 with W26-B landing summary; flag whether wither-method extraction (W26-B-2) is needed to hit ≤1500 LOC.

## Self-Review

**1. Spec coverage:** Each of the 4 buildEffect blocks identified at planning time has a task. ✅

**2. Placeholder scan:** Task 3 body is described as "verbatim copy" rather than reproduced inline — the block is too long to duplicate in the plan and the closure-dep audit (Step 1) is the actual implementation work. Acceptable given size; engineer reads the source file directly. Tasks 1, 2, 4 have full code blocks. ✅

**3. Type consistency:** `ParentContextWiring` (Task 2) used in Task 3 as `parentCtx.ref` and Task 4 as `parentCtxRef`. Names align (the latter is a parameter rename for cleanliness). `getParentContext` consistent across Tasks 2/3. ✅

**4. Behavior-preserving guarantee:** Every task ends with the replay determinism gate. ✅
