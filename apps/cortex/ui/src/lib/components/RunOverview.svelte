<script lang="ts">
  /**
   * RunOverview — compact right-column panel for the Run view.
   *
   * Shows: entropy mini-chart, stats grid, tool usage, debrief summary.
   * Replaces the tall SignalMonitor as the secondary column companion to the Trace.
   */
  import type { RunVitals, RunStatus } from "$lib/stores/run-store.js";
  import type { SignalData } from "$lib/stores/signal-store.js";
  import Tooltip from "$lib/components/Tooltip.svelte";

  interface Props {
    vitals: RunVitals;
    status: RunStatus;
    signal: SignalData;
    debrief: unknown;
    eventCount: number;
  }
  let { vitals, status, signal, debrief, eventCount }: Props = $props();

  type DebriefView = {
    outcome?: string;
    summary?: string;
    keyFindings?: string[];
    lessonsLearned?: string[];
    metrics?: { iterations?: number; tokens?: number; duration?: number; cost?: number };
    toolsUsed?: ReadonlyArray<{ name?: string; calls?: number; errors?: number }>;
  };

  const d = $derived((debrief && typeof debrief === "object" ? debrief : null) as DebriefView | null);
  const isComplete = $derived(status === "completed" || status === "failed");

  // ── Entropy mini-chart points ──────────────────────────────────────────────
  const entropyPoints = $derived(signal.entropy);

  // Build SVG polyline from entropy data
  const W = 200;
  const H = 48;
  const entropyPath = $derived.by(() => {
    if (entropyPoints.length < 2) return "";
    const xScale = (i: number) => (i / (entropyPoints.length - 1)) * W;
    const yScale = (v: number) => H - v * H;
    return entropyPoints.map((p, i) => `${xScale(i)},${yScale(p.value)}`).join(" ");
  });

  // Color trajectory badge
  const trajectoryConfig = $derived(
    vitals.trajectory === "CONVERGING"
      ? { color: "text-secondary border-secondary/30 bg-secondary/8", dot: "bg-secondary" }
      : vitals.trajectory === "STRESSED" || vitals.trajectory === "DIVERGING"
        ? { color: "text-error border-error/30 bg-error/8", dot: "bg-error" }
        : {
            color:
              "text-amber-900 border-amber-400/45 bg-amber-100/85 dark:text-amber-600/95 dark:border-amber-800/50 dark:bg-amber-950/40",
            dot: "bg-amber-600 dark:bg-amber-700",
          },
  );

  // ── Tool summary from signal data ─────────────────────────────────────────
  const toolSummary = $derived.by(() => {
    const map = new Map<string, { success: number; error: number; totalMs: number }>();
    for (const t of signal.tools) {
      const entry = map.get(t.name) ?? { success: 0, error: 0, totalMs: 0 };
      if (t.status === "success") entry.success++;
      else if (t.status === "error") entry.error++;
      if (t.latencyMs) entry.totalMs += t.latencyMs;
      map.set(t.name, entry);
    }
    return [...map.entries()].map(([name, stats]) => ({ name, ...stats }));
  });

  // Note: full debrief + copy lives in the DebriefPanel bottom tab
</script>

<div
  class="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low/35 shadow-[inset_0_1px_0_rgba(0,0,0,0.04)] dark:bg-surface-container-low/25 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
>
  <div
    class="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-outline-variant/10 bg-surface-container-low/25"
  >
    <span class="material-symbols-outlined text-secondary/90 text-base shrink-0" aria-hidden="true">insights</span>
    <h2 class="font-display text-[11px] font-semibold uppercase tracking-[0.12em] text-on-surface truncate">
      Summary
    </h2>
  </div>

  <div class="flex flex-col gap-3 flex-1 min-h-0 overflow-y-auto p-3">
  <!-- ── Entropy mini-chart ─────────────────────────────────────────────── -->
  <div class="bg-surface-container-low/50 border border-outline-variant/10 rounded-lg p-3">
    <div class="flex items-center justify-between mb-2">
      <span class="text-[9px] font-mono text-outline/70 uppercase tracking-widest">Entropy</span>
      <span class="text-[9px] font-mono px-1.5 py-0.5 rounded border {trajectoryConfig.color}">
        {vitals.trajectory}
      </span>
    </div>
    {#if entropyPoints.length >= 2}
      <div class="relative">
        <svg viewBox="0 0 {W} {H}" class="w-full h-12 overflow-visible" preserveAspectRatio="none">
          <!-- Fill area under curve -->
          <defs>
            <linearGradient id="ov-entropy-fill" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.2"/>
              <stop offset="60%" stop-color="#b45309" stop-opacity="0.12"/>
              <stop offset="100%" stop-color="#b45309" stop-opacity="0.08"/>
            </linearGradient>
          </defs>
          {#if entropyPath}
            <!-- Area fill -->
            <polygon
              points="{entropyPath} {W},{H} 0,{H}"
              fill="url(#ov-entropy-fill)"
            />
            <!-- Line -->
            <polyline
              points={entropyPath}
              fill="none"
              stroke={vitals.trajectory === "CONVERGING" ? "#06b6d4" : vitals.trajectory === "STRESSED" || vitals.trajectory === "DIVERGING" ? "#ef4444" : "#b45309"}
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          {/if}
          <!-- Current value dot -->
          {#if entropyPoints.length > 0}
            {@const last = entropyPoints[entropyPoints.length - 1]!}
            <circle
              cx={W}
              cy={H - last.value * H}
              r="2.5"
              fill={vitals.trajectory === "CONVERGING" ? "#06b6d4" : "#b45309"}
            />
          {/if}
        </svg>
        <!-- Min/max labels -->
        <div class="flex justify-between mt-0.5">
          <span class="text-[8px] font-mono text-outline/30">0</span>
          <span class="text-[9px] font-mono text-primary/60 tabular-nums">
            η {vitals.entropy.toFixed(2)}
          </span>
          <span class="text-[8px] font-mono text-outline/30">1</span>
        </div>
      </div>
    {:else}
      <div class="h-12 flex items-center justify-center text-[9px] font-mono text-outline/30 italic">
        no entropy data
      </div>
    {/if}
  </div>

  <!-- ── Run Config ────────────────────────────────────────────────────── -->
  {#if vitals.provider || vitals.model || vitals.strategy}
    <div class="bg-surface-container-low/40 border border-outline-variant/10 rounded-lg p-3">
      <div class="text-[9px] font-mono text-outline/70 uppercase tracking-widest mb-2.5">Config</div>
      <div class="space-y-2">
        {#if vitals.provider}
          <div class="flex items-center justify-between">
            <span class="text-[9px] font-mono text-outline/50 uppercase">Provider</span>
            <span class="text-[10px] font-mono text-on-surface/80 font-medium capitalize">
              {vitals.provider}
              {#if vitals.fallbackProvider}
                <span class="ml-1 text-[9px] text-amber-800 dark:text-amber-600/95">→ {vitals.fallbackProvider}</span>
              {/if}
            </span>
          </div>
        {/if}
        {#if vitals.model}
          <div class="flex items-start justify-between gap-2">
            <span class="text-[9px] font-mono text-outline/50 uppercase flex-shrink-0">Model</span>
            <span class="text-[10px] font-mono text-primary/80 text-right break-all">
              {vitals.model}
            </span>
          </div>
        {/if}
        {#if vitals.strategy}
          <div class="flex items-center justify-between">
            <span class="text-[9px] font-mono text-outline/50 uppercase">Strategy</span>
            <span class="text-[10px] font-mono text-secondary/80 uppercase tracking-wide">
              {vitals.strategy}
            </span>
          </div>
        {/if}
        {#if vitals.maxIterations > 0}
          <div class="flex items-center justify-between">
            <span class="text-[9px] font-mono text-outline/50 uppercase">Max Iter</span>
            <span class="text-[10px] font-mono text-on-surface/50 tabular-nums">
              {vitals.maxIterations}
            </span>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- ── Stats grid ─────────────────────────────────────────────────────── -->
  <div class="grid grid-cols-2 gap-2">
    {#each [
      {
        label: "Loop",
        hint: "Kernel loops — same axis as trace rows and replay",
        value: vitals.loopIteration > 0 ? String(vitals.loopIteration) : "—",
        sub:
          vitals.maxIterations > 0 && vitals.loopIteration > 0 && vitals.loopIteration <= vitals.maxIterations
            ? `/ ${vitals.maxIterations}`
            : undefined,
        color: "text-primary",
      },
      {
        label: "Steps",
        hint: "Inner reasoning steps — can exceed LOOP; replay does not scrub by step",
        value: vitals.reasoningSteps > 0 ? String(vitals.reasoningSteps) : "—",
        sub: undefined,
        color: "text-primary",
      },
      { label: "Tokens", hint: "", value: vitals.tokensUsed > 0 ? vitals.tokensUsed.toLocaleString() : "—", sub: undefined, color: "text-primary" },
      { label: "Cost", hint: "", value: vitals.cost < 0.0001 ? "<$0.0001" : `$${vitals.cost.toFixed(4)}`, sub: undefined, color: "text-secondary/80" },
      { label: "Duration", hint: "", value: vitals.durationMs > 0 ? vitals.durationMs < 1000 ? `${vitals.durationMs}ms` : `${(vitals.durationMs/1000).toFixed(1)}s` : "—", sub: undefined, color: "text-secondary/80" },
    ] as stat}
      {#if stat.hint}
        <Tooltip
          text={stat.hint}
          placement="bottom"
          class={stat.label === "Duration" ? "col-span-2 min-w-0" : "min-w-0"}
        >
          <div
            class="bg-surface-container-low/30 border border-outline-variant/10 rounded p-2.5 w-full cursor-help"
          >
            <div class="font-mono text-[9px] text-outline/50 uppercase tracking-widest mb-1">{stat.label}</div>
            <div class="font-mono text-[13px] font-semibold {stat.color} tabular-nums">
              {stat.value}
              {#if stat.sub}<span class="text-[10px] text-outline/40">{stat.sub}</span>{/if}
            </div>
          </div>
        </Tooltip>
      {:else}
        <div
          class="bg-surface-container-low/30 border border-outline-variant/10 rounded p-2.5 {stat.label === 'Duration' ? 'col-span-2' : ''}"
        >
          <div class="font-mono text-[9px] text-outline/50 uppercase tracking-widest mb-1">{stat.label}</div>
          <div class="font-mono text-[13px] font-semibold {stat.color} tabular-nums">
            {stat.value}
            {#if stat.sub}<span class="text-[10px] text-outline/40">{stat.sub}</span>{/if}
          </div>
        </div>
      {/if}
    {/each}
  </div>

  <!-- ── Tool usage ─────────────────────────────────────────────────────── -->
  {#if toolSummary.length > 0}
    <div class="bg-surface-container-low/40 border border-outline-variant/10 rounded-lg p-3">
      <div class="text-[9px] font-mono text-outline/70 uppercase tracking-widest mb-2.5">Tools</div>
      <div class="space-y-1.5">
        {#each toolSummary as t}
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="material-symbols-outlined text-[11px] flex-shrink-0 {t.error > 0 ? 'text-error' : 'text-secondary'}"
                style="font-variation-settings: 'FILL' 1;"
              >
                {t.error > 0 ? "error" : "check_circle"}
              </span>
              <span class="font-mono text-[10px] text-on-surface/80 truncate">{t.name}</span>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0 font-mono text-[9px] text-outline/50">
              <span>{t.success + t.error}×</span>
              {#if t.totalMs > 0}
                <span>{t.totalMs}ms</span>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Debrief hint when available — full content is in the Debrief tab below -->
  {#if d}
    <div class="bg-secondary/5 border border-secondary/15 rounded-lg px-3 py-2 flex items-center gap-2 flex-shrink-0">
      <span class="material-symbols-outlined text-sm text-secondary/70" style="font-variation-settings: 'FILL' 1;">task_alt</span>
      <span class="font-mono text-[10px] text-on-surface/60 flex-1 truncate">
        {(d as any).summary ?? "Run debrief available"}
      </span>
      <span class="font-mono text-[9px] text-secondary/50 flex-shrink-0">↓ Debrief</span>
    </div>
  {/if}

  <!-- ── Event count hint ────────────────────────────────────────────────── -->
  <div class="mt-auto text-[9px] font-mono text-outline/30 text-center pb-0.5">
    {eventCount} events · Raw Events ↓
  </div>
  </div>
</div>
