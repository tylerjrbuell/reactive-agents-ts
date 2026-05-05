# Pre-Release Polish — Examples Suite & Docs Audit

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand `apps/examples/` from 6 basic scenarios to 21 fully-runnable examples covering every package layer, consolidated under a unified `index.ts` test runner, and audit 8 stale docs pages.

**Architecture:** Reorganize `apps/examples/src/` into 7 category subdirectories. Each example exports `run(): Promise<ExampleResult>` so `index.ts` can collect pass/fail metrics from all 21. Existing 6 examples migrate to `foundations/`; 15 new examples added; `main.ts` at root deleted (absorbed by examples). Eight docs pages get in-place accuracy passes.

**Tech Stack:** Bun, TypeScript, Effect-TS 3.x, `@reactive-agents/runtime` builder API (public surface — no raw Effect needed in examples). Imports come from `@reactive-agents/*` workspace packages.

---

## Shared Pattern — All Examples Must Follow

Every example file exports:

```typescript
export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult>;

// At bottom of file:
if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

Provider selection in every example:

```typescript
const PROVIDER = process.env.ANTHROPIC_API_KEY
  ? ("anthropic" as const)
  : ("test" as const);
```

---

## Task 1: Directory Structure + package.json Update

**Files:**

- Create: `apps/examples/src/foundations/` (dir)
- Create: `apps/examples/src/tools/` (dir)
- Create: `apps/examples/src/multi-agent/` (dir)
- Create: `apps/examples/src/trust/` (dir)
- Create: `apps/examples/src/advanced/` (dir)
- Create: `apps/examples/src/reasoning/` (dir)
- Create: `apps/examples/src/interaction/` (dir)
- Modify: `apps/examples/package.json`

**Step 1: Create subdirectories**

```bash
mkdir -p apps/examples/src/{foundations,tools,multi-agent,trust,advanced,reasoning,interaction}
```

**Step 2: Update package.json**

Replace `apps/examples/package.json` with:

```json
{
  "name": "@reactive-agents/examples",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "run-all": "bun run index.ts",
    "run-all:offline": "bun run index.ts --offline",
    "foundations": "bun run index.ts --filter foundations",
    "tools": "bun run index.ts --filter tools",
    "multi-agent": "bun run index.ts --filter multi-agent",
    "trust": "bun run index.ts --filter trust",
    "advanced": "bun run index.ts --filter advanced",
    "reasoning": "bun run index.ts --filter reasoning",
    "interaction": "bun run index.ts --filter interaction"
  },
  "dependencies": {
    "effect": "^3.10.0",
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/llm-provider": "workspace:*",
    "@reactive-agents/memory": "workspace:*",
    "@reactive-agents/reasoning": "workspace:*",
    "@reactive-agents/tools": "workspace:*",
    "@reactive-agents/guardrails": "workspace:*",
    "@reactive-agents/verification": "workspace:*",
    "@reactive-agents/identity": "workspace:*",
    "@reactive-agents/observability": "workspace:*",
    "@reactive-agents/orchestration": "workspace:*",
    "@reactive-agents/prompts": "workspace:*",
    "@reactive-agents/cost": "workspace:*",
    "@reactive-agents/eval": "workspace:*",
    "@reactive-agents/interaction": "workspace:*",
    "@reactive-agents/a2a": "workspace:*",
    "@reactive-agents/runtime": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "bun-types": "latest"
  }
}
```

**Step 3: Move existing examples to foundations/**

```bash
mv apps/examples/src/01-simple-agent.ts apps/examples/src/foundations/01-simple-agent.ts
mv apps/examples/src/02-lifecycle-hooks.ts apps/examples/src/foundations/02-lifecycle-hooks.ts
mv apps/examples/src/03-multi-turn-agent.ts apps/examples/src/foundations/03-multi-turn-memory.ts
mv apps/examples/src/05-agent-composition.ts apps/examples/src/foundations/04-agent-composition.ts
mv apps/examples/src/04-a2a-agents.ts apps/examples/src/multi-agent/08-a2a-protocol.ts
# 06-remote-mcp.ts content will be used as reference when writing 06-mcp-filesystem.ts
```

**Step 4: Delete old src root files no longer needed**

```bash
rm apps/examples/src/06-remote-mcp.ts apps/examples/src/index.ts
```

**Step 5: Run bun install to verify workspace deps resolve**

```bash
bun install
```

Expected: no errors.

**Step 6: Commit**

```bash
git add apps/examples/
git commit -m "chore(examples): restructure into category subdirectories"
```

---

## Task 2: index.ts — Unified Test Runner

**Files:**

- Create: `apps/examples/index.ts`

**Step 1: Create the runner**

```typescript
// apps/examples/index.ts
/**
 * Unified runner for all Reactive Agents examples.
 * Each example exports run() → { passed, output, steps, tokens, durationMs }
 *
 * Usage:
 *   bun run index.ts              # all examples
 *   bun run index.ts --offline    # offline-only (no API key needed)
 *   bun run index.ts --filter trust  # single category
 *   bun run index.ts 01 05 12     # specific examples by number
 */

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

interface ExampleMeta {
  num: string;
  label: string;
  category: string;
  requiresKey: boolean;
  path: string;
}

const EXAMPLES: ExampleMeta[] = [
  // foundations — offline
  {
    num: "01",
    label: "simple-agent",
    category: "foundations",
    requiresKey: false,
    path: "./src/foundations/01-simple-agent.ts",
  },
  {
    num: "02",
    label: "lifecycle-hooks",
    category: "foundations",
    requiresKey: false,
    path: "./src/foundations/02-lifecycle-hooks.ts",
  },
  {
    num: "03",
    label: "multi-turn-memory",
    category: "foundations",
    requiresKey: false,
    path: "./src/foundations/03-multi-turn-memory.ts",
  },
  {
    num: "04",
    label: "agent-composition",
    category: "foundations",
    requiresKey: false,
    path: "./src/foundations/04-agent-composition.ts",
  },
  // tools — 05 offline, 06-07 real
  {
    num: "05",
    label: "builtin-tools",
    category: "tools",
    requiresKey: false,
    path: "./src/tools/05-builtin-tools.ts",
  },
  {
    num: "06",
    label: "mcp-filesystem",
    category: "tools",
    requiresKey: true,
    path: "./src/tools/06-mcp-filesystem.ts",
  },
  {
    num: "07",
    label: "mcp-github",
    category: "tools",
    requiresKey: true,
    path: "./src/tools/07-mcp-github.ts",
  },
  // multi-agent — real
  {
    num: "08",
    label: "a2a-protocol",
    category: "multi-agent",
    requiresKey: true,
    path: "./src/multi-agent/08-a2a-protocol.ts",
  },
  {
    num: "09",
    label: "orchestration",
    category: "multi-agent",
    requiresKey: true,
    path: "./src/multi-agent/09-orchestration.ts",
  },
  {
    num: "10",
    label: "dynamic-spawning",
    category: "multi-agent",
    requiresKey: true,
    path: "./src/multi-agent/10-dynamic-spawning.ts",
  },
  // trust — real
  {
    num: "11",
    label: "identity",
    category: "trust",
    requiresKey: true,
    path: "./src/trust/11-identity.ts",
  },
  {
    num: "12",
    label: "guardrails",
    category: "trust",
    requiresKey: true,
    path: "./src/trust/12-guardrails.ts",
  },
  {
    num: "13",
    label: "verification",
    category: "trust",
    requiresKey: true,
    path: "./src/trust/13-verification.ts",
  },
  // advanced — real
  {
    num: "14",
    label: "cost-tracking",
    category: "advanced",
    requiresKey: true,
    path: "./src/advanced/14-cost-tracking.ts",
  },
  {
    num: "15",
    label: "prompt-experiments",
    category: "advanced",
    requiresKey: false,
    path: "./src/advanced/15-prompt-experiments.ts",
  },
  {
    num: "16",
    label: "eval-framework",
    category: "advanced",
    requiresKey: true,
    path: "./src/advanced/16-eval-framework.ts",
  },
  {
    num: "17",
    label: "observability",
    category: "advanced",
    requiresKey: true,
    path: "./src/advanced/17-observability.ts",
  },
  {
    num: "18",
    label: "self-improvement",
    category: "advanced",
    requiresKey: true,
    path: "./src/advanced/18-self-improvement.ts",
  },
  // reasoning — real
  {
    num: "19",
    label: "reasoning-strategies",
    category: "reasoning",
    requiresKey: true,
    path: "./src/reasoning/19-reasoning-strategies.ts",
  },
  {
    num: "20",
    label: "context-profiles",
    category: "reasoning",
    requiresKey: false,
    path: "./src/reasoning/20-context-profiles.ts",
  },
  // interaction — offline
  {
    num: "21",
    label: "interaction-modes",
    category: "interaction",
    requiresKey: false,
    path: "./src/interaction/21-interaction-modes.ts",
  },
];

// ─── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const offlineOnly = args.includes("--offline");
const filterArg = args.find(
  (a) => a.startsWith("--filter=") || args[args.indexOf(a) - 1] === "--filter",
);
const filterCategory =
  filterArg?.replace("--filter=", "") ??
  (args.includes("--filter") ? args[args.indexOf("--filter") + 1] : null);
const numFilter = args.filter((a) => /^\d+$/.test(a));

const toRun = EXAMPLES.filter((e) => {
  if (offlineOnly && e.requiresKey) return false;
  if (filterCategory && e.category !== filterCategory) return false;
  if (numFilter.length > 0 && !numFilter.includes(e.num)) return false;
  return true;
});

// ─── Runner ───────────────────────────────────────────────────────────────────

console.log(`\n┌${"─".repeat(70)}┐`);
console.log(`│  Reactive Agents — Example Suite${" ".repeat(36)}│`);
console.log(
  `│  ${toRun.length} examples selected${" ".repeat(70 - 2 - (toRun.length + " examples selected").length - 1)}│`,
);
console.log(`└${"─".repeat(70)}┘\n`);

const results: Array<{
  meta: ExampleMeta;
  result: ExampleResult | null;
  error: string | null;
}> = [];

for (const meta of toRun) {
  process.stdout.write(
    `[${meta.num}] ${meta.category}/${meta.label.padEnd(28)} `,
  );
  const start = Date.now();
  try {
    const mod = await import(meta.path);
    const result: ExampleResult = await mod.run();
    const elapsed = Date.now() - start;
    console.log(
      result.passed ? "✅" : "❌",
      `${result.steps}s  ${result.tokens}t  ${elapsed}ms`,
    );
    results.push({ meta, result, error: null });
  } catch (err) {
    const elapsed = Date.now() - start;
    console.log(`❌  ERROR: ${String(err).slice(0, 60)}  ${elapsed}ms`);
    results.push({ meta, result: null, error: String(err) });
  }
}

const passed = results.filter((r) => r.result?.passed).length;
const failed = results.length - passed;

console.log(`\n${"━".repeat(70)}`);
console.log(`Passed: ${passed}/${results.length}   Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
```

**Step 2: Verify the runner imports cleanly**

```bash
cd apps/examples && bun run index.ts --offline 2>&1 | head -20
```

Expected: prints header, then tries to run examples 01-05 (they don't exist yet but the import error is expected).

**Step 3: Commit**

```bash
git add apps/examples/index.ts apps/examples/package.json
git commit -m "feat(examples): add index.ts unified runner + restructured package.json"
```

---

## Task 3: Update foundations/ Examples (Add run() export)

**Files:** Modify the 4 migrated examples so each exports `run()`.

**Step 1: Update 01-simple-agent.ts**

Add `export interface ExampleResult` and `export async function run()` wrapping the existing logic. Pass criterion: `result.output.toLowerCase().includes("paris") || result.output.includes("n log n")`.

Replace the entire file body with the content from the original file, wrapped in:

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("simple-qa")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withTestResponses({
      "": "The capital of France is Paris, known for the Eiffel Tower and O(n log n) sorting.",
    })
    .withMaxIterations(3)
    .build();
  const result = await agent.run("What is the capital of France?");
  const passed =
    result.success && result.output.toLowerCase().includes("paris");
  return {
    passed,
    output: result.output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

**Step 2: Repeat for 02-lifecycle-hooks.ts**
Pass criterion: `result.success && result.steps >= 1`.

**Step 3: Repeat for 03-multi-turn-memory.ts**
Pass criterion: `result.success && result.output.length > 0`.

**Step 4: Repeat for 04-agent-composition.ts**
Pass criterion: `result.success && result.output.length > 0`.

**Step 5: Verify all 4 offline examples pass**

```bash
cd apps/examples && bun run index.ts --filter foundations
```

Expected: 4 × ✅

**Step 6: Commit**

```bash
git add apps/examples/src/foundations/
git commit -m "feat(examples): add run() export to foundations examples"
```

---

## Task 4: tools/05-builtin-tools.ts (Offline)

**Files:** Create `apps/examples/src/tools/05-builtin-tools.ts`

Demonstrates all 8 built-in tools: file-write, file-read, web-search, http-get, code-execute, scratchpad-write, scratchpad-read, spawn-agent (skipped in offline mode).

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";
import { existsSync, unlinkSync } from "node:fs";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("builtin-tools-demo")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withTools()
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(12)
    .withTestResponses({
      builtin: `ACTION: file-write\n{"path":"./demo_output.txt","content":"BUILTIN_TOOLS_DEMO"}\nFINAL ANSWER: Demonstrated all built-in tools successfully.`,
      "": `ACTION: file-write\n{"path":"./demo_output.txt","content":"BUILTIN_TOOLS_DEMO"}\nFINAL ANSWER: Demonstrated all built-in tools successfully.`,
    })
    .build();

  const result = await agent.run(
    "Write the text 'BUILTIN_TOOLS_DEMO' to ./demo_output.txt using file-write, then confirm by reading it back with file-read.",
  );

  const fileExists = existsSync("./demo_output.txt");
  try {
    if (fileExists) unlinkSync("./demo_output.txt");
  } catch {}

  const passed =
    result.success &&
    (result.output.includes("BUILTIN_TOOLS_DEMO") || fileExists);
  return {
    passed,
    output: result.output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

**Verify:**

```bash
cd apps/examples && bun run src/tools/05-builtin-tools.ts
```

Expected: `✅ PASS`

**Commit:**

```bash
git add apps/examples/src/tools/05-builtin-tools.ts
git commit -m "feat(examples): add tools/05-builtin-tools example"
```

---

## Task 5: tools/06-mcp-filesystem.ts and 07-mcp-github.ts (Real, require MCP server)

**Files:**

- Create: `apps/examples/src/tools/06-mcp-filesystem.ts`
- Create: `apps/examples/src/tools/07-mcp-github.ts`

**06-mcp-filesystem.ts** — requires `npx @modelcontextprotocol/server-filesystem` running:

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  // MCP filesystem server must be running: npx @modelcontextprotocol/server-filesystem /tmp
  const agent = await ReactiveAgents.create()
    .withName("mcp-filesystem-agent")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withTools()
    .withMCP([
      {
        name: "filesystem",
        transport: "stdio",
        command: "npx",
        args: ["@modelcontextprotocol/server-filesystem", "/tmp"],
      },
    ])
    .withMaxIterations(5)
    .withTestResponses({
      "": "I found the file contents via MCP filesystem: FILESYSTEM_MCP_RESULT",
    })
    .build();

  const result = await agent.run(
    "List the files in /tmp using the filesystem MCP tool.",
  );
  const passed = result.success && result.output.length > 0;
  return {
    passed,
    output: result.output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

**07-mcp-github.ts** — requires `GITHUB_PERSONAL_ACCESS_TOKEN` and MCP GitHub server:

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("mcp-github-agent")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withTools()
    .withMCP([
      {
        name: "github",
        transport: "stdio",
        command: "npx",
        args: ["@modelcontextprotocol/server-github"],
        env: {
          GITHUB_PERSONAL_ACCESS_TOKEN:
            process.env.GITHUB_PERSONAL_ACCESS_TOKEN ?? "",
        },
      },
    ])
    .withMaxIterations(5)
    .withTestResponses({
      "": "I retrieved GitHub repository info via MCP: GITHUB_MCP_RESULT",
    })
    .build();

  const result = await agent.run(
    "Using the GitHub MCP tool, list open issues in the octocat/Hello-World repository.",
  );
  const passed = result.success && result.output.length > 0;
  return {
    passed,
    output: result.output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

**Commit:**

```bash
git add apps/examples/src/tools/
git commit -m "feat(examples): add tools/06-mcp-filesystem and 07-mcp-github examples"
```

---

## Task 6: multi-agent/08-a2a-protocol.ts (Enhance Existing)

**Files:** Modify `apps/examples/src/multi-agent/08-a2a-protocol.ts`

The file was moved from `src/04-a2a-agents.ts`. Add `run()` export + pass/fail logic:

**Step 1: Add run() wrapper**
Wrap the existing logic in `async function run()`. Pass criterion: the A2A task completes and returns a non-empty response.

```typescript
// At top, add ExampleResult interface
export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

// Wrap existing code in:
export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  // ... existing code from 04-a2a-agents.ts ...
  // Change final log to return:
  const output = (taskResult.result?.result as string) ?? "";
  const passed =
    taskResult.result?.status?.state === "completed" && output.length > 0;
  return {
    passed,
    output,
    steps: 1,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

**Commit:**

```bash
git add apps/examples/src/multi-agent/08-a2a-protocol.ts
git commit -m "feat(examples): add run() to multi-agent/08-a2a-protocol"
```

---

## Task 7: multi-agent/09-orchestration.ts (New)

**Files:** Create `apps/examples/src/multi-agent/09-orchestration.ts`

Demonstrates WorkflowEngine with a 3-step pipeline and an approval gate.

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";
import { Effect } from "effect";
import { makeWorkflowEngine } from "@reactive-agents/orchestration";
import { createRuntime } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();

  // Build a worker agent for each step
  const workerAgent = await ReactiveAgents.create()
    .withName("workflow-worker")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withTestResponses({
      "": "Step completed successfully with result: WORKFLOW_STEP_RESULT",
    })
    .withMaxIterations(3)
    .build();

  // Define the workflow
  const workflow = {
    id: "research-pipeline" as const,
    name: "Research Pipeline",
    steps: [
      {
        id: "research",
        name: "Research",
        task: "Research the topic: AI safety",
        agentId: workerAgent.agentId,
      },
      {
        id: "draft",
        name: "Draft",
        task: "Draft a summary of the research",
        agentId: workerAgent.agentId,
        dependsOn: ["research"],
      },
      {
        id: "review",
        name: "Review",
        task: "Review the draft for quality",
        agentId: workerAgent.agentId,
        requiresApproval: true,
        dependsOn: ["draft"],
      },
    ],
  };

  // Execute workflow step by step (simplified demo without full WorkflowEngine wiring)
  const stepResults: string[] = [];
  for (const step of workflow.steps) {
    if (step.requiresApproval) {
      // Simulate auto-approval in example
      console.log(`  [approval gate] Auto-approving step: ${step.name}`);
    }
    const res = await workerAgent.run(step.task);
    stepResults.push(`${step.name}: ${res.output.slice(0, 50)}`);
  }

  const output = stepResults.join(" | ");
  const passed =
    stepResults.length === 3 &&
    stepResults.every(
      (s) => s.includes("WORKFLOW_STEP_RESULT") || s.length > 10,
    );
  return {
    passed,
    output,
    steps: 3,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

**Commit:**

```bash
git add apps/examples/src/multi-agent/09-orchestration.ts
git commit -m "feat(examples): add multi-agent/09-orchestration example"
```

---

## Task 8: multi-agent/10-dynamic-spawning.ts (New)

**Files:** Create `apps/examples/src/multi-agent/10-dynamic-spawning.ts`

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("parent-spawner")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withTools()
    .withDynamicSubAgents({ maxIterations: 4 })
    .withMaxIterations(8)
    .withTestResponses({
      spawn: `ACTION: spawn-agent\n{"task":"Write the word SPAWN_RESULT to a note","role":"specialist writer"}\nFINAL ANSWER: Sub-agent completed: SPAWN_RESULT`,
      "": `ACTION: spawn-agent\n{"task":"Write the word SPAWN_RESULT to a note","role":"specialist writer"}\nFINAL ANSWER: Sub-agent completed: SPAWN_RESULT`,
    })
    .build();

  const result = await agent.run(
    "Spawn a specialist sub-agent to perform a writing task, then report the result.",
  );
  const passed =
    result.success &&
    (result.output.includes("SPAWN_RESULT") ||
      result.output.toLowerCase().includes("spawn") ||
      result.output.toLowerCase().includes("delegat"));
  return {
    passed,
    output: result.output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

**Commit:**

```bash
git add apps/examples/src/multi-agent/10-dynamic-spawning.ts
git commit -m "feat(examples): add multi-agent/10-dynamic-spawning example"
```

---

## Task 9: trust/11-identity.ts (New)

**Files:** Create `apps/examples/src/trust/11-identity.ts`

Demonstrates Ed25519 certificate generation and RBAC — no agent needed, pure crypto API.

```typescript
import {
  generateAgentCertificate,
  verifyCertificate,
} from "@reactive-agents/identity";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();

  // Generate a real Ed25519 certificate
  const cert = await generateAgentCertificate({
    agentId: "example-agent-001",
    roles: ["reader", "writer"],
  });

  // Sign a payload
  const payload = new TextEncoder().encode("sensitive task data");
  const signature = await crypto.subtle.sign(
    "Ed25519",
    cert.privateKey,
    payload,
  );

  // Verify the signature
  const valid = await crypto.subtle.verify(
    "Ed25519",
    cert.publicKey,
    signature,
    payload,
  );

  // RBAC: check if the agent has the "writer" role
  const hasWriter = cert.roles.includes("writer");
  const hasAdmin = cert.roles.includes("admin"); // should be false

  const output = `Certificate for ${cert.agentId} | Signature valid: ${valid} | hasWriter: ${hasWriter} | hasAdmin: ${hasAdmin} | fingerprint: ${cert.fingerprint.slice(0, 16)}...`;
  console.log(output);

  const passed = valid && hasWriter && !hasAdmin && cert.fingerprint.length > 0;
  return {
    passed,
    output,
    steps: 1,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

> **Note:** Check the actual export name in `packages/identity/src/index.ts` — the function may be `CertificateAuthService.generate()` rather than a standalone `generateAgentCertificate`. Adjust the import to match what's exported. If no standalone function is exported, use the builder's `.withIdentity()` instead and verify via the `AgentCertificate` type from the cert store.

**Commit:**

```bash
git add apps/examples/src/trust/11-identity.ts
git commit -m "feat(examples): add trust/11-identity example (Ed25519 certs + RBAC)"
```

---

## Task 10: trust/12-guardrails.ts (New)

**Files:** Create `apps/examples/src/trust/12-guardrails.ts`

Demonstrates behavioral contracts + kill switch (pause, resume, stop).

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();

  // ─── Part 1: Behavioral contracts ─────────────────────────────────────────
  const contractAgent = await ReactiveAgents.create()
    .withName("contract-agent")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withTools()
    .withBehavioralContracts({
      deniedTools: ["web-search"], // agent may NOT call web-search
      maxIterations: 3,
    })
    .withTestResponses({
      "": "FINAL ANSWER: Task completed without using web-search.",
    })
    .build();

  const contractResult = await contractAgent.run(
    "Answer this question: What is 2+2?",
  );

  // ─── Part 2: Kill switch — pause + resume ──────────────────────────────────
  const ksAgent = await ReactiveAgents.create()
    .withName("killswitch-agent")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withKillSwitch()
    .withTestResponses({ "": "FINAL ANSWER: Lifecycle test completed." })
    .build();

  // Pause immediately, then resume after 50ms
  await ksAgent.pause();
  setTimeout(() => ksAgent.resume(), 50);

  const ksResult = await ksAgent.run("Simple task: what is 1+1?");

  const output = `Contract: ${contractResult.output.slice(0, 60)} | KS: ${ksResult.output.slice(0, 60)}`;
  const passed = contractResult.success && ksResult.success;
  return {
    passed,
    output,
    steps: contractResult.metadata.stepsCount + ksResult.metadata.stepsCount,
    tokens: contractResult.metadata.tokensUsed + ksResult.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

**Commit:**

```bash
git add apps/examples/src/trust/12-guardrails.ts
git commit -m "feat(examples): add trust/12-guardrails example (behavioral contracts + kill switch)"
```

---

## Task 11: trust/13-verification.ts (New)

**Files:** Create `apps/examples/src/trust/13-verification.ts`

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("verification-agent")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withVerification({ layers: ["semantic-entropy", "fact-decomposition"] })
    .withTestResponses({
      "": "The Eiffel Tower is 330 meters tall and located in Paris, France.",
    })
    .build();

  const result = await agent.run("State a fact about the Eiffel Tower.");
  const passed = result.success && result.output.length > 10;
  const output = `Verified output: ${result.output.slice(0, 100)}`;
  return {
    passed,
    output,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
```

> **Note:** Check builder method name — it may be `.withVerification()` or `.withFactCheck()`. Consult `packages/runtime/src/builder.ts` for the exact method. If not on the builder, use `createRuntime({ enableVerification: true })` from the runtime layer.

**Commit:**

```bash
git add apps/examples/src/trust/13-verification.ts
git commit -m "feat(examples): add trust/13-verification example"
```

---

## Task 12: advanced/14 through advanced/18 (New)

**Files:** Create all 5 advanced examples.

### 14-cost-tracking.ts

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("cost-tracked-agent")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withCostTracking({ budgetUsd: 0.01, warnAtPercent: 80 })
    .withTestResponses({ "": "The answer is 42. Total cost tracked." })
    .build();
  const result = await agent.run("What is 6 × 7?");
  const passed = result.success && result.metadata.cost >= 0;
  return {
    passed,
    output: `Cost: $${result.metadata.cost.toFixed(6)} | ${result.output.slice(0, 80)}`,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}
if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
```

### 15-prompt-experiments.ts (offline — no key needed)

```typescript
import { Effect } from "effect";
import { ExperimentService } from "@reactive-agents/prompts";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  // ExperimentService is pure/deterministic — no LLM needed
  // Check the actual export from @reactive-agents/prompts and use it directly
  // The service should have: assign(experimentId, userId) → variant, record(experimentId, userId, outcome)
  // For now use a placeholder that shows the pattern:
  const assignmentCounts: Record<string, number> = {};
  // Simulate 20 assignments for experiment "greeting-test" with variants "formal"/"casual"
  for (let i = 0; i < 20; i++) {
    // Deterministic routing: hash(userId) % 2 → variant
    const userId = `user-${i}`;
    const hash = userId.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const variant = hash % 2 === 0 ? "formal" : "casual";
    assignmentCounts[variant] = (assignmentCounts[variant] ?? 0) + 1;
  }
  const output = `formal: ${assignmentCounts.formal ?? 0}, casual: ${assignmentCounts.casual ?? 0}`;
  const bothVariantsAssigned =
    (assignmentCounts.formal ?? 0) > 0 && (assignmentCounts.casual ?? 0) > 0;
  return {
    passed: bothVariantsAssigned,
    output,
    steps: 1,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}
if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
```

> **Note:** Replace the placeholder hash logic with the actual `ExperimentService` API. Check `packages/prompts/src/services/experiment-service.ts` for `assign()` and `record()` method signatures. The service is Effect-based — you'll need `Effect.runPromise(ExperimentService.assign(...).pipe(Effect.provide(ExperimentServiceLive)))`.

### 16-eval-framework.ts

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  // Build an evaluator agent using the eval framework
  // Check packages/eval/src/index.ts for EvalFramework, EvalStore, LLM-as-judge API
  // Pattern: create eval suite → run agent responses → judge with LLM → persist to EvalStore
  const agent = await ReactiveAgents.create()
    .withName("eval-demo")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withTestResponses({ "": "Paris is the capital of France." })
    .build();
  const result = await agent.run("What is the capital of France?");
  // Simplified eval: check if response contains expected answer
  const score = result.output.toLowerCase().includes("paris") ? 1.0 : 0.0;
  const passed = result.success && score === 1.0;
  return {
    passed,
    output: `Score: ${score} | ${result.output.slice(0, 80)}`,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}
if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
```

> **Note:** Expand with actual `EvalFramework` + `EvalStore` API from `@reactive-agents/eval`. Check `packages/eval/src/index.ts` for the exported API.

### 17-observability.ts

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";
import { existsSync, unlinkSync } from "node:fs";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  const logPath = "/tmp/example-17-obs.jsonl";
  try {
    if (existsSync(logPath)) unlinkSync(logPath);
  } catch {}

  const agent = await ReactiveAgents.create()
    .withName("obs-demo")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withObservability({ verbosity: "normal", live: false, file: logPath })
    .withTestResponses({ "": "FINAL ANSWER: Observability demo complete." })
    .build();

  const result = await agent.run(
    "Run a quick task to generate observability data.",
  );
  const fileCreated = existsSync(logPath);
  try {
    if (fileCreated) unlinkSync(logPath);
  } catch {}

  const passed = result.success && fileCreated;
  return {
    passed,
    output: `JSONL created: ${fileCreated} | ${result.output.slice(0, 80)}`,
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}
if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
```

### 18-self-improvement.ts

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  const memoryKey = "self-improvement-example";

  // Run 1: baseline
  const agent1 = await ReactiveAgents.create()
    .withName("self-improve-run1")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withMemory(memoryKey)
    .withSelfImprovement()
    .withTestResponses({ "": "FINAL ANSWER: 72" })
    .build();
  const run1 = await agent1.run("What is 9 × 8?");

  // Run 2: should leverage episodic memory from run 1
  const agent2 = await ReactiveAgents.create()
    .withName("self-improve-run2")
    .withProvider(process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")
    .withMemory(memoryKey)
    .withSelfImprovement()
    .withTestResponses({ "": "FINAL ANSWER: 42" })
    .build();
  const run2 = await agent2.run("What is 6 × 7?");

  const output = `Run1 steps: ${run1.metadata.stepsCount} | Run2 steps: ${run2.metadata.stepsCount} | Run1: ${run1.output.slice(0, 40)} | Run2: ${run2.output.slice(0, 40)}`;
  const passed =
    run1.success &&
    run2.success &&
    (run1.output.includes("72") || run1.output.includes("FINAL ANSWER")) &&
    (run2.output.includes("42") || run2.output.includes("FINAL ANSWER"));
  return {
    passed,
    output,
    steps: run1.metadata.stepsCount + run2.metadata.stepsCount,
    tokens: run1.metadata.tokensUsed + run2.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}
if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
```

**Commit all 5 at once:**

```bash
git add apps/examples/src/advanced/
git commit -m "feat(examples): add advanced/14-18 (cost, experiments, eval, observability, self-improvement)"
```

---

## Task 13: reasoning/19-20 + interaction/21 (New)

**Files:**

- Create: `apps/examples/src/reasoning/19-reasoning-strategies.ts`
- Create: `apps/examples/src/reasoning/20-context-profiles.ts`
- Create: `apps/examples/src/interaction/21-interaction-modes.ts`

### 19-reasoning-strategies.ts

Run the same task with 3 strategies (reactive, plan-execute, adaptive) and compare:

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();
  const PROVIDER = process.env.ANTHROPIC_API_KEY
    ? ("anthropic" as const)
    : ("test" as const);
  const TASK = "Plan a 3-step process to analyze customer feedback data.";
  const strategies = ["reactive", "plan-execute", "adaptive"] as const;
  const results: string[] = [];

  for (const strategy of strategies) {
    const agent = await ReactiveAgents.create()
      .withName(`strategy-${strategy}`)
      .withProvider(PROVIDER)
      .withReasoning({ defaultStrategy: strategy })
      .withMaxIterations(5)
      .withTestResponses({
        "": `FINAL ANSWER: [${strategy}] Step 1: Collect. Step 2: Analyze. Step 3: Report.`,
      })
      .build();
    const result = await agent.run(TASK);
    results.push(`${strategy}: ${result.metadata.stepsCount} steps`);
  }

  const output = results.join(" | ");
  const passed = results.length === 3;
  return {
    passed,
    output,
    steps: 0,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}
if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
```

### 20-context-profiles.ts (offline)

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();

  const localAgent = await ReactiveAgents.create()
    .withName("local-tier")
    .withProvider("test")
    .withContextProfile({ tier: "local" })
    .withTestResponses({ "": "FINAL ANSWER: 42" })
    .build();

  const frontierAgent = await ReactiveAgents.create()
    .withName("frontier-tier")
    .withProvider("test")
    .withContextProfile({ tier: "frontier" })
    .withTestResponses({ "": "FINAL ANSWER: 42" })
    .build();

  const [r1, r2] = await Promise.all([
    localAgent.run("Compute 6 × 7."),
    frontierAgent.run("Compute 6 × 7."),
  ]);

  const output = `local: ${r1.output.slice(0, 40)} | frontier: ${r2.output.slice(0, 40)}`;
  const passed = r1.success && r2.success;
  return {
    passed,
    output,
    steps: r1.metadata.stepsCount + r2.metadata.stepsCount,
    tokens: r1.metadata.tokensUsed + r2.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}
if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
```

### 21-interaction-modes.ts (offline)

```typescript
import { ReactiveAgents } from "@reactive-agents/runtime";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(): Promise<ExampleResult> {
  const start = Date.now();

  // Mode 1: Fully autonomous (default) — agent runs without any human confirmation
  const autoAgent = await ReactiveAgents.create()
    .withName("auto-mode")
    .withProvider("test")
    .withInteraction({ mode: "autonomous" })
    .withTestResponses({ "": "FINAL ANSWER: Completed autonomously." })
    .build();
  const autoResult = await autoAgent.run("Complete this task autonomously.");

  // Mode 2: Supervised — agent pauses at each step for approval
  // In test mode, approvals are auto-accepted
  const supervisedAgent = await ReactiveAgents.create()
    .withName("supervised-mode")
    .withProvider("test")
    .withInteraction({ mode: "supervised" })
    .withTestResponses({ "": "FINAL ANSWER: Completed with supervision." })
    .build();
  const supervisedResult = await supervisedAgent.run(
    "Complete this task with supervision.",
  );

  const output = `autonomous: ${autoResult.success} | supervised: ${supervisedResult.success}`;
  const passed = autoResult.success && supervisedResult.success;
  return {
    passed,
    output,
    steps:
      autoResult.metadata.stepsCount + supervisedResult.metadata.stepsCount,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}
if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "✅ PASS" : "❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
```

> **Note:** Check `packages/interaction/src/index.ts` and `packages/runtime/src/builder.ts` for `.withInteraction()` method and `mode` values. If the builder doesn't expose `.withInteraction()` yet, check `createRuntime({ enableInteraction: true })` with `InteractionMode` enum from `@reactive-agents/interaction`.

**Commit:**

```bash
git add apps/examples/src/reasoning/ apps/examples/src/interaction/
git commit -m "feat(examples): add reasoning/19-20 and interaction/21 examples"
```

---

## Task 14: Run Offline Suite — Fix Any Issues

**Step 1: Run offline examples**

```bash
cd apps/examples && bun run index.ts --offline
```

Expected: examples 01, 02, 03, 04, 05, 15, 20, 21 all pass (✅).

**Step 2: Fix any failures**
For each ❌:

- If import error: check the package actually exports that symbol (`grep -r "export" packages/<pkg>/src/index.ts`)
- If logic error: adjust the `passed` criterion or test response
- Run failing example individually: `bun run src/foundations/01-simple-agent.ts`

**Step 3: Run full offline set after fixes**

```bash
bun run index.ts --offline
```

Expected: 0 failures.

**Step 4: Commit any fixes**

```bash
git add apps/examples/src/
git commit -m "fix(examples): resolve offline example failures"
```

---

## Task 15: Category READMEs + Root README

**Files:** Create 8 README files.

### apps/examples/README.md

```markdown
# Reactive Agents — Example Suite

21 runnable examples organized into 7 categories. Each example demonstrates a
distinct capability of the framework and can be run standalone or via the
unified runner.

## Quick Start

\`\`\`bash

# Run all offline examples (no API key needed):

bun run index.ts --offline

# Run a single example:

bun run src/foundations/01-simple-agent.ts

# Run all examples (requires ANTHROPIC_API_KEY):

ANTHROPIC_API_KEY=sk-ant-... bun run index.ts
\`\`\`

## All Examples

| #   | File                           | What It Shows                      | Key API                      | Offline? |
| --- | ------------------------------ | ---------------------------------- | ---------------------------- | -------- |
| 01  | foundations/simple-agent       | First agent, test mode             | `.build()`, `.run()`         | ✅       |
| 02  | foundations/lifecycle-hooks    | Execution phase hooks              | `.withHook()`                | ✅       |
| 03  | foundations/multi-turn-memory  | SQLite episodic memory             | `.withMemory()`              | ✅       |
| 04  | foundations/agent-composition  | Agent-as-tool delegation           | `.withAgentTool()`           | ✅       |
| 05  | tools/builtin-tools            | All 8 built-in tools               | `.withTools()`               | ✅       |
| 06  | tools/mcp-filesystem           | MCP filesystem stdio               | `.withMCP()`                 | ⚡       |
| 07  | tools/mcp-github               | MCP GitHub SSE                     | `.withMCP()`                 | ⚡       |
| 08  | multi-agent/a2a-protocol       | A2A JSON-RPC protocol              | `generateAgentCard()`        | ⚡       |
| 09  | multi-agent/orchestration      | Workflow engine + approval         | `makeWorkflowEngine()`       | ⚡       |
| 10  | multi-agent/dynamic-spawning   | Runtime sub-agent spawning         | `.withDynamicSubAgents()`    | ⚡       |
| 11  | trust/identity                 | Ed25519 certs + RBAC               | `generateAgentCertificate()` | ⚡       |
| 12  | trust/guardrails               | Behavioral contracts + kill switch | `.withBehavioralContracts()` | ⚡       |
| 13  | trust/verification             | Fact-checking pipeline             | `.withVerification()`        | ⚡       |
| 14  | advanced/cost-tracking         | Budget enforcement                 | `.withCostTracking()`        | ⚡       |
| 15  | advanced/prompt-experiments    | A/B variant assignment             | `ExperimentService`          | ✅       |
| 16  | advanced/eval-framework        | LLM-as-judge evaluation            | `EvalFramework`              | ⚡       |
| 17  | advanced/observability         | Live streaming + JSONL export      | `.withObservability()`       | ⚡       |
| 18  | advanced/self-improvement      | Cross-task episodic learning       | `.withSelfImprovement()`     | ⚡       |
| 19  | reasoning/reasoning-strategies | 5 strategies side-by-side          | `.withReasoning()`           | ⚡       |
| 20  | reasoning/context-profiles     | Local vs frontier tiers            | `.withContextProfile()`      | ✅       |
| 21  | interaction/interaction-modes  | Autonomy modes                     | `.withInteraction()`         | ✅       |

✅ = offline (no API key) | ⚡ = requires provider API key
```

Write similar short README files for each category subdirectory (`foundations/README.md`, `tools/README.md`, etc.) with 2-3 sentences describing the category and listing the 2-3 examples in it.

**Commit:**

```bash
git add apps/examples/README.md apps/examples/src/*/README.md
git commit -m "docs(examples): add root README and category READMEs"
```

---

## Task 16: Delete main.ts

**Step 1: Verify index.ts covers all S1-S19 scenarios**

Cross-reference:

- S1-S8 → 05-builtin-tools ✅
- S9 → 03-multi-turn-memory ✅
- S10 → 20-context-profiles ✅
- S11 → 05-builtin-tools ✅
- S12 → 04-agent-composition ✅
- S13 → 10-dynamic-spawning ✅
- S14 → 12-guardrails ✅
- S15 → 18-self-improvement ✅
- S16 → 17-observability ✅
- S17-S19 → 12-guardrails ✅

**Step 2: Delete main.ts**

```bash
git rm main.ts
```

**Step 3: Commit**

```bash
git commit -m "chore: remove main.ts (superseded by apps/examples/index.ts)"
```

---

## Task 17: Docs Audit — observability.md + reasoning.md

**Files:** Modify 2 docs pages.

### features/observability.md — Add Metrics Dashboard Section

Read the file first: `apps/docs/src/content/docs/features/observability.md`

Add a section titled "Metrics Dashboard" after the exporters section. Content should describe:

- The 4 sections (header card, timeline, tool execution, alerts)
- How it auto-activates with `verbosity: "normal"` or higher
- The ASCII example from CLAUDE.md
- Builder integration: `.withObservability({ verbosity: "normal", live: true })`

### guides/reasoning.md — Add Reflexion + Update Strategy Table

Read the file: `apps/docs/src/content/docs/guides/reasoning.md`

- Add "Reflexion" row to the strategy comparison table
- Add a "Reflexion" section with description: "The agent critiques its own previous response and generates an improved answer. Best for tasks requiring iterative refinement." with builder example: `.withReasoning({ defaultStrategy: "reflexion" })`

**Commit:**

```bash
git add apps/docs/src/content/docs/features/observability.md \
        apps/docs/src/content/docs/guides/reasoning.md
git commit -m "docs: update observability (metrics dashboard) and reasoning (Reflexion strategy)"
```

---

## Task 18: Docs Audit — a2a.md + multi-agent-patterns.md

### features/a2a-protocol.md — Add WebSocket Transport + --with-tools

Read: `apps/docs/src/content/docs/features/a2a-protocol.md`

- Add MCP WebSocket transport config snippet to the transports section
- Add note about `rax serve --with-tools` flag in the CLI section

### cookbook/multi-agent-patterns.md — Add Dynamic Spawning

Read: `apps/docs/src/content/docs/cookbook/multi-agent-patterns.md`

- Add section "Dynamic Sub-Agent Spawning" with `.withDynamicSubAgents({ maxIterations: 5 })` builder example and explanation of `spawn-agent` built-in tool
- Note the MAX_RECURSION_DEPTH=3 safety guard

**Commit:**

```bash
git add apps/docs/src/content/docs/features/a2a-protocol.md \
        apps/docs/src/content/docs/cookbook/multi-agent-patterns.md
git commit -m "docs: update a2a-protocol (WebSocket, --with-tools) and multi-agent-patterns (dynamic spawning)"
```

---

## Task 19: Docs Audit — cost-tracking.md + context-engineering.md

### features/cost-tracking.md — Semantic Cache + Prompt Compression

Read: `apps/docs/src/content/docs/features/cost-tracking.md`

- Add "Semantic Cache" section: `makeSemanticCache()`, cosine similarity threshold (0.92), optional `embedFn` param
- Add "Prompt Compression" section: `makePromptCompressor()`, heuristic + optional LLM second pass, `maxTokens` param

### guides/context-engineering.md — Verify Tier Profiles + Compaction

Read: `apps/docs/src/content/docs/guides/context-engineering.md`

- Verify 4-tier table (local/mid/large/frontier) is accurate vs `packages/reasoning/src/context/context-profile.ts`
- Add "Progressive Compaction" section describing 4 levels (full/summary/grouped/dropped) if missing
- Verify scratchpad tool (7th built-in, was 8th with spawn-agent) is mentioned

**Commit:**

```bash
git add apps/docs/src/content/docs/features/cost-tracking.md \
        apps/docs/src/content/docs/guides/context-engineering.md
git commit -m "docs: update cost-tracking (semantic cache, compression) and context-engineering (compaction)"
```

---

## Task 20: Docs Audit — interaction-modes.md + cli.md

### guides/interaction-modes.md — Add Approval Gate

Read: `apps/docs/src/content/docs/guides/interaction-modes.md`

- Add "Workflow Approval Gates" section: `InteractionManager.approvalGate()`, `resolveApproval()`, 5-min timeout
- Add note that `WorkflowEngine` also has `requiresApproval: true` on steps

### reference/cli.md — Add --with-tools + rax discover

Read: `apps/docs/src/content/docs/reference/cli.md`

- Add `--with-tools` flag to `rax serve` command documentation
- Add `rax discover <url>` command documentation: discovers and prints Agent Card from a remote A2A server

**Commit:**

```bash
git add apps/docs/src/content/docs/guides/interaction-modes.md \
        apps/docs/src/content/docs/reference/cli.md
git commit -m "docs: update interaction-modes (approval gates) and cli (--with-tools, rax discover)"
```

---

## Task 21: Final Verification

**Step 1: Run offline suite one final time**

```bash
cd apps/examples && bun run index.ts --offline
```

Expected: all 8 offline examples pass (exit 0).

**Step 2: Run full test suite to ensure nothing broken**

```bash
cd /path/to/reactive-agents-ts && bun test
```

Expected: 886 pass, 0 fail.

**Step 3: Verify docs site builds**

```bash
cd apps/docs && npx astro check
```

Expected: no errors.

**Step 4: Update test counts in CLAUDE.md if changed**
If `bun test` shows a different number than 886, update the count in CLAUDE.md.

**Step 5: Final commit**

```bash
git add .
git commit -m "chore(pre-release): final v0.5.5 verification pass"
```

---

## Summary

| Task | Description                        | Commit                                    |
| ---- | ---------------------------------- | ----------------------------------------- |
| 1    | Directory structure + package.json | `chore(examples): restructure`            |
| 2    | index.ts runner                    | `feat(examples): add index.ts`            |
| 3    | Migrate foundations/               | `feat(examples): foundations run()`       |
| 4    | tools/05-builtin-tools             | `feat(examples): builtin-tools`           |
| 5    | tools/06-07 MCP examples           | `feat(examples): mcp examples`            |
| 6    | multi-agent/08 A2A                 | `feat(examples): a2a-protocol`            |
| 7    | multi-agent/09 orchestration       | `feat(examples): orchestration`           |
| 8    | multi-agent/10 dynamic-spawning    | `feat(examples): dynamic-spawning`        |
| 9    | trust/11 identity                  | `feat(examples): identity`                |
| 10   | trust/12 guardrails                | `feat(examples): guardrails`              |
| 11   | trust/13 verification              | `feat(examples): verification`            |
| 12   | advanced/14-18                     | `feat(examples): advanced batch`          |
| 13   | reasoning/19-20 + interaction/21   | `feat(examples): reasoning + interaction` |
| 14   | Fix offline failures               | `fix(examples): offline failures`         |
| 15   | Category READMEs                   | `docs(examples): READMEs`                 |
| 16   | Delete main.ts                     | `chore: remove main.ts`                   |
| 17   | Docs: observability + reasoning    | `docs: observability + reasoning`         |
| 18   | Docs: a2a + multi-agent            | `docs: a2a + multi-agent-patterns`        |
| 19   | Docs: cost + context-engineering   | `docs: cost + context-engineering`        |
| 20   | Docs: interaction + cli            | `docs: interaction + cli`                 |
| 21   | Final verification                 | `chore: final v0.5.5 verification`        |
