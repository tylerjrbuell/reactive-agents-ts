# Cortex Run Comparison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add side-by-side run comparison to Cortex so developers can A/B test prompts, strategies, models, and configs by selecting two runs and seeing their vitals, trace, and debrief aligned next to each other.

**Architecture:** No new backend endpoints — the existing `GET /api/runs/:runId` and `GET /api/runs/:runId/events` endpoints provide all needed data. A `comparison-store.ts` fetches both runs in parallel and derives a `ComparisonState`. The `/compare` route accepts `?a=runId&b=runId` query params. The runs list page gets a "Compare mode" toggle that lets users select exactly two runs and navigate to the comparison view.

**Tech Stack:** Svelte 5 (runes), SvelteKit routing, Tailwind CSS. No backend changes.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `apps/cortex/ui/src/lib/stores/comparison-store.ts` | Fetch + derive comparison state from two runs |
| Create | `apps/cortex/ui/src/lib/components/RunComparisonVitals.svelte` | Side-by-side vitals + config diff |
| Create | `apps/cortex/ui/src/lib/components/RunComparisonTrace.svelte` | Aligned trace rows for both runs |
| Create | `apps/cortex/ui/src/routes/compare/+page.svelte` | `/compare?a=...&b=...` route |
| Modify | `apps/cortex/ui/src/routes/runs/+page.svelte` | Compare mode toggle + run selection |

---

### Task 1: `comparison-store.ts` — fetch and derive comparison state

**Files:**
- Create: `apps/cortex/ui/src/lib/stores/comparison-store.ts`

**Background:** `GET /api/runs/:runId` returns a `RunSummary` with `runId, agentId, status, iterationCount, tokensUsed, cost, provider, model, strategy, debrief` (as raw JSON string). `GET /api/runs/:runId/events` returns the full event list. We need to extract trace frames (from `ReasoningStepCompleted` events) and vitals from both runs.

- [ ] **Step 1: Write the failing test**

Create `apps/cortex/ui/src/lib/stores/comparison-store.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { extractTraceFrames, extractVitals, diffConfigs } from "./comparison-store.js";

const mockEvents = [
  {
    type: "ReasoningStepCompleted",
    payload: { kernelPass: 1, step: 1, totalSteps: 1, strategy: "reactive", thought: "Analyzing…", action: "web-search", observation: "Result found" },
    ts: 1000,
  },
  {
    type: "ReasoningStepCompleted",
    payload: { kernelPass: 2, step: 1, totalSteps: 1, strategy: "reactive", thought: "Synthesizing…", action: null, observation: null },
    ts: 2000,
  },
  {
    type: "LLMRequestCompleted",
    payload: { tokensUsed: 500, estimatedCost: 0.001, provider: "anthropic", model: "claude-sonnet-4-6", durationMs: 1200 },
    ts: 1200,
  },
];

describe("extractTraceFrames", () => {
  it("extracts one frame per unique kernelPass", () => {
    const frames = extractTraceFrames(mockEvents);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.iteration).toBe(1);
    expect(frames[0]!.thought).toBe("Analyzing…");
    expect(frames[0]!.action).toBe("web-search");
    expect(frames[1]!.iteration).toBe(2);
    expect(frames[1]!.thought).toBe("Synthesizing…");
  });
});

describe("extractVitals", () => {
  it("extracts provider/model from LLMRequestCompleted", () => {
    const vitals = extractVitals(mockEvents);
    expect(vitals.provider).toBe("anthropic");
    expect(vitals.model).toBe("claude-sonnet-4-6");
    expect(vitals.tokensUsed).toBe(500);
  });
});

describe("diffConfigs", () => {
  it("returns changed fields between two run summaries", () => {
    const a = { provider: "anthropic", model: "claude-opus-4-6", strategy: "reactive", iterationCount: 5, tokensUsed: 1000, cost: 0.005 };
    const b = { provider: "anthropic", model: "claude-sonnet-4-6", strategy: "plan-execute-reflect", iterationCount: 3, tokensUsed: 600, cost: 0.003 };
    const diffs = diffConfigs(a, b);
    expect(diffs.find((d) => d.key === "model")).toBeTruthy();
    expect(diffs.find((d) => d.key === "strategy")).toBeTruthy();
    expect(diffs.find((d) => d.key === "provider")).toBeFalsy(); // same
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts
bun test apps/cortex/ui/src/lib/stores/comparison-store.test.ts 2>&1 | tail -15
```

Expected: FAIL — `comparison-store.js` not found.

- [ ] **Step 3: Create `apps/cortex/ui/src/lib/stores/comparison-store.ts`**

```typescript
import { writable } from "svelte/store";
import { CORTEX_SERVER_URL } from "$lib/constants.js";

export type TraceFrame = {
  iteration: number;
  thought: string;
  action: string | null;
  observation: string | null;
  strategy: string;
};

export type RunVitals = {
  provider: string | null;
  model: string | null;
  strategy: string | null;
  tokensUsed: number;
  cost: number;
  iterationCount: number;
  durationMs: number | null;
  status: string;
};

export type ConfigDiff = {
  key: string;
  a: string | number | null;
  b: string | number | null;
};

export type RunSide = {
  runId: string;
  summary: Record<string, unknown> | null;
  vitals: RunVitals;
  frames: TraceFrame[];
  debrief: Record<string, unknown> | null;
  loading: boolean;
  error: string | null;
};

export type ComparisonState = {
  a: RunSide;
  b: RunSide;
  diffs: ConfigDiff[];
};

const emptyVitals = (): RunVitals => ({
  provider: null, model: null, strategy: null,
  tokensUsed: 0, cost: 0, iterationCount: 0, durationMs: null, status: "unknown",
});

const emptySide = (runId: string, loading = false): RunSide => ({
  runId, summary: null, vitals: emptyVitals(), frames: [], debrief: null, loading, error: null,
});

// ── Pure helper functions (exported for testing) ──────────────────────────────

export function extractTraceFrames(events: Array<{ type: string; payload: Record<string, unknown>; ts: number }>): TraceFrame[] {
  const seen = new Map<number, TraceFrame>();
  for (const ev of events) {
    if (ev.type !== "ReasoningStepCompleted") continue;
    const p = ev.payload;
    const pass = typeof p.kernelPass === "number" ? p.kernelPass : 0;
    if (!seen.has(pass)) {
      seen.set(pass, {
        iteration: pass,
        thought: typeof p.thought === "string" ? p.thought : "",
        action: typeof p.action === "string" && p.action ? p.action : null,
        observation: typeof p.observation === "string" && p.observation ? p.observation : null,
        strategy: typeof p.strategy === "string" ? p.strategy : "unknown",
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.iteration - b.iteration);
}

export function extractVitals(events: Array<{ type: string; payload: Record<string, unknown>; ts: number }>): Partial<RunVitals> {
  let provider: string | null = null;
  let model: string | null = null;
  let tokensUsed = 0;
  let cost = 0;
  let durationMs: number | null = null;

  for (const ev of events) {
    if (ev.type === "LLMRequestCompleted") {
      const p = ev.payload;
      if (typeof p.provider === "string") provider = p.provider;
      if (typeof p.model === "string") model = p.model;
      if (typeof p.tokensUsed === "number") tokensUsed += p.tokensUsed;
      if (typeof p.estimatedCost === "number") cost += p.estimatedCost;
      if (typeof p.durationMs === "number") durationMs = (durationMs ?? 0) + p.durationMs;
    }
  }
  return { provider, model, tokensUsed, cost, durationMs };
}

export function diffConfigs(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): ConfigDiff[] {
  const COMPARE_KEYS: Array<keyof typeof a> = ["provider", "model", "strategy", "iterationCount", "tokensUsed", "cost"];
  const diffs: ConfigDiff[] = [];
  for (const key of COMPARE_KEYS) {
    const av = a[key] ?? null;
    const bv = b[key] ?? null;
    if (av !== bv) {
      diffs.push({ key: String(key), a: av as string | number | null, b: bv as string | number | null });
    }
  }
  return diffs;
}

// ── Store ─────────────────────────────────────────────────────────────────────

function createComparisonStore() {
  const { subscribe, set, update } = writable<ComparisonState>({
    a: emptySide(""),
    b: emptySide(""),
    diffs: [],
  });

  async function fetchSide(runId: string): Promise<RunSide> {
    const [summaryRes, eventsRes] = await Promise.all([
      fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}`),
      fetch(`${CORTEX_SERVER_URL}/api/runs/${encodeURIComponent(runId)}/events`),
    ]);
    if (!summaryRes.ok) throw new Error(`Run ${runId} not found`);
    const summary = (await summaryRes.json()) as Record<string, unknown>;
    const events = (await eventsRes.json()) as Array<{ type: string; payload: Record<string, unknown>; ts: number }>;

    const frames = extractTraceFrames(events);
    const eventVitals = extractVitals(events);
    const vitals: RunVitals = {
      provider: (summary.provider as string | null) ?? eventVitals.provider ?? null,
      model: (summary.model as string | null) ?? eventVitals.model ?? null,
      strategy: (summary.strategy as string | null) ?? null,
      tokensUsed: typeof summary.tokensUsed === "number" ? summary.tokensUsed : (eventVitals.tokensUsed ?? 0),
      cost: typeof summary.cost === "number" ? summary.cost : (eventVitals.cost ?? 0),
      iterationCount: typeof summary.iterationCount === "number" ? summary.iterationCount : 0,
      durationMs: typeof summary.completedAt === "number" && typeof summary.startedAt === "number"
        ? summary.completedAt - summary.startedAt
        : (eventVitals.durationMs ?? null),
      status: typeof summary.status === "string" ? summary.status : "unknown",
    };

    let debrief: Record<string, unknown> | null = null;
    if (typeof summary.debrief === "string") {
      try { debrief = JSON.parse(summary.debrief) as Record<string, unknown>; } catch { /* ok */ }
    }

    return { runId, summary, vitals, frames, debrief, loading: false, error: null };
  }

  async function load(runIdA: string, runIdB: string) {
    update(() => ({
      a: emptySide(runIdA, true),
      b: emptySide(runIdB, true),
      diffs: [],
    }));

    const [sideA, sideB] = await Promise.allSettled([fetchSide(runIdA), fetchSide(runIdB)]);

    const a: RunSide = sideA.status === "fulfilled" ? sideA.value : { ...emptySide(runIdA), error: sideA.reason?.message ?? "Load failed", loading: false };
    const b: RunSide = sideB.status === "fulfilled" ? sideB.value : { ...emptySide(runIdB), error: sideB.reason?.message ?? "Load failed", loading: false };

    const diffs = (a.summary && b.summary) ? diffConfigs(a.summary, b.summary) : [];
    set({ a, b, diffs });
  }

  return { subscribe, load };
}

export const comparisonStore = createComparisonStore();
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test apps/cortex/ui/src/lib/stores/comparison-store.test.ts 2>&1 | tail -15
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/stores/comparison-store.ts \
        apps/cortex/ui/src/lib/stores/comparison-store.test.ts
git commit -m "feat(cortex): comparison-store fetches and aligns two run summaries"
```

---

### Task 2: `RunComparisonVitals.svelte` — vitals + config diff

**Files:**
- Create: `apps/cortex/ui/src/lib/components/RunComparisonVitals.svelte`

**Background:** Shows two columns of stats. The `diffs` array tells us which keys differ — highlight those with a distinct color. Stats to show: status, provider, model, strategy, tokens, cost, iterations, duration.

- [ ] **Step 1: Create `RunComparisonVitals.svelte`**

```svelte
<script lang="ts">
  import type { RunSide, ConfigDiff } from "$lib/stores/comparison-store.js";

  interface Props {
    a: RunSide;
    b: RunSide;
    diffs: ConfigDiff[];
  }
  const { a, b, diffs } = $props();

  const diffKeys = $derived(new Set(diffs.map((d) => d.key)));

  function fmt(v: unknown): string {
    if (v == null) return "—";
    if (typeof v === "number") return v.toLocaleString();
    return String(v);
  }

  function fmtCost(v: number): string {
    return v < 0.001 ? `<$0.001` : `$${v.toFixed(4)}`;
  }

  function fmtMs(ms: number | null): string {
    if (ms == null) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  type Row = { key: string; label: string; aVal: string; bVal: string };

  const rows = $derived<Row[]>([
    { key: "status",         label: "Status",     aVal: fmt(a.vitals.status),         bVal: fmt(b.vitals.status) },
    { key: "provider",       label: "Provider",   aVal: fmt(a.vitals.provider),       bVal: fmt(b.vitals.provider) },
    { key: "model",          label: "Model",      aVal: fmt(a.vitals.model),          bVal: fmt(b.vitals.model) },
    { key: "strategy",       label: "Strategy",   aVal: fmt(a.vitals.strategy),       bVal: fmt(b.vitals.strategy) },
    { key: "iterationCount", label: "Iterations", aVal: fmt(a.vitals.iterationCount), bVal: fmt(b.vitals.iterationCount) },
    { key: "tokensUsed",     label: "Tokens",     aVal: fmt(a.vitals.tokensUsed),     bVal: fmt(b.vitals.tokensUsed) },
    { key: "cost",           label: "Cost",       aVal: fmtCost(a.vitals.cost),       bVal: fmtCost(b.vitals.cost) },
    { key: "durationMs",     label: "Duration",   aVal: fmtMs(a.vitals.durationMs),  bVal: fmtMs(b.vitals.durationMs) },
  ]);
</script>

<div class="border border-white/8 rounded-lg overflow-hidden font-mono text-[11px]">
  <!-- Header -->
  <div class="grid grid-cols-3 bg-surface-variant/20 border-b border-white/8">
    <div class="px-3 py-2 text-[9px] uppercase tracking-widest text-outline/50">Field</div>
    <div class="px-3 py-2 text-[9px] uppercase tracking-widest text-primary/70 border-l border-white/8">
      A · {a.runId.slice(0, 8)}
    </div>
    <div class="px-3 py-2 text-[9px] uppercase tracking-widest text-secondary/70 border-l border-white/8">
      B · {b.runId.slice(0, 8)}
    </div>
  </div>

  {#each rows as row (row.key)}
    {@const isDiff = diffKeys.has(row.key)}
    <div class="grid grid-cols-3 border-b border-white/5 last:border-b-0
                {isDiff ? 'bg-tertiary/5' : ''}">
      <div class="px-3 py-1.5 text-outline/50 flex items-center gap-1">
        {#if isDiff}
          <span class="w-1 h-1 rounded-full bg-tertiary flex-shrink-0"></span>
        {/if}
        {row.label}
      </div>
      <div class="px-3 py-1.5 border-l border-white/5 {isDiff ? 'text-primary' : 'text-on-surface/75'}">
        {row.aVal}
      </div>
      <div class="px-3 py-1.5 border-l border-white/5 {isDiff ? 'text-secondary' : 'text-on-surface/75'}">
        {row.bVal}
      </div>
    </div>
  {/each}

  {#if diffs.length === 0}
    <div class="px-3 py-2 text-outline/40 italic text-[10px] col-span-3">Identical configuration</div>
  {/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add apps/cortex/ui/src/lib/components/RunComparisonVitals.svelte
git commit -m "feat(cortex): RunComparisonVitals diff table highlights changed fields"
```

---

### Task 3: `RunComparisonTrace.svelte` — aligned trace rows

**Files:**
- Create: `apps/cortex/ui/src/lib/components/RunComparisonTrace.svelte`

**Background:** Shows two columns of trace frames, aligned by iteration number. If run A has 5 iterations and B has 3, rows 4 and 5 on the B side are empty. Each frame shows `thought`, `action`, and `observation` truncated to 3 lines.

- [ ] **Step 1: Create `RunComparisonTrace.svelte`**

```svelte
<script lang="ts">
  import type { RunSide } from "$lib/stores/comparison-store.js";

  interface Props { a: RunSide; b: RunSide; }
  const { a, b } = $props();

  const maxIter = $derived(Math.max(a.frames.length, b.frames.length));
  const iterations = $derived(Array.from({ length: maxIter }, (_, i) => i + 1));

  function frameAt(side: RunSide, iteration: number) {
    return side.frames.find((f) => f.iteration === iteration) ?? null;
  }
</script>

<div class="space-y-2">
  {#if maxIter === 0}
    <p class="text-outline/40 italic text-[10px] font-mono">No trace frames recorded</p>
  {:else}
    {#each iterations as iter}
      <div class="grid grid-cols-2 gap-2">
        {#each [{ side: a, color: "border-primary/20 bg-primary/4" }, { side: b, color: "border-secondary/20 bg-secondary/4" }] as { side, color }}
          {@const frame = frameAt(side, iter)}
          <div class="border {color} rounded p-2 font-mono text-[10px] min-h-[60px]">
            {#if frame}
              <div class="text-[9px] text-outline/40 mb-1 uppercase tracking-widest">Loop {iter} · {frame.strategy}</div>
              <p class="text-on-surface/80 leading-relaxed line-clamp-3 mb-1 whitespace-pre-wrap">{frame.thought}</p>
              {#if frame.action}
                <div class="flex items-baseline gap-1 text-[9px]">
                  <span class="text-secondary/60 uppercase">→</span>
                  <span class="text-secondary/80">{frame.action}</span>
                </div>
              {/if}
            {:else}
              <div class="text-outline/20 italic text-[9px]">— no frame —</div>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add apps/cortex/ui/src/lib/components/RunComparisonTrace.svelte
git commit -m "feat(cortex): RunComparisonTrace aligns trace frames by iteration index"
```

---

### Task 4: `/compare` route

**Files:**
- Create: `apps/cortex/ui/src/routes/compare/+page.svelte`

**Background:** The route reads `?a=runId&b=runId` from the URL, loads both runs, and renders `RunComparisonVitals` + `RunComparisonTrace` in a scrollable layout. Also shows debrief summaries side-by-side if available.

- [ ] **Step 1: Create `apps/cortex/ui/src/routes/compare/+page.svelte`**

```svelte
<script lang="ts">
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { comparisonStore } from "$lib/stores/comparison-store.js";
  import RunComparisonVitals from "$lib/components/RunComparisonVitals.svelte";
  import RunComparisonTrace from "$lib/components/RunComparisonTrace.svelte";

  const state = $derived($comparisonStore);
  const runIdA = $derived($page.url.searchParams.get("a") ?? "");
  const runIdB = $derived($page.url.searchParams.get("b") ?? "");

  onMount(() => {
    if (runIdA && runIdB) {
      void comparisonStore.load(runIdA, runIdB);
    }
  });

  $effect(() => {
    if (runIdA && runIdB) {
      void comparisonStore.load(runIdA, runIdB);
    }
  });
</script>

<svelte:head>
  <title>CORTEX — Compare</title>
</svelte:head>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Breadcrumb -->
  <nav class="flex-shrink-0 px-4 py-2 border-b border-white/5 flex items-center gap-2 text-[10px] font-mono text-outline">
    <a href="/runs" class="text-secondary hover:text-primary no-underline">Trace</a>
    <span class="text-on-surface/20">/</span>
    <span class="text-on-surface/60">Compare</span>
    <span class="text-on-surface/20 ml-2">
      <span class="text-primary/60">{runIdA.slice(0, 8)}</span>
      <span class="mx-1">vs</span>
      <span class="text-secondary/60">{runIdB.slice(0, 8)}</span>
    </span>
    <div class="flex-1"></div>
    <button
      type="button"
      class="text-outline hover:text-on-surface bg-transparent border-0 cursor-pointer flex items-center gap-1"
      onclick={() => goto("/runs")}
    >
      <span class="material-symbols-outlined text-sm">arrow_back</span>
      Back
    </button>
  </nav>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto p-4 space-y-6">
    {#if !runIdA || !runIdB}
      <p class="text-error/60 font-mono text-[11px]">Missing run IDs. Navigate here from the Trace list.</p>
    {:else if state.a.loading || state.b.loading}
      <p class="text-outline/40 italic font-mono text-[11px]">Loading runs…</p>
    {:else}
      <!-- Column headers -->
      <div class="grid grid-cols-2 gap-4 font-mono text-[10px]">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-primary flex-shrink-0"></span>
          <span class="text-primary/70">A · {runIdA.slice(0, 8)}</span>
          <a href="/run/{runIdA}" class="text-outline/40 hover:text-outline text-[9px]">open →</a>
          {#if state.a.error}
            <span class="text-error/60 text-[9px]">{state.a.error}</span>
          {/if}
        </div>
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-secondary flex-shrink-0"></span>
          <span class="text-secondary/70">B · {runIdB.slice(0, 8)}</span>
          <a href="/run/{runIdB}" class="text-outline/40 hover:text-outline text-[9px]">open →</a>
          {#if state.b.error}
            <span class="text-error/60 text-[9px]">{state.b.error}</span>
          {/if}
        </div>
      </div>

      <!-- Vitals + config diff -->
      <section>
        <h2 class="font-mono text-[10px] uppercase tracking-widest text-outline/50 mb-2">Configuration &amp; Vitals</h2>
        <RunComparisonVitals a={state.a} b={state.b} diffs={state.diffs} />
      </section>

      <!-- Trace -->
      <section>
        <h2 class="font-mono text-[10px] uppercase tracking-widest text-outline/50 mb-2">
          Trace — A: {state.a.frames.length} loops, B: {state.b.frames.length} loops
        </h2>
        <RunComparisonTrace a={state.a} b={state.b} />
      </section>

      <!-- Debrief comparison (if both have debriefs) -->
      {#if state.a.debrief || state.b.debrief}
        <section>
          <h2 class="font-mono text-[10px] uppercase tracking-widest text-outline/50 mb-2">Debrief</h2>
          <div class="grid grid-cols-2 gap-4 font-mono text-[11px]">
            {#each [{ side: state.a, color: "border-primary/15" }, { side: state.b, color: "border-secondary/15" }] as { side, color }}
              <div class="border {color} rounded-lg p-3 space-y-2">
                {#if side.debrief}
                  {#if (side.debrief as any).summary}
                    <p class="text-on-surface/75 text-[10px] leading-relaxed">{(side.debrief as any).summary}</p>
                  {/if}
                  {#if Array.isArray((side.debrief as any).keyFindings)}
                    <ul class="space-y-0.5">
                      {#each ((side.debrief as any).keyFindings as string[]).slice(0, 4) as finding}
                        <li class="text-[9px] text-on-surface/60 flex gap-1">
                          <span class="text-secondary/40 flex-shrink-0">·</span> {finding}
                        </li>
                      {/each}
                    </ul>
                  {/if}
                {:else}
                  <p class="text-outline/30 italic text-[10px]">No debrief available</p>
                {/if}
              </div>
            {/each}
          </div>
        </section>
      {/if}
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Type-check**

```bash
bunx tsc --noEmit -p apps/cortex/tsconfig.json 2>&1 | head -20
```

Expected: Zero errors.

- [ ] **Step 3: Commit**

```bash
git add apps/cortex/ui/src/routes/compare/+page.svelte
git commit -m "feat(cortex): /compare?a=...&b=... side-by-side run comparison view"
```

---

### Task 5: Compare mode in the runs list

**Files:**
- Modify: `apps/cortex/ui/src/routes/runs/+page.svelte`

**Background:** The runs list (`/runs`) shows recent runs. We add a "Compare" toggle button in the header. When active, clicking runs selects them (up to 2); when 2 are selected, a "Compare →" button appears that navigates to `/compare?a=...&b=...`. When toggled off, selection is cleared.

- [ ] **Step 1: Read the current runs list page**

```bash
cat /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cortex/ui/src/routes/runs/+page.svelte
```

Read the current structure to understand how runs are listed. Note the existing click handlers and run row markup.

- [ ] **Step 2: Add compare mode state and controls**

In the `<script>` section of `/runs/+page.svelte`, add:

```typescript
import { goto } from "$app/navigation";

let compareMode = $state(false);
let compareSelected = $state<string[]>([]);

function toggleCompareMode() {
  compareMode = !compareMode;
  compareSelected = [];
}

function toggleSelectRun(runId: string) {
  if (compareSelected.includes(runId)) {
    compareSelected = compareSelected.filter((id) => id !== runId);
  } else if (compareSelected.length < 2) {
    compareSelected = [...compareSelected, runId];
  }
}

function goCompare() {
  if (compareSelected.length === 2) {
    void goto(`/compare?a=${compareSelected[0]}&b=${compareSelected[1]}`);
  }
}
```

- [ ] **Step 3: Add compare controls to the header**

In the runs list header area, add the compare toggle button:

```svelte
<button
  type="button"
  class="flex items-center gap-1.5 px-3 py-1 border rounded font-mono text-[10px] uppercase tracking-wider
         bg-transparent cursor-pointer transition-colors
         {compareMode
           ? 'border-tertiary/40 text-tertiary bg-tertiary/8'
           : 'border-white/10 text-outline hover:border-white/20 hover:text-on-surface'}"
  onclick={toggleCompareMode}
  title="Select two runs to compare side by side"
>
  <span class="material-symbols-outlined text-[13px]">compare_arrows</span>
  {compareMode ? "Cancel" : "Compare"}
</button>

{#if compareMode && compareSelected.length === 2}
  <button
    type="button"
    class="flex items-center gap-1.5 px-3 py-1 border border-tertiary/40 text-tertiary bg-tertiary/10
           rounded font-mono text-[10px] uppercase tracking-wider cursor-pointer hover:bg-tertiary/20 transition-colors"
    onclick={goCompare}
  >
    <span class="material-symbols-outlined text-[13px]">compare_arrows</span>
    Compare →
  </button>
{/if}
```

- [ ] **Step 4: Add selection state to run rows**

In the run row template, modify the `onclick` behavior and add a visual selection indicator. When `compareMode` is true, clicking a row should toggle selection instead of navigating:

```svelte
<!-- Wrap the row click with compare-mode awareness -->
<tr
  class="cursor-pointer hover:bg-white/3 transition-colors font-mono text-[11px]
         {compareMode && compareSelected.includes(run.runId) ? 'bg-tertiary/8 outline outline-1 outline-tertiary/30' : ''}"
  onclick={() => {
    if (compareMode) {
      toggleSelectRun(run.runId);
    } else {
      goto(`/run/${run.runId}`);
    }
  }}
>
  <!-- Selection checkbox (compare mode only) -->
  {#if compareMode}
    <td class="px-2 py-2">
      <span class="material-symbols-outlined text-[14px] {compareSelected.includes(run.runId) ? 'text-tertiary' : 'text-outline/30'}">
        {compareSelected.includes(run.runId) ? 'check_box' : 'check_box_outline_blank'}
      </span>
    </td>
  {/if}
  <!-- ... existing run row cells ... -->
</tr>
```

Note: The exact markup depends on the current `runs/+page.svelte` structure read in Step 1. Adapt the above pattern to match the existing row structure — insert the selection column and conditional click handler.

- [ ] **Step 5: Add compare-mode instruction text**

When compare mode is active and fewer than 2 runs are selected, show a hint:

```svelte
{#if compareMode}
  <p class="text-[10px] font-mono text-outline/50 italic px-1">
    {compareSelected.length === 0
      ? "Click two runs to compare"
      : compareSelected.length === 1
        ? "Click one more run to compare"
        : "Click Compare → to view side by side"}
  </p>
{/if}
```

- [ ] **Step 6: Verify in browser**

```bash
cd /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/apps/cortex
bun run dev
```

Navigate to `/runs`. Verify:
1. "Compare" button appears in the header
2. Clicking "Compare" toggles compare mode with instruction text
3. Clicking runs in compare mode selects them (checkboxes + highlight)
4. Third click on a different run replaces the second selection (max 2)
5. "Compare →" button appears when 2 are selected
6. Clicking it navigates to `/compare?a=...&b=...`
7. The comparison page shows vitals table, trace columns, and debrief
8. "Cancel" returns to normal list behavior

- [ ] **Step 7: Type-check**

```bash
bunx tsc --noEmit -p apps/cortex/tsconfig.json 2>&1 | head -20
```

Expected: Zero errors.

- [ ] **Step 8: Commit**

```bash
git add apps/cortex/ui/src/routes/runs/+page.svelte
git commit -m "feat(cortex): compare mode in runs list selects two runs for side-by-side diff"
```

---

## Self-Review

**Spec coverage:**
- ✅ `comparison-store.ts` fetches both runs in parallel — Task 1
- ✅ `extractTraceFrames()` groups by kernelPass — Task 1
- ✅ `diffConfigs()` highlights changed fields — Task 1
- ✅ Vitals + config diff table with color highlights — Task 2
- ✅ Aligned trace rows (empty cells when run shorter) — Task 3
- ✅ `/compare?a=...&b=...` route — Task 4
- ✅ Debrief comparison section — Task 4
- ✅ Compare mode toggle in runs list — Task 5
- ✅ Selection with checkbox UI (max 2) — Task 5
- ✅ "Compare →" navigation button — Task 5
- ✅ No new backend endpoints needed — pure client-side

**Placeholder scan:**
- Task 5 Step 1 says "read the current structure" and "adapt the above pattern" — this is intentional because the exact `runs/+page.svelte` markup is unknown at plan time and must be adapted to fit. The selection logic and component code are complete; only the insertion point requires reading the file first. This is not a placeholder — it's an explicit instruction with complete code to insert.

**Type consistency:** `RunSide`, `TraceFrame`, `RunVitals`, `ConfigDiff`, `ComparisonState` all defined in `comparison-store.ts` and used consistently through `RunComparisonVitals`, `RunComparisonTrace`, and the compare page.
