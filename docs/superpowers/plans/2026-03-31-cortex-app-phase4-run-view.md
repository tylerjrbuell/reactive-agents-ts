# Cortex App — Phase 4: Run View

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Phase 3 Stage View must be complete.

**Goal:** Build the Run view — the execution window showing the signal monitor (4 D3 tracks), trace panel, vitals strip with EKG, reactive decisions/memory/context bottom panels, the post-run debrief card, and replay mode.

**Design reference:** `docs/superpowers/specs/cortex-design-export.html` — Run Detail screen (second `<!DOCTYPE html>` block) and Conversational Run screen (third block).
> ⚠️ The mockup shows the correct visual language. The production build must exceed it: real D3 data binding from live events (not static SVG), cross-track iteration highlighting on click, smooth data streaming as events arrive, and proper debrief card rendering. The mockup EKG and signal monitor tracks are static HTML — replace with fully live D3.

**Key visual elements from mockup:**
- Breadcrumb: `Stage / research-task-42` with LIVE badge + iter counter + η entropy
- Vitals strip: η, EXPLORING badge, TOKENS, COST, DURATION + animated EKG SVG line
- 65/35 split: Signal Monitor (left) + Trace Panel (right)
- Track labels: `01 // Entropy`, `02 // Tokens / Sec`, `03 // Tool Orchestration`, `04 // Latency (ms)`
- Gradient border on both panels
- Bottom footer: Reactive Decisions / Memory / Context tabs + Pause / Stop buttons

---

## File Map

```
apps/cortex/ui/src/
  routes/
    run/[runId]/+page.svelte              # Run view (replaces placeholder)
  lib/
    stores/
      run-store.ts                        # Full event log for one run
      signal-store.ts                     # D3-ready track data derived from run events
      trace-store.ts                      # Structured per-iteration frames
    components/
      VitalsStrip.svelte                  # Entropy EKG + metrics header
      SignalMonitor.svelte                # D3 four-track visualization
      TracePanel.svelte                   # Selected iteration detail
      DecisionLog.svelte                  # ReactiveDecision events log
      MemoryPanel.svelte                  # MemorySnapshot display
      ContextGauge.svelte                 # ContextPressure indicator
      DebriefCard.svelte                  # Post-run AgentDebrief summary
      ReplayControls.svelte               # Speed selector + scrubber for past runs
```

---

## Task 1: Run Store and Signal Store

**Files:**
- Create: `apps/cortex/ui/src/lib/stores/run-store.ts`
- Create: `apps/cortex/ui/src/lib/stores/signal-store.ts`
- Create: `apps/cortex/ui/src/lib/stores/trace-store.ts`

- [ ] **Step 1: Create run-store.ts**

```typescript
// apps/cortex/ui/src/lib/stores/run-store.ts
import { writable, derived } from "svelte/store";
import { createWsClient } from "./ws-client.js";
import { CORTEX_SERVER_URL } from "$lib/constants.js";

export type RunStatus = "live" | "completed" | "failed" | "paused" | "loading";

export interface RunVitals {
  readonly entropy: number;
  readonly trajectory: string;  // "CONVERGING" | "EXPLORING" | "STRESSED" | "DIVERGING"
  readonly tokensUsed: number;
  readonly cost: number;
  readonly durationMs: number;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly provider?: string;
  readonly fallbackProvider?: string;
}

export interface CortexLiveMsg {
  readonly v: number;
  readonly ts: number;
  readonly agentId: string;
  readonly runId: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface RunState {
  readonly runId: string;
  readonly agentId: string;
  readonly status: RunStatus;
  readonly vitals: RunVitals;
  readonly events: CortexLiveMsg[];
  readonly debrief: unknown | null;
  readonly isChat: boolean;
}

const DEFAULT_VITALS: RunVitals = {
  entropy: 0,
  trajectory: "EXPLORING",
  tokensUsed: 0,
  cost: 0,
  durationMs: 0,
  iteration: 0,
  maxIterations: 10,
};

export function createRunStore(runId: string) {
  const state = writable<RunState>({
    runId,
    agentId: "",
    status: "loading",
    vitals: DEFAULT_VITALS,
    events: [],
    debrief: null,
    isChat: false,
  });

  const wsClient = createWsClient(`/ws/live/${runId}?runId=${runId}`);
  const startTs = Date.now();
  let unsubMsg: (() => void) | null = null;

  // Load past events from REST (replay)
  async function loadHistory() {
    try {
      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs/${runId}/events`);
      if (!res.ok) { state.update((s) => ({ ...s, status: "failed" })); return; }
      const events = await res.json() as Array<{ ts: number; type: string; payload: string }>;

      for (const row of events) {
        const msg: CortexLiveMsg = {
          v: 1,
          ts: row.ts,
          agentId: "",
          runId,
          type: row.type,
          payload: JSON.parse(row.payload) as Record<string, unknown>,
        };
        applyEvent(msg);
      }
      // After replay, check if run is complete
      const run = await fetch(`${CORTEX_SERVER_URL}/api/runs/${runId}`).then(r => r.json()) as { status: string; agentId: string } | null;
      if (run) {
        state.update((s) => ({
          ...s,
          agentId: run.agentId,
          status: run.status === "live" ? "live" : run.status === "failed" ? "failed" : "completed",
        }));
      }
    } catch { /* ignore */ }
  }

  function applyEvent(msg: CortexLiveMsg) {
    state.update((s) => {
      const events = [...s.events, msg];
      const vitals = updateVitals(s.vitals, msg, startTs);
      const status = deriveStatus(s.status, msg);
      const debrief = msg.type === "DebriefCompleted" ? (msg.payload as any).debrief : s.debrief;
      const isChat = s.isChat || msg.type === "ChatTurn";
      return { ...s, events, vitals, status, debrief, isChat, agentId: msg.agentId || s.agentId };
    });
  }

  function updateVitals(v: RunVitals, msg: CortexLiveMsg, startTs: number): RunVitals {
    switch (msg.type) {
      case "EntropyScored": {
        const p = msg.payload as any;
        const entropy = p.composite ?? v.entropy;
        const shape = p.trajectory?.shape ?? "";
        const trajectory =
          shape === "converging" ? "CONVERGING" :
          shape === "diverging" ? "DIVERGING" :
          entropy > 0.75 ? "STRESSED" : "EXPLORING";
        return { ...v, entropy, trajectory };
      }
      case "LLMRequestCompleted": {
        const p = msg.payload as any;
        return {
          ...v,
          tokensUsed: v.tokensUsed + (p.tokensUsed?.total ?? 0),
          cost: v.cost + (p.estimatedCost ?? 0),
          durationMs: Date.now() - startTs,
        };
      }
      case "ReasoningStepCompleted":
        return { ...v, iteration: (msg.payload as any).iteration ?? v.iteration };
      case "ProviderFallbackActivated":
        return { ...v, fallbackProvider: (msg.payload as any).toProvider };
      default:
        return v;
    }
  }

  function deriveStatus(current: RunStatus, msg: CortexLiveMsg): RunStatus {
    if (msg.type === "AgentCompleted") return (msg.payload as any).success ? "completed" : "failed";
    if (msg.type === "TaskFailed") return "failed";
    if (current === "loading" && msg.type) return "live";
    return current;
  }

  // Subscribe to live messages
  unsubMsg = wsClient.onMessage((raw) => {
    const msg = raw as CortexLiveMsg;
    if (msg?.runId === runId || msg?.type) applyEvent(msg);
  });

  // Control actions
  async function pause() {
    await fetch(`${CORTEX_SERVER_URL}/api/runs/${runId}/pause`, { method: "POST" });
    state.update((s) => ({ ...s, status: "paused" }));
  }

  async function stop() {
    await fetch(`${CORTEX_SERVER_URL}/api/runs/${runId}/stop`, { method: "POST" });
  }

  loadHistory();

  return {
    subscribe: state.subscribe,
    pause,
    stop,
    destroy: () => {
      unsubMsg?.();
      wsClient.close();
    },
  };
}
```

- [ ] **Step 2: Create signal-store.ts**

```typescript
// apps/cortex/ui/src/lib/stores/signal-store.ts
import { derived } from "svelte/store";
import type { Readable } from "svelte/store";
import type { CortexLiveMsg, RunState } from "./run-store.js";

export interface TrackPoint { ts: number; value: number; color: string; }
export interface BarPoint { iteration: number; tokens: number; }
export interface ToolSpan { tStart: number; tEnd?: number; name: string; status: "active" | "success" | "error"; latencyMs?: number; }

export interface SignalData {
  readonly entropy: TrackPoint[];
  readonly tokens: BarPoint[];
  readonly tools: ToolSpan[];
  readonly latency: TrackPoint[];
  readonly selectedIteration: number | null;
}

function entropyColor(value: number): string {
  if (value < 0.5) return "#d0bcff";   // violet
  if (value < 0.75) return "#f7be1d";  // amber
  return "#ffb4ab";                     // error/red
}

export function createSignalStore(runState: Readable<RunState>) {
  let selectedIteration = null as number | null;

  const signalData = derived(runState, ($state): SignalData => {
    const entropy: TrackPoint[] = [];
    const tokens: BarPoint[] = [];
    const tools: ToolSpan[] = [];
    const latency: TrackPoint[] = [];
    const activeTools = new Map<string, { tStart: number; name: string }>();
    let llmStart: number | null = null;
    let currentIteration = 0;

    for (const msg of $state.events) {
      switch (msg.type) {
        case "EntropyScored": {
          const v = (msg.payload as any).composite ?? 0;
          entropy.push({ ts: msg.ts, value: v, color: entropyColor(v) });
          break;
        }
        case "LLMRequestStarted":
          llmStart = msg.ts;
          break;
        case "LLMRequestCompleted": {
          if (llmStart !== null) {
            latency.push({ ts: msg.ts, value: msg.ts - llmStart, color: "#4cd7f6" });
            llmStart = null;
          }
          const t = (msg.payload as any).tokensUsed?.total ?? 0;
          if (t > 0) {
            tokens.push({ iteration: currentIteration, tokens: t });
          }
          break;
        }
        case "ReasoningStepCompleted":
          currentIteration = (msg.payload as any).iteration ?? currentIteration;
          break;
        case "ToolCallStarted": {
          const name = (msg.payload as any).toolName ?? "unknown";
          activeTools.set(name, { tStart: msg.ts, name });
          tools.push({ tStart: msg.ts, name, status: "active" });
          break;
        }
        case "ToolCallCompleted": {
          const name = (msg.payload as any).toolName ?? "unknown";
          const active = activeTools.get(name);
          if (active) {
            activeTools.delete(name);
            const idx = tools.findLastIndex((t) => t.name === name && t.status === "active");
            if (idx >= 0) {
              const success = !(msg.payload as any).error;
              tools[idx] = {
                ...tools[idx],
                tEnd: msg.ts,
                status: success ? "success" : "error",
                latencyMs: msg.ts - active.tStart,
              };
            }
          }
          break;
        }
      }
    }

    return { entropy, tokens, tools, latency, selectedIteration };
  });

  return {
    subscribe: signalData.subscribe,
    selectIteration: (n: number | null) => { selectedIteration = n; },
  };
}
```

- [ ] **Step 3: Create trace-store.ts**

```typescript
// apps/cortex/ui/src/lib/stores/trace-store.ts
import { derived } from "svelte/store";
import type { Readable } from "svelte/store";
import type { RunState } from "./run-store.js";

export interface IterationFrame {
  readonly iteration: number;
  readonly thought: string;
  readonly toolName?: string;
  readonly toolArgs?: unknown;
  readonly observation?: string;
  readonly entropy?: number;
  readonly tokensUsed: number;
  readonly durationMs: number;
  readonly ts: number;
}

export function createTraceStore(runState: Readable<RunState>) {
  return derived(runState, ($state): IterationFrame[] => {
    const frames: IterationFrame[] = [];
    let currentFrame: Partial<IterationFrame> & { iteration: number } = { iteration: 0, tokensUsed: 0, durationMs: 0, ts: 0 };
    let llmStart: number | null = null;

    for (const msg of $state.events) {
      switch (msg.type) {
        case "ReasoningStepCompleted": {
          const p = msg.payload as any;
          currentFrame = {
            ...currentFrame,
            iteration: p.iteration ?? currentFrame.iteration,
            thought: p.thought ?? currentFrame.thought ?? "",
            ts: msg.ts,
          };
          // Push completed frame
          if (currentFrame.thought) {
            frames.push({
              iteration: currentFrame.iteration,
              thought: currentFrame.thought ?? "",
              toolName: currentFrame.toolName,
              toolArgs: currentFrame.toolArgs,
              observation: currentFrame.observation,
              entropy: currentFrame.entropy,
              tokensUsed: currentFrame.tokensUsed ?? 0,
              durationMs: currentFrame.durationMs ?? 0,
              ts: currentFrame.ts,
            });
            currentFrame = { iteration: currentFrame.iteration + 1, tokensUsed: 0, durationMs: 0, ts: 0 };
          }
          break;
        }
        case "ToolCallStarted":
          currentFrame.toolName = (msg.payload as any).toolName;
          currentFrame.toolArgs = (msg.payload as any).input;
          llmStart = msg.ts;
          break;
        case "ToolCallCompleted":
          currentFrame.observation = JSON.stringify((msg.payload as any).output ?? "").slice(0, 500);
          if (llmStart) { currentFrame.durationMs = msg.ts - llmStart; llmStart = null; }
          break;
        case "EntropyScored":
          currentFrame.entropy = (msg.payload as any).composite;
          break;
        case "LLMRequestCompleted":
          currentFrame.tokensUsed = (currentFrame.tokensUsed ?? 0) + ((msg.payload as any).tokensUsed?.total ?? 0);
          break;
      }
    }

    return frames;
  });
}
```

- [ ] **Step 4: Update stores/index.ts**

```typescript
export { createRunStore } from "./run-store.js";
export { createSignalStore } from "./signal-store.js";
export { createTraceStore } from "./trace-store.js";
export type { RunState, RunVitals, RunStatus, CortexLiveMsg } from "./run-store.js";
export type { SignalData, TrackPoint, BarPoint, ToolSpan } from "./signal-store.js";
export type { IterationFrame } from "./trace-store.js";
```

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/stores/run-store.ts apps/cortex/ui/src/lib/stores/signal-store.ts apps/cortex/ui/src/lib/stores/trace-store.ts
git commit -m "feat(cortex-ui): run/signal/trace stores — live event processing and D3-ready data"
```

---

## Task 2: VitalsStrip Component

**Files:**
- Create: `apps/cortex/ui/src/lib/components/VitalsStrip.svelte`

- [ ] **Step 1: Create VitalsStrip.svelte**

From the mockup: metrics row + animated EKG SVG line at bottom. The EKG is an SVG path with stroke-dasharray animation.

```svelte
<!-- apps/cortex/ui/src/lib/components/VitalsStrip.svelte -->
<script lang="ts">
  import type { RunVitals, RunStatus } from "$lib/stores/run-store.js";

  export let vitals: RunVitals;
  export let status: RunStatus;
  export let runId: string;

  $: statusLabel =
    status === "live" ? "LIVE" :
    status === "paused" ? "PAUSED" :
    status === "completed" ? "DONE" :
    status === "failed" ? "FAILED" : "...";

  $: statusClass =
    status === "live" ? "text-green-400 border-green-500/20 bg-green-500/10" :
    status === "failed" ? "text-error border-error/20 bg-error/10" :
    "text-secondary border-secondary/20 bg-secondary/10";

  $: trajectoryClass =
    vitals.trajectory === "CONVERGING" ? "text-primary border-primary/30 bg-primary/10" :
    vitals.trajectory === "STRESSED" ? "text-error border-error/30 bg-error/10" :
    "text-tertiary border-tertiary/30 bg-tertiary/10";

  // Format cost
  $: costStr = vitals.cost < 0.001
    ? `<$0.001`
    : `$${vitals.cost.toFixed(4)}`;

  // Format duration
  $: durationStr = vitals.durationMs < 1000
    ? `${vitals.durationMs}ms`
    : `${(vitals.durationMs / 1000).toFixed(1)}s`;
</script>

<div class="w-full bg-[#111317] border-b border-white/5 relative overflow-hidden flex-shrink-0">
  <!-- Metrics row -->
  <div class="max-w-full px-6 py-3 flex items-center gap-0 font-mono text-[11px] uppercase tracking-widest text-on-surface-variant overflow-x-auto">
    <!-- Status badge -->
    <div class="flex items-center gap-2 pr-5">
      <div class="flex items-center gap-2 px-2 py-0.5 rounded-full border {statusClass}">
        {#if status === "live"}
          <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
        {/if}
        <span class="text-[10px]">{statusLabel}</span>
      </div>
    </div>

    <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>

    <!-- Entropy -->
    <div class="flex items-center gap-2 pr-5">
      <span class="text-primary">η</span>
      <span class="text-on-surface tabular-nums">{vitals.entropy.toFixed(2)}</span>
    </div>
    <div class="px-2 py-0.5 rounded text-[10px] border mr-5 {trajectoryClass}">
      {vitals.trajectory}
    </div>

    <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>

    <!-- Tokens -->
    <div class="flex items-center gap-2 mr-5">
      <span class="text-primary tabular-nums">{vitals.tokensUsed.toLocaleString()}</span>
      <span class="text-on-surface-variant">TOKENS</span>
    </div>

    <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>

    <!-- Cost -->
    <div class="flex items-center gap-2 mr-5">
      <span class="text-primary">{costStr}</span>
      <span class="text-on-surface-variant">COST</span>
    </div>

    <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>

    <!-- Duration -->
    <div class="flex items-center gap-2 mr-5">
      <span class="text-primary tabular-nums">{durationStr}</span>
      <span class="text-on-surface-variant">DURATION</span>
    </div>

    {#if vitals.iteration > 0}
      <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>
      <div class="flex items-center gap-2">
        <span class="text-tertiary">ITER</span>
        <span class="text-on-surface tabular-nums">{vitals.iteration}/{vitals.maxIterations || "?"}</span>
      </div>
    {/if}

    <!-- Provider fallback badge -->
    {#if vitals.fallbackProvider}
      <div class="ml-4 flex items-center gap-1 px-2 py-0.5 bg-tertiary/10 border border-tertiary/30 rounded text-[10px] text-tertiary">
        <span class="material-symbols-outlined text-xs">electric_bolt</span>
        → {vitals.fallbackProvider}
      </div>
    {/if}
  </div>

  <!-- EKG heartbeat line (from mockup — animated SVG) -->
  <div class="absolute bottom-0 left-0 w-full h-[2px]">
    <svg
      class="w-full h-8 absolute bottom-0 overflow-visible"
      preserveAspectRatio="none"
      viewBox="0 0 1000 32"
    >
      <path
        class="ekg-line"
        d="M0 16 L100 16 L110 5 L120 27 L130 16 L300 16 L310 16 L320 2 L330 30 L340 16 L600 16 L610 8 L620 24 L630 16 L850 16 L860 0 L870 32 L880 16 L1000 16"
        fill="none"
        stroke={vitals.trajectory === "STRESSED" ? "#ffb4ab" : vitals.trajectory === "EXPLORING" ? "#f7be1d" : "#d0bcff"}
        stroke-width="1"
      />
    </svg>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add apps/cortex/ui/src/lib/components/VitalsStrip.svelte
git commit -m "feat(cortex-ui): VitalsStrip — entropy EKG + live metrics header"
```

---

## Task 3: Signal Monitor (D3)

**Files:**
- Create: `apps/cortex/ui/src/lib/components/SignalMonitor.svelte`

- [ ] **Step 1: Create SignalMonitor.svelte**

D3 renders all four tracks. Uses `svelte:window` binding for resize. Track labels match the mockup (`01 // Entropy`, etc.).

```svelte
<!-- apps/cortex/ui/src/lib/components/SignalMonitor.svelte -->
<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import * as d3 from "d3";
  import type { SignalData } from "$lib/stores/signal-store.js";

  export let data: SignalData;

  const dispatch = createEventDispatcher<{ selectIteration: number }>();

  let container: HTMLDivElement;
  let svg: SVGSVGElement;
  let width = 600;
  let height = 400;

  // Track heights (proportion of total height)
  const TRACK_PROPORTIONS = [0.30, 0.22, 0.20, 0.28]; // entropy, tokens, tools, latency
  const TRACK_LABELS = ["01 // Entropy", "02 // Tokens / Sec", "03 // Tool Orchestration", "04 // Latency (ms)"];
  const TRACK_GAP = 8;

  function render() {
    if (!svg || !data) return;

    const svgEl = d3.select(svg);
    svgEl.selectAll("*").remove();

    const W = width;
    const H = height;
    const LABEL_W = 120;
    const TRACK_W = W - LABEL_W - 16;

    // Time scale — use event timestamps or index
    const allTs = [
      ...data.entropy.map(d => d.ts),
      ...data.tokens.map((_, i) => i * 1000),
      ...data.tools.flatMap(t => [t.tStart, t.tEnd ?? t.tStart]),
      ...data.latency.map(d => d.ts),
    ];
    const tMin = allTs.length > 0 ? Math.min(...allTs) : 0;
    const tMax = allTs.length > 0 ? Math.max(...allTs, tMin + 1) : 1;
    const xScale = d3.scaleLinear().domain([tMin, tMax]).range([0, TRACK_W]);

    let yOffset = 0;

    TRACK_PROPORTIONS.forEach((prop, trackIdx) => {
      const trackH = Math.floor(H * prop) - TRACK_GAP;
      const g = svgEl.append("g")
        .attr("transform", `translate(0, ${yOffset})`);

      // Label
      g.append("text")
        .attr("x", 0)
        .attr("y", trackH / 2 + 4)
        .attr("fill", "#d0bcff")
        .attr("font-family", "JetBrains Mono, monospace")
        .attr("font-size", "9px")
        .attr("text-transform", "uppercase")
        .attr("letter-spacing", "0.05em")
        .text(TRACK_LABELS[trackIdx] ?? "");

      // Track background
      const trackG = g.append("g").attr("transform", `translate(${LABEL_W}, 0)`);

      trackG.append("rect")
        .attr("width", TRACK_W)
        .attr("height", trackH)
        .attr("rx", 2)
        .attr("fill", "#0c0e12")
        .attr("stroke", "rgba(255,255,255,0.05)")
        .attr("stroke-width", 1);

      // ─── Track 1: Entropy line ───────────────────────────────────
      if (trackIdx === 0 && data.entropy.length > 1) {
        const yScale = d3.scaleLinear().domain([0, 1]).range([trackH - 4, 4]);

        // Gradient area fill
        const defs = svgEl.append("defs");
        const grad = defs.append("linearGradient").attr("id", `entropy-grad-${trackIdx}`).attr("x1", "0%").attr("x2", "100%");
        grad.append("stop").attr("offset", "0%").attr("stop-color", "#8b5cf6");
        grad.append("stop").attr("offset", "60%").attr("stop-color", "#f7be1d");
        grad.append("stop").attr("offset", "100%").attr("stop-color", "#f7be1d");

        const area = d3.area<typeof data.entropy[0]>()
          .x(d => xScale(d.ts))
          .y0(trackH)
          .y1(d => yScale(d.value))
          .curve(d3.curveCatmullRom);

        const line = d3.line<typeof data.entropy[0]>()
          .x(d => xScale(d.ts))
          .y(d => yScale(d.value))
          .curve(d3.curveCatmullRom);

        trackG.append("path")
          .datum(data.entropy)
          .attr("d", area)
          .attr("fill", `url(#entropy-grad-${trackIdx})`)
          .attr("fill-opacity", 0.15);

        trackG.append("path")
          .datum(data.entropy)
          .attr("d", line)
          .attr("fill", "none")
          .attr("stroke", `url(#entropy-grad-${trackIdx})`)
          .attr("stroke-width", 2);
      }

      // ─── Track 2: Tokens bars ────────────────────────────────────
      if (trackIdx === 1 && data.tokens.length > 0) {
        const maxTok = Math.max(...data.tokens.map(d => d.tokens), 1);
        const yScale = d3.scaleLinear().domain([0, maxTok]).range([trackH - 4, 4]);
        const barW = Math.max(2, Math.min(20, TRACK_W / (data.tokens.length + 1) - 2));

        trackG.selectAll("rect.bar")
          .data(data.tokens)
          .join("rect")
          .attr("class", "bar")
          .attr("x", (_, i) => (i / data.tokens.length) * TRACK_W + barW * 0.5)
          .attr("y", d => yScale(d.tokens))
          .attr("width", barW)
          .attr("height", d => trackH - yScale(d.tokens))
          .attr("fill", "#d0bcff")
          .attr("fill-opacity", 0.8)
          .attr("rx", 1);
      }

      // ─── Track 3: Tool spans ─────────────────────────────────────
      if (trackIdx === 2 && data.tools.length > 0) {
        const spanH = 8;
        const spanY = (trackH - spanH) / 2;

        trackG.selectAll("g.tool")
          .data(data.tools)
          .join("g")
          .attr("class", "tool")
          .each(function(d) {
            const g = d3.select(this);
            const x1 = xScale(d.tStart);
            const x2 = d.tEnd ? xScale(d.tEnd) : TRACK_W;
            const w = Math.max(8, x2 - x1);
            const color = d.status === "active" ? "#f7be1d" : d.status === "error" ? "#ffb4ab" : "#4cd7f6";

            g.append("rect")
              .attr("x", x1).attr("y", spanY).attr("width", w).attr("height", spanH)
              .attr("rx", 4)
              .attr("fill", color)
              .attr("fill-opacity", d.status === "active" ? 0.8 : 0.9);

            if (w > 30) {
              g.append("text")
                .attr("x", x1 + 4).attr("y", spanY + spanH - 2)
                .attr("fill", d.status === "active" ? "#3f2e00" : "#001f26")
                .attr("font-size", "7px")
                .attr("font-family", "JetBrains Mono")
                .text(d.name.slice(0, 12));
            }
          });
      }

      // ─── Track 4: Latency area ───────────────────────────────────
      if (trackIdx === 3 && data.latency.length > 1) {
        const maxMs = Math.max(...data.latency.map(d => d.value), 1);
        const yScale = d3.scaleLinear().domain([0, maxMs]).range([trackH - 4, 4]);

        const area = d3.area<typeof data.latency[0]>()
          .x(d => xScale(d.ts)).y0(trackH).y1(d => yScale(d.value))
          .curve(d3.curveMonotoneX);

        const line = d3.line<typeof data.latency[0]>()
          .x(d => xScale(d.ts)).y(d => yScale(d.value))
          .curve(d3.curveMonotoneX);

        trackG.append("path").datum(data.latency).attr("d", area).attr("fill", "#4cd7f6").attr("fill-opacity", 0.15);
        trackG.append("path").datum(data.latency).attr("d", line).attr("fill", "none").attr("stroke", "#4cd7f6").attr("stroke-width", 1.5);
      }

      yOffset += trackH + TRACK_GAP;
    });
  }

  // Re-render when data changes
  $: if (data && svg) render();

  onMount(() => {
    const ro = new ResizeObserver(() => {
      if (container) {
        width = container.clientWidth;
        height = container.clientHeight;
        render();
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  });
</script>

<div class="gradient-border-glow rounded-lg h-full flex flex-col">
  <div class="flex justify-between items-center px-6 py-4 flex-shrink-0">
    <h2 class="font-headline text-sm font-bold tracking-tight text-on-surface/90 uppercase">
      Signal Monitor
    </h2>
    <div class="flex gap-4 text-[10px] font-mono text-on-surface/30">
      <span>{data.entropy.length} samples</span>
    </div>
  </div>

  <div bind:this={container} class="flex-1 relative px-4 pb-4 min-h-0">
    <svg bind:this={svg} {width} {height} class="w-full h-full overflow-visible"></svg>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add apps/cortex/ui/src/lib/components/SignalMonitor.svelte
git commit -m "feat(cortex-ui): SignalMonitor D3 component — 4 live tracks with entropy gradient, token bars, tool spans, latency area"
```

---

## Task 4: Trace Panel

**Files:**
- Create: `apps/cortex/ui/src/lib/components/TracePanel.svelte`

- [ ] **Step 1: Create TracePanel.svelte**

From the mockup: iteration badge, THOUGHT/ACTION/OBSERVATION sections with left accent bars, raw exchange disclosure.

```svelte
<!-- apps/cortex/ui/src/lib/components/TracePanel.svelte -->
<script lang="ts">
  import type { IterationFrame } from "$lib/stores/trace-store.js";

  export let frame: IterationFrame | null;

  let expandedObservation = false;
  let expandedRaw = false;

  $: if (frame) { expandedObservation = false; expandedRaw = false; }
</script>

<div class="gradient-border-glow rounded-lg h-full flex flex-col overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
    <div class="flex items-center gap-3">
      {#if frame}
        <span class="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
          ITER {String(frame.iteration).padStart(2, "0")}
        </span>
      {/if}
      <h3 class="font-headline text-sm font-bold uppercase tracking-wide">Trace Panel</h3>
    </div>
    <span class="material-symbols-outlined text-sm text-on-surface/30">open_in_new</span>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-y-auto px-6 py-4 space-y-6">
    {#if !frame}
      <p class="font-mono text-xs text-outline text-center mt-8">
        Click any point on the signal monitor to inspect an iteration.
      </p>
    {:else}
      <!-- THOUGHT -->
      {#if frame.thought}
        <div class="relative pl-4">
          <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-primary/40 rounded-full"></div>
          <label class="text-[9px] font-mono text-primary uppercase mb-2 block tracking-widest">Thought</label>
          <p class="text-xs font-mono text-on-surface/60 leading-relaxed">{frame.thought}</p>
        </div>
      {/if}

      <!-- ACTION -->
      {#if frame.toolName}
        <div class="relative pl-4">
          <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-tertiary/40 rounded-full"></div>
          <label class="text-[9px] font-mono text-tertiary uppercase mb-2 block tracking-widest">Action</label>
          <div class="flex items-center gap-2 mb-3">
            <span class="px-2 py-0.5 bg-tertiary/10 border border-tertiary/30 text-tertiary text-[10px] font-mono rounded">
              {frame.toolName}
            </span>
            {#if frame.latencyMs}
              <span class="text-[10px] font-mono text-outline">{frame.latencyMs}ms</span>
            {/if}
          </div>
          {#if frame.toolArgs}
            <div class="bg-surface-container-lowest p-3 rounded border border-white/5">
              <code class="text-[11px] font-mono text-on-surface/80 break-all">
                {JSON.stringify(frame.toolArgs, null, 2).slice(0, 300)}
              </code>
            </div>
          {/if}
        </div>
      {/if}

      <!-- OBSERVATION -->
      {#if frame.observation}
        <div class="relative pl-4">
          <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-secondary/40 rounded-full"></div>
          <label class="text-[9px] font-mono text-secondary uppercase mb-2 block tracking-widest">Observation</label>
          <div class="bg-secondary/5 p-3 rounded border border-secondary/10 relative">
            <code
              class="text-[11px] font-mono text-on-surface/50 block break-all transition-all duration-300"
              class:line-clamp-4={!expandedObservation}
            >
              {frame.observation}
            </code>
            {#if !expandedObservation}
              <div class="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[#12131a] to-transparent flex items-end justify-center pb-1">
                <button
                  class="text-[10px] font-mono text-secondary hover:underline"
                  on:click={() => expandedObservation = true}
                >[Expand ▾]</button>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- METRICS -->
      <div class="flex gap-3 flex-wrap pl-4">
        {#if frame.entropy !== undefined}
          <span class="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
            η {frame.entropy.toFixed(3)}
          </span>
        {/if}
        {#if frame.tokensUsed > 0}
          <span class="text-[10px] font-mono text-on-surface/40 bg-surface-container px-2 py-0.5 rounded">
            {frame.tokensUsed.toLocaleString()} tok
          </span>
        {/if}
        {#if frame.durationMs > 0}
          <span class="text-[10px] font-mono text-on-surface/40 bg-surface-container px-2 py-0.5 rounded">
            {frame.durationMs}ms
          </span>
        {/if}
      </div>

      <!-- RAW EXCHANGE -->
      <button
        class="w-full flex items-center justify-between p-3 bg-white/5 rounded border border-white/5 hover-lift transition-all"
        on:click={() => expandedRaw = !expandedRaw}
      >
        <span class="text-[10px] font-mono text-on-surface/40 uppercase">
          {expandedRaw ? "▼" : "▶"} Raw LLM exchange
        </span>
        <span class="text-[10px] font-mono text-on-surface/20">
          {expandedRaw ? "collapse" : "expand"}
        </span>
      </button>
      {#if expandedRaw}
        <div class="bg-surface-container-lowest p-3 rounded border border-white/5 animate-fade-up">
          <code class="text-[10px] font-mono text-on-surface/40 break-all">
            {JSON.stringify(frame, null, 2)}
          </code>
        </div>
      {/if}
    {/if}
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add apps/cortex/ui/src/lib/components/TracePanel.svelte
git commit -m "feat(cortex-ui): TracePanel — thought/action/observation with expand controls"
```

---

## Task 5: Bottom Info Panels

**Files:**
- Create: `apps/cortex/ui/src/lib/components/DecisionLog.svelte`
- Create: `apps/cortex/ui/src/lib/components/MemoryPanel.svelte`
- Create: `apps/cortex/ui/src/lib/components/ContextGauge.svelte`
- Create: `apps/cortex/ui/src/lib/components/DebriefCard.svelte`

- [ ] **Step 1: Create DecisionLog.svelte**

```svelte
<!-- apps/cortex/ui/src/lib/components/DecisionLog.svelte -->
<script lang="ts">
  export let events: Array<{ type: string; payload: Record<string, unknown>; ts: number }>;

  $: decisions = events
    .filter(e => e.type === "ReactiveDecision")
    .map(e => ({
      iteration: (e.payload as any).iteration ?? 0,
      decision: (e.payload as any).decision as string,
      reason: (e.payload as any).reason as string,
      entropyBefore: (e.payload as any).entropyBefore as number,
      entropyAfter: (e.payload as any).entropyAfter as number | undefined,
      triggered: (e.payload as any).triggered !== false,
    }));

  const decisionIcon: Record<string, string> = {
    "early-stop": "stop_circle",
    "compress": "compress",
    "switch-strategy": "swap_horiz",
    "branch": "call_split",
    "attribute": "label",
  };
</script>

<div class="h-full overflow-y-auto px-4 py-3 space-y-2">
  {#if decisions.length === 0}
    <p class="font-mono text-[10px] text-outline text-center mt-4">No controller decisions yet.</p>
  {:else}
    {#each decisions as d}
      <div class="flex items-start gap-3 p-2 rounded bg-surface-container-low border border-outline-variant/10 hover:border-primary/20 transition-colors">
        <span class="material-symbols-outlined text-sm text-primary flex-shrink-0 mt-0.5">
          {decisionIcon[d.decision] ?? "electric_bolt"}
        </span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[10px] font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">
              iter {String(d.iteration).padStart(2, "0")}
            </span>
            <span class="text-[10px] font-mono text-on-surface uppercase">{d.decision}</span>
            {#if !d.triggered}
              <span class="text-[9px] font-mono text-outline">(not triggered)</span>
            {/if}
          </div>
          <p class="text-[10px] font-mono text-on-surface/60 leading-relaxed truncate">{d.reason}</p>
          <div class="flex gap-2 mt-1">
            <span class="text-[9px] font-mono text-outline">
              η {d.entropyBefore.toFixed(3)}
              {#if d.entropyAfter !== undefined} → {d.entropyAfter.toFixed(3)}{/if}
            </span>
          </div>
        </div>
      </div>
    {/each}
  {/if}
</div>
```

- [ ] **Step 2: Create MemoryPanel.svelte**

```svelte
<!-- apps/cortex/ui/src/lib/components/MemoryPanel.svelte -->
<script lang="ts">
  export let events: Array<{ type: string; payload: Record<string, unknown>; ts: number }>;

  $: snapshot = events
    .filter(e => e.type === "MemorySnapshot")
    .at(-1)?.payload as any ?? null;
</script>

<div class="h-full overflow-y-auto px-4 py-3">
  {#if !snapshot}
    <p class="font-mono text-[10px] text-outline text-center mt-4">No memory snapshot yet.</p>
  {:else}
    <div class="space-y-3">
      <div class="flex gap-4 font-mono text-[10px]">
        <span class="text-primary">{snapshot.episodicCount ?? 0}</span><span class="text-outline">EPISODIC</span>
        <span class="text-primary">{snapshot.semanticCount ?? 0}</span><span class="text-outline">SEMANTIC</span>
        <span class="text-secondary">{(snapshot.skillsActive ?? []).length}</span><span class="text-outline">SKILLS</span>
      </div>
      {#if snapshot.skillsActive?.length > 0}
        <div class="flex flex-wrap gap-1">
          {#each snapshot.skillsActive as skill}
            <span class="px-2 py-0.5 bg-secondary/10 border border-secondary/20 text-[9px] font-mono text-secondary rounded">{skill}</span>
          {/each}
        </div>
      {/if}
      {#if snapshot.working?.length > 0}
        <div class="space-y-1">
          {#each snapshot.working as item}
            <div class="flex gap-2 text-[10px] font-mono">
              <span class="text-primary/60 flex-shrink-0">{item.key}</span>
              <span class="text-on-surface/40 truncate">{item.preview}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
```

- [ ] **Step 3: Create ContextGauge.svelte**

```svelte
<!-- apps/cortex/ui/src/lib/components/ContextGauge.svelte -->
<script lang="ts">
  export let events: Array<{ type: string; payload: Record<string, unknown>; ts: number }>;

  $: pressure = events
    .filter(e => e.type === "ContextPressure")
    .at(-1)?.payload as any ?? null;

  $: pct = pressure?.utilizationPct ?? 0;
  $: level = pressure?.level ?? "low";
  $: barColor = level === "critical" ? "#ffb4ab" : level === "high" ? "#f7be1d" : level === "medium" ? "#d0bcff" : "#4cd7f6";
</script>

<div class="h-full px-4 py-3 flex flex-col justify-center gap-3">
  {#if !pressure}
    <p class="font-mono text-[10px] text-outline text-center">No context pressure data yet.</p>
  {:else}
    <div class="flex items-center justify-between font-mono text-[10px]">
      <span class="text-outline uppercase">Context Window</span>
      <span style="color: {barColor}">{pct.toFixed(0)}%</span>
    </div>
    <div class="w-full h-2 bg-surface-container-lowest rounded-full overflow-hidden">
      <div
        class="h-full rounded-full transition-all duration-500"
        style="width: {pct}%; background: {barColor};"
      ></div>
    </div>
    <div class="flex justify-between font-mono text-[10px] text-outline">
      <span>{pressure.tokensUsed?.toLocaleString() ?? 0} used</span>
      <span>{pressure.tokensAvailable?.toLocaleString() ?? "?"} available</span>
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Create DebriefCard.svelte**

```svelte
<!-- apps/cortex/ui/src/lib/components/DebriefCard.svelte -->
<script lang="ts">
  export let debrief: any;

  let copied = false;

  async function copyMarkdown() {
    if (!debrief?.markdown) return;
    await navigator.clipboard.writeText(debrief.markdown);
    copied = true;
    setTimeout(() => copied = false, 2000);
  }
</script>

{#if debrief}
  <div class="gradient-border rounded-lg p-6 animate-fade-up">
    <!-- Header -->
    <div class="flex items-center justify-between mb-5">
      <div class="flex items-center gap-3">
        <span class="material-symbols-outlined text-primary">summarize</span>
        <h3 class="font-headline text-sm font-bold uppercase tracking-wide">Run Debrief</h3>
      </div>
      <div class="flex items-center gap-3">
        <span
          class="px-2 py-0.5 rounded text-[10px] font-mono border
                 {debrief.outcome === 'success'
                   ? 'text-secondary border-secondary/30 bg-secondary/10'
                   : 'text-error border-error/30 bg-error/10'}"
        >
          {debrief.outcome === "success" ? "✓ SUCCESS" : "✗ FAILED"}
        </span>
        <button
          on:click={copyMarkdown}
          class="text-[10px] font-mono text-primary/60 hover:text-primary transition-colors flex items-center gap-1"
        >
          <span class="material-symbols-outlined text-sm">{copied ? "check" : "content_copy"}</span>
          {copied ? "Copied!" : "Copy Markdown"}
        </button>
      </div>
    </div>

    <!-- Summary -->
    {#if debrief.summary}
      <p class="font-mono text-xs text-on-surface/70 leading-relaxed mb-5 pl-4 border-l-2 border-primary/30">
        {debrief.summary}
      </p>
    {/if}

    <!-- Two-column: findings + lessons -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
      {#if debrief.keyFindings?.length > 0}
        <div>
          <label class="text-[9px] font-mono text-primary uppercase tracking-widest block mb-2">Key Findings</label>
          <ul class="space-y-1">
            {#each debrief.keyFindings.slice(0, 4) as finding}
              <li class="text-[11px] font-mono text-on-surface/60 flex gap-2">
                <span class="text-primary/50 flex-shrink-0">•</span>
                {finding}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
      {#if debrief.lessons?.length > 0}
        <div>
          <label class="text-[9px] font-mono text-secondary uppercase tracking-widest block mb-2">Lessons Learned</label>
          <ul class="space-y-1">
            {#each debrief.lessons.slice(0, 4) as lesson}
              <li class="text-[11px] font-mono text-on-surface/60 flex gap-2">
                <span class="text-secondary/50 flex-shrink-0">•</span>
                {lesson}
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    <!-- Metrics footer -->
    {#if debrief.metrics}
      <div class="flex flex-wrap gap-4 font-mono text-[10px] pt-4 border-t border-white/5">
        <span class="text-outline">METRICS:</span>
        <span>{debrief.metrics.iterations ?? 0} iter</span>
        <span>·</span>
        <span>{(debrief.metrics.tokens ?? 0).toLocaleString()} tok</span>
        <span>·</span>
        <span>${(debrief.metrics.cost ?? 0).toFixed(4)}</span>
        <span>·</span>
        <span>{((debrief.metrics.duration ?? 0) / 1000).toFixed(1)}s</span>
        {#if debrief.toolsUsed?.length > 0}
          <span>·</span>
          <span>{debrief.toolsUsed.reduce((s: number, t: any) => s + (t.calls ?? 0), 0)} tool calls</span>
        {/if}
      </div>
    {/if}
  </div>
{/if}
```

- [ ] **Step 5: Commit**

```bash
git add apps/cortex/ui/src/lib/components/DecisionLog.svelte apps/cortex/ui/src/lib/components/MemoryPanel.svelte apps/cortex/ui/src/lib/components/ContextGauge.svelte apps/cortex/ui/src/lib/components/DebriefCard.svelte
git commit -m "feat(cortex-ui): DecisionLog, MemoryPanel, ContextGauge, DebriefCard components"
```

---

## Task 6: Run View Page

**Files:**
- Modify: `apps/cortex/ui/src/routes/run/[runId]/+page.svelte` (replace placeholder)

- [ ] **Step 1: Replace placeholder with full Run view**

```svelte
<!-- apps/cortex/ui/src/routes/run/[runId]/+page.svelte -->
<script lang="ts">
  import { page } from "$app/stores";
  import { onMount, onDestroy } from "svelte";
  import VitalsStrip from "$lib/components/VitalsStrip.svelte";
  import SignalMonitor from "$lib/components/SignalMonitor.svelte";
  import TracePanel from "$lib/components/TracePanel.svelte";
  import DecisionLog from "$lib/components/DecisionLog.svelte";
  import MemoryPanel from "$lib/components/MemoryPanel.svelte";
  import ContextGauge from "$lib/components/ContextGauge.svelte";
  import DebriefCard from "$lib/components/DebriefCard.svelte";
  import { createRunStore } from "$lib/stores/run-store.js";
  import { createSignalStore } from "$lib/stores/signal-store.js";
  import { createTraceStore } from "$lib/stores/trace-store.js";

  const runId = $page.params.runId;

  const runStore = createRunStore(runId);
  const signalStore = createSignalStore(runStore);
  const traceStore = createTraceStore(runStore);

  let selectedIteration: number | null = null;
  let bottomTab: "decisions" | "memory" | "context" = "decisions";

  $: runState = $runStore;
  $: signalData = $signalStore;
  $: frames = $traceStore;
  $: selectedFrame = selectedIteration !== null
    ? (frames.find(f => f.iteration === selectedIteration) ?? null)
    : frames.at(-1) ?? null;

  function handleSignalSelect(e: CustomEvent<number>) {
    selectedIteration = e.detail;
  }

  async function pause() { await runStore.pause(); }
  async function stop() { await runStore.stop(); }

  onDestroy(() => runStore.destroy());
</script>

<svelte:head>
  <title>CORTEX — Run {runId.slice(0, 8)}</title>
</svelte:head>

<div class="flex flex-col h-full overflow-hidden">
  <!-- Vitals strip -->
  <VitalsStrip
    vitals={runState.vitals}
    status={runState.status}
    {runId}
  />

  <!-- Main 65/35 content split -->
  <div class="flex-1 grid grid-cols-1 md:grid-cols-[65%_35%] gap-4 p-4 overflow-hidden min-h-0">
    <!-- Left: Signal Monitor -->
    <section class="flex flex-col gap-4 overflow-hidden min-h-0">
      <div class="flex-1 min-h-0">
        <SignalMonitor data={signalData} on:selectIteration={handleSignalSelect} />
      </div>

      <!-- Debrief card appears below signal monitor on completion -->
      {#if runState.debrief}
        <div class="flex-shrink-0 max-h-64 overflow-y-auto">
          <DebriefCard debrief={runState.debrief} />
        </div>
      {/if}
    </section>

    <!-- Right: Trace Panel -->
    <section class="min-h-0">
      <TracePanel frame={selectedFrame} />
    </section>
  </div>

  <!-- Bottom footer bar (from mockup) -->
  <footer class="bg-[#111317]/80 backdrop-blur-md flex justify-between items-center px-6 flex-shrink-0 border-t border-primary/10 h-14">
    <!-- Tab buttons -->
    <div class="flex items-center h-full">
      {#each [
        { id: "decisions", label: "Reactive Decisions", icon: "analytics" },
        { id: "memory",    label: "Memory",             icon: "account_tree" },
        { id: "context",   label: "Context Pressure",   icon: "data_usage" },
      ] as tab}
        <button
          class="flex flex-col items-center justify-center px-5 h-full transition-all duration-200 font-mono text-[10px] uppercase tracking-wider
                 {bottomTab === tab.id
                   ? 'text-primary border-t-2 border-primary bg-primary/5 -mt-0.5'
                   : 'text-outline hover:bg-white/5 hover:text-secondary'}"
          on:click={() => bottomTab = tab.id as typeof bottomTab}
        >
          <span class="material-symbols-outlined text-sm mb-0.5">{tab.icon}</span>
          {tab.label}
        </button>
      {/each}
    </div>

    <!-- Control buttons -->
    <div class="flex items-center gap-3">
      {#if runState.status === "live"}
        <button
          on:click={pause}
          class="px-5 py-1.5 border border-primary/20 text-primary font-mono text-xs uppercase hover:bg-primary/10 transition-colors rounded"
        >
          Pause
        </button>
        <button
          on:click={stop}
          class="px-5 py-1.5 border border-error/20 text-error font-mono text-xs uppercase hover:bg-error/10 transition-colors rounded"
        >
          Stop
        </button>
      {/if}
    </div>
  </footer>

  <!-- Bottom panel (slide up when tab selected) -->
  {#if bottomTab}
    <div
      class="bg-surface-container-low border-t border-outline-variant/10 h-40 overflow-hidden transition-all duration-300"
    >
      {#if bottomTab === "decisions"}
        <DecisionLog events={runState.events} />
      {:else if bottomTab === "memory"}
        <MemoryPanel events={runState.events} />
      {:else if bottomTab === "context"}
        <ContextGauge events={runState.events} />
      {/if}
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Verify UI builds cleanly**

```bash
cd apps/cortex/ui && bun run build 2>&1 | tail -5
```
Expected: no errors.

- [ ] **Step 3: Final commit**

```bash
git add apps/cortex/ui/src/routes/run/ apps/cortex/ui/src/lib/
git commit -m "feat(cortex-ui): Run view complete — signal monitor, trace panel, debrief card, bottom info panels"
```

---

## Phase 4 Complete

The Run view is live. Signal monitor renders 4 D3 tracks from real event data. Trace panel shows thought/action/observation per iteration. Reactive decisions, memory snapshots, and context pressure appear in the bottom tabs. The debrief card renders post-run.

**Next:** `2026-03-31-cortex-app-phase5-workshop-and-cli.md` — Workshop view (Builder/Skills/Tools tabs), Command Palette, CLI integration, and static asset bundling into `rax`.
