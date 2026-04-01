<script lang="ts">
  import { getContext, onMount, onDestroy } from "svelte";
  import AgentGrid from "$lib/components/AgentGrid.svelte";
  import BottomInputBar from "$lib/components/BottomInputBar.svelte";
  import type { AgentStore } from "$lib/stores/agent-store.js";
  import type { StageStore } from "$lib/stores/stage-store.js";

  const agentStore = getContext<AgentStore>("agentStore");
  const stageStore = getContext<StageStore>("stageStore");

  let inputBarRef = $state<{ focus: () => void } | undefined>(undefined);

  // Handle R shortcut from layout
  function handleFocusInput() { inputBarRef?.focus(); }
  onMount(() => window.addEventListener("cortex:focus-input", handleFocusInput));
  onDestroy(() => window.removeEventListener("cortex:focus-input", handleFocusInput));

  const activeCount = $derived(
    $agentStore.filter((a) => ["running", "exploring", "stressed"].includes(a.state)).length,
  );
</script>

<svelte:head>
  <title>CORTEX — Mission Control</title>
</svelte:head>

<div class="relative h-full flex flex-col overflow-hidden">
  <!-- Ambient background glows -->
  <div class="absolute top-1/4 left-1/3 w-[600px] h-[600px] bg-primary/4 blur-[140px] rounded-full pointer-events-none"></div>
  <div class="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-secondary/4 blur-[100px] rounded-full pointer-events-none"></div>

  {#if $agentStore.length > 0}
    <!-- ── Active state: minimal status bar + agent grid ────────────── -->
    <div class="flex items-center justify-between px-6 pt-4 pb-2 relative z-10 flex-shrink-0">
      <div class="flex items-center gap-3">
        {#if activeCount > 0}
          <span class="flex items-center gap-1.5 text-[10px] font-mono text-secondary/80">
            <span class="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></span>
            {activeCount} active
          </span>
          <span class="text-outline/30 text-[10px]">·</span>
        {/if}
        <span class="text-[10px] font-mono text-outline/50">
          {$agentStore.length} node{$agentStore.length !== 1 ? "s" : ""}
        </span>
      </div>
    </div>

    <div class="flex-1 relative overflow-y-auto px-6 pb-32 z-10 min-h-0">
      <AgentGrid agents={$agentStore} />
    </div>
  {:else}
    <!-- ── Empty state: pulsing neural core + instructions ──────────── -->
    <div class="flex-1 flex flex-col items-center justify-center relative z-10 pb-20 min-h-0">
      <!-- Pulsing neural network icon -->
      <div class="relative mb-10">
        <!-- Outer sonar rings -->
        <div class="absolute inset-0 flex items-center justify-center">
          <div class="sonar-ring w-32 h-32" style="--ring-color: #8b5cf6;"></div>
          <div class="sonar-ring w-32 h-32" style="--ring-color: #8b5cf6;"></div>
          <div class="sonar-ring w-32 h-32" style="--ring-color: #8b5cf6;"></div>
        </div>
        <!-- Neural network SVG — same as header logo, larger -->
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="80" height="80" class="relative z-10">
          <defs>
            <linearGradient id="stage-ed" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.8"/>
              <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.4"/>
            </linearGradient>
            <linearGradient id="stage-ed2" x1="100%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.6"/>
              <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0.25"/>
            </linearGradient>
            <filter id="stage-gC" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
            <filter id="stage-gN" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="1.6" result="b"/>
              <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
            </filter>
          </defs>
          <circle cx="24" cy="24" r="18" fill="#8b5cf6" opacity="0.06"/>
          <line x1="14" y1="6" x2="34" y2="6" stroke="url(#stage-ed)" stroke-width="1.2" stroke-linecap="round"/>
          <line x1="14" y1="6" x2="6" y2="20" stroke="url(#stage-ed)" stroke-width="1.2" stroke-linecap="round"/>
          <line x1="34" y1="6" x2="42" y2="20" stroke="url(#stage-ed)" stroke-width="1.2" stroke-linecap="round"/>
          <line x1="6" y1="20" x2="6" y2="34" stroke="url(#stage-ed)" stroke-width="1.2" stroke-linecap="round"/>
          <line x1="42" y1="20" x2="42" y2="34" stroke="url(#stage-ed)" stroke-width="1.2" stroke-linecap="round"/>
          <line x1="6" y1="34" x2="18" y2="44" stroke="url(#stage-ed)" stroke-width="1.2" stroke-linecap="round"/>
          <line x1="42" y1="34" x2="30" y2="44" stroke="url(#stage-ed)" stroke-width="1.2" stroke-linecap="round"/>
          <line x1="18" y1="44" x2="30" y2="44" stroke="url(#stage-ed)" stroke-width="1.2" stroke-linecap="round"/>
          <line x1="14" y1="6" x2="24" y2="24" stroke="url(#stage-ed2)" stroke-width="1.4" stroke-linecap="round"/>
          <line x1="34" y1="6" x2="24" y2="24" stroke="url(#stage-ed2)" stroke-width="1.4" stroke-linecap="round"/>
          <line x1="6" y1="20" x2="24" y2="24" stroke="url(#stage-ed2)" stroke-width="1.4" stroke-linecap="round"/>
          <line x1="42" y1="20" x2="24" y2="24" stroke="url(#stage-ed2)" stroke-width="1.4" stroke-linecap="round"/>
          <line x1="6" y1="34" x2="24" y2="24" stroke="url(#stage-ed2)" stroke-width="1.4" stroke-linecap="round"/>
          <line x1="42" y1="34" x2="24" y2="24" stroke="url(#stage-ed2)" stroke-width="1.4" stroke-linecap="round"/>
          <line x1="18" y1="44" x2="24" y2="24" stroke="url(#stage-ed2)" stroke-width="1.4" stroke-linecap="round"/>
          <line x1="30" y1="44" x2="24" y2="24" stroke="url(#stage-ed2)" stroke-width="1.4" stroke-linecap="round"/>
          <circle cx="14" cy="6" r="3" fill="#8b5cf6" filter="url(#stage-gN)">
            <animate attributeName="opacity" values="0.7;1;0.7" dur="4s" begin="0s" repeatCount="indefinite"/>
          </circle>
          <circle cx="34" cy="6" r="3" fill="#06b6d4" filter="url(#stage-gN)">
            <animate attributeName="opacity" values="0.6;1;0.6" dur="5s" begin="1.2s" repeatCount="indefinite"/>
          </circle>
          <circle cx="6" cy="20" r="2.5" fill="#a78bfa" filter="url(#stage-gN)">
            <animate attributeName="opacity" values="0.7;1;0.7" dur="6s" begin="2s" repeatCount="indefinite"/>
          </circle>
          <circle cx="42" cy="20" r="2.5" fill="#c4b5fd" filter="url(#stage-gN)">
            <animate attributeName="opacity" values="0.6;1;0.6" dur="4.5s" begin="0.5s" repeatCount="indefinite"/>
          </circle>
          <circle cx="6" cy="34" r="2.5" fill="#06b6d4" filter="url(#stage-gN)">
            <animate attributeName="opacity" values="0.7;1;0.7" dur="7s" begin="3s" repeatCount="indefinite"/>
          </circle>
          <circle cx="42" cy="34" r="2.5" fill="#8b5cf6" filter="url(#stage-gN)">
            <animate attributeName="opacity" values="0.6;1;0.6" dur="5.5s" begin="1.8s" repeatCount="indefinite"/>
          </circle>
          <circle cx="18" cy="44" r="3" fill="#a78bfa" filter="url(#stage-gN)">
            <animate attributeName="opacity" values="0.7;1;0.7" dur="6.5s" begin="0.8s" repeatCount="indefinite"/>
          </circle>
          <circle cx="30" cy="44" r="3" fill="#06b6d4" filter="url(#stage-gN)">
            <animate attributeName="opacity" values="0.6;1;0.6" dur="4s" begin="2.5s" repeatCount="indefinite"/>
          </circle>
          <circle cx="24" cy="24" r="6" fill="#8b5cf6" filter="url(#stage-gC)">
            <animate attributeName="fill" values="#8b5cf6;#a78bfa;#06b6d4;#a78bfa;#8b5cf6" dur="8s" begin="0s" repeatCount="indefinite"/>
          </circle>
          <circle cx="24" cy="24" r="9" fill="none" stroke="#06b6d4" stroke-width="0.6">
            <animate attributeName="opacity" values="0.1;0.3;0.1" dur="6s" begin="0s" repeatCount="indefinite"/>
          </circle>
        </svg>
      </div>

      <!-- Status text -->
      <p class="font-mono text-[11px] text-outline uppercase tracking-[0.2em] mb-8 flex items-center gap-2">
        <span class="w-1.5 h-1.5 rounded-full bg-primary/40 animate-pulse"></span>
        Awaiting connections
        <span class="w-1.5 h-1.5 rounded-full bg-primary/40 animate-pulse" style="animation-delay: 0.5s"></span>
      </p>

      <!-- Connection methods -->
      <div class="space-y-3 text-center max-w-sm">
        <div class="px-5 py-2.5 bg-primary/6 border border-primary/15 rounded-lg">
          <code class="font-mono text-[11px] text-primary/80">
            rax run "your prompt" --cortex
          </code>
        </div>
        <div class="text-[9px] font-mono text-outline/40 uppercase tracking-widest">or</div>
        <div class="px-5 py-2.5 bg-surface-container-low border border-outline-variant/10 rounded-lg">
          <code class="font-mono text-[10px] text-outline/60">
            .withCortex()
          </code>
          <span class="font-mono text-[9px] text-outline/40 ml-2">— one builder line</span>
        </div>
        <div class="text-[9px] font-mono text-outline/40 uppercase tracking-widest">or type below</div>
      </div>
    </div>
  {/if}

  <BottomInputBar
    bind:this={inputBarRef}
    loading={$stageStore.submitting}
    onSubmit={(prompt) => void stageStore.submitPrompt(prompt)}
  />
</div>
