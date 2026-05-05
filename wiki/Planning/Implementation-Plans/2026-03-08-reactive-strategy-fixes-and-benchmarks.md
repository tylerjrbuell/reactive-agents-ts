# Reactive Strategy Fixes, Benchmarks & CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix reactive strategy efficiency gaps (scratchpad guidance, tool context bloat, token budgets, model tier classification), add `rax bench` CLI command, and expand benchmarks for multi-model comparison.

**Architecture:** Targeted fixes to the ReAct kernel prompt, context profile system, and tool inference. No architectural rewrites. Then CLI wrapper + benchmark expansion for measurement.

**Tech Stack:** Effect-TS, Bun test runner, Astro (docs), TypeScript

---

### Task 1: Add Scratchpad Guidance to RULES Prompt

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts:278-289`
- Test: Run `bun run test.ts` to verify behavior improvement

**Step 1: Update RULES in react-kernel.ts**

In `react-kernel.ts`, find the RULES section (line 278-289) and replace:

```typescript
RULES:
1. You MUST take action NOW. Do NOT ask for clarification — all information is in the Task above.
2. ONE action per turn. Wait for the real result before proceeding.
3. Use EXACT parameter names from tool schemas above — do NOT guess parameter names.
4. When you have ALL required information, immediately write: FINAL ANSWER: <your answer>
5. Check 'ALREADY DONE' above before acting. Skip completed steps.
6. Do NOT fabricate results — wait for the real tool response.
7. Trust your tool results. Once a tool succeeds, the action is done — do NOT repeat it.
```

Replace with:

```typescript
RULES:
1. ONE action per turn. Wait for the real result before proceeding.
2. Use EXACT parameter names from tool schemas above.
3. When you have ALL required information: FINAL ANSWER: <your answer>
4. Check 'ALREADY DONE' above. Skip completed steps.
5. Do NOT fabricate or invent data. Only use information from tool results.
6. When results show [STORED: _key], use ACTION: scratchpad-read({"key": "_key"}) to read full data BEFORE summarizing. Do NOT guess missing items from previews.
7. Trust tool results. Once a tool succeeds, do NOT repeat it.
```

Key changes:
- Rule 6 is NEW: explicit scratchpad-read guidance with exact syntax
- Rule 5 strengthened: "Do NOT fabricate or invent data" (was weaker "wait for real tool response")
- Rule 1 simplified: removed "Do NOT ask for clarification" (redundant, wastes tokens)
- Tighter wording throughout saves ~30 tokens per iteration

**Step 2: Run tests**

Run: `bun test packages/reasoning/tests/ --timeout 30000`
Expected: All existing tests pass (the RULES text is not tested verbatim)

**Step 3: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts
git commit -m "fix(reasoning): add scratchpad guidance to RULES prompt and tighten anti-fabrication rule"
```

---

### Task 2: Increase Token Budgets for Local and Mid Tiers

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts:294-300`
- Modify: `packages/reasoning/src/context/context-profile.ts:29-54`

**Step 1: Update tierMaxTokens in react-kernel.ts**

Find lines 294-300:

```typescript
const tierMaxTokens: Record<string, number> = {
  local: 800,
  mid: 1500,
  large: 3000,
  frontier: 4000,
};
```

Replace with:

```typescript
const tierMaxTokens: Record<string, number> = {
  local: 1200,
  mid: 2000,
  large: 3000,
  frontier: 4000,
};
```

**Step 2: Update local profile toolResultMaxChars**

In `context-profile.ts`, update the `local` profile (line 29):

Change `toolResultMaxChars: 400` to `toolResultMaxChars: 600`.

This gives local models more tool result data to work with (reduces need for scratchpad reads on medium results).

**Step 3: Run tests**

Run: `bun test packages/reasoning/tests/ --timeout 30000`
Expected: All pass

**Step 4: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts packages/reasoning/src/context/context-profile.ts
git commit -m "fix(reasoning): increase token budgets for local (800→1200) and mid (1500→2000) tiers"
```

---

### Task 3: Aggressive Tool Filtering for Large Tool Sets

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts:124-185` (buildInitialContext)

**Step 1: Update buildInitialContext to collapse secondary tools for large sets**

In `react-kernel.ts`, find the `buildInitialContext` function. Replace the section where secondary tools are formatted (inside the `primary.length > 0` branch, around line 161-176):

Current code:
```typescript
} else {
  // Primary tools always get full schema
  const primaryLines = formatToolSchemas(primary);

  // Secondary tools: format based on tier
  let secondarySection = "";
  if (secondary.length > 0) {
    if (detail === "names-only") {
      secondarySection = `\nAlso available: ${secondary.map(t => t.name).join(", ")}`;
    } else {
      secondarySection = `\nOther tools:\n${secondary.map(formatToolSchemaCompact).join("\n")}`;
    }
  }

  toolSection = `Available Tools:\n${primaryLines}${secondarySection}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.`;
}
```

Replace with:
```typescript
} else {
  // Primary tools always get full schema
  const primaryLines = formatToolSchemas(primary);

  // Secondary tools: collapse aggressively when there are many
  let secondarySection = "";
  if (secondary.length > 0) {
    if (detail === "names-only" || secondary.length > 15) {
      // Names-only for large tool sets (>15) regardless of tier — saves ~500 tokens
      secondarySection = `\nAlso available (use by name): ${secondary.map(t => t.name).join(", ")}`;
    } else {
      secondarySection = `\nOther tools:\n${secondary.map(formatToolSchemaCompact).join("\n")}`;
    }
  }

  toolSection = `Available Tools:\n${primaryLines}${secondarySection}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.`;
}
```

Also update the `primary.length === 0` branch similarly — when ALL tools are secondary and there are >15, use names-only even for mid tier:

Find the block starting at line 149 (`if (primary.length === 0)`). Update it:
```typescript
if (primary.length === 0) {
  if (detail === "names-only") {
    const toolNames = availableToolSchemas.map(t => t.name).join(", ");
    toolSection = `Tools: ${toolNames}\nTo use: ACTION: tool_name({"param": "value"})`;
  } else if (detail === "names-and-types" || availableToolSchemas.length > 20) {
    // Compact format for large tool sets or local tier
    const toolLines = availableToolSchemas.map(formatToolSchemaCompact).join("\n");
    toolSection = `Available Tools:\n${toolLines}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names.`;
  } else {
    const toolLines = formatToolSchemas(availableToolSchemas);
    toolSection = `Available Tools:\n${toolLines}\n\nTo use a tool: ACTION: tool_name({"param": "value"}) — use EXACT parameter names shown above, valid JSON only.`;
  }
}
```

**Step 2: Run tests**

Run: `bun test packages/reasoning/tests/ --timeout 30000`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts
git commit -m "fix(reasoning): collapse secondary tools to names-only for large tool sets (>15)"
```

---

### Task 4: Heuristic-First Tool Inference (Skip LLM When Possible)

**Files:**
- Modify: `packages/runtime/src/execution-engine.ts` (infer-tools section, ~lines 569-605)
- Modify: `packages/reasoning/src/strategies/shared/tool-utils.ts` (export filterToolsByRelevance)

**Step 1: Add heuristic pass before LLM inference in execution-engine.ts**

Find the infer-tools section in execution-engine.ts (around line 569-605). The current code always calls `inferRequiredTools()` (LLM call). Add a heuristic fast path:

Before the `inferRequiredTools` call, add:

```typescript
// Fast path: heuristic keyword matching (no LLM call needed)
const { filterToolsByRelevance } = await import("@reactive-agents/reasoning");
const taskText = extractTaskText(task.input);
const toolSchemas = toolDefsForInfer.map((t: any) => ({
  name: t.name as string,
  description: (t.description ?? "") as string,
  parameters: ((t.parameters ?? []) as any[]).map((p: any) => ({
    name: p.name as string,
    type: (p.type ?? "string") as string,
    description: (p.description ?? "") as string,
    required: Boolean(p.required),
  })),
}));
const { primary } = filterToolsByRelevance(taskText, toolSchemas);

if (primary.length > 0) {
  // Heuristic found relevant tools — skip LLM inference
  inferredRequired = primary.map(t => t.name);
} else {
  // Heuristic found nothing — fall back to LLM inference
  inferredRequired = yield* inferRequiredTools({
    taskDescription: taskText,
    availableTools: toolSchemas,
    systemPrompt: config.systemPrompt,
  }).pipe(Effect.catchAll(() => Effect.succeed([] as readonly string[])));
}
```

Note: `filterToolsByRelevance` is already exported from `@reactive-agents/reasoning` (via tool-utils.ts re-exports). Verify the export chain.

**Step 2: Verify export**

Check that `filterToolsByRelevance` is exported from `packages/reasoning/src/index.ts`. If not, add it.

**Step 3: Run tests**

Run: `bun test packages/runtime/tests/ --timeout 30000`
Expected: All pass

**Step 4: Run test.ts to verify faster inference**

Run: `bun run test.ts`
Expected: `[infer-tools]` step should be nearly instant (~1ms) instead of ~8s since it uses keyword matching.

**Step 5: Commit**

```bash
git add packages/runtime/src/execution-engine.ts packages/reasoning/src/index.ts
git commit -m "perf(runtime): heuristic-first tool inference — skip LLM call when keyword matching finds tools"
```

---

### Task 5: Reclassify Capable Local Models as Mid Tier

**Files:**
- Modify: `packages/reasoning/src/context/profile-resolver.ts:7-20`

**Step 1: Split LOCAL_PATTERNS into small and capable groups**

Replace the current `LOCAL_PATTERNS` and `tierFromModelName` function:

```typescript
// Small local models — truly constrained context/reasoning
const LOCAL_PATTERNS = [
  "tinyllama",
  "phi-2",
  "gemma-2b",
  "stablelm",
];

// Capable local models — can handle mid-tier prompts (>=7B params)
const CAPABLE_LOCAL_PATTERNS = [
  "ollama:",
  "llama",
  "mistral",
  "phi-",
  "phi3",
  "phi4",
  "qwen",
  "deepseek",
  "codellama",
  "cogito",
  "gemma",
];
```

Then update `tierFromModelName`:

```typescript
function tierFromModelName(model: string): ModelTier {
  const lower = model.toLowerCase();

  if (FRONTIER_PATTERNS.some((p) => lower.includes(p))) return "frontier";

  // Small local models (tiny/2B) — truly constrained
  if (LOCAL_PATTERNS.some((p) => lower.includes(p))) return "local";

  // Capable local models (7B+) get mid-tier treatment
  if (CAPABLE_LOCAL_PATTERNS.some((p) => lower.includes(p))) {
    // Check for explicit size hints — >=13B models are solidly mid
    const sizeMatch = lower.match(/(\d+)[bB]/);
    if (sizeMatch) {
      const sizeB = parseInt(sizeMatch[1], 10);
      if (sizeB >= 13) return "mid";
      if (sizeB <= 3) return "local";
    }
    return "mid";
  }

  if (lower.includes("gpt-4o-mini")) return "mid";
  if (MID_PATTERNS.some((p) => lower.includes(p))) return "mid";
  if (LARGE_PATTERNS.some((p) => lower.includes(p))) return "large";

  return "mid";
}
```

**Step 2: Run tests**

Run: `bun test packages/reasoning/tests/context/ --timeout 30000`
Expected: All pass. Note: if there are tests that assert `cogito:14b` → "local", they need updating to "mid".

**Step 3: Commit**

```bash
git add packages/reasoning/src/context/profile-resolver.ts
git commit -m "fix(reasoning): reclassify capable local models (7B+) as mid tier for better prompts and budgets"
```

---

### Task 6: Refine Stop Sequences

**Files:**
- Modify: `packages/reasoning/src/strategies/shared/react-kernel.ts:307`

**Step 1: Update stop sequences**

Find line 307:
```typescript
stopSequences: ["Observation:", "\nObservation:"],
```

Replace with:
```typescript
stopSequences: ["\nObservation:", "\nObservation: "],
```

Both variants now require a newline prefix, preventing mid-sentence cuts when a model writes "Observation:" as part of natural reasoning text.

**Step 2: Run tests**

Run: `bun test packages/reasoning/tests/ --timeout 30000`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/reasoning/src/strategies/shared/react-kernel.ts
git commit -m "fix(reasoning): require newline prefix on stop sequences to prevent mid-sentence cuts"
```

---

### Task 7: Add `rax bench` CLI Command

**Files:**
- Create: `apps/cli/src/commands/bench.ts`
- Modify: `apps/cli/src/index.ts`

**Step 1: Create bench.ts**

```typescript
// File: apps/cli/src/commands/bench.ts
import { info, fail } from "../ui.js";
import type { Tier } from "@reactive-agents/benchmarks";

export async function runBench(argv: string[]) {
  const getArg = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 && idx + 1 < argv.length ? argv[idx + 1] : undefined;
  };

  const provider = (getArg("--provider") ?? "test") as
    | "anthropic" | "openai" | "gemini" | "ollama" | "litellm" | "test";
  const model = getArg("--model");
  const tierArg = getArg("--tier");
  const tiers = tierArg ? (tierArg.split(",") as Tier[]) : undefined;
  const output = getArg("--output");

  const { runBenchmarks } = await import("@reactive-agents/benchmarks");

  const report = await runBenchmarks({ provider, model, tiers });

  if (output) {
    await Bun.write(output, JSON.stringify(report, null, 2));
    console.log(info(`Report saved to ${output}`));
  }
}
```

**Step 2: Add bench command to CLI router**

In `apps/cli/src/index.ts`, add import:
```typescript
import { runBench } from "./commands/bench.js";
```

Add to HELP string:
```
    bench [--provider ...] [--model ...] [--tier ...] [--output ...]
                  Run benchmark suite against an LLM provider
```

Add case in switch:
```typescript
case "bench":
  runAsync(runBench(argv.slice(1)));
  break;
```

**Step 3: Verify CLI builds**

Run: `bun run build`
Expected: All packages + CLI build successfully

**Step 4: Test CLI command**

Run: `cd apps/cli && bun run dist/index.js bench --provider test`
Expected: Benchmark suite runs with test provider, shows results table

**Step 5: Commit**

```bash
git add apps/cli/src/commands/bench.ts apps/cli/src/index.ts
git commit -m "feat(cli): add rax bench command for running benchmark suite"
```

---

### Task 8: Multi-Model Benchmark Report Format

**Files:**
- Modify: `packages/benchmarks/src/types.ts`
- Modify: `packages/benchmarks/src/runner.ts`
- Modify: `packages/benchmarks/src/run.ts`
- Modify: `packages/benchmarks/src/index.ts`

**Step 1: Add MultiModelReport type**

In `types.ts`, add after `BenchmarkReport`:

```typescript
/** Multi-model benchmark report — contains results from multiple provider/model runs. */
export interface MultiModelReport {
  readonly generatedAt: string;
  readonly runs: readonly BenchmarkReport[];
}
```

**Step 2: Upsert logic in runner**

In `run.ts`, `--output` always upserts: reads the existing report, replaces any
previous run for the same provider+model, and keeps all other runs intact.

```typescript
const report = await runBenchmarks({ provider, model, tiers, timeoutMs });

if (output) {
  // Upsert: keep other provider/model runs, replace the matching one
  let multiReport: MultiModelReport;
  try {
    const existing = JSON.parse(await Bun.file(output).text()) as MultiModelReport;
    const otherRuns = existing.runs.filter(
      (r) => !(r.provider === report.provider && r.model === report.model),
    );
    multiReport = {
      generatedAt: new Date().toISOString(),
      runs: [...otherRuns, report],
    };
  } catch {
    multiReport = { generatedAt: new Date().toISOString(), runs: [report] };
  }
  await Bun.write(output, JSON.stringify(multiReport, null, 2));
  console.log(`  Report saved to ${output}`);
}
```

**Step 3: Export MultiModelReport**

In `index.ts`, add:
```typescript
export type { MultiModelReport } from "./types.js";
```

**Step 4: Run tests**

Run: `bun test packages/benchmarks/tests/ --timeout 30000`
Expected: All pass

**Step 5: Commit**

```bash
git add packages/benchmarks/src/types.ts packages/benchmarks/src/runner.ts packages/benchmarks/src/run.ts packages/benchmarks/src/index.ts
git commit -m "feat(benchmarks): multi-model report format with upsert-on-write"
```

---

### Task 9: Update Astro Benchmark Component for Multi-Model Display

**Files:**
- Modify: `apps/docs/src/components/BenchmarkResults.astro`
- Modify: `apps/docs/src/data/benchmark-report.json` (regenerate as multi-model format)

**Step 1: Update BenchmarkResults.astro**

Rewrite the component to handle both single-run (legacy) and multi-model formats. The component should:
- Detect format: if `benchmarkData.runs` exists, use multi-model view
- Show a comparison matrix: rows = tiers, columns = provider/model
- Color-code cells by pass rate (green >=90%, yellow >=70%, red <70%)
- Show per-model summary cards (pass rate, avg latency, total tokens, cost)
- Keep individual task drilldown per model in collapsible sections

**Step 2: Regenerate report as multi-model format**

Run benchmark with test provider to create initial multi-model structure:
```bash
cd packages/benchmarks
bun run src/run.ts --provider test --output ../../apps/docs/src/data/benchmark-report.json
```

**Step 3: Verify docs build**

Run: `cd apps/docs && bunx astro build`
Expected: 42+ pages built successfully

**Step 4: Commit**

```bash
git add apps/docs/src/components/BenchmarkResults.astro apps/docs/src/data/benchmark-report.json
git commit -m "feat(docs): multi-model benchmark comparison view with color-coded matrix"
```

---

### Task 10: Integration Verification

**Step 1: Full test suite**

Run: `bun test`
Expected: 1588+ tests pass, 0 fail

**Step 2: Full build**

Run: `bun run build`
Expected: All 20 packages + 2 apps build

**Step 3: Run test.ts to verify reactive strategy improvements**

Run: `bun run test.ts`
Expected improvements vs baseline (14.6s, 5834 tok, 7 steps):
- Faster tool inference (heuristic instead of LLM call)
- Model uses scratchpad-read when data is stored (no fabrication)
- Fewer tokens per iteration (tool context reduction)
- cogito:14b classified as "mid" tier (better prompts/budgets)

**Step 4: Docs build**

Run: `cd apps/docs && bunx astro build`
Expected: Complete build with benchmark page rendering

**Step 5: Final commit**

If any integration fixes needed, commit them.
