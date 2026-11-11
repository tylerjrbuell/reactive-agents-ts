<script lang="ts">
  /** The inspector's Context tab: the latest `ContextPressure` reading, else loop progress as a stand-in. */
  import Meter from "$lib/components/kit/Meter.svelte";

  interface Ev {
    readonly type: string;
    readonly payload: Record<string, unknown>;
    readonly ts: number;
  }
  interface Props {
    events: Ev[];
  }
  let { events }: Props = $props();

  type Pressure = {
    utilizationPct?: number;
    level?: string;
    tokensUsed?: number;
    tokensAvailable?: number;
    isFallback?: boolean;
    iteration?: number;
    maxIterations?: number;
  };

  function tokensFromPayload(p: Record<string, unknown>): number {
    const raw = p.tokensUsed;
    if (typeof raw === "number") return raw;
    if (raw && typeof raw === "object" && "total" in raw && typeof (raw as { total: unknown }).total === "number") {
      return (raw as { total: number }).total;
    }
    return 0;
  }

  const pressure = $derived.by((): Pressure | null => {
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i]?.type === "ContextPressure") {
        return events[i]!.payload as Pressure;
      }
    }
    // Fallback derived signal when explicit ContextPressure events are unavailable.
    let usedFromRequests = 0;
    let totalFromCompleted = 0;
    let iteration = 0;
    let maxIterations = 0;
    for (const e of events) {
      if (e.type === "LLMRequestCompleted") usedFromRequests += tokensFromPayload(e.payload);
      if (e.type === "ReasoningIterationProgress") {
        iteration =
          typeof e.payload.iteration === "number" ? e.payload.iteration : iteration;
        maxIterations =
          typeof e.payload.maxIterations === "number" ? e.payload.maxIterations : maxIterations;
      }
      // AgentCompleted and FinalAnswerProduced carry authoritative totals —
      // use them as fallback when per-request usage is 0 (local/Ollama models omit usage).
      if (e.type === "AgentCompleted") {
        const t = e.payload.totalTokens;
        if (typeof t === "number" && t > 0) totalFromCompleted = t;
      }
      if (e.type === "FinalAnswerProduced") {
        const t = e.payload.totalTokens;
        if (typeof t === "number" && t > totalFromCompleted) totalFromCompleted = t;
      }
    }
    const tokensUsed = usedFromRequests > 0 ? usedFromRequests : totalFromCompleted;
    if (tokensUsed <= 0 && maxIterations <= 0) return null;
    const ratio = maxIterations > 0 ? Math.min(1, iteration / maxIterations) : 0;
    const utilizationPct = Math.max(0, Math.min(100, ratio * 100));
    const level =
      utilizationPct >= 90 ? "critical" : utilizationPct >= 75 ? "high" : utilizationPct >= 45 ? "medium" : "low";
    return {
      utilizationPct,
      level,
      tokensUsed,
      tokensAvailable: undefined,
      isFallback: true,
      iteration,
      maxIterations,
    };
  });

  const pct = $derived(pressure?.utilizationPct ?? 0);
  const level = $derived(pressure?.level ?? "low");
  const tone = $derived<"neutral" | "warn" | "bad">(level === "critical" ? "bad" : level === "high" ? "warn" : "neutral");
  const title = $derived(pressure?.isFallback ? "Loop progress" : "Context window");
</script>

<section class="sec">
  {#if !pressure}
    <h3>Context window</h3>
    <p class="hint">No context pressure reported yet. The framework reports it as the window fills.</p>
  {:else}
    <div class="row"><h3>{title}</h3><span class="v" data-tone={tone}>{pct.toFixed(0)}%</span></div>
    <Meter value={pct} max={100} label="{title} used" {tone} />
    <div class="row meta">
      {#if pressure.isFallback && (pressure.tokensUsed ?? 0) === 0 && (pressure.maxIterations ?? 0) > 0}
        <span>Loop {pressure.iteration ?? 0} of {pressure.maxIterations}</span>
      {:else}
        <span>{(pressure.tokensUsed ?? 0).toLocaleString()} tokens</span>
      {/if}
      {#if pressure.tokensAvailable != null}
        <span>{pressure.tokensAvailable.toLocaleString()} available</span>
      {:else if pressure.isFallback}
        <span>No context window reading: shown as loop progress</span>
      {/if}
    </div>
  {/if}
</section>

<style>
  .sec { display: grid; gap: 8px; }
  h3 { margin: 0; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .v { font-family: var(--cortex-font-data); font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .v[data-tone="warn"] { color: var(--cortex-warn); }
  .v[data-tone="bad"] { color: var(--cortex-bad); }
  .meta { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .hint { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
