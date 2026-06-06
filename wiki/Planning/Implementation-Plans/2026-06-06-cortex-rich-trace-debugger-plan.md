# Cortex Rich-Trace Debugger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Cortex's iteration-frame TracePanel into a fine-grained, filterable, rich-event debugger timeline that reuses the `@reactive-agents/trace` model — augmenting (never replacing) today's reasoning detail and replay.

**Architecture:** Approach **A′** (refined from spec Approach A after reading ingest code). Every raw rich `AgentEvent` (`LLMExchangeEmitted`, `StrategySwitched`, `VerifierVerdictEmitted`, `GuardFiredEmitted`, `ToolCall*`, `ReactiveDecision`, `Intervention*`, `CuratorDecisionEmitted`, `KernelStateSnapshotEmitted`) is ALREADY persisted in `cortex_events` and broadcast to the client (`ingest-service.ts:149/165`), sitting in `run-store.events`. `toTraceEvent` is a **pure sync** mapper. So we (1) extract `toTraceEvent` into a pure, Effect-free module and export it, (2) reuse it **client-side** in a new `timeline-store` that merges fine-grained reasoning rows (from `ReasoningStepCompleted`) with normalized rich `TraceEvent` rows, ordered chronologically and grouped by the `ReasoningIterationProgress` loop axis, (3) render a filterable timeline in `TracePanel`. **No Cortex server change** — avoids double-writing normalized rows for zero phase-1 benefit (server normalization is deferred to phase-2 `analyzeRun`).

**Tech Stack:** TypeScript, Effect-TS (server only — untouched here), Svelte 5 (runes), Bun test, Vite. Packages: `@reactive-agents/trace`, `apps/cortex/ui`.

**Deviation from spec (recorded):** spec chose "normalize in Cortex ingest (server)". Reading `ingest-service.ts` showed raw rich events already reach the client fully (persist + broadcast + bootstrap), and `toTraceEvent` is pure. Client-side reuse of the exported mapper is strictly better for phase-1 (zero server churn, no double-write, same shared trace model). Server-side normalization remains the right move for **phase-2** (`analyzeRun` reading normalized rows from the DB) and is deferred there.

**Phase note — phase labels:** the spec mentions phase sub-labels (plan/execute/reflect). Those are NOT carried on any current event (only emitted as `emitLog` phase boundaries, not `AgentEvent`s). Phase-1 groups by **iteration only**; phase sub-labels require a future event field and are out of scope here.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `packages/trace/src/normalize.ts` | Create | Pure, Effect-free `toTraceEvent(raw, seq)` mapper (moved verbatim from `layer.ts`). |
| `packages/trace/src/layer.ts` | Modify | Import `toTraceEvent` from `normalize.ts`; pass `nextSeq()` as the seq arg. |
| `packages/trace/src/index.ts` | Modify | `export { toTraceEvent } from "./normalize.js"`. |
| `packages/trace/test/normalize.test.ts` | Create | Unit tests for the exported mapper. |
| `apps/cortex/ui/src/lib/stores/timeline-store.ts` | Create | `TimelineRow` type + `createTimelineStore` (merge reasoning + rich rows, group by iteration). |
| `apps/cortex/ui/src/lib/stores/timeline-filter.ts` | Create | `TimelineCategory`, `categoryOf(row)`, aux detection, `filterRows(rows, active)`. |
| `apps/cortex/ui/src/lib/stores/timeline-store.test.ts` | Create | Bun unit tests: merge order, grouping, no-loss, filtering. |
| `apps/cortex/ui/src/lib/components/TimelineRow.svelte` | Create | Per-kind row renderer (collapsed title + expandable detail). |
| `apps/cortex/ui/src/lib/components/TimelineFilterChips.svelte` | Create | Filter chip bar with live counts. |
| `apps/cortex/ui/src/lib/components/TracePanel.svelte` | Modify | Host grouped timeline + chips; preserve expand/collapse/copy/replay-slice. |

---

## Task 1: Extract pure `toTraceEvent` mapper

**Files:**
- Create: `packages/trace/src/normalize.ts`
- Modify: `packages/trace/src/layer.ts` (remove inline `toTraceEvent` + `nextSeq`/`globalSeq`, import instead)
- Modify: `packages/trace/src/index.ts`
- Test: `packages/trace/test/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/trace/test/normalize.test.ts
import { describe, it, expect } from "bun:test";
import { toTraceEvent } from "../src/normalize.js";
import type { AgentEvent } from "@reactive-agents/core";

const base = { taskId: "run-1", timestamp: 1000 };

describe("toTraceEvent", () => {
  it("maps LLMExchangeEmitted → llm-exchange with the injected seq", () => {
    const raw = {
      _tag: "LLMExchangeEmitted",
      ...base,
      iteration: 2,
      provider: "ollama",
      model: "qwen3.5",
      requestKind: "stream",
      systemPrompt: "sys",
      messages: [{ role: "user", content: "hi" }],
      toolSchemaNames: [],
      response: { content: "ok", tokensIn: 100, tokensOut: 5 },
    } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 7);
    expect(ev?.kind).toBe("llm-exchange");
    expect(ev?.seq).toBe(7);
    expect((ev as { provider: string }).provider).toBe("ollama");
    expect((ev as { iter: number }).iter).toBe(2);
  });

  it("maps StrategySwitched → strategy-switched", () => {
    const raw = { _tag: "StrategySwitched", ...base, from: "reactive", to: "plan-execute", reason: "stuck" } as unknown as AgentEvent;
    const ev = toTraceEvent(raw, 3);
    expect(ev?.kind).toBe("strategy-switched");
    expect((ev as { to: string }).to).toBe("plan-execute");
  });

  it("returns null for unmapped tags (ReasoningStepCompleted)", () => {
    const raw = { _tag: "ReasoningStepCompleted", ...base, strategy: "reactive", step: 1, totalSteps: 0, thought: "x" } as unknown as AgentEvent;
    expect(toTraceEvent(raw, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/trace/test/normalize.test.ts`
Expected: FAIL — `Cannot find module '../src/normalize.js'`.

- [ ] **Step 3: Create `normalize.ts` by moving the mapper**

Move the entire `function toTraceEvent(raw: AgentEvent): TraceEvent | null { ... }` body from `layer.ts` into a new pure module, changing the signature to accept `seq` and replacing every `nextSeq()` call inside it with the `seq` parameter. Keep ALL existing `case` branches verbatim (only the seq source changes).

```ts
// packages/trace/src/normalize.ts
import type { AgentEvent } from "@reactive-agents/core";
import type {
  TraceEvent, RunStartedEvent, RunCompletedEvent, EntropyScoredEvent,
  DecisionEvaluatedEvent, StrategySwitchedEvent, InterventionDispatchedEvent,
  InterventionSuppressedEvent, KernelStateSnapshotEvent, VerifierVerdictEvent,
  GuardFiredEvent, LLMExchangeEvent, HarnessSignalInjectedEvent, ToolCallEvent,
  AssumptionRecordedEvent, CuratorDecisionEvent, AlternativesConsideredEvent,
} from "./events.js";

/**
 * Pure, Effect-free mapper: one raw `AgentEvent` → one normalized `TraceEvent`
 * (or `null` for tags this taxonomy does not cover). `seq` is injected by the
 * caller so both the recorder (process-global counter) and Cortex (per-run
 * `cortex_events.seq` / client array index) can supply their own ordering.
 */
export function toTraceEvent(raw: AgentEvent, seq: number): TraceEvent | null {
  switch (raw._tag) {
    // ⟢ paste every existing case body here UNCHANGED, except replace each
    //   `nextSeq()` with `seq`. (AgentStarted, AgentCompleted, EntropyScored,
    //   ReactiveDecision, StrategySwitched, InterventionDispatched,
    //   InterventionSuppressed, KernelStateSnapshotEmitted, VerifierVerdictEmitted,
    //   GuardFiredEmitted, LLMExchangeEmitted, ToolCallStarted, ToolCallCompleted,
    //   AssumptionRecordedEmitted, CuratorDecisionEmitted,
    //   AlternativesConsideredEmitted, HarnessSignalInjectedEmitted)
    default:
      return null;
  }
}
```

- [ ] **Step 4: Rewire `layer.ts` to import the mapper**

In `layer.ts`: delete the inline `function toTraceEvent` and the `globalSeq`/`nextSeq` block IF `nextSeq` is used only by the mapper; otherwise keep `nextSeq` and pass it in. Replace the single call site (inside the EventBus subscriber that builds trace events) with:

```ts
import { toTraceEvent } from "./normalize.js";
// ... keep the process-global counter for the recorder:
let globalSeq = 0;
const nextSeq = (): number => globalSeq++;
// ... at the mapping call site:
const traceEvent = toTraceEvent(raw, nextSeq());
```

- [ ] **Step 5: Export from index AND add a browser-safe subpath**

`normalize.ts` is pure (only `import type` of `@reactive-agents/core` + `./events`); the package root re-exports `recorder.ts`/`replay.ts` which import `node:fs/promises` + `effect` at top level. The browser UI MUST NOT import the root (it would pull `node:fs` into the Vite bundle). So expose a dedicated subpath.

```ts
// packages/trace/src/index.ts  (add near the events re-export — for Node/CLI consumers)
export { toTraceEvent } from "./normalize.js";
```

```jsonc
// packages/trace/package.json — add a second export entry alongside "."
"exports": {
  ".": {
    "bun": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "default": "./dist/index.js"
  },
  "./normalize": {
    "bun": "./dist/normalize.js",
    "types": "./dist/normalize.d.ts",
    "import": "./dist/normalize.js",
    "default": "./dist/normalize.js"
  }
}
```

Verify the bundler entry includes `normalize.ts` (tsup/tsdown configs in this repo build every `src/*.ts`; if `packages/trace`'s build config has an explicit `entry` list, add `src/normalize.ts` to it).

- [ ] **Step 6: Build, test, typecheck**

Run: `bunx turbo run build --filter=@reactive-agents/trace && bun test packages/trace/test/normalize.test.ts && bunx turbo run typecheck --filter=@reactive-agents/trace`
Expected: build emits `dist/normalize.js` + `dist/normalize.d.ts`; tests PASS (3/3); typecheck exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/trace/src/normalize.ts packages/trace/src/layer.ts packages/trace/src/index.ts packages/trace/package.json packages/trace/test/normalize.test.ts
git commit -m "refactor(trace): extract pure toTraceEvent mapper + ./normalize browser-safe subpath"
```

---

## Task 2: Timeline filter + category module

**Files:**
- Create: `apps/cortex/ui/src/lib/stores/timeline-filter.ts`
- Test: `apps/cortex/ui/src/lib/stores/timeline-store.test.ts` (shared test file; filter cases first)

- [ ] **Step 1: Write the failing test (filter half)**

```ts
// apps/cortex/ui/src/lib/stores/timeline-store.test.ts
import { describe, it, expect } from "bun:test";
import { categoryOf, isAux, filterRows, ALL_CATEGORIES, type TimelineRow } from "./timeline-filter.js";

const row = (over: Partial<TimelineRow>): TimelineRow => ({
  id: "0", seq: 0, ts: 0, iteration: 1, category: "reasoning", kind: "reasoning-thought", title: "t", ...over,
});

describe("timeline-filter", () => {
  it("categorizes a strategy-switched trace as control", () => {
    expect(categoryOf({ kind: "strategy-switched" } as TimelineRow["trace"])).toBe("control");
  });
  it("flags a completeStructured llm-exchange as aux", () => {
    expect(isAux({ kind: "llm-exchange", requestKind: "completeStructured", systemPrompt: "x" } as never)).toBe(true);
  });
  it("flags a tool-classifier llm-exchange as aux", () => {
    expect(isAux({ kind: "llm-exchange", requestKind: "complete", systemPrompt: "You are a tool classifier. Output…" } as never)).toBe(true);
  });
  it("does NOT flag a normal reasoning llm-exchange as aux", () => {
    expect(isAux({ kind: "llm-exchange", requestKind: "stream", systemPrompt: "Environment: …" } as never)).toBe(false);
  });
  it("filterRows excludes muted categories", () => {
    const rows = [row({ category: "reasoning" }), row({ category: "aux", id: "1", seq: 1 })];
    const out = filterRows(rows, new Set(ALL_CATEGORIES.filter((c) => c !== "aux")));
    expect(out.map((r) => r.id)).toEqual(["0"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cortex/ui && bun test src/lib/stores/timeline-store.test.ts --timeout 15000`
Expected: FAIL — `Cannot find module './timeline-filter.js'`.

- [ ] **Step 3: Implement `timeline-filter.ts`**

```ts
// apps/cortex/ui/src/lib/stores/timeline-filter.ts
import type { TraceEvent } from "@reactive-agents/trace";
import type { ConvMessage } from "./trace-store.js";

export type TimelineCategory = "reasoning" | "llm" | "tool" | "control" | "aux";
export const ALL_CATEGORIES: readonly TimelineCategory[] = ["reasoning", "llm", "tool", "control", "aux"];
/** Default-visible set: everything except aux/internal noise. */
export const DEFAULT_VISIBLE = new Set<TimelineCategory>(["reasoning", "llm", "tool", "control"]);

export interface TimelineRow {
  readonly id: string;
  readonly seq: number;
  readonly ts: number;
  readonly iteration: number;        // 0 = before first ReasoningIterationProgress
  readonly category: TimelineCategory;
  readonly kind: string;             // trace kind, or reasoning-thought/-action/-observation/-final
  readonly title: string;            // collapsed one-liner
  readonly trace?: TraceEvent;       // present for non-reasoning rows
  readonly reasoning?: {
    readonly thought?: string;
    readonly action?: string;
    readonly observation?: string;
    readonly rawResponse?: string;
    readonly messages?: readonly ConvMessage[];
    readonly entropy?: number;
  };
}

const CONTROL_KINDS = new Set([
  "strategy-switched", "verifier-verdict", "guard-fired", "reactive-decision",
  "decision-evaluated", "intervention-dispatched", "intervention-suppressed",
  "curator-decision", "alternatives-considered", "harness-signal-injected",
]);

const AUX_SYSTEM_PROMPT_MARKERS = ["tool classifier", "classify", "respond with only valid json"];

/** llm-exchange calls that are harness plumbing, not the agent's real reasoning. */
export function isAux(trace: TraceEvent): boolean {
  if (trace.kind === "kernel-state-snapshot") return true;
  if (trace.kind !== "llm-exchange") return false;
  const t = trace as Extract<TraceEvent, { kind: "llm-exchange" }>;
  if (t.requestKind === "completeStructured") return true;
  const sys = (t.systemPrompt ?? "").toLowerCase();
  return AUX_SYSTEM_PROMPT_MARKERS.some((m) => sys.includes(m));
}

export function categoryOf(trace: TraceEvent): TimelineCategory {
  if (isAux(trace)) return "aux";
  if (trace.kind === "llm-exchange") return "llm";
  if (trace.kind === "tool-call-start" || trace.kind === "tool-call-end") return "tool";
  if (CONTROL_KINDS.has(trace.kind)) return "control";
  return "aux"; // run-started/-completed/entropy/etc. — not surfaced as primary rows
}

export function filterRows(rows: readonly TimelineRow[], active: ReadonlySet<TimelineCategory>): TimelineRow[] {
  return rows.filter((r) => active.has(r.category));
}

export function countByCategory(rows: readonly TimelineRow[]): Record<TimelineCategory, number> {
  const out: Record<TimelineCategory, number> = { reasoning: 0, llm: 0, tool: 0, control: 0, aux: 0 };
  for (const r of rows) out[r.category] += 1;
  return out;
}
```

- [ ] **Step 4: Run test to verify the filter cases pass**

Run: `cd apps/cortex/ui && bun test src/lib/stores/timeline-store.test.ts --timeout 15000`
Expected: the 5 filter/category tests PASS (timeline-store tests added in Task 3 not present yet).

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/stores/timeline-filter.ts apps/cortex/ui/src/lib/stores/timeline-store.test.ts
git commit -m "feat(cortex): timeline category + aux-detection + filter logic"
```

---

## Task 3: Timeline store (merge reasoning + rich rows, group by iteration)

**Files:**
- Create: `apps/cortex/ui/src/lib/stores/timeline-store.ts`
- Test: `apps/cortex/ui/src/lib/stores/timeline-store.test.ts` (append store cases)

- [ ] **Step 1: Append the failing test**

```ts
// append to apps/cortex/ui/src/lib/stores/timeline-store.test.ts
import { get, writable } from "svelte/store";
import { createTimelineStore } from "./timeline-store.js";
import type { RunState } from "./run-store.js";

const ev = (type: string, payload: Record<string, unknown>, ts = 0) => ({ type, payload, ts, v: 1, agentId: "a", runId: "run-1", source: "eventbus" as const });

function runStateWith(events: unknown[]): RunState {
  // Minimal RunState shape — only `events` is read by the timeline store.
  return { events } as unknown as RunState;
}

describe("createTimelineStore", () => {
  it("emits a reasoning row from ReasoningStepCompleted and a control row from StrategySwitched, grouped by iteration", () => {
    const rs = writable(runStateWith([
      ev("ReasoningIterationProgress", { iteration: 1, toolsThisStep: [] }),
      ev("ReasoningStepCompleted", { thought: "thinking about it", strategy: "reactive" }),
      ev("StrategySwitched", { taskId: "run-1", from: "reactive", to: "plan-execute", reason: "stuck", timestamp: 1 }),
      ev("ReasoningIterationProgress", { iteration: 2, toolsThisStep: ["crypto-price"] }),
    ]));
    const store = createTimelineStore(rs);
    const groups = get(store);
    // two iteration groups
    expect(groups.map((g) => g.iteration)).toEqual([1, 2]);
    const kinds = groups.flatMap((g) => g.rows.map((r) => r.kind));
    expect(kinds).toContain("reasoning-thought");
    expect(kinds).toContain("strategy-switched");
  });

  it("preserves reasoning content (no loss): thought text survives onto the row", () => {
    const rs = writable(runStateWith([
      ev("ReasoningIterationProgress", { iteration: 1 }),
      ev("ReasoningStepCompleted", { thought: "the answer is 42", rawResponse: "raw 42" }),
    ]));
    const rows = get(createTimelineStore(rs)).flatMap((g) => g.rows);
    const r = rows.find((x) => x.kind === "reasoning-thought");
    expect(r?.reasoning?.thought).toBe("the answer is 42");
    expect(r?.reasoning?.rawResponse).toBe("raw 42");
  });

  it("normalizes LLMExchangeEmitted into an llm row via toTraceEvent", () => {
    const rs = writable(runStateWith([
      ev("ReasoningIterationProgress", { iteration: 1 }),
      ev("LLMExchangeEmitted", {
        taskId: "run-1", timestamp: 1, iteration: 1, provider: "ollama", model: "qwen3.5",
        requestKind: "stream", systemPrompt: "Environment: …", messages: [], toolSchemaNames: [],
        response: { content: "ok", tokensIn: 50, tokensOut: 3 },
      }),
    ]));
    const rows = get(createTimelineStore(rs)).flatMap((g) => g.rows);
    const llm = rows.find((x) => x.kind === "llm-exchange");
    expect(llm?.category).toBe("llm");
    expect(llm?.trace).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cortex/ui && bun test src/lib/stores/timeline-store.test.ts --timeout 15000`
Expected: FAIL — `Cannot find module './timeline-store.js'`.

- [ ] **Step 3: Implement `timeline-store.ts`**

```ts
// apps/cortex/ui/src/lib/stores/timeline-store.ts
import { derived, type Readable } from "svelte/store";
import type { AgentEvent } from "@reactive-agents/core";
import { toTraceEvent } from "@reactive-agents/trace/normalize"; // browser-safe subpath — NOT the root (root pulls node:fs)
import type { RunState } from "./run-store.js";
import type { ConvMessage } from "./trace-store.js";
import { categoryOf, type TimelineRow } from "./timeline-filter.js";

export interface TimelineGroup {
  readonly iteration: number;
  readonly rows: TimelineRow[];
}

function safeMessages(raw: unknown): readonly ConvMessage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const msgs = raw
    .filter((m): m is { role: string; content: unknown } => !!m && typeof m === "object" && typeof (m as { role?: unknown }).role === "string")
    .map((m) => ({ role: String((m as { role: string }).role), content: typeof (m as { content?: unknown }).content === "string" ? (m as { content: string }).content : JSON.stringify((m as { content: unknown }).content) }));
  return msgs.length > 0 ? msgs : undefined;
}

/** One reasoning row per populated RSC facet (thought / action / observation). */
function reasoningRows(p: Record<string, unknown>, seq: number, ts: number, iteration: number, entropy: number | undefined): TimelineRow[] {
  const out: TimelineRow[] = [];
  const thought = typeof p.thought === "string" ? p.thought.trim() : "";
  const action = typeof p.action === "string" ? p.action.trim() : "";
  const obs = typeof p.observation === "string" ? p.observation.trim() : "";
  const rawResponse = typeof p.rawResponse === "string" ? p.rawResponse.trim() : "";
  const messages = safeMessages(p.messages);
  const mk = (kind: string, title: string, extra: TimelineRow["reasoning"]): TimelineRow => ({
    id: `${seq}-${kind}`, seq, ts, iteration, category: "reasoning", kind, title, reasoning: { entropy, ...extra },
  });
  if (thought) out.push(mk("reasoning-thought", thought.slice(0, 120), { thought, rawResponse: rawResponse || undefined, messages }));
  if (action) out.push(mk("reasoning-action", action.slice(0, 120), { action }));
  if (obs) out.push(mk("reasoning-observation", obs.slice(0, 120), { observation: obs }));
  return out;
}

function traceTitle(trace: NonNullable<TimelineRow["trace"]>): string {
  switch (trace.kind) {
    case "llm-exchange": { const t = trace as { requestKind: string; model: string; response?: { tokensIn?: number; tokensOut?: number } }; return `LLM ${t.requestKind} · ${t.model} · in ${t.response?.tokensIn ?? "?"} / out ${t.response?.tokensOut ?? "?"}`; }
    case "tool-call-start": return `→ tool ${(trace as { toolName: string }).toolName}`;
    case "tool-call-end": { const t = trace as { toolName: string; ok?: boolean; durationMs?: number }; return `✓ tool ${t.toolName} ${t.ok === false ? "FAILED" : ""} ${t.durationMs ?? 0}ms`; }
    case "strategy-switched": { const t = trace as { from: string; to: string; reason: string }; return `strategy ${t.from} → ${t.to}: ${t.reason}`; }
    case "verifier-verdict": { const t = trace as { verified: boolean; summary: string }; return `verifier ${t.verified ? "✓" : "✗"} ${t.summary}`; }
    case "guard-fired": { const t = trace as { guard?: string; outcome?: string; reason?: string }; return `guard ${t.guard ?? ""} ${t.outcome ?? ""}: ${t.reason ?? ""}`; }
    default: return trace.kind;
  }
}

export function createTimelineStore(runState: Readable<RunState>): Readable<TimelineGroup[]> {
  return derived(runState, ($state): TimelineGroup[] => {
    const rows: TimelineRow[] = [];
    let iteration = 0;
    let pendingEntropy: number | undefined;
    const events = ($state.events ?? []) as readonly { type: string; payload: Record<string, unknown>; ts: number }[];

    events.forEach((msg, seq) => {
      const p = msg.payload;
      if (msg.type === "ReasoningIterationProgress") {
        iteration = typeof p.iteration === "number" ? p.iteration : iteration + 1;
        return;
      }
      if (msg.type === "EntropyScored") {
        if (typeof p.composite === "number") pendingEntropy = p.composite;
        return;
      }
      if (msg.type === "ReasoningStepCompleted") {
        for (const r of reasoningRows(p, seq, msg.ts, iteration, pendingEntropy)) rows.push(r);
        return;
      }
      if (msg.type === "FinalAnswerProduced") {
        const answer = typeof p.answer === "string" ? p.answer.trim() : "";
        if (answer) rows.push({ id: `${seq}-final`, seq, ts: msg.ts, iteration, category: "reasoning", kind: "final", title: answer.slice(0, 120), reasoning: { thought: answer } });
        return;
      }
      // Rich events → normalized TraceEvent (pure mapper); null = unmapped, skip.
      const trace = toTraceEvent(p as unknown as AgentEvent, seq);
      if (!trace) return;
      const category = categoryOf(trace);
      rows.push({ id: `${seq}-${trace.kind}`, seq, ts: msg.ts, iteration: (trace as { iter?: number }).iter && (trace as { iter: number }).iter > 0 ? (trace as { iter: number }).iter : iteration, category, kind: trace.kind, title: traceTitle(trace), trace });
    });

    // Group by iteration, preserving insertion (chronological) order within a group.
    const byIter = new Map<number, TimelineRow[]>();
    for (const r of rows) {
      const g = byIter.get(r.iteration) ?? [];
      g.push(r);
      byIter.set(r.iteration, g);
    }
    return [...byIter.entries()].sort((a, b) => a[0] - b[0]).map(([iteration, rows]) => ({ iteration, rows }));
  });
}

export type TimelineStore = ReturnType<typeof createTimelineStore>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/cortex/ui && bun test src/lib/stores/timeline-store.test.ts --timeout 15000`
Expected: PASS — all filter + store cases (8 total).

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/stores/timeline-store.ts apps/cortex/ui/src/lib/stores/timeline-store.test.ts
git commit -m "feat(cortex): unified timeline store merging reasoning + rich trace rows"
```

---

## Task 4: `TimelineRow.svelte` renderer

**Files:**
- Create: `apps/cortex/ui/src/lib/components/TimelineRow.svelte`

(UI component — verified by `svelte-check` + manual run; no unit test. Keep logic-free: pure presentation of a `TimelineRow`.)

- [ ] **Step 1: Implement the component**

```svelte
<!-- apps/cortex/ui/src/lib/components/TimelineRow.svelte -->
<script lang="ts">
  import type { TimelineRow } from "../stores/timeline-filter.js";
  interface Props { row: TimelineRow; expanded: boolean; onToggle: () => void; }
  let { row, expanded, onToggle }: Props = $props();

  const dotClass = $derived(
    row.category === "reasoning" ? "bg-secondary"
    : row.category === "llm" ? "bg-primary"
    : row.category === "tool" ? "bg-emerald-500"
    : row.category === "control" ? "bg-amber-500"
    : "bg-outline/50",
  );
  // llm-exchange cache hit ratio for the collapsed badge (real cost signal).
  const cache = $derived.by(() => {
    if (row.trace?.kind !== "llm-exchange") return null;
    const r = (row.trace as { response?: { cacheReadTokensIn?: number; tokensIn?: number } }).response;
    if (!r?.cacheReadTokensIn || !r.tokensIn) return null;
    return Math.round((r.cacheReadTokensIn / r.tokensIn) * 100);
  });
</script>

<button type="button" class="w-full flex items-start gap-2 text-left py-1 hover:bg-surface-container/40" onclick={onToggle}>
  <span class="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 {dotClass}"></span>
  <span class="font-mono text-[11px] text-on-surface-variant truncate flex-1">{row.title}</span>
  {#if cache !== null}<span class="font-mono text-[10px] text-primary/70">cache {cache}%</span>{/if}
  <span class="font-mono text-[10px] text-outline/60">#{row.seq}</span>
</button>

{#if expanded}
  <div class="ml-4 pl-2 border-l border-[var(--cortex-border)] text-[11px] font-mono whitespace-pre-wrap break-words text-on-surface-variant/90 pb-2">
    {#if row.reasoning}
      {#if row.reasoning.thought}<div class="mb-1"><span class="text-tertiary/70">thought:</span> {row.reasoning.thought}</div>{/if}
      {#if row.reasoning.action}<div class="mb-1"><span class="text-tertiary/70">action:</span> {row.reasoning.action}</div>{/if}
      {#if row.reasoning.observation}<div class="mb-1"><span class="text-tertiary/70">observation:</span> {row.reasoning.observation}</div>{/if}
      {#if row.reasoning.rawResponse}<div class="mb-1 opacity-70"><span class="text-tertiary/70">raw:</span> {row.reasoning.rawResponse}</div>{/if}
      {#if row.reasoning.messages}<div class="opacity-70">{row.reasoning.messages.length} messages</div>{/if}
    {:else if row.trace}
      <pre class="overflow-x-auto">{JSON.stringify(row.trace, null, 2)}</pre>
    {/if}
  </div>
{/if}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/cortex/ui && bun run check 2>&1 | grep -i timelinerow || echo "no TimelineRow errors"`
Expected: `no TimelineRow errors` (pre-existing unrelated errors from vite.config / bun:test are acceptable — see VitalsStrip precedent).

- [ ] **Step 3: Commit**

```bash
git add apps/cortex/ui/src/lib/components/TimelineRow.svelte
git commit -m "feat(cortex): TimelineRow renderer with per-category styling + cache badge"
```

---

## Task 5: Filter chips + wire into TracePanel (no loss)

**Files:**
- Create: `apps/cortex/ui/src/lib/components/TimelineFilterChips.svelte`
- Modify: `apps/cortex/ui/src/lib/components/TracePanel.svelte`

- [ ] **Step 1: Implement the chips component**

```svelte
<!-- apps/cortex/ui/src/lib/components/TimelineFilterChips.svelte -->
<script lang="ts">
  import { ALL_CATEGORIES, type TimelineCategory } from "../stores/timeline-filter.js";
  interface Props { active: Set<TimelineCategory>; counts: Record<TimelineCategory, number>; onToggle: (c: TimelineCategory) => void; }
  let { active, counts, onToggle }: Props = $props();
  const LABEL: Record<TimelineCategory, string> = { reasoning: "Reasoning", llm: "LLM calls", tool: "Tools", control: "Control", aux: "Aux/internal" };
</script>

<div class="flex flex-wrap gap-1.5 px-2 py-1.5 border-b border-[var(--cortex-border)]">
  {#each ALL_CATEGORIES as c (c)}
    <button type="button"
      class="font-mono text-[10px] px-2 py-0.5 rounded-full border transition-colors {active.has(c)
        ? 'border-primary/40 bg-primary/12 text-primary'
        : 'border-outline/30 text-outline/60 hover:text-on-surface-variant'}"
      onclick={() => onToggle(c)}>
      {LABEL[c]} <span class="opacity-60">{counts[c] ?? 0}</span>
    </button>
  {/each}
</div>
```

- [ ] **Step 2: Wire the timeline into TracePanel**

In `TracePanel.svelte`: keep the existing `frame`/`frames`/`status`/`streamText` props and all existing affordances. ADD a timeline view driven by the run state. Because `TracePanel` currently receives `frames` (derived from trace-store), pass the run-store-derived timeline groups in as a new optional prop `timeline` from the parent (`RunDetail.svelte`) and render it as the primary body; keep the old frame list reachable via a "Frames" toggle so NOTHING is lost.

Add to the `<script>`:

```ts
import TimelineRow from "./TimelineRow.svelte";
import TimelineFilterChips from "./TimelineFilterChips.svelte";
import { DEFAULT_VISIBLE, filterRows, countByCategory, type TimelineCategory } from "../stores/timeline-filter.js";
import type { TimelineGroup } from "../stores/timeline-store.js";

let { /* existing props */ timeline = [] as TimelineGroup[] }: Props & { timeline?: TimelineGroup[] } = $props();

let active = $state<Set<TimelineCategory>>(new Set(DEFAULT_VISIBLE));
let expandedTimeline = $state<string[]>([]);
let showFrames = $state(false); // false = rich timeline (default), true = legacy frame list

const allRows = $derived(timeline.flatMap((g) => g.rows));
const counts = $derived(countByCategory(allRows));
const visibleGroups = $derived(
  timeline
    .map((g) => ({ iteration: g.iteration, rows: filterRows(g.rows, active) }))
    .filter((g) => g.rows.length > 0),
);
function toggleCat(c: TimelineCategory) {
  const next = new Set(active);
  next.has(c) ? next.delete(c) : next.add(c);
  active = next;
}
function toggleTimelineRow(id: string) {
  expandedTimeline = expandedTimeline.includes(id) ? expandedTimeline.filter((x) => x !== id) : [...expandedTimeline, id];
}
```

Add to the markup (above the existing frames block), gating the legacy view behind `showFrames`:

```svelte
<div class="flex items-center justify-between px-2 py-1">
  <div class="flex gap-1">
    <button type="button" class="text-[10px] px-2 py-0.5 rounded {showFrames ? 'text-outline/60' : 'text-primary'}" onclick={() => (showFrames = false)}>Timeline</button>
    <button type="button" class="text-[10px] px-2 py-0.5 rounded {showFrames ? 'text-primary' : 'text-outline/60'}" onclick={() => (showFrames = true)}>Frames</button>
  </div>
</div>

{#if !showFrames}
  <TimelineFilterChips {active} {counts} onToggle={toggleCat} />
  <div class="flex flex-col">
    {#each visibleGroups as g (g.iteration)}
      <div class="px-2 py-1 text-[10px] font-mono text-amber-700 dark:text-amber-600 sticky top-0 bg-surface-container-lowest/90">iteration {g.iteration}</div>
      {#each g.rows as r (r.id)}
        <TimelineRow row={r} expanded={expandedTimeline.includes(r.id)} onToggle={() => toggleTimelineRow(r.id)} />
      {/each}
    {/each}
    {#if visibleGroups.length === 0}
      <div class="px-3 py-6 text-center text-[11px] text-outline/50">No events match the active filters.</div>
    {/if}
  </div>
{:else}
  <!-- existing frame-list markup stays here UNCHANGED -->
{/if}
```

In `RunDetail.svelte`: create the timeline store next to the existing trace store and pass it to `TracePanel`:

```ts
import { createTimelineStore } from "$lib/stores/timeline-store.js";
const timelineStore = createTimelineStore(runState); // runState is the existing Readable<RunState>
// in markup: <TracePanel ... timeline={$timelineStore} />
```

- [ ] **Step 3: Typecheck the UI**

Run: `cd apps/cortex/ui && bun run check 2>&1 | grep -iE "TracePanel|TimelineFilterChips|RunDetail|timeline-store" || echo "no new errors"`
Expected: `no new errors`.

- [ ] **Step 4: Commit**

```bash
git add apps/cortex/ui/src/lib/components/TimelineFilterChips.svelte apps/cortex/ui/src/lib/components/TracePanel.svelte apps/cortex/ui/src/lib/components/RunDetail.svelte
git commit -m "feat(cortex): rich event-timeline view in TracePanel with filter chips (frames preserved)"
```

---

## Task 6: Live verification + no-loss audit

**Files:** none (verification only).

- [ ] **Step 1: Build the UI**

Run: `cd apps/cortex/ui && bun run build 2>&1 | tail -5`
Expected: Vite build succeeds (exit 0).

- [ ] **Step 2: Run a real agent through Cortex and inspect**

Start the Cortex dev server, run a `plan-execute-reflect` ollama agent (multi-tool task), open the run. Confirm in the Timeline tab:
- reasoning rows (thought/action/observation) appear per iteration — **no loss vs the old frame view**;
- `LLM calls` rows show provider/model/token counts (and cache % on Anthropic);
- a `Control` row appears for any strategy switch / verifier verdict / guard;
- filter chips mute/reveal categories; `Aux/internal` hidden by default, revealed on click;
- the `Frames` toggle still renders the original frame list verbatim;
- replay scrub still works and the timeline reflects the scrubbed iteration.

- [ ] **Step 3: Full typecheck across touched packages**

Run: `bunx turbo run typecheck --filter=@reactive-agents/trace && cd apps/cortex/ui && bun test src/lib --timeout 15000 2>&1 | tail -5`
Expected: trace typecheck exit 0; cortex-ui lib tests green.

- [ ] **Step 4: Commit any verification fixes, then summarize**

```bash
git add -A
git commit -m "test(cortex): verify rich-trace timeline parity + no-loss" # only if fixes were needed
```

---

## Task 7: Context-length (numCtx) override in the agent builder panel

**Context:** RA's builder accepts `numCtx` via `.withModel({ model, numCtx })` → `config.numCtx` (top-level) → `runtime options.numCtx` → provider (`local.ts` precedence: `request.numCtx ?? config.explicitNumCtx ?? capability.recommendedNumCtx ?? config.defaultNumCtx`). This closes the loop with the bug-2 gauge: the user can now SET the exact window. `numCtx` is provider-honored only where the provider exposes a context-window knob (Ollama `num_ctx`); cloud providers that don't expose it simply ignore the field — so the UI labels it accordingly and never blocks.

**Files:**
- Modify: `apps/cortex/server/services/cortex-agent-config.ts` (normalize + persist `numCtx`)
- Modify: `apps/cortex/server/services/cortex-to-agent-config.ts` (map `params.numCtx` → top-level `draft.numCtx`)
- Modify: `apps/cortex/server/services/build-cortex-agent.ts` (forward `numCtx` in the agent params spread)
- Modify: `apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte` (Inference-section number field)
- Test: `apps/cortex/server/tests/cortex-to-agent-config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// add to apps/cortex/server/tests/cortex-to-agent-config.test.ts
import { describe, it, expect } from "bun:test";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js"; // use the file's actual exported fn name

describe("numCtx mapping", () => {
  it("maps a positive numCtx to top-level draft.numCtx", () => {
    const cfg = cortexParamsToAgentConfig({ provider: "ollama", model: "qwen3.5:latest", numCtx: 32768 } as never);
    expect((cfg as { numCtx?: number }).numCtx).toBe(32768);
  });
  it("omits numCtx when unset or non-positive", () => {
    const cfg = cortexParamsToAgentConfig({ provider: "ollama", model: "qwen3.5:latest", numCtx: 0 } as never);
    expect((cfg as { numCtx?: number }).numCtx).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/cortex && bun test server/tests/cortex-to-agent-config.test.ts --timeout 15000`
Expected: FAIL — `numCtx` is undefined on the result (mapping not implemented). (First confirm the real exported function name in `cortex-to-agent-config.ts` and fix the import if it differs.)

- [ ] **Step 3: Map numCtx in `cortex-to-agent-config.ts`**

Add alongside the existing top-level `provider`/`model` assignment on the draft (mirror that block, NOT the `execution` block — `numCtx` is top-level config, not under `execution`):

```ts
// where draft.provider / draft.model are set:
if (typeof params.numCtx === "number" && params.numCtx > 0) {
  draft.numCtx = params.numCtx;
}
```

Add `numCtx?: number` to the params input type/interface this function accepts.

- [ ] **Step 4: Persist numCtx in `cortex-agent-config.ts`**

In the normalizer that lists numeric fields (`n("temperature"); n("maxTokens"); …`), add:

```ts
n("numCtx");
```

And in the two config-assembly spreads (the `...(typeof a.provider === "string" …)` / `...(typeof o.maxIterations === "number" …)` regions ~224/~328), add:

```ts
...(typeof a.numCtx === "number" && a.numCtx > 0 ? { numCtx: a.numCtx } : {}),
```

(use the matching local variable name `a`/`o` for each region). Add `readonly numCtx?: number;` to the config type(s) at ~412/~420.

- [ ] **Step 5: Forward numCtx in `build-cortex-agent.ts`**

Add `readonly numCtx?: number;` to the agent params interface (near `readonly maxIterations?: number;` line 45), and forward it in the params spread (near line 177-180):

```ts
...(at.agent.numCtx ? { numCtx: at.agent.numCtx } : {}),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/cortex && bun test server/tests/cortex-to-agent-config.test.ts --timeout 15000`
Expected: PASS (both cases).

- [ ] **Step 7: Add the UI field in `AgentConfigPanel.svelte`**

In the **Inference** section, next to the existing `maxTokens`/`temperature` inputs, add a context-length field bound to `config.numCtx`. Mirror the existing number-input markup/binding pattern in that section (read the surrounding inputs first to match classes + the config-mutation idiom):

```svelte
<label class="block">
  <span class="text-[11px] text-on-surface-variant">Context length (numCtx)</span>
  <input
    type="number" min="0" step="1024" placeholder="auto (provider default)"
    bind:value={config.numCtx}
    class="…match-sibling-input-classes…" />
  <span class="text-[10px] text-outline/60">
    Overrides the provider context window. Honored by local providers (Ollama num_ctx);
    cloud providers that don't expose a context knob ignore it.
  </span>
</label>
```

Ensure the panel's `config` type includes `numCtx?: number` so binding type-checks.

- [ ] **Step 8: Typecheck + commit**

Run: `cd apps/cortex/ui && bun run check 2>&1 | grep -iE "AgentConfigPanel" || echo "no AgentConfigPanel errors"` and `cd apps/cortex && bun test server/tests/cortex-to-agent-config.test.ts --timeout 15000`
Expected: no AgentConfigPanel errors; mapping tests green.

```bash
git add apps/cortex/server/services/cortex-agent-config.ts apps/cortex/server/services/cortex-to-agent-config.ts apps/cortex/server/services/build-cortex-agent.ts apps/cortex/ui/src/lib/components/AgentConfigPanel.svelte apps/cortex/server/tests/cortex-to-agent-config.test.ts
git commit -m "feat(cortex): context-length (numCtx) override in agent builder panel"
```

---

## Self-Review

**Spec coverage:**
- Live-rich timeline → Tasks 3–5. ✓
- Event-timeline row model → `TimelineRow` + `createTimelineStore` (per-event rows). ✓
- Reuse trace package model → Task 1 exports `toTraceEvent`; Task 3 calls it. ✓
- All events + filter chips → Task 2 (categories/aux) + Task 5 (chips, default hides aux). ✓
- No lost functionality → reasoning rows preserve RSC content (Task 3 test), `Frames` toggle keeps legacy view, replay unchanged (Task 5/6). ✓
- Approach A′ deviation + phase-label limitation → documented in header. ✓

**Placeholder scan:** the only non-literal block is Task 1 Step 3's "paste every existing case body" — this is a deliberate *move* of existing, already-correct code (reproducing ~270 lines verbatim adds no value and risks transcription drift); the transformation rule (`nextSeq()` → `seq`) is explicit. All other code blocks are complete.

**Type consistency:** `TimelineRow`/`TimelineCategory` defined once in `timeline-filter.ts`, imported everywhere. `createTimelineStore` returns `TimelineGroup[]`; `TracePanel`/`RunDetail` consume `TimelineGroup[]`. `toTraceEvent(raw, seq)` signature consistent across Task 1 definition and Task 3 call.

## Out of scope
- Phase-2 offline `analyzeRun()` analysis tab + JSONL recorder on Cortex runs.
- Phase sub-labels (need a new event field).
- Server-side normalization / new DB columns (not needed; raw events already flow + persist).
