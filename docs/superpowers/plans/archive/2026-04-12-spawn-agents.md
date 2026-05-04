# spawn-agents: Parallel Sub-Agent Dispatch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `spawn-agents` batch tool that dispatches N sub-agents in parallel with one LLM tool call, and fix `isParallelBatchSafeTool` so the kernel batches multiple `spawn-agent` calls when the LLM emits them together.

**Architecture:** Three packages change. `packages/tools` gets a new `createSpawnAgentsTool()` definition. `packages/reasoning` gets a one-line safety-filter fix. `packages/runtime` extracts the shared sub-agent execution logic from `spawnHandler` into `buildSingleSubAgentTask`, then adds `spawnAgentsHandler` and registers it alongside `spawn-agent` in `withDynamicSubAgents`.

**Tech Stack:** Effect-TS (`Effect.all`, `Effect.either`, `Effect.tryPromise`), Bun test, TypeScript

---

## File Map

| File | Change |
|------|--------|
| `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts` | Add `PARALLEL_SAFE_TOOLS` set; check before existing pattern logic in `isParallelBatchSafeTool` |
| `packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts` | Add test: `spawn-agent` batches with other `spawn-agent` calls |
| `packages/tools/src/adapters/agent-tool-adapter.ts` | Add `createSpawnAgentsTool()` after `createSpawnAgentTool` |
| `packages/tools/src/index.ts` (or barrel) | Export `createSpawnAgentsTool` |
| `packages/tools/tests/agent-tool-adapter.test.ts` | Add `createSpawnAgentsTool` schema tests |
| `packages/runtime/src/builder.ts` | Extract `buildSingleSubAgentTask`; add `SubAgentTaskArgs` + `SubAgentCallResult` types; add `spawnAgentsHandler`; register in `withDynamicSubAgents` block |
| `packages/runtime/tests/spawn-agents.test.ts` | New file: builder integration tests |

---

## Task 1: Fix `isParallelBatchSafeTool` — `spawn-agent` is batch-safe

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts:709`
- Test: `packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts`

- [ ] **Step 1: Write the failing test**

Open `packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts`. Find the `describe("planNextMoveBatches"` block (around line 250). Add this test inside it:

```ts
it("batches multiple spawn-agent calls together as parallel-safe", () => {
  const calls = [
    { id: "1", name: "spawn-agent" },
    { id: "2", name: "spawn-agent" },
    { id: "3", name: "spawn-agent" },
  ];
  const batches = planNextMoveBatches(calls, { enabled: true, maxBatchSize: 5 });
  expect(batches.length).toBe(1);
  expect(batches[0]!.length).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
rtk vitest run packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts
```

Expected: FAIL — `expect(batches.length).toBe(1)` fails because `spawn-agent` is not recognized as safe, so each call gets its own singleton batch (length 3).

- [ ] **Step 3: Apply the fix**

In `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts`, find `isParallelBatchSafeTool` at line 709. Add the following as the **first two lines** of the function body, before `const lowered = name.toLowerCase()`:

```ts
// Explicitly safe tools — dispatching multiple in parallel is always correct.
const PARALLEL_SAFE_TOOLS = new Set(["spawn-agent"]);
if (PARALLEL_SAFE_TOOLS.has(name)) return true;
```

The function should now open:

```ts
function isParallelBatchSafeTool(name: string): boolean {
  // Explicitly safe tools — dispatching multiple in parallel is always correct.
  const PARALLEL_SAFE_TOOLS = new Set(["spawn-agent"]);
  if (PARALLEL_SAFE_TOOLS.has(name)) return true;

  const lowered = name.toLowerCase();
  // ... rest unchanged
```

- [ ] **Step 4: Run test to verify it passes**

```bash
rtk vitest run packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts
```

Expected: PASS

- [ ] **Step 5: Run full reasoning suite to catch regressions**

```bash
rtk vitest run packages/reasoning
```

Expected: all tests pass (784+)

- [ ] **Step 6: Commit**

```bash
rtk git add packages/reasoning/src/strategies/kernel/utils/tool-utils.ts \
            packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts
rtk git commit -m "fix(reasoning): mark spawn-agent as parallel-batch-safe tool"
```

---

## Task 2: Add `createSpawnAgentsTool` definition

**Files:**
- Modify: `packages/tools/src/adapters/agent-tool-adapter.ts` (after `createSpawnAgentTool` at line ~415)
- Modify: `packages/tools/src/index.ts` (or wherever `createSpawnAgentTool` is exported — grep for it)
- Test: `packages/tools/tests/agent-tool-adapter.test.ts`

- [ ] **Step 1: Write the failing tests**

Open `packages/tools/tests/agent-tool-adapter.test.ts`. Add this import at the top alongside the existing imports:

```ts
import {
  createAgentTool,
  createRemoteAgentTool,
  createSpawnAgentsTool,   // ← add
  executeAgentTool,
  executeRemoteAgentTool,
  MAX_RECURSION_DEPTH,
  type RemoteAgentClient,
} from "../src/adapters/agent-tool-adapter.js";
```

Add this new `describe` block at the end of the file:

```ts
describe("createSpawnAgentsTool", () => {
  it("has name spawn-agents", () => {
    expect(createSpawnAgentsTool().name).toBe("spawn-agents");
  });

  it("has required tasks array parameter", () => {
    const tool = createSpawnAgentsTool();
    const param = tool.parameters.find((p) => p.name === "tasks");
    expect(param).toBeDefined();
    expect(param!.required).toBe(true);
    expect(param!.type).toBe("array");
  });

  it("has optional failFast boolean defaulting to false", () => {
    const tool = createSpawnAgentsTool();
    const param = tool.parameters.find((p) => p.name === "failFast");
    expect(param).toBeDefined();
    expect(param!.required).toBe(false);
    expect(param!.default).toBe(false);
  });

  it("has optional maxConcurrency number parameter", () => {
    const tool = createSpawnAgentsTool();
    const param = tool.parameters.find((p) => p.name === "maxConcurrency");
    expect(param).toBeDefined();
    expect(param!.required).toBe(false);
    expect(param!.type).toBe("number");
  });

  it("description explains when to use vs spawn-agent", () => {
    const tool = createSpawnAgentsTool();
    expect(tool.description).toContain("independent");
    expect(tool.description).toContain("spawn-agent");
  });

  it("has 300s timeout to cover N parallel agents", () => {
    expect(createSpawnAgentsTool().timeoutMs).toBe(300_000);
  });

  it("has medium riskLevel and no approval required", () => {
    const tool = createSpawnAgentsTool();
    expect(tool.riskLevel).toBe("medium");
    expect(tool.requiresApproval).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
rtk vitest run packages/tools/tests/agent-tool-adapter.test.ts
```

Expected: FAIL — `createSpawnAgentsTool is not a function` (not exported yet)

- [ ] **Step 3: Implement `createSpawnAgentsTool`**

In `packages/tools/src/adapters/agent-tool-adapter.ts`, add the following **directly after** `createSpawnAgentTool` (line ~415):

```ts
/**
 * Create the `spawn-agents` tool definition used when `.withDynamicSubAgents()`
 * is enabled. Dispatches N sub-agents in parallel with a single tool call.
 * The handler is registered by the builder alongside `spawn-agent`.
 */
export const createSpawnAgentsTool = (): ToolDefinition => ({
  name: "spawn-agents",
  description:
    "Dispatch multiple sub-agents in parallel with a single tool call. Each sub-agent " +
    "runs independently and simultaneously — use this when tasks have NO dependencies " +
    "on each other's results. " +
    "\n\nUse `spawn-agent` (singular) instead when: " +
    "(1) spawning exactly one sub-agent, or " +
    "(2) tasks are sequential — task B needs task A's output as input. " +
    "\n\nEach task description must be fully self-contained. Sub-agents start with a " +
    "fresh context window and zero knowledge of your conversation. Include all specific " +
    "values: URLs, IDs, file paths, usernames, dates, phone numbers. Never say 'the repo' " +
    "— say 'github.com/owner/repo'. Never say 'the user' — say 'user@example.com'. " +
    "\n\nSet `failFast: true` for all-or-nothing workflows (e.g., deployment steps). " +
    "Set `maxConcurrency` when tasks call rate-limited APIs (e.g., 3 for GitHub API).",
  parameters: [
    {
      name: "tasks",
      type: "array" as const,
      description:
        "Array of sub-agent task descriptors to run in parallel. Each element: " +
        "{ task: string (required, fully self-contained), " +
        "name: string (required, kebab-case, e.g. 'commit-summarizer'), " +
        "role?: string (e.g. 'researcher'), " +
        "instructions?: string (behavioral guidance), " +
        "tone?: string (e.g. 'concise'), " +
        "tools?: string[] (whitelist of tool names — omit for all parent tools) }",
      required: true,
    },
    {
      name: "failFast",
      type: "boolean" as const,
      description:
        "When true: abort all remaining agents on first failure (all-or-nothing). " +
        "When false (default): run all agents to completion and return partial results " +
        "— succeeded agents return output, failed agents return error message.",
      required: false,
      default: false,
    },
    {
      name: "maxConcurrency",
      type: "number" as const,
      description:
        "Maximum number of agents running simultaneously. Default: all tasks run at once. " +
        "Cap this when tasks call rate-limited APIs — e.g., set to 3 for GitHub API tasks.",
      required: false,
    },
  ],
  returnType: "object" as const,
  category: "custom" as const,
  riskLevel: "medium" as const,
  timeoutMs: 300_000, // 5 min — N agents in parallel; multiply spawn-agent's 2 min by headroom
  requiresApproval: false,
  source: "function" as const,
});
```

- [ ] **Step 4: Export `createSpawnAgentsTool`**

Find where `createSpawnAgentTool` is exported from the tools package (run `grep -r "createSpawnAgentTool" packages/tools/src/index.ts` or check the barrel). Add `createSpawnAgentsTool` to the same export statement.

```bash
rtk grep "createSpawnAgentTool" packages/tools/src/index.ts
```

Add `createSpawnAgentsTool` alongside `createSpawnAgentTool` in that export line.

- [ ] **Step 5: Run tests to verify they pass**

```bash
rtk vitest run packages/tools/tests/agent-tool-adapter.test.ts
```

Expected: PASS for all `createSpawnAgentsTool` tests

- [ ] **Step 6: Run full tools suite**

```bash
rtk vitest run packages/tools
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
rtk git add packages/tools/src/adapters/agent-tool-adapter.ts \
            packages/tools/src/index.ts \
            packages/tools/tests/agent-tool-adapter.test.ts
rtk git commit -m "feat(tools): add createSpawnAgentsTool definition for parallel sub-agent dispatch"
```

---

## Task 3: Extract `buildSingleSubAgentTask` helper in builder.ts

This is a refactor with no new behaviour — extract the body of `spawnHandler` into a reusable inner function so `spawnAgentsHandler` can call it without duplication.

**Files:**
- Modify: `packages/runtime/src/builder.ts` (inside `buildEffect`, around lines 2878–3159)

- [ ] **Step 1: Add `SubAgentTaskArgs` and `SubAgentCallResult` types**

Directly before `const deriveSubAgentName` (line 2878 inside `buildEffect`), insert:

```ts
/** Per-task arguments for a single sub-agent dispatch. */
type SubAgentTaskArgs = {
  task: string;
  name: string;
  role?: string;
  instructions?: string;
  tone?: string;
  tools?: string[];
};

/** Result returned by a single sub-agent execution. */
type SubAgentCallResult = {
  name: string;
  output: string;
  success: boolean;
  tokensUsed: number;
  stepsCompleted: number;
  delegatedToolsUsed?: string[];
};
```

- [ ] **Step 2: Extract `buildSingleSubAgentTask`**

After `deriveSubAgentName` (line ~2886) and before `spawnHandler` (line 2895), insert:

```ts
/**
 * Build and execute a single sub-agent task.
 * Shared by spawnHandler (singular) and spawnAgentsHandler (batch).
 */
const buildSingleSubAgentTask = async (t: SubAgentTaskArgs): Promise<SubAgentCallResult> => {
  const executor = toolsMod.createSubAgentExecutor(
    {
      name: t.name,
      provider: parentProvider,
      model: parentModel,
      maxIterations: defaultMaxIter,
      tools: t.tools && t.tools.length > 0 ? t.tools : undefined,
      persona:
        t.role || t.instructions || t.tone
          ? { role: t.role, instructions: t.instructions, tone: t.tone }
          : undefined,
    },
    // ── executeFn: identical to the one currently inline in spawnHandler ──
    // (copy the full async (opts) => { ... } body from spawnHandler here)
    async (opts) => {
      /* PASTE the full executeFn body from the existing spawnHandler here.
         It starts with:
           const _taskPreview = opts.task.length > 80 ? ...
         and ends with:
           return { output: ..., success: ..., tokensUsed: ..., stepsCompleted: ..., delegatedToolsUsed: ... };
      */
    },
    0,
    getParentContext,
  );

  const result = await executor(t.task);
  return { name: t.name, ...result };
};
```

**Important:** The comment block above is a placeholder to show structure. The actual step is to physically move the `async (opts) => { ... }` function body (currently at lines ~2933–3154 inside `spawnHandler`) into `buildSingleSubAgentTask`'s `executeFn` argument. Do not retype it — cut and paste.

- [ ] **Step 3: Rewrite `spawnHandler` to delegate to `buildSingleSubAgentTask`**

Replace the current `spawnHandler` (lines 2895–3157) with this slimmed-down version:

```ts
const spawnHandler = (args: Record<string, unknown>) =>
  Effect.tryPromise({
    try: async () => {
      const task =
        typeof args.task === "string"
          ? args.task
          : JSON.stringify(args.task ?? "");
      const subName =
        typeof args.name === "string" && args.name.trim().length > 0
          ? args.name.trim()
          : deriveSubAgentName(task);
      return buildSingleSubAgentTask({
        task,
        name: subName,
        role: typeof args.role === "string" ? args.role : undefined,
        instructions:
          typeof args.instructions === "string" ? args.instructions : undefined,
        tone: typeof args.tone === "string" ? args.tone : undefined,
        tools: Array.isArray(args.tools)
          ? (args.tools as unknown[]).filter(
              (x): x is string => typeof x === "string",
            )
          : undefined,
      });
    },
    catch: (e) => new Error(String(e)),
  });
```

- [ ] **Step 4: Run full runtime suite to confirm no regression**

```bash
rtk vitest run packages/runtime
```

Expected: all tests pass (599+). If any test fails, the `executeFn` body was not copied faithfully — diff against the original.

- [ ] **Step 5: Commit**

```bash
rtk git add packages/runtime/src/builder.ts
rtk git commit -m "refactor(runtime): extract buildSingleSubAgentTask helper from spawnHandler"
```

---

## Task 4: Implement `spawnAgentsHandler` and wire registration

**Files:**
- Modify: `packages/runtime/src/builder.ts`
- Create: `packages/runtime/tests/spawn-agents.test.ts`

- [ ] **Step 1: Write failing tests**

Create `packages/runtime/tests/spawn-agents.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { ReactiveAgents } from "../src/index.js";

describe("spawn-agents — registration", () => {
  it("withDynamicSubAgents() registers spawn-agents tool (agent builds)", async () => {
    const agent = await ReactiveAgents.create()
      .withName("parallel-dispatch-test")
      .withProvider("test")
      .withDynamicSubAgents({ maxIterations: 3 })
      .withTestScenario([{ text: "Done." }])
      .build();

    expect(agent).toBeDefined();
    expect(agent.agentId).toContain("parallel-dispatch-test");
    await agent.dispose();
  });

  it("withDynamicSubAgents() without spawn-agents still registers (no regression)", async () => {
    // Verify existing spawn-agent still works after refactor
    const agent = await ReactiveAgents.create()
      .withName("single-spawn-regression")
      .withProvider("test")
      .withDynamicSubAgents()
      .withTestScenario([{ text: "Done." }])
      .build();

    expect(agent).toBeDefined();
    await agent.dispose();
  });

  it("spawn-agents tool has correct name via createSpawnAgentsTool()", async () => {
    // Verify the tool definition itself (redundant with tools package test but confirms wiring)
    const { createSpawnAgentsTool } = await import("@reactive-agents/tools");
    expect(createSpawnAgentsTool().name).toBe("spawn-agents");
  });
});

describe("spawn-agents — failFast flag defaults", () => {
  it("spawn-agents tool has failFast parameter defaulting to false", async () => {
    const { createSpawnAgentsTool } = await import("@reactive-agents/tools");
    const tool = createSpawnAgentsTool();
    const param = tool.parameters.find((p) => p.name === "failFast");
    expect(param?.default).toBe(false);
  });

  it("spawn-agents tool tasks parameter is required array", async () => {
    const { createSpawnAgentsTool } = await import("@reactive-agents/tools");
    const tool = createSpawnAgentsTool();
    const param = tool.parameters.find((p) => p.name === "tasks");
    expect(param?.required).toBe(true);
    expect(param?.type).toBe("array");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
rtk vitest run packages/runtime/tests/spawn-agents.test.ts
```

Expected: the `spawn-agents tool has correct name` test passes (definition already done), but the builder tests may fail if `spawn-agents` isn't yet registered. All should at minimum pass after Task 4 Step 3.

- [ ] **Step 3: Implement `spawnAgentsHandler`**

In `packages/runtime/src/builder.ts`, add the following **directly after `spawnHandler`** (after line 3157, before `registrations.push`):

```ts
const spawnAgentsHandler = (args: Record<string, unknown>) =>
  Effect.tryPromise({
    try: async () => {
      const rawTasks = Array.isArray(args.tasks) ? (args.tasks as unknown[]) : [];
      const failFast = args.failFast === true;
      const maxConcurrency =
        typeof args.maxConcurrency === "number"
          ? Math.max(1, args.maxConcurrency)
          : rawTasks.length;

      const taskArgs: SubAgentTaskArgs[] = rawTasks.map((t) => {
        const obj = t as Record<string, unknown>;
        const task = typeof obj.task === "string" ? obj.task : "";
        const rawName =
          typeof obj.name === "string" ? obj.name.trim() : "";
        return {
          task,
          name: rawName.length > 0 ? rawName : deriveSubAgentName(task),
          role: typeof obj.role === "string" ? obj.role : undefined,
          instructions:
            typeof obj.instructions === "string" ? obj.instructions : undefined,
          tone: typeof obj.tone === "string" ? obj.tone : undefined,
          tools: Array.isArray(obj.tools)
            ? (obj.tools as unknown[]).filter(
                (x): x is string => typeof x === "string",
              )
            : undefined,
        };
      });

      if (failFast) {
        // Strict: first failure aborts the rest
        const results = await Effect.runPromise(
          Effect.all(
            taskArgs.map((t) =>
              Effect.tryPromise({
                try: () => buildSingleSubAgentTask(t),
                catch: (e) => new Error(String(e)),
              }),
            ),
            { concurrency: maxConcurrency },
          ),
        );
        return {
          results,
          summary: {
            total: results.length,
            succeeded: results.filter((r) => r.success).length,
            failed: results.filter((r) => !r.success).length,
          },
        };
      }

      // Default: partial results — wrap each in Either so one failure doesn't abort others
      const eithers = await Effect.runPromise(
        Effect.all(
          taskArgs.map((t) =>
            Effect.tryPromise({
              try: () => buildSingleSubAgentTask(t),
              catch: (e) => new Error(String(e)),
            }).pipe(Effect.either),
          ),
          { concurrency: maxConcurrency },
        ),
      );

      const results: SubAgentCallResult[] = eithers.map((either, i) => {
        if (either._tag === "Right") return either.right;
        return {
          name: taskArgs[i]!.name,
          output: either.left.message,
          success: false,
          tokensUsed: 0,
          stepsCompleted: 0,
        };
      });

      return {
        results,
        summary: {
          total: results.length,
          succeeded: results.filter((r) => r.success).length,
          failed: results.filter((r) => !r.success).length,
        },
      };
    },
    catch: (e) => new Error(String(e)),
  });
```

- [ ] **Step 4: Register `spawn-agents` alongside `spawn-agent`**

Find the registration line (currently line 3159):

```ts
registrations.push({ def: spawnToolDef, handler: spawnHandler });
```

Add the `spawn-agents` registration immediately after it:

```ts
registrations.push({ def: spawnToolDef, handler: spawnHandler });

const spawnAgentsToolDef = toolsMod.createSpawnAgentsTool();
registrations.push({ def: spawnAgentsToolDef, handler: spawnAgentsHandler });
```

- [ ] **Step 5: Run spawn-agents tests**

```bash
rtk vitest run packages/runtime/tests/spawn-agents.test.ts
```

Expected: all tests pass

- [ ] **Step 6: Run full runtime suite**

```bash
rtk vitest run packages/runtime
```

Expected: all tests pass (599+)

- [ ] **Step 7: Commit**

```bash
rtk git add packages/runtime/src/builder.ts \
            packages/runtime/tests/spawn-agents.test.ts
rtk git commit -m "feat(runtime): add spawn-agents parallel sub-agent dispatch tool"
```

---

## Task 5: Full monorepo verification

- [ ] **Step 1: Run all three changed packages**

```bash
rtk vitest run packages/reasoning && rtk vitest run packages/tools && rtk vitest run packages/runtime
```

Expected: all pass, zero failures

- [ ] **Step 2: TypeScript build check**

```bash
rtk tsc
```

Expected: zero errors. If errors appear, the most likely cause is `SubAgentTaskArgs` or `SubAgentCallResult` not in scope at the `spawnAgentsHandler` site — check they are defined inside `buildEffect` before `spawnAgentsHandler`.

- [ ] **Step 3: Final commit (if any fixups needed)**

```bash
rtk git add -p
rtk git commit -m "fix(runtime): typescript cleanup for spawn-agents types"
```

---

## Quick Reference: Key Locations

| What | Where |
|------|-------|
| `isParallelBatchSafeTool` to fix | `packages/reasoning/src/strategies/kernel/utils/tool-utils.ts:709` |
| `planNextMoveBatches` test block | `packages/reasoning/tests/strategies/kernel/utils/tool-utils.test.ts:~250` |
| `createSpawnAgentTool` (reference) | `packages/tools/src/adapters/agent-tool-adapter.ts:~350` |
| Add `createSpawnAgentsTool` after | `packages/tools/src/adapters/agent-tool-adapter.ts:~415` |
| `agent-tool-adapter` test file | `packages/tools/tests/agent-tool-adapter.test.ts` |
| `deriveSubAgentName` (insert types before) | `packages/runtime/src/builder.ts:2878` |
| `spawnHandler` ends, registration | `packages/runtime/src/builder.ts:3157–3159` |
| `withDynamicSubAgents` flag | `packages/runtime/src/builder.ts:1046` |
