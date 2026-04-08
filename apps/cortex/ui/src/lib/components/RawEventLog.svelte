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

  let filterText = $state("");
  let expandedIdx = $state<number | null>(null);
  let logEl = $state<HTMLDivElement | undefined>(undefined);
  let autoScroll = $state(true);

  // Color map for event types
  const TYPE_COLORS: Record<string, string> = {
    AgentStarted:               "text-primary",
    AgentCompleted:             "text-secondary",
    TaskCreated:                "text-outline/60",
    TaskCompleted:              "text-secondary",
    TaskFailed:                 "text-error",
    LLMRequestStarted:         "text-primary/60",
    LLMRequestCompleted:       "text-primary",
    ToolCallStarted:           "text-tertiary",
    ToolCallCompleted:         "text-tertiary",
    EntropyScored:             "text-primary/70",
    ReasoningStepCompleted:    "text-primary/60",
    ReasoningIterationProgress:"text-secondary/80",
    FinalAnswerProduced:       "text-secondary",
    DebriefCompleted:          "text-secondary",
    MemoryBootstrapped:        "text-outline/60",
    MemoryFlushed:             "text-outline/60",
    ReactiveDecision:          "text-tertiary",
    AgentPaused:               "text-tertiary",
    AgentStopped:              "text-error/60",
    ContextPressure:           "text-tertiary",
  };

  function typeColor(type: string): string {
    return TYPE_COLORS[type] ?? "text-outline/50";
  }

  const filtered = $derived(
    filterText.trim()
      ? events.filter((e) =>
          e.type.toLowerCase().includes(filterText.toLowerCase()) ||
          JSON.stringify(e.payload).toLowerCase().includes(filterText.toLowerCase()),
        )
      : events,
  );

  // Event type summary counts
  const typeCounts = $derived(
    events.reduce<Record<string, number>>((acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    }, {}),
  );

  const topTypes = $derived(
    Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5),
  );

  $effect(() => {
    // Auto-scroll to bottom when new events arrive
    void filtered.length; // track reactively
    if (autoScroll && logEl) {
      logEl.scrollTop = logEl.scrollHeight;
    }
  });

  async function copyEventPayload(payload: Record<string, unknown>) {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    } catch {
      // ignore clipboard errors
    }
  }

  async function copyAllEventsAsJson() {
    try {
      const data = filtered.map((e) => ({
        type: e.type,
        payload: e.payload,
        ts: e.ts,
      }));
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    } catch {
      // ignore clipboard errors
    }
  }
</script>

<div class="h-full flex flex-col overflow-hidden">
  <!-- Filter + summary bar -->
  <div class="flex flex-shrink-0 items-center gap-2 border-b border-[var(--cortex-border)] px-3 py-2">
    <span class="material-symbols-outlined text-sm text-outline/50">search</span>
    <input
      type="text"
      bind:value={filterText}
      placeholder="Filter events…"
      class="flex-1 bg-transparent border-none outline-none text-[11px] font-mono text-on-surface placeholder:text-outline/40 min-w-0"
    />
    <span class="text-[10px] font-mono text-outline/40 flex-shrink-0">
      {filtered.length}/{events.length}
    </span>
    <button
      type="button"
      class="text-[9px] font-mono flex-shrink-0 border-0 bg-transparent cursor-pointer
             {autoScroll ? 'text-secondary' : 'text-outline/40'}"
      onclick={() => (autoScroll = !autoScroll)}
      title="Auto-scroll"
    >
      {autoScroll ? "↓ live" : "↓ paused"}
    </button>
    {#if filtered.length > 0}
      <button
        type="button"
        class="text-[9px] font-mono flex-shrink-0 border-0 bg-transparent cursor-pointer text-outline/40 hover:text-primary transition-colors"
        onclick={copyAllEventsAsJson}
        title="Copy all events as JSON"
      >
        copy all
      </button>
    {/if}
  </div>

  <!-- Top event types summary -->
  {#if topTypes.length > 0 && !filterText}
    <div class="flex flex-shrink-0 gap-2 overflow-x-auto border-b border-[var(--cortex-border)] px-3 py-1.5">
      {#each topTypes as [type, count]}
        <button
          type="button"
          class="flex items-center gap-1 text-[8px] font-mono bg-transparent border-0 cursor-pointer hover:text-primary transition-colors flex-shrink-0 {typeColor(type)}"
          onclick={() => (filterText = type)}
          title="Filter to {type}"
        >
          <span>{type.replace(/([A-Z])/g, " $1").trim().split(" ").slice(-1)[0]}</span>
          <span class="bg-surface-container rounded px-1">{count}</span>
        </button>
      {/each}
    </div>
  {/if}

  <!-- Event stream -->
  <div
    bind:this={logEl}
    class="flex-1 overflow-y-auto min-h-0 font-mono text-[10px]"
    onscroll={() => {
      if (!logEl) return;
      const atBottom = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30;
      autoScroll = atBottom;
    }}
  >
    {#if filtered.length === 0}
      <p class="text-outline text-center mt-6 px-4">
        {filterText ? "No events match the filter." : "No events yet."}
      </p>
    {:else}
      {#each filtered as ev, i (ev.ts + i)}
        {@const isExpanded = expandedIdx === i}

        <button
          type="button"
          class="flex w-full cursor-pointer items-start gap-2 border-x-0 border-b border-t-0 border-[var(--cortex-border)] bg-transparent px-3 py-1 text-left transition-colors hover:bg-surface-container-low/40
                 {isExpanded ? 'bg-surface-container-low/60' : ''}"
          onclick={() => (expandedIdx = isExpanded ? null : i)}
        >
          <!-- Timestamp -->
          <span class="flex-shrink-0 text-outline/30 w-[50px] text-right tabular-nums">
            {new Date(ev.ts).toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>

          <!-- Event type -->
          <span class="flex-shrink-0 w-[180px] truncate {typeColor(ev.type)}" title={ev.type}>
            {ev.type}
          </span>

          <!-- Payload preview -->
          <span class="flex-1 text-outline/50 truncate min-w-0">
            {#if ev.type === "LLMRequestCompleted"}
              {typeof ev.payload.tokensUsed === "number" ? `${ev.payload.tokensUsed}t` : ""}
              {typeof ev.payload.durationMs === "number" ? ` ${ev.payload.durationMs}ms` : ""}
              {typeof ev.payload.model === "string" ? ` · ${ev.payload.model}` : ""}
            {:else if ev.type === "ToolCallStarted" || ev.type === "ToolCallCompleted"}
              {ev.payload.toolName ?? ""}
              {ev.type === "ToolCallCompleted" ? (ev.payload.success ? " ✓" : " ✗") : ""}
            {:else if ev.type === "EntropyScored"}
              η={typeof ev.payload.composite === "number" ? ev.payload.composite.toFixed(3) : "?"}
              {#if ev.payload.trajectory && typeof ev.payload.trajectory === "object"}
                · {(ev.payload.trajectory as any).shape ?? ""}
              {/if}
            {:else if ev.type === "ReasoningIterationProgress"}
              iter {ev.payload.iteration}/{ev.payload.maxIterations}
              {#if Array.isArray(ev.payload.toolsThisStep) && ev.payload.toolsThisStep.length > 0}
                · {(ev.payload.toolsThisStep as string[]).join(", ")}
              {/if}
            {:else if ev.type === "FinalAnswerProduced"}
              {typeof ev.payload.answer === "string" ? ev.payload.answer.slice(0, 60) : ""}
            {:else if ev.type === "ReactiveDecision"}
              {ev.payload.decision ?? ""} · {ev.payload.reason ?? ""}
            {:else}
              {JSON.stringify(ev.payload).slice(0, 80)}
            {/if}
          </span>

          <!-- Expand indicator -->
          <span class="flex-shrink-0 material-symbols-outlined text-[11px] text-outline/20 {isExpanded ? 'rotate-180' : ''}">
            expand_more
          </span>
        </button>

        <!-- Expanded payload -->
        {#if isExpanded}
          <div
            class="border-b border-[var(--cortex-border)] bg-surface-container-lowest/60 px-3 py-2"
          >
            <div class="flex items-center justify-between mb-2">
              <span class="text-[8px] font-mono text-outline/40 uppercase tracking-widest">Payload JSON</span>
              <button
                type="button"
                class="text-[8px] font-mono text-outline/40 hover:text-primary transition-colors border-0 bg-transparent cursor-pointer"
                onclick={() => copyEventPayload(ev.payload)}
                title="Copy JSON"
              >
                copy
              </button>
            </div>
            <pre class="text-[9px] font-mono text-on-surface/50 whitespace-pre-wrap break-all overflow-x-auto max-h-64 overflow-y-auto">{JSON.stringify(
                ev.payload,
                null,
                2,
              )}</pre>
          </div>
        {/if}
      {/each}
    {/if}
  </div>
</div>
