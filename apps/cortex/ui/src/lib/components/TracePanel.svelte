<script lang="ts">
  import type { IterationFrame } from "$lib/stores/trace-store.js";

  interface Props {
    frame: IterationFrame | null;
    frames?: IterationFrame[];
  }
  let { frame, frames = [] }: Props = $props();

  let expandedObservation = $state(false);
  let expandedRaw = $state(false);

  $effect(() => {
    if (frame) {
      expandedObservation = false;
      expandedRaw = false;
    }
  });
</script>

<div class="gradient-border-glow rounded-lg h-full flex flex-col overflow-hidden min-h-0">
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

  <div class="flex-1 overflow-y-auto px-6 py-4 space-y-6 min-h-0">
    {#if !frame}
      <p class="font-mono text-xs text-outline text-center mt-8">
        Click the entropy track or a token bar to inspect an iteration.
      </p>
    {:else}
      {#if frame.thought}
        <div class="relative pl-4">
          <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-primary/40 rounded-full"></div>
          <span class="text-[9px] font-mono text-primary uppercase mb-2 block tracking-widest">
            {frame.kind === "final" ? "Final Answer" : "Iteration Summary"}
          </span>
          <p class="text-xs font-mono text-on-surface/70 leading-relaxed">{frame.thought}</p>
        </div>
      {/if}

      <!-- Tools used this iteration -->
      {#if frame.toolsThisStep && frame.toolsThisStep.length > 0}
        <div class="relative pl-4">
          <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-tertiary/40 rounded-full"></div>
          <span class="text-[9px] font-mono text-tertiary uppercase mb-2 block tracking-widest">
            Tools Called
          </span>
          <div class="flex flex-wrap gap-2">
            {#each frame.toolsThisStep as tool}
              <span class="px-2 py-1 bg-tertiary/10 border border-tertiary/30 text-tertiary text-[11px] font-mono rounded">
                {tool}
              </span>
            {/each}
            {#if frame.durationMs > 0}
              <span class="text-[10px] font-mono text-outline self-center">{frame.durationMs}ms</span>
            {/if}
          </div>
        </div>
      {:else if frame.toolName && !frame.toolsThisStep}
        <!-- Legacy single-tool display -->
        <div class="relative pl-4">
          <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-tertiary/40 rounded-full"></div>
          <span class="text-[9px] font-mono text-tertiary uppercase mb-2 block tracking-widest">Tool</span>
          <span class="px-2 py-1 bg-tertiary/10 border border-tertiary/30 text-tertiary text-[11px] font-mono rounded">
            {frame.toolName}
          </span>
        </div>
      {/if}

      {#if frame.observation}
        <div class="relative pl-4">
          <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-secondary/40 rounded-full"></div>
          <span class="text-[9px] font-mono text-secondary uppercase mb-2 block tracking-widest">Observation</span>
          <div class="bg-secondary/5 p-3 rounded border border-secondary/10 relative">
            <code
              class="text-[11px] font-mono text-on-surface/50 block break-all transition-all duration-300 {expandedObservation
                ? ''
                : 'line-clamp-4'}"
            >
              {frame.observation}
            </code>
            {#if !expandedObservation && frame.observation.length > 120}
              <div
                class="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-[#12131a] to-transparent flex items-end justify-center pb-1"
              >
                <button
                  type="button"
                  class="text-[10px] font-mono text-secondary hover:underline bg-transparent border-0 cursor-pointer"
                  onclick={() => (expandedObservation = true)}
                >
                  [Expand ▾]
                </button>
              </div>
            {/if}
          </div>
        </div>
      {/if}

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

      <button
        type="button"
        class="w-full flex items-center justify-between p-3 bg-white/5 rounded border border-white/5 hover-lift transition-all cursor-pointer"
        onclick={() => (expandedRaw = !expandedRaw)}
      >
        <span class="text-[10px] font-mono text-on-surface/40 uppercase">
          {expandedRaw ? "▼" : "▶"} Raw frame
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

      {#if frames.length > 0}
        <div class="pt-2 border-t border-white/5">
          <span class="text-[9px] font-mono text-outline uppercase tracking-widest block mb-2">Full Trace</span>
          <div class="space-y-1 max-h-56 overflow-y-auto pr-1">
            {#each frames as f (f.ts + ":" + f.iteration + ":" + (f.kind ?? "step"))}
              <div class="text-[10px] font-mono text-on-surface/60 bg-white/5 rounded px-2 py-1 truncate">
                <span class="text-primary mr-2">#{f.iteration}</span>
                {f.kind === "final" ? "final: " : ""}{f.thought}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
