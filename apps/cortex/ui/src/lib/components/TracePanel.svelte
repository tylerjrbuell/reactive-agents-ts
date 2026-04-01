<script lang="ts">
  import type { IterationFrame } from "$lib/stores/trace-store.js";

  interface Props {
    frame: IterationFrame | null;
    frames?: IterationFrame[];
  }
  let { frame, frames = [] }: Props = $props();

  // Svelte 5: $state(Set) mutations don't trigger reactivity.
  // Use an array and reassign on every change.
  let expandedRows = $state<number[]>([]);

  function toggleRow(idx: number) {
    if (expandedRows.includes(idx)) {
      expandedRows = expandedRows.filter((i) => i !== idx);
    } else {
      expandedRows = [...expandedRows, idx];
    }
  }

  // When a frame is selected from the signal monitor, auto-expand it in the log
  $effect(() => {
    if (frame !== null) {
      const idx = frames.findLastIndex(
        (f) => f.iteration === frame?.iteration && f.kind === frame?.kind,
      );
      if (idx >= 0 && !expandedRows.includes(idx)) {
        expandedRows = [...expandedRows, idx];
      }
    }
  });

  function kindClass(f: IterationFrame) {
    if (f.kind === "final") return "border-l-2 border-secondary/60";
    return "border-l-2 border-outline-variant/20 hover:border-primary/40";
  }

  function truncate(s: string, max = 120) {
    return s.length > max ? s.slice(0, max) + "…" : s;
  }
</script>

<div class="gradient-border-glow rounded-lg h-full flex flex-col overflow-hidden min-h-0">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-white/5 flex-shrink-0">
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined text-sm text-primary">receipt_long</span>
      <h3 class="font-headline text-sm font-bold uppercase tracking-wide">Execution Trace</h3>
      {#if frames.length > 0}
        <span class="text-[10px] font-mono text-outline bg-surface-container px-1.5 py-0.5 rounded">
          {frames.length}
        </span>
      {/if}
    </div>
    {#if frame}
      <span class="text-[10px] font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
        ITER {String(frame.iteration).padStart(2, "0")} selected
      </span>
    {/if}
  </div>

  <!-- Scrollable trace log -->
  <div class="flex-1 overflow-y-auto min-h-0 py-2">
    {#if frames.length === 0}
      <p class="font-mono text-[10px] text-outline text-center mt-8 px-4">
        Trace will appear here as the agent runs.
      </p>
    {:else}
      {#each frames as f, idx (f.ts + ":" + f.iteration + ":" + (f.kind ?? "step"))}
        {@const isExpanded = expandedRows.includes(idx)}
        {@const isSelected = frame?.iteration === f.iteration && frame?.kind === f.kind}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div
          class="mx-2 mb-1 rounded transition-all duration-150 cursor-pointer
                 {kindClass(f)}
                 {isSelected ? 'bg-primary/8 border-primary/50' : 'bg-surface-container-lowest/40 hover:bg-surface-container-low/60'}"
          onclick={() => toggleRow(idx)}
        >
          <!-- Collapsed row — always visible -->
          <div class="flex items-center gap-2 px-3 py-2">
            <!-- Iter badge -->
            <span
              class="flex-shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded tabular-nums
                     {f.kind === 'final'
                       ? 'text-secondary bg-secondary/10 border border-secondary/20'
                       : 'text-primary/70 bg-primary/10'}"
            >
              {f.kind === "final" ? "FINAL" : `#${f.iteration}`}
            </span>

            <!-- Summary text -->
            <span class="flex-1 text-[10px] font-mono text-on-surface/70 truncate min-w-0">
              {truncate(f.thought)}
            </span>

            <!-- Tool pills (compact) -->
            {#if f.toolsThisStep && f.toolsThisStep.length > 0}
              <div class="flex-shrink-0 flex gap-1">
                {#each f.toolsThisStep.slice(0, 2) as tool}
                  <span class="text-[8px] font-mono px-1 py-0.5 bg-tertiary/10 text-tertiary rounded">
                    {tool.length > 10 ? tool.slice(0, 9) + "…" : tool}
                  </span>
                {/each}
                {#if f.toolsThisStep.length > 2}
                  <span class="text-[8px] font-mono text-outline">+{f.toolsThisStep.length - 2}</span>
                {/if}
              </div>
            {/if}

            <!-- Metrics (tokens, duration) -->
            <div class="flex-shrink-0 flex items-center gap-2 text-[9px] font-mono text-outline/60">
              {#if f.tokensUsed > 0}
                <span>{f.tokensUsed.toLocaleString()}t</span>
              {/if}
              {#if f.durationMs > 0}
                <span>{f.durationMs}ms</span>
              {/if}
              {#if f.entropy !== undefined}
                <span class="text-primary/50">η{f.entropy.toFixed(2)}</span>
              {/if}
            </div>

            <!-- Expand chevron -->
            <span class="flex-shrink-0 material-symbols-outlined text-xs text-outline/40 transition-transform {isExpanded ? 'rotate-180' : ''}">
              expand_more
            </span>
          </div>

          <!-- Expanded detail -->
          {#if isExpanded}
            <div class="px-3 pb-3 space-y-3 border-t border-white/5 pt-3" onclick={(e) => e.stopPropagation()}>

              <!-- Full thought / final answer -->
              {#if f.thought && f.thought !== `Called: ${f.toolsThisStep?.join(", ")}` && f.thought !== "(thinking)" && f.thought !== "(reasoning — no tools)"}
                <div class="relative pl-3">
                  <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-primary/30 rounded-full"></div>
                  <span class="text-[9px] font-mono text-primary uppercase tracking-widest block mb-1">
                    {f.kind === "final" ? "Final Answer" : "Summary"}
                  </span>
                  <p class="text-[11px] font-mono text-on-surface/70 leading-relaxed whitespace-pre-wrap break-words">
                    {f.thought}
                  </p>
                </div>
              {/if}

              <!-- Tools called -->
              {#if f.toolsThisStep && f.toolsThisStep.length > 0}
                <div class="relative pl-3">
                  <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-tertiary/30 rounded-full"></div>
                  <span class="text-[9px] font-mono text-tertiary uppercase tracking-widest block mb-2">
                    Tools Called ({f.toolsThisStep.length})
                  </span>
                  <div class="flex flex-wrap gap-1.5">
                    {#each f.toolsThisStep as tool}
                      <span class="px-2 py-1 bg-tertiary/10 border border-tertiary/30 text-tertiary text-[10px] font-mono rounded">
                        {tool}
                      </span>
                    {/each}
                  </div>
                </div>
              {/if}

              <!-- Observation / result preview -->
              {#if f.observation}
                <div class="relative pl-3">
                  <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-secondary/30 rounded-full"></div>
                  <span class="text-[9px] font-mono text-secondary uppercase tracking-widest block mb-1">
                    Result Preview
                  </span>
                  <div class="bg-secondary/5 border border-secondary/10 rounded p-2 max-h-32 overflow-y-auto">
                    <code class="text-[10px] font-mono text-on-surface/50 break-all whitespace-pre-wrap">
                      {f.observation}
                    </code>
                  </div>
                </div>
              {/if}

              <!-- Stats row -->
              <div class="flex flex-wrap gap-3 text-[9px] font-mono text-outline/60 pl-3">
                {#if f.tokensUsed > 0}
                  <span class="text-primary/60">{f.tokensUsed.toLocaleString()} tokens</span>
                {/if}
                {#if f.durationMs > 0}
                  <span>{f.durationMs}ms</span>
                {/if}
                {#if f.entropy !== undefined}
                  <span>η {f.entropy.toFixed(3)}</span>
                {/if}
                <span class="text-outline/30">{new Date(f.ts).toLocaleTimeString()}</span>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
</div>
