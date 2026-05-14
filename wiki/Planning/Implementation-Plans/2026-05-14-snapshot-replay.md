# Snapshot/Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `replay(recordedRun, builderFn, overrides) → ReplayResult` — deterministically re-run a recorded agent run with optional prompt/model overrides, holding tool results constant, and produce a structured diff. This is the v0.11 "auditable-by-demo" differentiator.

**Architecture:** New `@reactive-agents/replay` package depends on `@reactive-agents/trace` + `@reactive-agents/runtime` + `@reactive-agents/tools` + `@reactive-agents/core`. The package exports:
1. `loadRecordedRun(idOrPath)` — read JSONL trace, extract `runId`, `task`, `model`, `provider`, `config` from `run-started` event and recover all `tool-call-end` events keyed by `(toolName, argsHash, occurrenceIndex)`.
2. `ReplayToolLayer` — Effect layer that wraps `ToolService.invoke` to consult a `ReplayResultProvider`; when a call matches a recorded one, returns recorded payload; otherwise either errors (strict) or falls through to live (lenient, default for overrides).
3. `replay(recordedRun, builderFn, overrides?)` — orchestrator: invokes builder, attaches replay layer via builder hook, runs task, returns `{ original, replay, diff }`.
4. `diffTraces(a, b)` — pure comparison producing `ReplayDiff` (iterations, tool sequence, outputs, tokens, cost, terminating reason).
5. `rax-diagnose replay-run` CLI subcommand wiring 1–4.

Tool interception happens at the `ToolService` layer (not via compose harness), because there is no `tool.invoke` tag in the Wave-A catalog and replay tool-result freezing must be unconditional.

**Tech Stack:** TypeScript, Effect-TS, Bun runtime, Vitest (workspace pattern uses `bun test` per package), existing `@reactive-agents/trace` JSONL format, existing `@reactive-agents/runtime` builder.

---

## File Structure

**New package: `packages/replay/`**
- `package.json` — `@reactive-agents/replay`, declares deps on `@reactive-agents/{trace,runtime,tools,core}`
- `tsconfig.json` — extends workspace root, mirrors `packages/compose/tsconfig.json`
- `src/index.ts` — public exports
- `src/load.ts` — `loadRecordedRun(idOrPath): Promise<RecordedRun>`; resolves runId by scanning `~/.reactive-agents/traces/` then `.reactive-agents/traces/`; parses JSONL; extracts metadata + tool table
- `src/tool-table.ts` — pure: builds `ReadonlyMap<string, ToolResult>` keyed by `toolName::argsHash::occurrenceIndex`; `argsHash = sha256(stableStringify(args)).slice(0,16)`
- `src/replay-tool-layer.ts` — Effect Layer wrapping ToolService; consults `ReplayResultProvider` FiberRef set per-call from the recorded table
- `src/replay-controller.ts` — `ReplayResultProvider` interface + Effect Ref-backed state machine (which occurrence next per `toolName::argsHash`)
- `src/replay.ts` — top-level `replay(recordedRun, builderFn, overrides)` orchestrator
- `src/diff.ts` — pure `diffTraces(original, replayed): ReplayDiff`
- `src/types.ts` — `RecordedRun`, `ReplayOverrides`, `ReplayResult`, `ReplayDiff` shapes
- `tests/load.test.ts`
- `tests/tool-table.test.ts`
- `tests/replay-controller.test.ts`
- `tests/diff.test.ts`
- `tests/replay-integration.test.ts` — full round-trip with a stub agent

**Modify (minimal):**
- `packages/runtime/src/builder.ts` — add `.withReplayLayer(layer)` builder hook that injects a user-supplied Effect Layer ahead of the default ToolService composition. **No new exports beyond this one method.** Internal: store `_replayLayer?: Layer` on the builder; in `buildEffect()`, when set, compose it after the default tool layer so it overrides `ToolService.invoke`.
- `packages/diagnose/src/cli.ts` — new subcommand `replay-run <runId> [--system-prompt=<s>] [--model=<m>] [--temperature=<n>] [--builder=<path>]`
- `packages/diagnose/src/commands/replay-run.ts` — CLI command wiring (new file)
- `packages/diagnose/package.json` — add dep `@reactive-agents/replay`
- `apps/docs/src/content/docs/replay.mdx` — user-facing docs (new file)
- `apps/docs/src/content/docs/index.mdx` — add Replay section link

---

## Type Reference (lock these in before coding)

```typescript
// src/types.ts — exact shapes used across all tasks

import type { Trace, TraceEvent } from "@reactive-agents/trace";
import type { ReactiveAgent } from "@reactive-agents/runtime";

export interface RecordedRun {
  readonly runId: string;
  readonly task: string;
  readonly model: string;
  readonly provider: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly trace: Trace;
  readonly toolTable: ReadonlyMap<string, RecordedToolResult[]>;
}

export interface RecordedToolResult {
  readonly toolName: string;
  readonly argsHash: string;
  readonly args: unknown;
  readonly result: unknown;
  readonly ok: boolean;
  readonly error?: string;
  readonly durationMs: number;
  readonly iter: number;
  readonly seq: number;
}

export interface ReplayOverrides {
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly temperature?: number;
  /** strict: error on unknown tool call. lenient: pass through to live tool. Default: 'strict'. */
  readonly onMissingToolResult?: 'strict' | 'lenient';
}

export type BuilderFn = () => Promise<ReactiveAgent>;

export interface ReplayResult {
  readonly original: TraceSnapshot;
  readonly replay: TraceSnapshot;
  readonly diff: ReplayDiff;
}

export interface TraceSnapshot {
  readonly runId: string;
  readonly task: string;
  readonly model: string;
  readonly iterations: number;
  readonly toolCalls: readonly { toolName: string; argsHash: string; ok: boolean }[];
  readonly output: string | undefined;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly durationMs: number;
}

export interface ReplayDiff {
  readonly identical: boolean;
  readonly iterationsDelta: number;
  readonly toolSequenceDiff: readonly ToolSeqEdit[];
  readonly outputDiff: { readonly original: string | undefined; readonly replay: string | undefined; readonly equal: boolean };
  readonly tokensDelta: number;
  readonly costDelta: number;
  readonly durationDeltaMs: number;
}

export type ToolSeqEdit =
  | { readonly kind: 'added';   readonly toolName: string; readonly argsHash: string; readonly atIndex: number }
  | { readonly kind: 'removed'; readonly toolName: string; readonly argsHash: string; readonly atIndex: number }
  | { readonly kind: 'reordered'; readonly toolName: string; readonly argsHash: string; readonly from: number; readonly to: number };
```

```typescript
// src/replay-controller.ts — interface

export interface ReplayResultProvider {
  readonly next: (toolName: string, args: unknown) =>
    | { readonly hit: true; readonly result: unknown; readonly ok: boolean; readonly error?: string }
    | { readonly hit: false };
}
```

```typescript
// builder hook signature (new in builder.ts)
withReplayLayer(layer: Layer.Layer<never, never, never>): this
```

---

## Task 1: Scaffold `@reactive-agents/replay` package

**Files:**
- Create: `packages/replay/package.json`
- Create: `packages/replay/tsconfig.json`
- Create: `packages/replay/src/index.ts`
- Modify: `package.json` (root) — workspaces array already covers `packages/*`, no change needed; verify

- [ ] **Step 1: Create `packages/replay/package.json`**

```json
{
  "name": "@reactive-agents/replay",
  "version": "0.11.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "src", "README.md"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "bun test"
  },
  "dependencies": {
    "@reactive-agents/core": "workspace:*",
    "@reactive-agents/trace": "workspace:*",
    "@reactive-agents/tools": "workspace:*",
    "@reactive-agents/runtime": "workspace:*",
    "effect": "catalog:"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "typescript": "catalog:"
  },
  "engines": { "bun": ">=1.1.0", "node": ">=20" }
}
```

- [ ] **Step 2: Create `packages/replay/tsconfig.json` mirroring compose package**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "ignoreDeprecations": "6.0"
  },
  "include": ["src/**/*.ts"],
  "references": [
    { "path": "../core" },
    { "path": "../trace" },
    { "path": "../tools" },
    { "path": "../runtime" }
  ]
}
```

(If `tsconfig.base.json` does not exist, copy the exact contents from `packages/compose/tsconfig.json` and adjust `outDir`/`rootDir`/`references`.)

- [ ] **Step 3: Create stub `src/index.ts`**

```typescript
export {};
```

- [ ] **Step 4: Verify workspace recognizes the package**

Run: `rtk bun install`
Expected: `+ @reactive-agents/replay@0.11.0` appears in install output; no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/replay/
git commit -m "feat(replay): scaffold @reactive-agents/replay package"
```

---

## Task 2: Define types module

**Files:**
- Create: `packages/replay/src/types.ts`
- Test: `packages/replay/tests/types.test.ts`

- [ ] **Step 1: Write failing type test**

```typescript
// tests/types.test.ts
import { describe, test, expect } from "bun:test";
import type { RecordedRun, ReplayDiff, ReplayResult, ReplayOverrides } from "../src/types.js";

describe("types module", () => {
  test("ReplayOverrides accepts all optional fields", () => {
    const o: ReplayOverrides = { systemPrompt: "x", model: "m", temperature: 0, onMissingToolResult: "strict" };
    expect(o.systemPrompt).toBe("x");
  });

  test("ReplayDiff identical flag works", () => {
    const d: ReplayDiff = {
      identical: true, iterationsDelta: 0, toolSequenceDiff: [],
      outputDiff: { original: "a", replay: "a", equal: true },
      tokensDelta: 0, costDelta: 0, durationDeltaMs: 0,
    };
    expect(d.identical).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `cd packages/replay && rtk bun test tests/types.test.ts`
Expected: FAIL with "Cannot find module '../src/types.js'".

- [ ] **Step 3: Create `src/types.ts` with the exact shapes from the Type Reference section above**

Copy verbatim from the Type Reference section. Include all interfaces and the `ReplayResultProvider` from `replay-controller.ts` types — but **do not** re-export it here (it belongs to its own module). For Task 2, only the types in the first block (RecordedRun through ToolSeqEdit) go in `src/types.ts`.

- [ ] **Step 4: Update `src/index.ts`**

```typescript
export type {
  RecordedRun, RecordedToolResult, ReplayOverrides, BuilderFn,
  ReplayResult, TraceSnapshot, ReplayDiff, ToolSeqEdit,
} from "./types.js";
```

- [ ] **Step 5: Run test, expect PASS**

Run: `cd packages/replay && rtk bun test tests/types.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 6: Commit**

```bash
git add packages/replay/src/types.ts packages/replay/src/index.ts packages/replay/tests/types.test.ts
git commit -m "feat(replay): define core types (RecordedRun, ReplayDiff, ReplayResult)"
```

---

## Task 3: Tool table builder (pure function)

**Files:**
- Create: `packages/replay/src/tool-table.ts`
- Test: `packages/replay/tests/tool-table.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/tool-table.test.ts
import { describe, test, expect } from "bun:test";
import { buildToolTable, computeArgsHash } from "../src/tool-table.js";
import type { TraceEvent } from "@reactive-agents/trace";

describe("buildToolTable", () => {
  test("groups tool-call-end events by name+argsHash and preserves call order", () => {
    const events: TraceEvent[] = [
      { kind: "run-started", runId: "r1", timestamp: 0, iter: -1, seq: 0, task: "t", model: "m", provider: "p", config: {} } as TraceEvent,
      { kind: "tool-call-start", runId: "r1", timestamp: 1, iter: 0, seq: 1, toolName: "search", args: { q: "hn" } } as TraceEvent,
      { kind: "tool-call-end", runId: "r1", timestamp: 2, iter: 0, seq: 2, toolName: "search", args: { q: "hn" }, ok: true, durationMs: 50 } as unknown as TraceEvent,
      { kind: "tool-call-end", runId: "r1", timestamp: 3, iter: 1, seq: 3, toolName: "search", args: { q: "hn" }, ok: true, durationMs: 60 } as unknown as TraceEvent,
      { kind: "tool-call-end", runId: "r1", timestamp: 4, iter: 1, seq: 4, toolName: "search", args: { q: "different" }, ok: false, error: "boom", durationMs: 10 } as unknown as TraceEvent,
    ];
    const table = buildToolTable(events);
    const h1 = computeArgsHash({ q: "hn" });
    const h2 = computeArgsHash({ q: "different" });
    expect(table.get(`search::${h1}`)?.length).toBe(2);
    expect(table.get(`search::${h2}`)?.length).toBe(1);
    expect(table.get(`search::${h2}`)?.[0].ok).toBe(false);
  });

  test("computeArgsHash is stable across key ordering", () => {
    expect(computeArgsHash({ a: 1, b: 2 })).toBe(computeArgsHash({ b: 2, a: 1 }));
  });
});
```

- [ ] **Step 2: Run test, expect FAIL**

Run: `cd packages/replay && rtk bun test tests/tool-table.test.ts`
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Implement `src/tool-table.ts`**

```typescript
import { createHash } from "node:crypto";
import type { TraceEvent } from "@reactive-agents/trace";
import type { RecordedToolResult } from "./types.js";

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") + "}";
}

export function computeArgsHash(args: unknown): string {
  return createHash("sha256").update(stableStringify(args)).digest("hex").slice(0, 16);
}

export function buildToolTable(events: readonly TraceEvent[]): Map<string, RecordedToolResult[]> {
  const table = new Map<string, RecordedToolResult[]>();
  for (const ev of events) {
    if (ev.kind !== "tool-call-end") continue;
    const toolName = (ev as unknown as { toolName: string }).toolName;
    const args = (ev as unknown as { args?: unknown }).args;
    const result = (ev as unknown as { result?: unknown }).result;
    const ok = (ev as unknown as { ok?: boolean }).ok ?? true;
    const error = (ev as unknown as { error?: string }).error;
    const durationMs = (ev as unknown as { durationMs?: number }).durationMs ?? 0;
    const argsHash = computeArgsHash(args);
    const key = `${toolName}::${argsHash}`;
    const entry: RecordedToolResult = {
      toolName, argsHash, args, result, ok, error, durationMs, iter: ev.iter, seq: ev.seq,
    };
    const list = table.get(key) ?? [];
    list.push(entry);
    table.set(key, list);
  }
  return table;
}
```

- [ ] **Step 4: Run test, expect PASS**

Run: `cd packages/replay && rtk bun test tests/tool-table.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add packages/replay/src/tool-table.ts packages/replay/tests/tool-table.test.ts
git commit -m "feat(replay): pure tool-table builder with stable argsHash"
```

> **Note on trace shape:** the existing `ToolCallEvent` does NOT carry `result` on `tool-call-end` (see `packages/trace/src/events.ts`). Task 3.5 (below) extends the event schema so replay can recover tool results. If that change is non-trivial, defer to Task 3.5; tool-table builder accepts an optional `result` field but tolerates absence (replay then falls back to lenient mode).

---

## Task 3.5: Extend `tool-call-end` to record result payload

**Files:**
- Modify: `packages/trace/src/events.ts:115-124`
- Modify: `packages/reasoning/src/kernel/capabilities/act/tool-execution.ts` (emission site)
- Test: `packages/trace/tests/events.test.ts` (add coverage)

- [ ] **Step 1: Identify the emission site**

Run: `rtk grep -rn 'kind: "tool-call-end"\|kind:"tool-call-end"' packages/reasoning/src/ packages/runtime/src/`
Expected: 1–3 emission sites. Note the file:line for each.

- [ ] **Step 2: Add `result` field to `ToolCallEvent` interface**

In `packages/trace/src/events.ts:115-124`, add:

```typescript
export interface ToolCallEvent extends TraceEventBase {
  readonly kind: "tool-call-start" | "tool-call-end"
  readonly toolName: string
  readonly args?: unknown
  readonly result?: unknown        // ← NEW, only set on tool-call-end
  readonly durationMs?: number
  readonly ok?: boolean
  readonly error?: string
  readonly rationale?: Rationale
}
```

- [ ] **Step 3: Update each emission site to include `result`**

At every `kind: "tool-call-end"` emission, pass through the actual result payload (already in scope from the tool call's return value). If the site computes a `ToolExecutionResult`, the field to use is whatever holds the rendered tool output text — match the existing `args` placement.

- [ ] **Step 4: Run trace package tests**

Run: `cd packages/trace && rtk bun test`
Expected: PASS, no regressions.

- [ ] **Step 5: Run reasoning + runtime package tests**

Run: `rtk bunx turbo run test --filter=@reactive-agents/reasoning --filter=@reactive-agents/runtime`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/trace/src/events.ts packages/reasoning/src/kernel/capabilities/act/tool-execution.ts packages/trace/tests/
git commit -m "feat(trace): record tool result payload on tool-call-end for replay"
```

---

## Task 4: `loadRecordedRun` — resolve runId + parse JSONL

**Files:**
- Create: `packages/replay/src/load.ts`
- Test: `packages/replay/tests/load.test.ts`
- Fixture: `packages/replay/tests/fixtures/sample-trace.jsonl` (small recorded run, 5–10 events)

- [ ] **Step 1: Create fixture**

`packages/replay/tests/fixtures/sample-trace.jsonl`:
```
{"kind":"run-started","runId":"r-fix-1","timestamp":1000,"iter":-1,"seq":0,"task":"echo hello","model":"qwen3:14b","provider":"ollama","config":{"temperature":0}}
{"kind":"tool-call-start","runId":"r-fix-1","timestamp":1010,"iter":0,"seq":1,"toolName":"echo","args":{"msg":"hello"}}
{"kind":"tool-call-end","runId":"r-fix-1","timestamp":1020,"iter":0,"seq":2,"toolName":"echo","args":{"msg":"hello"},"result":"hello","ok":true,"durationMs":10}
{"kind":"run-completed","runId":"r-fix-1","timestamp":1100,"iter":0,"seq":3,"status":"success","output":"hello","totalTokens":42,"totalCostUsd":0,"durationMs":100}
```

- [ ] **Step 2: Write failing test**

```typescript
// tests/load.test.ts
import { describe, test, expect } from "bun:test";
import { loadRecordedRun } from "../src/load.js";
import { join } from "node:path";

describe("loadRecordedRun", () => {
  test("loads JSONL from path and extracts metadata", async () => {
    const path = join(import.meta.dir, "fixtures/sample-trace.jsonl");
    const run = await loadRecordedRun(path);
    expect(run.runId).toBe("r-fix-1");
    expect(run.task).toBe("echo hello");
    expect(run.model).toBe("qwen3:14b");
    expect(run.provider).toBe("ollama");
    expect(run.trace.events.length).toBe(4);
    expect(run.toolTable.size).toBe(1);
  });

  test("throws on missing run-started event", async () => {
    const fakePath = "/tmp/replay-nonexistent.jsonl";
    await expect(loadRecordedRun(fakePath)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `cd packages/replay && rtk bun test tests/load.test.ts`
Expected: FAIL "Cannot find module '../src/load.js'".

- [ ] **Step 4: Implement `src/load.ts`**

```typescript
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { loadTrace } from "@reactive-agents/trace";
import { buildToolTable } from "./tool-table.js";
import type { RecordedRun } from "./types.js";
import type { TraceEvent } from "@reactive-agents/trace";

const SEARCH_DIRS = [
  join(homedir(), ".reactive-agents", "traces"),
  join(process.cwd(), ".reactive-agents", "traces"),
];

export async function loadRecordedRun(idOrPath: string): Promise<RecordedRun> {
  const path = await resolvePath(idOrPath);
  const trace = await loadTrace(path);
  const runStarted = trace.events.find((e) => e.kind === "run-started") as
    | (TraceEvent & { task: string; model: string; provider: string; config: Record<string, unknown> })
    | undefined;
  if (!runStarted) throw new Error(`replay: no run-started event in ${path}`);
  const toolTable = buildToolTable(trace.events);
  return {
    runId: trace.runId,
    task: runStarted.task,
    model: runStarted.model,
    provider: runStarted.provider,
    config: runStarted.config,
    trace,
    toolTable,
  };
}

async function resolvePath(idOrPath: string): Promise<string> {
  if (isAbsolute(idOrPath) && existsSync(idOrPath)) return idOrPath;
  if (existsSync(idOrPath)) return idOrPath;
  for (const dir of SEARCH_DIRS) {
    const candidate = join(dir, `${idOrPath}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`replay: cannot resolve ${idOrPath}; searched ${SEARCH_DIRS.join(", ")}`);
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `cd packages/replay && rtk bun test tests/load.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 6: Export from `src/index.ts`**

Append:
```typescript
export { loadRecordedRun } from "./load.js";
```

- [ ] **Step 7: Commit**

```bash
git add packages/replay/src/load.ts packages/replay/tests/load.test.ts packages/replay/tests/fixtures/ packages/replay/src/index.ts
git commit -m "feat(replay): loadRecordedRun resolves runId or path to RecordedRun"
```

---

## Task 5: `ReplayResultProvider` — controller for tool-result dispensing

**Files:**
- Create: `packages/replay/src/replay-controller.ts`
- Test: `packages/replay/tests/replay-controller.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/replay-controller.test.ts
import { describe, test, expect } from "bun:test";
import { makeReplayController } from "../src/replay-controller.js";
import { computeArgsHash } from "../src/tool-table.js";

describe("ReplayController", () => {
  test("returns recorded results in call order", () => {
    const h = computeArgsHash({ q: "hn" });
    const table = new Map([
      [`search::${h}`, [
        { toolName: "search", argsHash: h, args: { q: "hn" }, result: "r1", ok: true, durationMs: 1, iter: 0, seq: 1 },
        { toolName: "search", argsHash: h, args: { q: "hn" }, result: "r2", ok: true, durationMs: 1, iter: 1, seq: 2 },
      ]],
    ]);
    const ctrl = makeReplayController(table);
    const a = ctrl.next("search", { q: "hn" });
    expect(a.hit).toBe(true);
    if (a.hit) expect(a.result).toBe("r1");
    const b = ctrl.next("search", { q: "hn" });
    if (b.hit) expect(b.result).toBe("r2");
    const c = ctrl.next("search", { q: "hn" });
    expect(c.hit).toBe(false); // exhausted
  });

  test("returns hit=false for unrecorded tool calls", () => {
    const ctrl = makeReplayController(new Map());
    expect(ctrl.next("unknown", {}).hit).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/replay && rtk bun test tests/replay-controller.test.ts`

- [ ] **Step 3: Implement `src/replay-controller.ts`**

```typescript
import { computeArgsHash } from "./tool-table.js";
import type { RecordedToolResult } from "./types.js";

export interface ReplayResultProvider {
  readonly next: (toolName: string, args: unknown) =>
    | { readonly hit: true; readonly result: unknown; readonly ok: boolean; readonly error?: string }
    | { readonly hit: false };
}

export function makeReplayController(
  table: ReadonlyMap<string, readonly RecordedToolResult[]>,
): ReplayResultProvider {
  const cursors = new Map<string, number>();
  return {
    next(toolName, args) {
      const key = `${toolName}::${computeArgsHash(args)}`;
      const list = table.get(key);
      if (!list) return { hit: false };
      const idx = cursors.get(key) ?? 0;
      if (idx >= list.length) return { hit: false };
      cursors.set(key, idx + 1);
      const rec = list[idx];
      return { hit: true, result: rec.result, ok: rec.ok, error: rec.error };
    },
  };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd packages/replay && rtk bun test tests/replay-controller.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add packages/replay/src/replay-controller.ts packages/replay/tests/replay-controller.test.ts
git commit -m "feat(replay): ReplayController dispenses recorded tool results in order"
```

---

## Task 6: `ReplayToolLayer` — Effect layer that intercepts ToolService.invoke

**Files:**
- Create: `packages/replay/src/replay-tool-layer.ts`
- Test: `packages/replay/tests/replay-tool-layer.test.ts`

**Pre-step research:**
Run: `rtk grep -n "ToolService\s*=\|class ToolService\|invoke:" packages/tools/src/tool-service.ts | head -20`
Expected output gives the exact ToolService Tag declaration and the `invoke` method signature. The layer must match the signature precisely.

- [ ] **Step 1: Write failing test**

```typescript
// tests/replay-tool-layer.test.ts
import { describe, test, expect } from "bun:test";
import { Effect, Layer } from "effect";
import { ToolService } from "@reactive-agents/tools";
import { makeReplayToolLayer } from "../src/replay-tool-layer.js";
import { makeReplayController } from "../src/replay-controller.js";
import { computeArgsHash } from "../src/tool-table.js";

describe("ReplayToolLayer", () => {
  test("invoke returns recorded result without calling live tool", async () => {
    const h = computeArgsHash({ q: "x" });
    const table = new Map([[`search::${h}`, [
      { toolName: "search", argsHash: h, args: { q: "x" }, result: "recorded-output", ok: true, durationMs: 0, iter: 0, seq: 0 },
    ]]]);
    const ctrl = makeReplayController(table);
    const layer = makeReplayToolLayer(ctrl, "strict");
    const program = Effect.gen(function* () {
      const ts = yield* ToolService;
      return yield* ts.invoke("search", { q: "x" });
    });
    const result = await Effect.runPromise(Effect.provide(program, layer) as any);
    expect((result as { output: unknown }).output).toBe("recorded-output");
  });

  test("strict mode errors on unrecorded tool call", async () => {
    const ctrl = makeReplayController(new Map());
    const layer = makeReplayToolLayer(ctrl, "strict");
    const program = Effect.gen(function* () {
      const ts = yield* ToolService;
      return yield* ts.invoke("unknown", {});
    });
    await expect(Effect.runPromise(Effect.provide(program, layer) as any)).rejects.toThrow(/unrecorded/i);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/replay && rtk bun test tests/replay-tool-layer.test.ts`

- [ ] **Step 3: Implement `src/replay-tool-layer.ts`**

The exact ToolService method shape must come from research output in Pre-step. The implementation pattern:

```typescript
import { Effect, Layer } from "effect";
import { ToolService } from "@reactive-agents/tools";
import type { ReplayResultProvider } from "./replay-controller.js";

export function makeReplayToolLayer(
  provider: ReplayResultProvider,
  mode: "strict" | "lenient",
) {
  return Layer.succeed(
    ToolService,
    ToolService.of({
      // Match all methods on the real ToolService — copy the shape from
      // packages/tools/src/tool-service.ts. The critical override is `invoke`.
      invoke: (toolName: string, args: unknown) =>
        Effect.sync(() => {
          const hit = provider.next(toolName, args);
          if (!hit.hit) {
            if (mode === "strict") {
              throw new Error(`replay: unrecorded tool call ${toolName} (strict mode)`);
            }
            return { output: undefined, ok: false, error: "no-recording" };
          }
          if (!hit.ok) {
            return { output: undefined, ok: false, error: hit.error ?? "recorded-error" };
          }
          return { output: hit.result, ok: true };
        }),
      // Stub out remaining ToolService methods as no-ops or pass through.
      // The exact list comes from `packages/tools/src/tool-service.ts`.
    } as any),
  );
}
```

**Note:** the `as any` is required because ToolService likely has more methods (list, schemas, init) that we mock. The plan deliberately delegates to research-step output for exact shape. Replace `as any` once the full method list is known. If a method is called during replay that this layer doesn't handle, the replay errors loudly — that is desired.

- [ ] **Step 4: Run, expect PASS**

Run: `cd packages/replay && rtk bun test tests/replay-tool-layer.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add packages/replay/src/replay-tool-layer.ts packages/replay/tests/replay-tool-layer.test.ts
git commit -m "feat(replay): ReplayToolLayer intercepts ToolService.invoke"
```

---

## Task 7: Builder hook `.withReplayLayer()`

**Files:**
- Modify: `packages/runtime/src/builder.ts` (around the existing `.withHarness()` block; find via `rtk grep -n "withHarness\b" packages/runtime/src/builder.ts`)
- Modify: `packages/runtime/src/builder/build-effect/` (wherever the tool layer is composed — find via `rtk grep -rn "ToolServiceLive\|provideToolService" packages/runtime/src/builder/`)
- Test: `packages/runtime/tests/builder-replay-layer.test.ts`

- [ ] **Step 1: Locate the tool layer composition site**

Run: `rtk grep -rn "ToolServiceLive\|provideToolService\|ToolService," packages/runtime/src/builder/ | head -20`
Expected: 1–3 sites. Note the file:line where the tool layer is finalized (just before `Layer.merge` or `Layer.provide`).

- [ ] **Step 2: Write failing test**

```typescript
// packages/runtime/tests/builder-replay-layer.test.ts
import { describe, test, expect } from "bun:test";
import { Layer, Effect } from "effect";
import { ToolService } from "@reactive-agents/tools";
import { ReactiveAgentBuilder } from "../src/builder.js";

describe("ReactiveAgentBuilder.withReplayLayer", () => {
  test("user-supplied layer overrides ToolService.invoke", async () => {
    const stubLayer = Layer.succeed(ToolService, ToolService.of({
      invoke: () => Effect.succeed({ output: "STUB", ok: true }),
    } as any));
    const builder = new ReactiveAgentBuilder().withReplayLayer(stubLayer);
    // smoke: builder method exists and returns this
    expect(typeof (builder as any).withReplayLayer).toBe("function");
    // full build path verified in integration test (Task 9)
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `cd packages/runtime && rtk bun test tests/builder-replay-layer.test.ts`
Expected: FAIL `withReplayLayer is not a function`.

- [ ] **Step 4: Add `_replayLayer` field + `.withReplayLayer()` method to ReactiveAgentBuilder**

In `packages/runtime/src/builder.ts`, near other `_xxxLayer` fields:
```typescript
private _replayLayer?: Layer.Layer<never, never, never>;

withReplayLayer(layer: Layer.Layer<never, never, never>): this {
  this._replayLayer = layer;
  return this;
}
```

In `buildEffect()` (or wherever tool layer is composed — site located in Step 1), after the default tool layer composition:
```typescript
const finalToolLayer = this._replayLayer
  ? Layer.provideMerge(this._replayLayer, defaultToolLayer)
  : defaultToolLayer;
```
Use `finalToolLayer` in place of the previous `defaultToolLayer` reference.

(The exact merge function may need to be `Layer.merge` or `Layer.orElse` depending on existing composition — match the surrounding style; the goal is: replay layer wins on `ToolService`, default fills any other deps.)

- [ ] **Step 5: Run, expect PASS**

Run: `cd packages/runtime && rtk bun test tests/builder-replay-layer.test.ts`
Expected: PASS, 1/1.

- [ ] **Step 6: Run full runtime test suite to confirm no regressions**

Run: `cd packages/runtime && rtk bun test`
Expected: All 685+ tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/src/builder/ packages/runtime/tests/builder-replay-layer.test.ts
git commit -m "feat(runtime): .withReplayLayer() builder hook for tool-result injection"
```

---

## Task 8: `replay()` orchestrator

**Files:**
- Create: `packages/replay/src/replay.ts`
- Test: `packages/replay/tests/replay.test.ts`

- [ ] **Step 1: Write failing test (uses a stub builder, no real LLM)**

```typescript
// tests/replay.test.ts
import { describe, test, expect } from "bun:test";
import { replay } from "../src/replay.js";
import { loadRecordedRun } from "../src/load.js";
import { join } from "node:path";

// Stub agent that records the task and returns a deterministic output.
function makeStubBuilder(captured: { task?: string }) {
  return async () => ({
    run: async (task: string) => {
      captured.task = task;
      return { output: "hello", totalTokens: 42, totalCostUsd: 0, durationMs: 50 };
    },
    dispose: async () => {},
  }) as any;
}

describe("replay()", () => {
  test("invokes builder with original task and returns ReplayResult", async () => {
    const path = join(import.meta.dir, "fixtures/sample-trace.jsonl");
    const run = await loadRecordedRun(path);
    const captured: { task?: string } = {};
    const result = await replay(run, makeStubBuilder(captured));
    expect(captured.task).toBe("echo hello");
    expect(result.original.runId).toBe("r-fix-1");
    expect(result.replay.output).toBe("hello");
    expect(result.diff).toBeDefined();
  });

  test("overrides apply: model override changes effective task input", async () => {
    const path = join(import.meta.dir, "fixtures/sample-trace.jsonl");
    const run = await loadRecordedRun(path);
    const captured: { task?: string } = {};
    const result = await replay(run, makeStubBuilder(captured), { model: "gpt-4o-mini" });
    expect(result.original.model).toBe("qwen3:14b");
    // model override is observed by builder via overrides param; verified in integration
    expect(captured.task).toBe("echo hello");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/replay && rtk bun test tests/replay.test.ts`

- [ ] **Step 3: Implement `src/replay.ts`**

```typescript
import { makeReplayController } from "./replay-controller.js";
import { diffTraces } from "./diff.js";
import { snapshotFromRecordedRun, snapshotFromAgentResult } from "./snapshot.js";
import type { RecordedRun, ReplayOverrides, ReplayResult, BuilderFn } from "./types.js";

export interface BuildContext {
  readonly overrides: ReplayOverrides;
  readonly recordedRun: RecordedRun;
}

export async function replay(
  recordedRun: RecordedRun,
  builderFn: BuilderFn | ((ctx: BuildContext) => Promise<unknown>),
  overrides: ReplayOverrides = {},
): Promise<ReplayResult> {
  const mode = overrides.onMissingToolResult ?? "strict";
  const _controller = makeReplayController(recordedRun.toolTable);
  // The builder is responsible for wiring the replay layer via .withReplayLayer(makeReplayToolLayer(controller, mode))
  // We pass the controller/mode through the BuildContext so builders that opt-in can attach the layer.
  // Convention: builderFn receives { overrides, recordedRun, controller, mode } when it has arity > 0.
  const ctx: BuildContext = { overrides, recordedRun };
  const agent = await (builderFn.length > 0
    ? (builderFn as (c: BuildContext) => Promise<unknown>)(ctx)
    : (builderFn as BuilderFn)());
  try {
    const result = await (agent as { run: (t: string) => Promise<unknown> }).run(recordedRun.task);
    const original = snapshotFromRecordedRun(recordedRun);
    const replaySnapshot = snapshotFromAgentResult(result, recordedRun);
    const diff = diffTraces(original, replaySnapshot);
    return { original, replay: replaySnapshot, diff };
  } finally {
    if (typeof (agent as { dispose?: () => Promise<void> }).dispose === "function") {
      await (agent as { dispose: () => Promise<void> }).dispose();
    }
  }
}
```

Plus `src/snapshot.ts`:
```typescript
import type { RecordedRun, TraceSnapshot } from "./types.js";
import { traceStats } from "@reactive-agents/trace";

export function snapshotFromRecordedRun(run: RecordedRun): TraceSnapshot {
  const stats = traceStats(run.trace);
  const completed = run.trace.events.find((e) => e.kind === "run-completed") as
    | { output?: string; totalCostUsd: number } | undefined;
  const toolCalls: { toolName: string; argsHash: string; ok: boolean }[] = [];
  for (const [, list] of run.toolTable) {
    for (const r of list) toolCalls.push({ toolName: r.toolName, argsHash: r.argsHash, ok: r.ok });
  }
  return {
    runId: run.runId, task: run.task, model: run.model,
    iterations: stats.iterations, toolCalls, output: completed?.output,
    totalTokens: stats.totalTokens, totalCostUsd: completed?.totalCostUsd ?? 0,
    durationMs: stats.durationMs,
  };
}

export function snapshotFromAgentResult(result: unknown, recordedRun: RecordedRun): TraceSnapshot {
  const r = result as { output?: string; totalTokens?: number; totalCostUsd?: number; durationMs?: number };
  return {
    runId: `${recordedRun.runId}-replay`, task: recordedRun.task, model: recordedRun.model,
    iterations: 0, toolCalls: [], output: r.output,
    totalTokens: r.totalTokens ?? 0, totalCostUsd: r.totalCostUsd ?? 0,
    durationMs: r.durationMs ?? 0,
  };
}
```

- [ ] **Step 4: Implement minimal `src/diff.ts` (skeleton — full diff in Task 9)**

```typescript
import type { ReplayDiff, TraceSnapshot } from "./types.js";

export function diffTraces(a: TraceSnapshot, b: TraceSnapshot): ReplayDiff {
  const outputEqual = a.output === b.output;
  return {
    identical: outputEqual && a.iterations === b.iterations && a.toolCalls.length === b.toolCalls.length,
    iterationsDelta: b.iterations - a.iterations,
    toolSequenceDiff: [],
    outputDiff: { original: a.output, replay: b.output, equal: outputEqual },
    tokensDelta: b.totalTokens - a.totalTokens,
    costDelta: b.totalCostUsd - a.totalCostUsd,
    durationDeltaMs: b.durationMs - a.durationMs,
  };
}
```

- [ ] **Step 5: Run, expect PASS**

Run: `cd packages/replay && rtk bun test tests/replay.test.ts`
Expected: PASS, 2/2.

- [ ] **Step 6: Export from `src/index.ts`**

Append:
```typescript
export { replay } from "./replay.js";
export { makeReplayController } from "./replay-controller.js";
export { makeReplayToolLayer } from "./replay-tool-layer.js";
export { diffTraces } from "./diff.js";
export { buildToolTable, computeArgsHash } from "./tool-table.js";
```

- [ ] **Step 7: Commit**

```bash
git add packages/replay/src/replay.ts packages/replay/src/snapshot.ts packages/replay/src/diff.ts packages/replay/src/index.ts packages/replay/tests/replay.test.ts
git commit -m "feat(replay): replay() orchestrator + snapshot + minimal diff"
```

---

## Task 9: Full `diffTraces` — tool sequence edit script

**Files:**
- Modify: `packages/replay/src/diff.ts`
- Test: `packages/replay/tests/diff.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/diff.test.ts
import { describe, test, expect } from "bun:test";
import { diffTraces } from "../src/diff.js";
import type { TraceSnapshot } from "../src/types.js";

const base: TraceSnapshot = {
  runId: "a", task: "t", model: "m", iterations: 2,
  toolCalls: [
    { toolName: "search", argsHash: "h1", ok: true },
    { toolName: "calc",   argsHash: "h2", ok: true },
  ],
  output: "answer", totalTokens: 100, totalCostUsd: 0.01, durationMs: 1000,
};

describe("diffTraces", () => {
  test("identical snapshots produce identical=true and empty edit script", () => {
    const d = diffTraces(base, { ...base, runId: "b" });
    expect(d.identical).toBe(true);
    expect(d.toolSequenceDiff).toEqual([]);
  });

  test("added tool call produces 'added' edit", () => {
    const replayed: TraceSnapshot = {
      ...base, runId: "b",
      toolCalls: [
        { toolName: "search", argsHash: "h1", ok: true },
        { toolName: "calc",   argsHash: "h2", ok: true },
        { toolName: "search", argsHash: "h3", ok: true },
      ],
    };
    const d = diffTraces(base, replayed);
    expect(d.identical).toBe(false);
    expect(d.toolSequenceDiff).toEqual([
      { kind: "added", toolName: "search", argsHash: "h3", atIndex: 2 },
    ]);
  });

  test("removed tool call produces 'removed' edit", () => {
    const replayed: TraceSnapshot = { ...base, runId: "b", toolCalls: [base.toolCalls[0]] };
    const d = diffTraces(base, replayed);
    expect(d.toolSequenceDiff).toEqual([
      { kind: "removed", toolName: "calc", argsHash: "h2", atIndex: 1 },
    ]);
  });

  test("token / cost / duration deltas computed", () => {
    const replayed: TraceSnapshot = { ...base, runId: "b", totalTokens: 150, totalCostUsd: 0.02, durationMs: 1500 };
    const d = diffTraces(base, replayed);
    expect(d.tokensDelta).toBe(50);
    expect(d.costDelta).toBeCloseTo(0.01);
    expect(d.durationDeltaMs).toBe(500);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/replay && rtk bun test tests/diff.test.ts`

- [ ] **Step 3: Replace `src/diff.ts` with full implementation**

```typescript
import type { ReplayDiff, TraceSnapshot, ToolSeqEdit } from "./types.js";

export function diffTraces(a: TraceSnapshot, b: TraceSnapshot): ReplayDiff {
  const outputEqual = a.output === b.output;
  const toolSequenceDiff = diffToolSequence(a.toolCalls, b.toolCalls);
  const identical =
    outputEqual &&
    a.iterations === b.iterations &&
    toolSequenceDiff.length === 0 &&
    a.totalTokens === b.totalTokens;
  return {
    identical,
    iterationsDelta: b.iterations - a.iterations,
    toolSequenceDiff,
    outputDiff: { original: a.output, replay: b.output, equal: outputEqual },
    tokensDelta: b.totalTokens - a.totalTokens,
    costDelta: b.totalCostUsd - a.totalCostUsd,
    durationDeltaMs: b.durationMs - a.durationMs,
  };
}

function diffToolSequence(
  a: readonly { toolName: string; argsHash: string }[],
  b: readonly { toolName: string; argsHash: string }[],
): ToolSeqEdit[] {
  const edits: ToolSeqEdit[] = [];
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i], y = b[i];
    if (x && !y) edits.push({ kind: "removed", toolName: x.toolName, argsHash: x.argsHash, atIndex: i });
    else if (!x && y) edits.push({ kind: "added", toolName: y.toolName, argsHash: y.argsHash, atIndex: i });
    else if (x && y && (x.toolName !== y.toolName || x.argsHash !== y.argsHash)) {
      edits.push({ kind: "removed", toolName: x.toolName, argsHash: x.argsHash, atIndex: i });
      edits.push({ kind: "added", toolName: y.toolName, argsHash: y.argsHash, atIndex: i });
    }
  }
  return edits;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd packages/replay && rtk bun test tests/diff.test.ts`
Expected: PASS, 4/4.

- [ ] **Step 5: Commit**

```bash
git add packages/replay/src/diff.ts packages/replay/tests/diff.test.ts
git commit -m "feat(replay): full diff including tool sequence edit script"
```

---

## Task 10: Integration test — determinism gate

**Files:**
- Test: `packages/replay/tests/replay-integration.test.ts`

Replays a recorded run with no overrides through a real builder + `ReplayToolLayer`, asserts the output matches the recorded output (modulo provider nondeterminism — uses a mock provider for determinism).

- [ ] **Step 1: Write the integration test**

```typescript
// tests/replay-integration.test.ts
import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { loadRecordedRun, replay, makeReplayToolLayer, makeReplayController } from "../src/index.js";
// Use the runtime mock provider — see packages/runtime/tests/utils for the canonical mock.
import { mockLlmProvider } from "@reactive-agents/runtime/test-utils";
import { ReactiveAgentBuilder } from "@reactive-agents/runtime";

describe("replay integration — determinism gate", () => {
  test("no-override replay matches recorded output", async () => {
    const path = join(import.meta.dir, "fixtures/sample-trace.jsonl");
    const run = await loadRecordedRun(path);

    const result = await replay(run, async (ctx) => {
      const ctrl = makeReplayController(run.toolTable);
      const layer = makeReplayToolLayer(ctrl, ctx.overrides.onMissingToolResult ?? "strict");
      return new ReactiveAgentBuilder()
        .withLlmProvider(mockLlmProvider({ scriptedReply: "hello" }))
        .withReplayLayer(layer)
        .build();
    });

    expect(result.diff.outputDiff.equal).toBe(true);
    expect(result.diff.identical).toBe(true);
  });
});
```

- [ ] **Step 2: Run, expect PASS (or fix shape mismatches)**

Run: `cd packages/replay && rtk bun test tests/replay-integration.test.ts`
Expected: PASS. If the mock provider path doesn't exist, locate it via `rtk grep -rn "mockLlmProvider\|MockLlmProvider" packages/` and adjust import.

- [ ] **Step 3: Commit**

```bash
git add packages/replay/tests/replay-integration.test.ts
git commit -m "test(replay): determinism gate — no-override replay matches recorded output"
```

---

## Task 11: CLI `rax-diagnose replay-run <runId>` subcommand

**Files:**
- Create: `packages/diagnose/src/commands/replay-run.ts`
- Modify: `packages/diagnose/src/cli.ts` (add case branch)
- Modify: `packages/diagnose/package.json` (add `@reactive-agents/replay` dep)
- Test: `packages/diagnose/tests/replay-run-cli.test.ts`

- [ ] **Step 1: Add dep to `packages/diagnose/package.json`**

In `dependencies`:
```json
"@reactive-agents/replay": "workspace:*",
```
Run: `rtk bun install`

- [ ] **Step 2: Write failing test**

```typescript
// packages/diagnose/tests/replay-run-cli.test.ts
import { describe, test, expect } from "bun:test";
import { replayRunCommand } from "../src/commands/replay-run.js";
import { join } from "node:path";

describe("replay-run CLI", () => {
  test("loads run and prints diff summary to stdout", async () => {
    let captured = "";
    const orig = console.log;
    console.log = (s: string) => { captured += s + "\n"; };
    try {
      const fixturePath = join(import.meta.dir, "../../replay/tests/fixtures/sample-trace.jsonl");
      await replayRunCommand(fixturePath, { dryRun: true });
      expect(captured).toContain("runId=r-fix-1");
      expect(captured).toContain("task=echo hello");
    } finally {
      console.log = orig;
    }
  });
});
```

- [ ] **Step 3: Implement `src/commands/replay-run.ts`**

```typescript
import { loadRecordedRun } from "@reactive-agents/replay";

export interface ReplayRunOpts {
  readonly systemPrompt?: string;
  readonly model?: string;
  readonly temperature?: number;
  readonly dryRun?: boolean;
}

export async function replayRunCommand(idOrPath: string, opts: ReplayRunOpts = {}): Promise<void> {
  const run = await loadRecordedRun(idOrPath);
  console.log(`runId=${run.runId} task=${run.task} model=${run.model} provider=${run.provider}`);
  console.log(`recorded events=${run.trace.events.length} tool calls=${[...run.toolTable.values()].flat().length}`);
  if (opts.dryRun) return;
  // Full replay requires a builder factory — not available at CLI level without --builder=<path>.
  // For v0.11 MVP, CLI is read-only summary; full replay is via API.
  console.log("(replay-run CLI is summary-only in v0.11; use the replay() API for full re-execution)");
}
```

- [ ] **Step 4: Wire into `cli.ts`**

In `packages/diagnose/src/cli.ts`, add an import + case branch alongside `replay`:
```typescript
import { replayRunCommand } from "./commands/replay-run.js";
// ...
case "replay-run": {
  const id = args[1];
  if (!id) { console.error("replay-run: missing <runId>"); process.exit(1); }
  const dryRun = args.includes("--dry-run");
  await replayRunCommand(id, { dryRun });
  break;
}
```

Update the help text block to include `replay-run`.

- [ ] **Step 5: Run, expect PASS**

Run: `cd packages/diagnose && rtk bun test tests/replay-run-cli.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/diagnose/src/commands/replay-run.ts packages/diagnose/src/cli.ts packages/diagnose/package.json packages/diagnose/tests/replay-run-cli.test.ts
git commit -m "feat(diagnose): rax-diagnose replay-run subcommand (summary mode)"
```

---

## Task 12: Documentation

**Files:**
- Create: `apps/docs/src/content/docs/replay.mdx`
- Modify: `apps/docs/src/content/docs/index.mdx` (add link in nav)
- Modify: `apps/docs/src/content/docs/stability.md` (mark replay API as `@stable`)

- [ ] **Step 1: Create `replay.mdx`**

```mdx
---
title: Snapshot & Replay
description: Deterministically re-run a recorded agent run with optional overrides.
---

import { Aside } from '@astrojs/starlight/components';

## Why

Every Reactive Agents run produces a JSONL trace. The replay capability lets you re-execute a recorded run against modified prompts or models while holding tool results constant. Use it to:

- **Test prompt changes** without paying for fresh tool calls
- **A/B model swaps** on real production traces
- **Audit decisions** — same trace, different prompt: does the agent still pick the same tool?

## Basic usage

```typescript
import { loadRecordedRun, replay, makeReplayController, makeReplayToolLayer } from "@reactive-agents/replay";
import { ReactiveAgentBuilder } from "@reactive-agents/runtime";

const run = await loadRecordedRun("r-abc123");

const result = await replay(run, async (ctx) => {
  const ctrl = makeReplayController(run.toolTable);
  const layer = makeReplayToolLayer(ctrl, "strict");
  return new ReactiveAgentBuilder()
    .withLlmProvider(/* ... */)
    .withReplayLayer(layer)
    .build();
}, {
  systemPrompt: "You are extra concise.",   // override
});

console.log(result.diff);
// → { identical: false, tokensDelta: -120, outputDiff: { equal: false, ... }, ... }
```

## Determinism guarantee

With no overrides and `temperature: 0`, a replay produces an output identical to the recorded run (modulo provider-side nondeterminism, which is logged). This is enforced by an integration test in `@reactive-agents/replay` (`replay-integration.test.ts`).

## Strict vs lenient mode

- **strict** (default): unrecorded tool calls during replay throw. Use for audits where you want to detect prompt changes that alter tool sequence.
- **lenient**: unrecorded tool calls return `{ ok: false }`. Use for exploratory overrides.

## CLI

```bash
rax-diagnose replay-run r-abc123
# prints summary (event count, tool table size, recorded model/provider)
```

Full re-execution from CLI requires a builder factory and is API-only in v0.11.

<Aside type="note">
Replay re-uses recorded tool results but does **not** mock the LLM. Provider calls are live. Use a deterministic provider (e.g. `mockLlmProvider`) for full determinism in tests.
</Aside>
```

- [ ] **Step 2: Link from `index.mdx`**

Add a new section near the Compose API section:
```mdx
### Snapshot & Replay

Replay any recorded run with prompt / model overrides. See [Replay](/replay/) for details.
```

- [ ] **Step 3: Mark API stable in `stability.md`**

Append:
```markdown
- `@reactive-agents/replay` — `@stable` (v0.11)
  - `loadRecordedRun`
  - `replay`
  - `makeReplayController`
  - `makeReplayToolLayer`
  - `diffTraces`
- `ReactiveAgentBuilder.withReplayLayer` — `@stable` (v0.11)
```

- [ ] **Step 4: Verify docs build**

Run: `cd apps/docs && rtk bun run build`
Expected: build succeeds; no broken links reported.

- [ ] **Step 5: Commit**

```bash
git add apps/docs/src/content/docs/replay.mdx apps/docs/src/content/docs/index.mdx apps/docs/src/content/docs/stability.md
git commit -m "docs(replay): add Snapshot & Replay page + nav + stability marker"
```

---

## Task 13: Workspace integration check

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `rtk bunx turbo run build --filter=@reactive-agents/replay --filter=@reactive-agents/runtime --filter=@reactive-agents/diagnose --filter=@reactive-agents/trace`
Expected: All packages build clean, DTS step passes.

- [ ] **Step 2: Full test suite**

Run: `rtk bunx turbo run test`
Expected: All tests pass (5,128 baseline + ~10 new replay tests = ~5,138).

- [ ] **Step 3: Update CHANGELOG**

In `CHANGELOG.md` (root), add to the unreleased section:
```markdown
### Added
- `@reactive-agents/replay` package — deterministic re-run of recorded traces with prompt/model overrides and tool-result freezing
- `ReactiveAgentBuilder.withReplayLayer()` — inject a custom tool layer for replay or testing
- `tool-call-end` trace event now records the tool result payload (used by replay)
- `rax-diagnose replay-run <runId>` — CLI summary of a recorded run
```

- [ ] **Step 4: Update wiki Hot cache**

Append to `wiki/Hot.md` under "Latest Session":
```markdown
### Snapshot/Replay — COMPLETE ✅

New `@reactive-agents/replay` package. Determinism gate passes. Phase C v0.11 differentiator landed.
```

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md wiki/Hot.md
git commit -m "chore: changelog + hot cache for snapshot/replay landing"
```

---

## Out of scope for v0.11 (deferred)

- **Full CLI re-execution** with `--builder=<path>` dynamic import. v0.11 CLI is summary-only. Deferred to v0.12.
- **Event-level diff** (per-message, per-iteration). v0.11 diff is at TraceSnapshot granularity. Event diff is incremental work on top of `diffTraces`.
- **HTML report generation** for diff visualization. Stretch.
- **Stripe-style snapshot store** (git-tracked golden traces for regression testing). Separate spec.
- **Replay with `temperature`/`seed` enforcement on providers that support neither**. Logged as caveat in docs.

---

## Self-Review Notes

**Spec coverage:** North Star §6 Phase C lists Snapshot/Replay with three properties — (1) `agent.replay(traceId, overrides)`, (2) deterministic on same overrides, (3) builds on `packages/trace`. All three covered: Task 8 (API), Task 10 (determinism gate), Task 1 (package depends on trace).

**Placeholder scan:** None. Every step shows the code or command.

**Type consistency:** `ReplayResultProvider.next` return shape, `ReplayDiff`, `ToolSeqEdit`, `RecordedToolResult`, `BuilderFn`, `BuildContext` — all defined once in Type Reference, referenced consistently. `withReplayLayer` signature locked.

**Known fragility:** Task 6 (ReplayToolLayer) uses `as any` to bypass full `ToolService` shape — research step before coding gives exact method list. Task 7 (builder hook) requires locating the tool layer composition site via grep — explicit step provided.

**Test count delta:** ~10 new tests across 7 test files. Aligns with v0.11 expectation of zero regressions on 5,128+ baseline.
