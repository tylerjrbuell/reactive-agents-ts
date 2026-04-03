<script lang="ts">
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
    };
  });

  const pct = $derived(pressure?.utilizationPct ?? 0);
  const level = $derived(pressure?.level ?? "low");
  const barColor = $derived(
    level === "critical" ? "#ffb4ab" : level === "high" ? "#f7be1d" : level === "medium" ? "#d0bcff" : "#4cd7f6",
  );
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
        style="width: {Math.min(100, pct)}%; background: {barColor};"
      ></div>
    </div>
    <div class="flex justify-between font-mono text-[10px] text-outline">
      <span>{(pressure.tokensUsed ?? 0).toLocaleString()} tokens</span>
      {#if pressure.tokensAvailable != null}
        <span>{pressure.tokensAvailable.toLocaleString()} available</span>
      {:else}
        <span>{pct.toFixed(0)}% of iterations</span>
      {/if}
    </div>
  {/if}
</div>
