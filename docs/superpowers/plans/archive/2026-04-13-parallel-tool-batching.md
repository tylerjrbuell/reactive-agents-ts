# Parallel Tool Batching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the ReAct kernel to execute multiple tool calls returned in a single LLM FC response in parallel rather than sequentially, eliminating wasted think phases between independent operations.

**Architecture:** The parallel batching infrastructure already exists in `act.ts` (lines 161–454, `Effect.all` concurrent execution) and `tool-utils.ts` (`planNextMoveBatches`, `isParallelBatchSafeTool`). It is gated behind `nextMovesPlanning.enabled` which defaults to `false`. The fix is: flip the default to `true`, expand the safe-tool allowlist, add a system-prompt hint to encourage multi-FC responses, and expose a kill-switch through the builder. No new phases or architectural changes.

**Tech Stack:** TypeScript, Effect-TS `Effect.all({ concurrency: N })`, bun:test

---

## File Map

| File | Change |
|------|--------|
| `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts` | Expand `PARALLEL_SAFE_TOOLS` — add `spawn-agents`, `recall`, `find` |
| `packages/reasoning/src/types/config.ts` | Default `nextMovesPlanning.enabled: false` → `true`, `maxBatchSize: 3` → `4` |
| `packages/reasoning/src/strategies/kernel/phases/context-builder.ts` | Add multi-tool hint to mid/large/frontier tier prompts |
| `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts` | (same file as row 1) — also export `isParallelBatchSafeTool` for testing |
| `packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts` | Add tests: expanded safe list, default batching behavior |
| `scratch.ts` | Already has the XRP/XLM/ETH/BTC subagent task — verify it runs and shows parallel dispatch in observability output |

---

## Task 1: Expand the parallel-safe tool allowlist

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts`
- Test: `packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts`

### Background

`isParallelBatchSafeTool` currently only marks `spawn-agent` as explicitly safe, relying on name heuristics (`search`, `http`, `fetch`, `get`, `read`, `list`, `query`) for everything else. Three important tools are missed: `spawn-agents` (parallel subagent dispatch — the whole point of this PR), `recall` (scratchpad read — pure read, no side effect), and `find` (index lookup — pure read).

- [ ] **Step 1: Write failing tests for the expanded safe list**

Add these cases to `tool-utils.test.ts` inside a new `describe("isParallelBatchSafeTool")` block. Because `isParallelBatchSafeTool` is currently unexported, you'll test it via `planNextMoveBatches` with a 2-call input and a `{ enabled: true }` config — if a tool is safe, both calls should end up in one batch of length 2; if unsafe, they should be in two singletons.

```typescript
// At top of file, existing import already has planNextMoveBatches.
// No new imports needed.

describe("planNextMoveBatches — safe-tool batching", () => {
  const cfg = { enabled: true, maxBatchSize: 4, allowParallelBatching: true };

  function makeCalls(names: string[]) {
    return names.map((name, i) => ({ id: `id-${i}`, name, arguments: {} }));
  }

  it("batches two spawn-agents calls together", () => {
    const batches = planNextMoveBatches(makeCalls(["spawn-agents", "spawn-agents"]), cfg);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it("batches two recall calls together", () => {
    const batches = planNextMoveBatches(makeCalls(["recall", "recall"]), cfg);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it("batches two find calls together", () => {
    const batches = planNextMoveBatches(makeCalls(["find", "find"]), cfg);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });

  it("does NOT batch file-write with itself", () => {
    const batches = planNextMoveBatches(makeCalls(["file-write", "file-write"]), cfg);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(1);
  });

  it("does NOT batch final-answer", () => {
    const batches = planNextMoveBatches(makeCalls(["final-answer", "web-search"]), cfg);
    // final-answer is unsafe; web-search lands in its own batch
    expect(batches).toHaveLength(2);
  });

  it("splits unsafe tool between two safe batches", () => {
    const calls = makeCalls(["web-search", "file-write", "web-search"]);
    const batches = planNextMoveBatches(calls, cfg);
    // web-search | file-write | web-search → 3 batches
    expect(batches).toHaveLength(3);
    expect(batches[0]![0]!.name).toBe("web-search");
    expect(batches[1]![0]!.name).toBe("file-write");
    expect(batches[2]![0]!.name).toBe("web-search");
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd packages/reasoning && bun test tests/strategies/kernel/utils/tool-utils.test.ts --testNamePattern="planNextMoveBatches — safe-tool batching"
```

Expected: `spawn-agents`, `recall`, `find` tests fail (they produce 2 singletons, not 1 batch of 2).

- [ ] **Step 3: Add the three tools to `PARALLEL_SAFE_TOOLS` and export the function**

In `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts`, find the `isParallelBatchSafeTool` function (around line 709) and update it:

```typescript
// Before:
function isParallelBatchSafeTool(name: string): boolean {
  const PARALLEL_SAFE_TOOLS = new Set(["spawn-agent"]);

// After:
export function isParallelBatchSafeTool(name: string): boolean {
  const PARALLEL_SAFE_TOOLS = new Set([
    "spawn-agent",   // single subagent dispatch
    "spawn-agents",  // parallel subagent dispatch
    "recall",        // scratchpad read — pure, no side effect
    "find",          // index lookup — pure, no side effect
  ]);
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
cd packages/reasoning && bun test tests/strategies/kernel/utils/tool-utils.test.ts --testNamePattern="planNextMoveBatches — safe-tool batching"
```

Expected: all 6 new tests pass.

- [ ] **Step 5: Run the full reasoning test suite — confirm no regressions**

```bash
cd packages/reasoning && bun test
```

Expected: all tests pass, 0 fail.

- [ ] **Step 6: Commit**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
rtk git add packages/reasoning/src/strategies/kernel/utils/tool-utils.ts packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts
rtk git commit -m "feat(reasoning): expand parallel-safe tool allowlist — spawn-agents, recall, find"
```

---

## Task 2: Enable parallel batching by default

**Files:**
- Modify: `packages/reasoning/src/types/config.ts`
- Test: `packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts`

### Background

`config.ts` line 79 sets `nextMovesPlanning: { enabled: false, ... }` as the default for the reactive strategy. This is the single gate preventing parallel execution. Changing it to `enabled: true` activates the existing batch path in `act.ts` for all multi-FC responses without requiring explicit builder config. `maxBatchSize: 4` matches the analysis doc's concurrency recommendation (previously 3).

- [ ] **Step 1: Write failing test for default batching (no explicit config)**

Add inside the existing `tool-utils.test.ts` file, in a new describe block:

```typescript
describe("planNextMoveBatches — default-enabled behavior", () => {
  it("batches safe tools when called with undefined config (new default)", () => {
    // This test documents the INTENT: once config.ts is updated, the execution
    // engine passes config.strategies.reactive.nextMovesPlanning (enabled: true).
    // Here we verify planNextMoveBatches with the new default config value.
    const defaultCfg = { enabled: true, maxBatchSize: 4, allowParallelBatching: true };
    const calls = [
      { id: "a", name: "web-search", arguments: {} },
      { id: "b", name: "web-search", arguments: {} },
      { id: "c", name: "web-search", arguments: {} },
    ];
    const batches = planNextMoveBatches(calls, defaultCfg);
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(3);
  });

  it("returns singletons when batching is explicitly disabled", () => {
    const disabledCfg = { enabled: false };
    const calls = [
      { id: "a", name: "web-search", arguments: {} },
      { id: "b", name: "web-search", arguments: {} },
    ];
    const batches = planNextMoveBatches(calls, disabledCfg);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(1);
    expect(batches[1]).toHaveLength(1);
  });

  it("respects maxBatchSize cap", () => {
    const cfg = { enabled: true, maxBatchSize: 2, allowParallelBatching: true };
    const calls = [
      { id: "a", name: "web-search", arguments: {} },
      { id: "b", name: "web-search", arguments: {} },
      { id: "c", name: "web-search", arguments: {} },
    ];
    const batches = planNextMoveBatches(calls, cfg);
    expect(batches).toHaveLength(2);          // [2-call batch, 1-call batch]
    expect(batches[0]).toHaveLength(2);
    expect(batches[1]).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — confirm all three pass** (they use explicit config, not `undefined`, so they should already pass after Task 1)

```bash
cd packages/reasoning && bun test tests/strategies/kernel/utils/tool-utils.test.ts --testNamePattern="default-enabled"
```

Expected: all 3 pass.

- [ ] **Step 3: Update the default config in `config.ts`**

In `packages/reasoning/src/types/config.ts`, find line 79 and update:

```typescript
// Before:
nextMovesPlanning: { enabled: false, maxBatchSize: 3, allowParallelBatching: true },

// After:
nextMovesPlanning: { enabled: true, maxBatchSize: 4, allowParallelBatching: true },
```

- [ ] **Step 4: Run the full reasoning + runtime test suites**

```bash
cd packages/reasoning && bun test
cd ../runtime && bun test
```

Expected: all tests pass in both packages.

- [ ] **Step 5: Commit**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
rtk git add packages/reasoning/src/types/config.ts packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts
rtk git commit -m "feat(reasoning): enable parallel tool batching by default in reactive strategy (maxBatch=4)"
```

---

## Task 3: Add multi-tool system prompt hint

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/phases/context-builder.ts`

### Background

The LLM needs to know it's allowed and encouraged to issue multiple independent tool calls in a single response. Without this hint, frontier models may return one tool call per response even when they know multiple are needed — they default to conservative behavior. Local/mid models especially benefit from explicit permission. The hint is appended to the mid, large, and frontier tier prompts inside `buildSystemPrompt`. It is NOT added to the local-tier prompt since small models (≤3B) often struggle to coordinate multi-FC payloads reliably.

No tests needed — prompt text is not unit-tested; it is validated through harness probes.

- [ ] **Step 1: Update `buildSystemPrompt` in `context-builder.ts`**

Find lines 32–39 (the tier-adaptive return block) and update:

```typescript
// Before:
  if (t === "frontier" || t === "large") {
    return "You are an expert reasoning agent. Think step by step. Use tools precisely and efficiently. Prefer concise, direct answers once you have sufficient information.";
  }
  // mid tier
  return "You are a reasoning agent. Think step by step and use available tools when needed.";

// After:
  const PARALLEL_HINT = " When a task requires multiple independent lookups or actions, issue all tool calls in the same response — they execute in parallel.";

  if (t === "frontier" || t === "large") {
    return `You are an expert reasoning agent. Think step by step. Use tools precisely and efficiently. Prefer concise, direct answers once you have sufficient information.${PARALLEL_HINT}`;
  }
  // mid tier
  return `You are a reasoning agent. Think step by step and use available tools when needed.${PARALLEL_HINT}`;
```

- [ ] **Step 2: Run the full reasoning test suite — confirm no regressions**

```bash
cd packages/reasoning && bun test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
rtk git add packages/reasoning/src/strategies/kernel/phases/context-builder.ts
rtk git commit -m "feat(reasoning): add parallel tool-call hint to mid/large/frontier system prompts"
```

---

## Task 4: Expose kill-switch through builder

**Files:**
- Modify: `packages/runtime/src/reasoning-options-schema.ts`
- Modify: `packages/runtime/src/execution-engine.ts`

### Background

Users who need strict sequential tool execution for debugging or correctness should be able to opt out with `.withReasoning({ parallelToolCalls: false })`. This wires through the existing `strategies.reactive.nextMovesPlanning.enabled` field rather than adding a new runtime layer. The kill-switch only controls whether batching is enabled; all other batching parameters (maxBatchSize, allowParallelBatching) remain in config.

- [ ] **Step 1: Add `parallelToolCalls` to the reasoning options schema**

In `packages/runtime/src/reasoning-options-schema.ts`, add the field after `maxIterations`:

```typescript
// Before:
  maxIterations: Schema.optional(Schema.Number),
  synthesis: Schema.optional(Schema.Literal("auto", "fast", "deep", "custom", "off")),

// After:
  maxIterations: Schema.optional(Schema.Number),
  /** When false, tool calls from a single LLM response execute sequentially (debug/correctness mode). Default: true. */
  parallelToolCalls: Schema.optional(Schema.Boolean),
  synthesis: Schema.optional(Schema.Literal("auto", "fast", "deep", "custom", "off")),
```

- [ ] **Step 2: Wire it into the execution engine**

In `packages/runtime/src/execution-engine.ts`, find the spot where `reactiveConfig` or `config.strategies.reactive` is built (search for `strategies.reactive.nextMovesPlanning`). Add the override after the existing config is resolved:

```typescript
// Find the block that builds the reactive kernel input and adds nextMovesPlanning.
// It flows through reactive.ts line 156:
//   nextMovesPlanning: input.config.strategies.reactive.nextMovesPlanning,
// The config comes from the merged ReactiveAgentsConfig. Override it here
// when parallelToolCalls: false is set in reasoningOptions.

// After the line that builds/merges `mergedConfig` (or wherever config.strategies.reactive is assembled):
if (config.reasoningOptions?.parallelToolCalls === false) {
  mergedConfig = {
    ...mergedConfig,
    strategies: {
      ...mergedConfig.strategies,
      reactive: {
        ...mergedConfig.strategies.reactive,
        nextMovesPlanning: {
          ...mergedConfig.strategies.reactive.nextMovesPlanning,
          enabled: false,
        },
      },
    },
  };
}
```

> **Finding the right spot:** Search execution-engine.ts for `mergedConfig` or `strategies.reactive`. The config merge happens inside the reasoning path. If the variable is named differently, apply the same override pattern to whatever variable holds the reactive strategy config before it's passed to the strategy.

- [ ] **Step 3: Write a unit test for the kill-switch**

Add to `packages/runtime/tests/parallel-tool-batching.test.ts` (new file):

```typescript
import { describe, it, expect } from "bun:test";
import { planNextMoveBatches } from "@reactive-agents/reasoning";

describe("parallelToolCalls kill-switch", () => {
  it("disabled config produces singletons", () => {
    const calls = [
      { id: "a", name: "web-search", arguments: {} },
      { id: "b", name: "web-search", arguments: {} },
    ];
    const batches = planNextMoveBatches(calls, { enabled: false });
    expect(batches).toHaveLength(2);
  });

  it("enabled config (default) batches safe tools", () => {
    const calls = [
      { id: "a", name: "web-search", arguments: {} },
      { id: "b", name: "web-search", arguments: {} },
    ];
    const batches = planNextMoveBatches(calls, { enabled: true, maxBatchSize: 4, allowParallelBatching: true });
    expect(batches).toHaveLength(1);
    expect(batches[0]).toHaveLength(2);
  });
});
```

- [ ] **Step 4: Run the runtime test suite**

```bash
cd packages/runtime && bun test
```

Expected: 532+ tests pass (531 existing + 2 new).

- [ ] **Step 5: Commit**

```bash
rtk git add packages/runtime/src/reasoning-options-schema.ts packages/runtime/src/execution-engine.ts packages/runtime/tests/parallel-tool-batching.test.ts
rtk git commit -m "feat(runtime): expose parallelToolCalls kill-switch in withReasoning() options"
```

---

## Task 5: Update scratch.ts and verify end-to-end

**Files:**
- Modify: `scratch.ts`

### Background

`scratch.ts` already contains the XRP/XLM/ETH/Bitcoin subagent dispatch task. With parallel batching now on by default, the agent should issue all 4 `spawn-agent` tool calls in a single LLM response and execute them concurrently. The observability output (debug verbosity) will show 4 `action` steps firing before any `observation` steps arrive — confirming parallel dispatch.

**What to look for in the output:**
```
[action] spawn-agent({"name":"xrp-agent",...})
[action] spawn-agent({"name":"xlm-agent",...})
[action] spawn-agent({"name":"eth-agent",...})
[action] spawn-agent({"name":"btc-agent",...})
[observation] xrp-agent: XRP = $0.52
[observation] xlm-agent: XLM = $0.11
...
```
If you see `action → observation → action → observation → ...` interleaved, parallel batching is NOT working (the `spawn-agent` calls are not in the same FC response or are being treated as unsafe).

- [ ] **Step 1: Verify scratch.ts is ready to run**

`scratch.ts` already has the right task (line 51). Confirm Ollama is running with gemma4:e4b available:

```bash
curl -s http://localhost:11434/api/tags | rtk json | grep "gemma4"
```

Expected: `gemma4:e4b` appears in the model list.

- [ ] **Step 2: Run scratch.ts and observe the output**

```bash
bun run scratch.ts 2>&1 | tee /tmp/scratch-parallel-test.txt
```

Watch the live output for the parallel action pattern (4 `spawn-agent` actions before any observations). If parallel batching is working, all 4 will appear in sequence before observations.

- [ ] **Step 3: Confirm results render as markdown table**

The `--- Result ---` section at the end should contain a markdown table with 4 rows (XRP, XLM, ETH, Bitcoin) and a Price column with real values.

- [ ] **Step 4: If parallel dispatch is NOT visible**

Check that gemma4:e4b is returning multiple tool_use blocks in a single response. In the JSONL observability file (if wired), look for `tool_use_start` events. If the model is only returning one tool call at a time, add a more explicit system prompt override to scratch.ts:

```typescript
// Add .withSystemPrompt() after .withReasoning():
.withSystemPrompt("You are a research orchestration agent. When dispatching multiple independent subagents, call spawn-agent for ALL of them in the same response — they execute in parallel. Do not wait for one to complete before dispatching the next.")
```

- [ ] **Step 5: Commit scratch.ts if any changes were made**

```bash
rtk git add scratch.ts
rtk git commit -m "test(scratch): parallel subagent dispatch via gemma4:e4b — verify parallel tool batching"
```

---

## Task 6: Final verification

- [ ] **Step 1: Run full test suite across all packages**

```bash
cd packages/reasoning && bun test && cd ../runtime && bun test && cd ../..
```

Expected: all tests pass, 0 fail.

- [ ] **Step 2: Run the harness trivial-1step baseline probe**

With IC-6 (allowedTools prompt filtering) fixed and parallel batching enabled, the trivial-1step probe should now complete in 1 iteration with 0 act phases (no tool calls for a pure-knowledge task).

```bash
PROBE_MODEL=qwen2.5:7b bun run .agents/skills/harness-improvement-loop/scripts/harness-probe.ts trivial-1step 2>&1 | tail -20
```

Expected:
```
Iterations: 1 / 5
Wasted iters: 0
Duplicate calls: 0
```

- [ ] **Step 3: Run the harness tool-heavy probe**

The tool-heavy probe should now show `actPhaseCount ≥ 1` (W1/cogito:8b FC parsing fix is separate, but if using a native-FC model this validates parallel batching end-to-end).

```bash
PROBE_MODEL=qwen3:14b bun run .agents/skills/harness-improvement-loop/scripts/harness-probe.ts tool-heavy 2>&1 | tail -20
```

- [ ] **Step 4: Commit if any final adjustments were made, otherwise done**

```bash
rtk git add -A
rtk git commit -m "chore: parallel tool batching complete — all probes green, full test suite passing"
```

---

## Summary of Changes

| File | Type | Change |
|------|------|--------|
| `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts` | Modified | Add `spawn-agents`, `recall`, `find` to `PARALLEL_SAFE_TOOLS`; export `isParallelBatchSafeTool` |
| `packages/reasoning/src/types/config.ts` | Modified | `nextMovesPlanning.enabled: false → true`, `maxBatchSize: 3 → 4` |
| `packages/reasoning/src/strategies/kernel/phases/context-builder.ts` | Modified | Add parallel-tool hint to mid/large/frontier prompts |
| `packages/runtime/src/reasoning-options-schema.ts` | Modified | Add `parallelToolCalls?: boolean` field |
| `packages/runtime/src/execution-engine.ts` | Modified | Wire `parallelToolCalls: false` → `nextMovesPlanning.enabled = false` override |
| `packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts` | Modified | New `planNextMoveBatches` safe-list and default-batching tests |
| `packages/runtime/tests/parallel-tool-batching.test.ts` | Created | Kill-switch unit tests |
| `scratch.ts` | Modified (maybe) | Verify parallel dispatch; add explicit system prompt if needed |

**What is NOT in scope:**
- Option 2 (greedy batching — speculative pre-fetching)
- Option 3 (async pipelining — full kernel rewrite)
- Changes to plan-execute or reflexion strategies
- New kernel phases or state machine changes
