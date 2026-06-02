# Canonical Context Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace RA's 4+ overlapping context-assembly paths with ONE pure, deterministic, observable `project(log, capability, store)` over a single append-only event log, fixing the marker/recall/dead-seam/two-record failure modes at the root.

**Architecture:** Greenfield pure core built first under `packages/reasoning/src/assembly/` (event log + content-addressed ResultStore + a pure staged `project` function whose trace is its byproduct). Then a strangler-fig cutover: `project` becomes the single live entry by first delegating byte-identically to the current renderer (trace-diff = control), after which each legacy builder is collapsed into a pure stage and **deleted**. No model-facing context machinery survives. Migration shims are temporary proving scaffolds, removed by the end.

**Tech Stack:** TypeScript (strict, no `any`), Effect-TS, Bun 1.3.10 test runner, turbo. Spec: `wiki/Architecture/Design-Specs/2026-05-31-canonical-context-assembly.md` (design-locked). Branch: `overhaul/agentic-core-2026-05-31`.

**Conventions for every task:** commit messages have NO `Co-Authored-By` trailer. Run targeted tests with `bun test <path>`. Do NOT rebuild dist — bun runs reasoning from `src` (verified `require.resolve` → `src/index.ts`). Kernel edits (`packages/reasoning/src/kernel/**`) route through `kernel-warden` per the active pilot; the new `assembly/` module is OUTSIDE `kernel/**` and is edited directly.

---

## File Structure

**New (greenfield pure core — outside `kernel/**`):**
- `packages/reasoning/src/assembly/event-log.ts` — `AgentEvent` union, `EventLog` (append-only), pure constructors/selectors.
- `packages/reasoning/src/assembly/result-store.ts` — content-addressed store (hash → value), `put`/`get`/`summarize`/`materialize`. (Supersedes the branch's `overhaul/result-store.ts`; reuses `@reactive-agents/tools` `renderValue`/`describeShape`.)
- `packages/reasoning/src/assembly/capability.ts` — `ResolvedCapability` + `resolveCapability(input)` (single source; budgets derived).
- `packages/reasoning/src/assembly/trace.ts` — `AssemblyTrace` type + `emptyTrace`/`pushStage` helpers.
- `packages/reasoning/src/assembly/stages/*.ts` — one file per pure stage: `system-prompt.ts`, `select-tools.ts`, `project-results.ts`, `compact-history.ts`, `finalize.ts`.
- `packages/reasoning/src/assembly/project.ts` — `project(input): Projection` — composes the stages.
- `packages/reasoning/src/assembly/types.ts` — `AssemblyInput`, `AssemblyCtx`, `Projection`, `ProviderRequest`, `GoalState`, `ToolsSnapshot`.
- `packages/reasoning/tests/assembly/*.test.ts` — one test file per module above.

**Modified (integration, later phases):**
- The live render call site (identified in Phase 0 — recorded as finding **F1**).
- `packages/reasoning/src/kernel/capabilities/reason/think.ts` (kernel-warden) — route to `project`.
- Deletions (Phase 6): `attend/context-utils.ts buildConversationMessages`, `context/context-manager.ts` (`build` + `buildCuratedMessages`), `context/context-curator.ts` injectable indirection, `recall` registration, `compressToolResult` model-facing output.

**Discovery artifact:**
- `wiki/Research/Harness-Reports/2026-05-31-live-assembly-path-pinned.md` — Phase 0 output (findings F1–F4).

---

## Phase 0 — Pin the live assembly path (discovery; gates integration)

No production code changes. Produce the findings doc. This phase exists because this session proved that unit-green + present src edits prove nothing about live behavior.

### Task 0.1: Instrument the candidate render entries

**Files:**
- Modify (temporary probes, gated on `RA_ASM_DEBUG`): `packages/reasoning/src/context/context-curator.ts` (curate entry), `packages/reasoning/src/kernel/capabilities/reason/think.ts` (each message-assembly call site) — think.ts via kernel-warden.

- [ ] **Step 1: Add an entry probe to `defaultContextCurator.curate`**

In `context-curator.ts`, at the top of `curate(...)`:
```ts
if (process.env.RA_ASM_DEBUG === "1") {
  // eslint-disable-next-line no-console
  console.error(`[asm-probe] curate iteration=${state.iteration} adapter=${adapter ? "yes" : "no"}`);
}
```

- [ ] **Step 2: Add probes at each assembly call site in `think.ts`** (kernel-warden MissionBrief)

Dispatch `kernel-warden` to add, immediately before every call that produces provider messages (search `think.ts` for `defaultContextCurator`, `curate(`, `applyMessageWindow`, `buildToolSchemas`, and any `.messages` assembly):
```ts
if (process.env.RA_ASM_DEBUG === "1") console.error(`[asm-probe] think:<lineno> <branch-name> stream=${isStreaming}`);
```

- [ ] **Step 3: Run a live probe and capture which path renders**

Run:
```bash
SPOT_MODEL=cogito:14b RA_ASM_DEBUG=1 \
  SPOT_TASK='Fetch the last 10 commits to tylerjrbuell/reactive-agents-ts then write ./pc.md with the messages.' \
  timeout 300 bun apps/examples/spot-test.ts 2>&1 | grep "asm-probe"
```
Expected: a sequence of `[asm-probe]` lines showing the exact branch order. **Record which `think.ts` branch fires and whether `curate` runs.**

- [ ] **Step 4: Confirm/deny `ContextManager.build` liveness**

Add the same probe to `context-manager.ts ContextManager.build` (both `if(adapter)`/`else` branches), re-run Step 3. Record: does `build` fire live? which branch?

- [ ] **Step 5: Write findings F1–F4 to the discovery artifact**

Create `wiki/Research/Harness-Reports/2026-05-31-live-assembly-path-pinned.md` with:
- **F1:** the exact file:function:line that renders the live provider request (the call think.ts actually uses).
- **F2:** whether `ContextManager.build` / `buildConversationMessages` / `buildCuratedMessages` have any live caller (yes/no each).
- **F3:** what inputs the live renderer receives (state.messages? state.scratchpad? adapter? a curator instance?).
- **F4:** whether a `GoalState`/post-condition ledger is already derivable from current state, or needs new event types.

- [ ] **Step 6: Remove the probes, commit the findings**

Revert all `RA_ASM_DEBUG` probes (think.ts via kernel-warden). Commit only the findings doc:
```bash
git add wiki/Research/Harness-Reports/2026-05-31-live-assembly-path-pinned.md
git commit -m "docs(overhaul): Phase 0 — pinned the live assembly path (F1–F4)"
```

---

## Phase 1 — Greenfield pure core (event log, ResultStore, capability, trace)

All greenfield, outside `kernel/**`, fully TDD. No integration yet.

### Task 1.1: AgentEvent union + EventLog

**Files:**
- Create: `packages/reasoning/src/assembly/event-log.ts`
- Test: `packages/reasoning/tests/assembly/event-log.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { EventLog, type AgentEvent } from "../../src/assembly/event-log.js";

describe("EventLog — append-only single source", () => {
  it("appends events immutably and preserves order", () => {
    const log = new EventLog();
    const l2 = log.append({ kind: "goal", text: "do X" });
    const l3 = l2.append({ kind: "tool_called", tool: "list_commits", callId: "c1", args: {} });
    expect(log.events.length).toBe(0);        // original unchanged (immutable)
    expect(l3.events.length).toBe(2);
    expect(l3.events[0]!.kind).toBe("goal");
    expect(l3.events[1]!.kind).toBe("tool_called");
  });

  it("selects events by kind", () => {
    const log = new EventLog()
      .append({ kind: "goal", text: "g" })
      .append({ kind: "tool_result", callId: "c1", ref: "r1", shape: "Array(20)" });
    expect(log.byKind("tool_result").length).toBe(1);
    expect(log.byKind("thought").length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/tests/assembly/event-log.test.ts`
Expected: FAIL — cannot find module `event-log.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
export type AgentEvent =
  | { readonly kind: "goal"; readonly text: string }
  | { readonly kind: "thought"; readonly text: string }
  | { readonly kind: "tool_called"; readonly tool: string; readonly callId: string; readonly args: Record<string, unknown> }
  | { readonly kind: "tool_result"; readonly callId: string; readonly ref: string; readonly shape: string }
  | { readonly kind: "observation"; readonly text: string }
  | { readonly kind: "goal_state"; readonly remaining: readonly string[] }
  | { readonly kind: "terminated"; readonly reason: string };

export class EventLog {
  constructor(readonly events: readonly AgentEvent[] = []) {}
  append(e: AgentEvent): EventLog {
    return new EventLog([...this.events, e]);
  }
  byKind<K extends AgentEvent["kind"]>(kind: K): ReadonlyArray<Extract<AgentEvent, { kind: K }>> {
    return this.events.filter((e): e is Extract<AgentEvent, { kind: K }> => e.kind === kind);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/tests/assembly/event-log.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/assembly/event-log.ts packages/reasoning/tests/assembly/event-log.test.ts
git commit -m "feat(assembly): append-only EventLog + AgentEvent union (single source)"
```

### Task 1.2: Content-addressed ResultStore

**Files:**
- Create: `packages/reasoning/src/assembly/result-store.ts`
- Test: `packages/reasoning/tests/assembly/result-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { ResultStore } from "../../src/assembly/result-store.js";

const commits = Array.from({ length: 20 }, (_, i) => ({ sha: `s${i}`, commit: { message: `m${i}` } }));

describe("ResultStore — content-addressed, system-owned", () => {
  it("put returns a stable ref; same content → same ref (CAS)", () => {
    const s = new ResultStore();
    const r1 = s.put("github/list_commits", commits);
    const r2 = s.put("github/list_commits", commits);
    expect(r1).toBe(r2); // content-addressed
    expect(s.get(r1)?.value).toEqual(commits);
  });

  it("summarize gives shape + ref, no bulk, no marker, no recall", () => {
    const s = new ResultStore();
    const ref = s.put("github/list_commits", commits);
    const sum = s.summarize(ref);
    expect(sum).toContain("Array(20)");
    expect(sum).toContain(ref);
    expect(sum).not.toContain("[STORED:");
    expect(sum).not.toContain("recall(");
    expect(sum).not.toContain("m0");
  });

  it("materialize renders ALL items deterministically", () => {
    const s = new ResultStore();
    const ref = s.put("github/list_commits", commits);
    expect(s.materialize(ref, "bullets").split("\n").length).toBe(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/tests/assembly/result-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { createHash } from "node:crypto";
import { renderValue, describeShape, type ResultFormat } from "@reactive-agents/tools";

export interface StoredResult { readonly ref: string; readonly tool: string; readonly value: unknown; }

export class ResultStore {
  private readonly map = new Map<string, StoredResult>();
  put(tool: string, value: unknown): string {
    const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 12);
    const ref = `res_${hash}`;
    if (!this.map.has(ref)) this.map.set(ref, { ref, tool, value });
    return ref;
  }
  get(ref: string): StoredResult | undefined { return this.map.get(ref); }
  has(ref: string): boolean { return this.map.has(ref); }
  summarize(ref: string): string {
    const s = this.map.get(ref);
    if (!s) return `[unknown result_ref="${ref}"]`;
    return `${s.tool} result stored as result_ref="${ref}" (${describeShape(s.value)}). ` +
      `Full data held system-side; act on it by reference (e.g. write_result_to_file(result_ref="${ref}", path)). Do not retype it.`;
  }
  materialize(ref: string, format: ResultFormat = "bullets"): string {
    const s = this.map.get(ref);
    if (!s) return `[unknown result_ref="${ref}"]`;
    return renderValue(s.value, format);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/tests/assembly/result-store.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/assembly/result-store.ts packages/reasoning/tests/assembly/result-store.test.ts
git commit -m "feat(assembly): content-addressed ResultStore (replaces scratchpad/recall)"
```

### Task 1.3: ResolvedCapability + single-source budgets

**Files:**
- Create: `packages/reasoning/src/assembly/capability.ts`
- Test: `packages/reasoning/tests/assembly/capability.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { resolveCapability } from "../../src/assembly/capability.js";

describe("resolveCapability — single source; budgets derived", () => {
  it("derives recency/aged budgets from the window", () => {
    const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
    expect(cap.recencyBudgetChars).toBe(Math.floor(15360 * 0.35 * 4));
    expect(cap.agedBudgetChars).toBeLessThan(cap.recencyBudgetChars);
  });
  it("predicts num_ctx as smallest bucket ≥ assembled+output+headroom", () => {
    const cap = resolveCapability({ window: 131072, outputBudget: 2000, dialect: "native-fc", tier: "local" });
    expect(cap.predictNumCtx(6000)).toBe(16384); // 6000 prompt + 2000 out + headroom → 16k bucket
    expect(cap.predictNumCtx(20000)).toBe(32768);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/tests/assembly/capability.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
export type Tier = "local" | "mid" | "large" | "frontier";
export interface CapabilityInput { window: number; outputBudget: number; dialect: "native-fc" | "text-parse" | "none"; tier: Tier; }
export interface ResolvedCapability {
  readonly window: number;
  readonly outputBudget: number;
  readonly dialect: CapabilityInput["dialect"];
  readonly tier: Tier;
  readonly recencyBudgetChars: number;
  readonly agedBudgetChars: number;
  predictNumCtx(assembledPromptTokens: number): number;
}
const BUCKETS = [8192, 16384, 32768, 65536, 131072];
export function resolveCapability(input: CapabilityInput): ResolvedCapability {
  const recencyBudgetChars = Math.floor(input.window * 0.35 * 4);
  const agedBudgetChars = Math.max(600, Math.min(4000, Math.floor(input.window * 0.04 * 4)));
  return {
    ...input,
    recencyBudgetChars,
    agedBudgetChars,
    predictNumCtx(assembledPromptTokens: number) {
      const need = assembledPromptTokens + input.outputBudget + 1024; // headroom
      return BUCKETS.find((b) => b >= need) ?? BUCKETS[BUCKETS.length - 1]!;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/tests/assembly/capability.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/assembly/capability.ts packages/reasoning/tests/assembly/capability.test.ts
git commit -m "feat(assembly): ResolvedCapability — single source, derived budgets, predicted num_ctx"
```

### Task 1.4: Assembly types + AssemblyTrace

**Files:**
- Create: `packages/reasoning/src/assembly/types.ts`, `packages/reasoning/src/assembly/trace.ts`
- Test: `packages/reasoning/tests/assembly/trace.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { emptyTrace, pushStage, recordMessage } from "../../src/assembly/trace.js";

describe("AssemblyTrace — observability by construction", () => {
  it("accumulates stage notes and per-message projection decisions", () => {
    let t = emptyTrace({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local", recencyBudgetChars: 21504, agedBudgetChars: 2400, predictNumCtx: () => 16384 });
    t = pushStage(t, "projectResults", "1 full, 2 cleared");
    t = recordMessage(t, { role: "tool_result", chars: 120, projection: "summary+ref" });
    expect(t.stages[0]!.name).toBe("projectResults");
    expect(t.messages[0]!.projection).toBe("summary+ref");
    expect(t.capability.window).toBe(15360);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/tests/assembly/trace.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementations**

`types.ts`:
```ts
import type { ResolvedCapability } from "./capability.js";
export interface ProviderRequest {
  readonly systemPrompt: string;
  readonly messages: ReadonlyArray<{ role: string; content: string; toolCallId?: string; toolName?: string; toolCalls?: unknown }>;
  readonly tools: readonly unknown[];
}
export interface GoalState { readonly goal: string; readonly remaining: readonly string[]; }
export interface ToolsSnapshot { readonly schemas: readonly unknown[]; }
```

`trace.ts`:
```ts
import type { ResolvedCapability } from "./capability.js";
export interface MessageTrace { readonly role: string; readonly chars: number; readonly projection?: "full" | "summary+ref" | "cleared"; }
export interface AssemblyTrace {
  readonly capability: ResolvedCapability;
  readonly stages: ReadonlyArray<{ name: string; note: string }>;
  readonly messages: readonly MessageTrace[];
  readonly tools: readonly string[];
}
export const emptyTrace = (capability: ResolvedCapability): AssemblyTrace => ({ capability, stages: [], messages: [], tools: [] });
export const pushStage = (t: AssemblyTrace, name: string, note: string): AssemblyTrace => ({ ...t, stages: [...t.stages, { name, note }] });
export const recordMessage = (t: AssemblyTrace, m: MessageTrace): AssemblyTrace => ({ ...t, messages: [...t.messages, m] });
export const setTools = (t: AssemblyTrace, tools: readonly string[]): AssemblyTrace => ({ ...t, tools });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/tests/assembly/trace.test.ts`
Expected: PASS (1 pass).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/assembly/types.ts packages/reasoning/src/assembly/trace.ts packages/reasoning/tests/assembly/trace.test.ts
git commit -m "feat(assembly): AssemblyTrace + core types (observability is the return type)"
```

---

## Phase 2 — The pure `project` pipeline + stages

Each stage is a pure `(AssemblyCtx) → AssemblyCtx`. TDD each. `AssemblyCtx` carries the working `ProviderRequest` parts + the `AssemblyTrace` + the inputs.

### Task 2.1: AssemblyCtx + project skeleton (stage composition)

**Files:**
- Create: `packages/reasoning/src/assembly/project.ts`
- Test: `packages/reasoning/tests/assembly/project.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { project } from "../../src/assembly/project.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";

describe("project — pure total assembler", () => {
  const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  it("is deterministic — same inputs → byte-identical output", () => {
    const log = new EventLog().append({ kind: "goal", text: "do X" });
    const store = new ResultStore();
    const a = project({ log, capability: cap, store, persona: { system: "P" }, tools: { schemas: [] } });
    const b = project({ log, capability: cap, store, persona: { system: "P" }, tools: { schemas: [] } });
    expect(JSON.stringify(a.request)).toBe(JSON.stringify(b.request));
    expect(a.request.systemPrompt).toContain("P");
  });
  it("returns a populated trace (observability by construction)", () => {
    const log = new EventLog().append({ kind: "goal", text: "do X" });
    const { trace } = project({ log, capability: cap, store: new ResultStore(), persona: { system: "P" }, tools: { schemas: [] } });
    expect(trace.stages.map((s) => s.name)).toEqual(["systemPrompt", "selectTools", "projectResults", "compactHistory", "finalize"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/tests/assembly/project.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { EventLog } from "./event-log.js";
import { ResultStore } from "./result-store.js";
import type { ResolvedCapability } from "./capability.js";
import type { ProviderRequest } from "./types.js";
import { emptyTrace, type AssemblyTrace } from "./trace.js";
import { systemPromptStage } from "./stages/system-prompt.js";
import { selectToolsStage } from "./stages/select-tools.js";
import { projectResultsStage } from "./stages/project-results.js";
import { compactHistoryStage } from "./stages/compact-history.js";
import { finalizeStage } from "./stages/finalize.js";

export interface AssemblyInput {
  readonly log: EventLog;
  readonly capability: ResolvedCapability;
  readonly store: ResultStore;
  readonly persona: { system: string };
  readonly tools: { schemas: readonly unknown[] };
}
export interface AssemblyCtx extends AssemblyInput {
  systemPrompt: string;
  messages: ProviderRequest["messages"];
  toolSchemas: readonly unknown[];
  trace: AssemblyTrace;
}
export interface Projection { readonly request: ProviderRequest; readonly trace: AssemblyTrace; }

const STAGES = [systemPromptStage, selectToolsStage, projectResultsStage, compactHistoryStage, finalizeStage];

export function project(input: AssemblyInput): Projection {
  let ctx: AssemblyCtx = { ...input, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(input.capability) };
  for (const stage of STAGES) ctx = stage(ctx);
  return { request: { systemPrompt: ctx.systemPrompt, messages: ctx.messages, tools: ctx.toolSchemas }, trace: ctx.trace };
}
```

(Stages 2.2–2.6 below provide each imported stage. Implement them in order; this skeleton fails to import until they exist — that is expected and resolved by the next tasks. To keep this task self-contained and green, create minimal pass-through stubs for the five stage files now, each: `export const <name>Stage = (c) => ({ ...c, trace: pushStage(c.trace, "<name>", "stub") });`, then flesh out per task.)

- [ ] **Step 4: Create the five pass-through stage stubs, run the test**

Create `stages/system-prompt.ts`, `select-tools.ts`, `project-results.ts`, `compact-history.ts`, `finalize.ts`, each:
```ts
import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";
export const systemPromptStage = (c: AssemblyCtx): AssemblyCtx => ({ ...c, systemPrompt: c.persona.system, trace: pushStage(c.trace, "systemPrompt", "stub") });
```
(name each export/stage per file: `selectToolsStage`/"selectTools", `projectResultsStage`/"projectResults", `compactHistoryStage`/"compactHistory", `finalizeStage`/"finalize"; finalize copies `c.messages`/`c.toolSchemas` through.)

Run: `bun test packages/reasoning/tests/assembly/project.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/assembly/project.ts packages/reasoning/src/assembly/stages/ packages/reasoning/tests/assembly/project.test.ts
git commit -m "feat(assembly): pure total project() + staged pipeline skeleton"
```

### Task 2.2: `projectResults` stage (the core — full | summary+ref | cleared)

**Files:**
- Modify: `packages/reasoning/src/assembly/stages/project-results.ts`
- Test: `packages/reasoning/tests/assembly/project-results.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { projectResultsStage } from "../../src/assembly/stages/project-results.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { emptyTrace } from "../../src/assembly/trace.js";

function ctxWith(value: unknown) {
  const cap = resolveCapability({ window: 1000, outputBudget: 100, dialect: "native-fc", tier: "local" }); // tiny → forces overflow
  const store = new ResultStore();
  const ref = store.put("github/list_commits", value);
  const log = new EventLog().append({ kind: "tool_called", tool: "github/list_commits", callId: "c1", args: {} })
    .append({ kind: "tool_result", callId: "c1", ref, shape: "Array" });
  return { input: { log, capability: cap, store, persona: { system: "" }, tools: { schemas: [] } }, ref };
}

describe("projectResults — full | summary+ref | cleared", () => {
  it("emits a tool_result message; OVERFLOW → summary+ref, no marker", () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ sha: `s${i}`, commit: { message: `message ${i} ${"x".repeat(50)}` } }));
    const { input, ref } = ctxWith(big);
    const ctx = projectResultsStage({ ...input, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(input.capability) });
    const tr = ctx.messages.find((m) => m.role === "tool_result")!;
    expect(tr.content).toContain(`result_ref="${ref}"`);
    expect(tr.content).not.toContain("[STORED:");
    expect(tr.content).not.toContain("recall(");
    expect(ctx.trace.messages.some((m) => m.projection === "summary+ref")).toBe(true);
  });
  it("FITTING result → present full", () => {
    const small = [{ sha: "s0", commit: { message: "tiny" } }];
    const { input } = ctxWith(small);
    const ctx = projectResultsStage({ ...input, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(input.capability) });
    const tr = ctx.messages.find((m) => m.role === "tool_result")!;
    expect(tr.content).toContain("tiny");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/tests/assembly/project-results.test.ts`
Expected: FAIL (stub returns no messages).

- [ ] **Step 3: Write the implementation**

```ts
import type { AssemblyCtx } from "../project.js";
import { pushStage, recordMessage } from "../trace.js";

export const projectResultsStage = (c: AssemblyCtx): AssemblyCtx => {
  const results = c.log.byKind("tool_result");
  const calls = c.log.byKind("tool_called");
  let messages = [...c.messages];
  let trace = c.trace;
  let full = 0, summarized = 0;
  for (const r of results) {
    const call = calls.find((x) => x.callId === r.callId);
    const stored = c.store.get(r.ref);
    if (!stored) continue;
    const fullText = c.store.materialize(r.ref, "bullets");
    let content: string;
    let projection: "full" | "summary+ref";
    if (fullText.length <= c.capability.recencyBudgetChars) {
      content = fullText; projection = "full"; full++;
    } else {
      content = c.store.summarize(r.ref); projection = "summary+ref"; summarized++;
    }
    messages = [...messages, { role: "tool_result", toolCallId: r.callId, toolName: call?.tool ?? "tool", content }];
    trace = recordMessage(trace, { role: "tool_result", chars: content.length, projection });
  }
  return { ...c, messages, trace: pushStage(trace, "projectResults", `${full} full, ${summarized} summary+ref`) };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/tests/assembly/project-results.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/assembly/stages/project-results.ts packages/reasoning/tests/assembly/project-results.test.ts
git commit -m "feat(assembly): projectResults stage — full|summary+ref, system-owned, no markers"
```

### Task 2.3: `systemPrompt` stage (persona + goal/remaining recited to recency)

**Files:**
- Modify: `packages/reasoning/src/assembly/stages/system-prompt.ts`
- Test: `packages/reasoning/tests/assembly/system-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { systemPromptStage } from "../../src/assembly/stages/system-prompt.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { emptyTrace } from "../../src/assembly/trace.js";

it("renders persona + goal + remaining post-conditions", () => {
  const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  const log = new EventLog().append({ kind: "goal", text: "fetch and write" }).append({ kind: "goal_state", remaining: ["write_file"] });
  const c = systemPromptStage({ log, capability: cap, store: new ResultStore(), persona: { system: "You are an agent." }, tools: { schemas: [] }, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(cap) });
  expect(c.systemPrompt).toContain("You are an agent.");
  expect(c.systemPrompt).toContain("fetch and write");
  expect(c.systemPrompt).toContain("write_file"); // remaining recited
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/tests/assembly/system-prompt.test.ts`
Expected: FAIL (stub omits goal/remaining).

- [ ] **Step 3: Write the implementation**

```ts
import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";

export const systemPromptStage = (c: AssemblyCtx): AssemblyCtx => {
  const goal = c.log.byKind("goal").at(-1)?.text ?? "";
  const remaining = c.log.byKind("goal_state").at(-1)?.remaining ?? [];
  const parts = [c.persona.system];
  if (goal) parts.push(`\nGoal: ${goal}`);
  if (remaining.length) parts.push(`Remaining steps: ${remaining.join(", ")}`);
  const systemPrompt = parts.join("\n");
  return { ...c, systemPrompt, trace: pushStage(c.trace, "systemPrompt", `goal+${remaining.length} remaining`) };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/tests/assembly/system-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/assembly/stages/system-prompt.ts packages/reasoning/tests/assembly/system-prompt.test.ts
git commit -m "feat(assembly): systemPrompt stage — persona + goal/remaining recited to recency"
```

### Task 2.4: `selectTools` + `finalize` stages

**Files:**
- Modify: `packages/reasoning/src/assembly/stages/select-tools.ts`, `stages/finalize.ts`
- Test: `packages/reasoning/tests/assembly/select-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { selectToolsStage } from "../../src/assembly/stages/select-tools.js";
import { finalizeStage } from "../../src/assembly/stages/finalize.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";
import { emptyTrace } from "../../src/assembly/trace.js";

const base = () => {
  const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  return { log: new EventLog(), capability: cap, store: new ResultStore(), persona: { system: "" }, tools: { schemas: [{ name: "file-write" }, { name: "file-write" }] }, systemPrompt: "", messages: [], toolSchemas: [], trace: emptyTrace(cap) };
};

it("selectTools passes a stable deduped set + records names", () => {
  const c = selectToolsStage(base());
  expect(c.toolSchemas.length).toBe(1); // deduped, stable
  expect(c.trace.tools).toEqual(["file-write"]);
});
it("finalize records each message into the trace", () => {
  const c0 = { ...base(), messages: [{ role: "user", content: "hi" }] };
  const c = finalizeStage(c0);
  expect(c.trace.messages.length).toBe(1);
  expect(c.trace.messages[0]!.chars).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/reasoning/tests/assembly/select-tools.test.ts`
Expected: FAIL (stubs don't dedup / don't record).

- [ ] **Step 3: Write the implementations**

`select-tools.ts`:
```ts
import type { AssemblyCtx } from "../project.js";
import { pushStage, setTools } from "../trace.js";
export const selectToolsStage = (c: AssemblyCtx): AssemblyCtx => {
  const seen = new Set<string>();
  const deduped = c.tools.schemas.filter((s) => {
    const n = (s as { name?: string }).name ?? "";
    if (seen.has(n)) return false; seen.add(n); return true;
  });
  const names = deduped.map((s) => (s as { name?: string }).name ?? "");
  return { ...c, toolSchemas: deduped, trace: setTools(pushStage(c.trace, "selectTools", `${deduped.length} tools`), names) };
};
```
`finalize.ts`:
```ts
import type { AssemblyCtx } from "../project.js";
import { pushStage, recordMessage } from "../trace.js";
export const finalizeStage = (c: AssemblyCtx): AssemblyCtx => {
  let trace = c.trace;
  for (const m of c.messages) {
    if (!trace.messages.some((x) => x === undefined)) { /* keep */ }
    trace = recordMessage(trace, { role: m.role, chars: (m.content ?? "").length });
  }
  return { ...c, trace: pushStage(trace, "finalize", `${c.messages.length} messages`) };
};
```
(Note: `projectResults` already records its tool_result messages; to avoid double-counting, `finalize` records only messages not already traced. For simplicity in the test above there are none from projectResults; in the integrated pipeline, gate finalize's recordMessage to `role !== "tool_result"`. Adjust the implementation accordingly: `if (m.role !== "tool_result") trace = recordMessage(...)`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/reasoning/tests/assembly/select-tools.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 5: Commit**

```bash
git add packages/reasoning/src/assembly/stages/select-tools.ts packages/reasoning/src/assembly/stages/finalize.ts packages/reasoning/tests/assembly/select-tools.test.ts
git commit -m "feat(assembly): selectTools (stable/masked) + finalize (trace records messages)"
```

### Task 2.5: `compactHistory` stage + full pipeline integration test

**Files:**
- Modify: `packages/reasoning/src/assembly/stages/compact-history.ts`
- Test: `packages/reasoning/tests/assembly/pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { project } from "../../src/assembly/project.js";
import { EventLog } from "../../src/assembly/event-log.js";
import { ResultStore } from "../../src/assembly/result-store.js";
import { resolveCapability } from "../../src/assembly/capability.js";

it("end-to-end: 50-commit overflow → summary+ref in request, full data in store", () => {
  const cap = resolveCapability({ window: 15360, outputBudget: 2000, dialect: "native-fc", tier: "local" });
  const store = new ResultStore();
  const big = Array.from({ length: 50 }, (_, i) => ({ sha: `s${i}`, commit: { message: `m${i} ${"x".repeat(60)}` } }));
  const ref = store.put("github/list_commits", big);
  const log = new EventLog().append({ kind: "goal", text: "write all 50" })
    .append({ kind: "tool_called", tool: "github/list_commits", callId: "c1", args: {} })
    .append({ kind: "tool_result", callId: "c1", ref, shape: "Array(50)" });
  const { request, trace } = project({ log, capability: cap, store, persona: { system: "Agent" }, tools: { schemas: [{ name: "write_result_to_file" }] } });
  const tr = request.messages.find((m) => m.role === "tool_result")!;
  expect(tr.content).toContain(`result_ref="${ref}"`);
  expect(tr.content).not.toContain("[STORED:");
  expect(store.materialize(ref, "bullets").split("\n").length).toBe(50); // full data recoverable system-side
  expect(trace.tools).toContain("write_result_to_file");
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test packages/reasoning/tests/assembly/pipeline.test.ts`
Expected: FAIL if `compact-history` stub drops messages; otherwise verify the overflow assertion.

- [ ] **Step 3: Implement `compactHistory` (no-op below limit; summarize oldest turns above)**

```ts
import type { AssemblyCtx } from "../project.js";
import { pushStage } from "../trace.js";
export const compactHistoryStage = (c: AssemblyCtx): AssemblyCtx => {
  const totalChars = c.messages.reduce((n, m) => n + (m.content ?? "").length, 0);
  const limitChars = c.capability.window * 4; // window in chars
  if (totalChars <= limitChars) return { ...c, trace: pushStage(c.trace, "compactHistory", "under limit, no-op") };
  // Above limit: keep the most-recent half verbatim, replace older with a one-line summary.
  const half = Math.floor(c.messages.length / 2);
  const kept = c.messages.slice(half);
  const summary = { role: "user" as const, content: `[history compacted: ${half} earlier messages summarized]` };
  return { ...c, messages: [summary, ...kept], trace: pushStage(c.trace, "compactHistory", `compacted ${half} msgs`) };
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test packages/reasoning/tests/assembly/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole assembly suite + commit**

Run: `bun test packages/reasoning/tests/assembly/`
Expected: all green.
```bash
git add packages/reasoning/src/assembly/stages/compact-history.ts packages/reasoning/tests/assembly/pipeline.test.ts
git commit -m "feat(assembly): compactHistory stage + end-to-end pipeline test (overflow→summary+ref)"
```

---

## Phase 3 — Single live entry (strangler control; gated on Phase 0 F1)

**Depends on Phase 0 finding F1** (the exact live render call site) and F3 (its current inputs).

### Task 3.1: Adapter — build `AssemblyInput` from current KernelState

**Files:**
- Create: `packages/reasoning/src/assembly/from-kernel-state.ts` (maps `KernelState` → `AssemblyInput`: messages/steps → EventLog, scratchpad → ResultStore, profile → ResolvedCapability)
- Test: `packages/reasoning/tests/assembly/from-kernel-state.test.ts`

- [ ] **Step 1: Write the failing test** — construct a minimal `KernelState` with one tool_result + storedKey; assert the adapter yields an `EventLog` with a `tool_result` event and a `ResultStore` containing the body.

```ts
// (Build a KernelState fixture per the shape at packages/reasoning/src/kernel/state/kernel-state.ts;
//  assert fromKernelState(state, profile).log.byKind("tool_result").length === 1 and store.get(ref) is defined.)
```

- [ ] **Step 2: Run — FAIL (module missing).**
- [ ] **Step 3: Implement `fromKernelState`** — translate `state.messages`/`state.steps` into events, copy `state.scratchpad` entries into a `ResultStore` (parse JSON values), derive `ResolvedCapability` from `profile` (window = `profile.maxTokens`, outputBudget from config, dialect/tier from capability).
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** `feat(assembly): fromKernelState adapter (KernelState → AssemblyInput)`.

### Task 3.2: Route the live call site through `project`, delegating byte-identically

**Files:**
- Modify: the F1 call site (kernel-warden if under `kernel/**`).

- [ ] **Step 1: Add a feature gate** `RA_ASSEMBLY=1`. When ON, call `project(fromKernelState(state, profile))` and use its `request`; when OFF, the existing renderer (default — byte-identical).
- [ ] **Step 2: Add a trace-diff harness** — `apps/examples/assembly-tracediff.ts`: run the same task with `RA_ASSEMBLY=0` and `=1`, capture each iteration's provider request (messages+tools+systemPrompt), assert structural equality (allowing the known intended differences: summary+ref vs marker). Output a diff report.
- [ ] **Step 3: Run the trace-diff** on cogito 10c (fits budget → should be byte-identical except formatting). Expected: the only diffs are intended (no markers). Record in `wiki/Research/Harness-Reports/2026-05-31-assembly-tracediff.md`.
- [ ] **Step 4: Verify the assembly suite + a live smoke run** (`RA_ASSEMBLY=1`, cogito 10c) writes a faithful file. Confirm via EXEC-log that `project` ran (add a one-line `console.error("[project] live")` behind `RA_ASM_DEBUG`).
- [ ] **Step 5: Commit** `feat(assembly): project() as single live entry behind RA_ASSEMBLY (byte-identical control)`.

---

## Phase 4 — Collapse + delete the legacy builders (trace-diff gated)

For each legacy builder, migrate its remaining unique behavior into a `project` stage, then delete it. Each task: (1) confirm no live caller besides the F1 path, (2) move behavior, (3) trace-diff identical or ablation-justified, (4) delete, (5) run full reasoning suite.

- [ ] **Task 4.1:** Delete `buildConversationMessages` + the overhaul projection seam in `context-utils.ts` (its logic now lives in `projectResults`). kernel-warden. Full suite green.
- [ ] **Task 4.2:** Delete `buildCuratedMessages` + `ContextManager.build` dispatch (folded into `project`). Confirm via Phase-0 F2 it has no other live caller. Full suite green.
- [ ] **Task 4.3:** Remove the injectable `ContextCurator` indirection in `context-curator.ts`; `think.ts` calls `project` directly (kernel-warden). Full suite green.
- [ ] **Task 4.4:** Flip `RA_ASSEMBLY` default ON (opt-out), run the cross-tier grid (Phase 5 harness) to confirm no regression vs the locked OLD baseline.

---

## Phase 5 — Land projection + reference tool in the ONE path; prove cross-tier

- [ ] **Task 5.1:** Ensure `write_result_to_file` is registered + OFFERED on the live path (verify via EXEC-log, not file format). Move its registration so it rides `project`'s tool set (the `selectTools` stage), not the dead `tool-capabilities.ts` seam.
- [ ] **Task 5.2:** Build real tool-call telemetry — populate `AssemblyTrace.response` from the provider result (`done_reason`, eval/prompt tokens, tool calls). Replace the empty `metadata.toolCalls`. Test: a live run's trace shows the tools the model actually called.
- [ ] **Task 5.3:** Cross-tier N≥3 proof — extend `/tmp/baseline-grid.sh` to N=3 per cell + a robust faithfulness check (parse the written file structurally; detect `[STORED:`/marker leakage; count items; compare to expected). Run OLD (RA_ASSEMBLY=0) vs NEW (=1) on {cogito:14b, qwen3:14b, qwen3.5, gpt-4o-mini, sonnet-4-6} × {10c, 20c, 50c}. Also run the marginal arm (OLD + strip-marker point-fix) for true marginal attribution.
- [ ] **Task 5.4:** Write the proof debrief `wiki/Research/Debriefs/2026-06-xx-canonical-assembly-proof.md` — per-tier faithful pass^k, dishonest-success caught, tokens, per-component attribution. **Merge gate:** NEW beats OLD on the failure class at ≤ tokens, or honest `success:false`; else iterate.

---

## Phase 6 — Delete the model-facing machinery; reconcile main

- [ ] **Task 6.1:** Remove the `recall` tool registration + `[STORED:]` marker emission + `TOOL_RESULT_INLINE_CAP` + `compressToolResult`'s model-facing output (kept only as the store's internal renderer). Full suite green; cross-tier grid shows no regression.
- [ ] **Task 6.2:** Verify whether `c9e6fba2` (age-aware curation default-on, main) ever ran live (it lived in `buildConversationMessages`); fold its intent into `projectResults`; note the reconciliation for main in the debrief.
- [ ] **Task 6.3:** Remove all temporary `RA_ASM_DEBUG`/strangler shims; `RA_ASSEMBLY` becomes the only (soon-default) gate. Update `2026-05-31-canonical-context-assembly.md` status → shipped.
- [ ] **Task 6.4:** `superpowers:finishing-a-development-branch` — final review, then merge `overhaul/agentic-core-2026-05-31`.

---

## Self-Review notes
- **Spec coverage:** all 10 pillars mapped — one log (1.1), CAS (1.2), pure project (2.1), capability-once+predicted num_ctx (1.3), full|summary+ref|cleared (2.2/2.5), observability=return type (1.4/2.x/5.2), no model-facing machinery (6.1), deterministic (2.1 determinism test), strategies-as-reducers (covered by single `project` entry — Phase 4.3; no per-strategy assembler), honesty=projection (system-prompt recites goal_state 2.3; verifier integration is a separate spine spec, referenced not duplicated).
- **Phase 0 gate:** Phases 3–4 explicitly depend on F1/F2/F3; do not start them before the findings doc exists.
- **Determinism caveat:** `ResultStore.put` uses content hashing → deterministic refs (golden-trace stable). `project` performs no IO and no `Date.now()` → safe for trace-diff.
- **Open risk:** the `fromKernelState` adapter (3.1) is the load-bearing translation; if F3 shows the live renderer doesn't carry `storedKey`/scratchpad as assumed, adjust the adapter (not the pure core).
