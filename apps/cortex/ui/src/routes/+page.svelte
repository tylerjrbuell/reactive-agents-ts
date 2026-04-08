<script lang="ts">
  import { getContext, onMount, onDestroy } from "svelte";
  import BeaconCanvas from "$lib/components/BeaconCanvas.svelte";
  import BottomInputBar from "$lib/components/BottomInputBar.svelte";
  import CortexDeskShell from "$lib/components/CortexDeskShell.svelte";
  import type { AgentCognitiveState } from "$lib/stores/agent-store.js";
  import type { AgentStore } from "$lib/stores/agent-store.js";
  import type { StageStore } from "$lib/stores/stage-store.js";

  const agentStore = getContext<AgentStore>("agentStore");
  /** Explicit cast — SvelteKit `getContext` typing can widen store methods. */
  const stageStore = getContext("stageStore") as StageStore;

  let inputBarRef = $state<{ focus: () => void } | undefined>(undefined);
  type StatusFilter = "all" | AgentCognitiveState;
  const STATUS_FILTER_STORAGE_KEY = "cortex.beacon.statusFilter";
  let statusFilter = $state<StatusFilter>("all");
  let statusFilterHydrated = $state(false);
  let organizeToken = $state(0);

  const statusFilterOptions: ReadonlyArray<{ value: StatusFilter; label: string }> = [
    { value: "all", label: "All" },
    { value: "running", label: "Running" },
    { value: "exploring", label: "Exploring" },
    { value: "stressed", label: "Stressed" },
    { value: "completed", label: "Completed" },
    { value: "error", label: "Error" },
    { value: "idle", label: "Idle" },
  ];

  const filteredAgents = $derived(
    statusFilter === "all" ? $agentStore : $agentStore.filter((agent) => agent.state === statusFilter),
  );

  function isStatusFilter(value: string): value is StatusFilter {
    return statusFilterOptions.some((option) => option.value === value);
  }

  $effect(() => {
    if (typeof window === "undefined") return;
    if (!statusFilterHydrated) return;
    window.localStorage.setItem(STATUS_FILTER_STORAGE_KEY, statusFilter);
  });

  // Handle R shortcut from layout
  function handleFocusInput() { inputBarRef?.focus(); }
  onMount(() => {
    window.addEventListener("cortex:focus-input", handleFocusInput);

    const saved = window.localStorage.getItem(STATUS_FILTER_STORAGE_KEY);
    if (saved && isStatusFilter(saved)) {
      statusFilter = saved;
    }

    statusFilterHydrated = true;
  });
  onDestroy(() => window.removeEventListener("cortex:focus-input", handleFocusInput));

  function autoOrganizeBeacon() {
    organizeToken += 1;
  }

</script>

<svelte:head>
  <title>CORTEX — Beacon</title>
</svelte:head>

<CortexDeskShell>
  {#if $agentStore.length > 0}
    <div class="flex-1 relative overflow-hidden z-10 min-h-0">
      <div class="absolute right-4 md:right-48 top-4 z-20 inline-flex items-center gap-2 rounded-lg px-2 py-1.5 backdrop-blur-sm bg-white/80 dark:bg-surface-container-low/45 shadow-[0_0_0_1px_rgba(124,58,237,0.2),0_0_0_1px_rgba(255,255,255,0.7)_inset] dark:shadow-[0_0_0_1px_rgba(139,92,246,0.28),0_0_0_1px_rgba(6,182,212,0.08)_inset]">
        <button
          type="button"
          class="rounded-md border border-[var(--cortex-border)] bg-surface px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-on-surface transition-colors hover:border-secondary hover:text-secondary"
          onclick={autoOrganizeBeacon}
        >
          Auto-organize
        </button>
        <label for="beacon-status-filter" class="font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/80">
          Status
        </label>
        <select
          id="beacon-status-filter"
          aria-label="Filter agents by status"
          bind:value={statusFilter}
          class="rounded-md border border-[var(--cortex-border)] bg-surface px-2 py-1 font-mono text-[11px] text-on-surface outline-none transition-colors focus:border-secondary"
        >
          {#each statusFilterOptions as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
        <span class="font-mono text-[10px] text-on-surface-variant/70">
          {filteredAgents.length} / {$agentStore.length}
        </span>
      </div>

      {#if filteredAgents.length > 0}
        <BeaconCanvas agents={filteredAgents} autoOrganizeToken={organizeToken} />
      {:else}
        <div class="absolute inset-0 flex items-center justify-center px-6">
          <p class="rounded-lg border border-[var(--cortex-border)] bg-surface/90 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-on-surface-variant/80 shadow-sm">
            No agents match this status filter
          </p>
        </div>
      {/if}
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
      <p class="font-mono text-[11px] text-outline uppercase tracking-[0.18em] mb-2 flex items-center justify-center gap-2">
        <span
          class="w-1.5 h-1.5 rounded-full bg-violet-500 animate-pulse shadow-[0_0_6px_rgba(124,58,237,0.45)] dark:bg-violet-400 dark:shadow-[0_0_10px_rgba(167,139,250,0.7)]"
        ></span>
        Awaiting connections
        <span
          class="w-1.5 h-1.5 rounded-full bg-cyan-600 animate-pulse shadow-[0_0_6px_rgba(6,182,212,0.45)] dark:bg-cyan-400 dark:shadow-[0_0_10px_rgba(34,211,238,0.6)]"
          style="animation-delay: 0.5s"
        ></span>
      </p>
      <p class="text-center text-[11px] text-on-surface-variant/75 font-medium max-w-md px-6 mb-8 leading-relaxed">
        Local desk — stream runs with <code class="font-mono text-[10px] text-secondary/90">rax … --cortex</code> or
        <code class="font-mono text-[10px] text-primary/90">.withCortex()</code>. Press
        <kbd class="cortex-kbd align-middle mx-0.5">R</kbd> to focus the prompt.
      </p>

      <!-- Connection methods -->
      <div class="space-y-3 text-center max-w-sm">
        <div
          class="px-5 py-2.5 rounded-lg bg-violet-100/95 dark:bg-violet-950/35 shadow-[0_0_0_1px_rgba(124,58,237,0.28),0_4px_16px_rgba(124,58,237,0.08)] dark:shadow-[0_0_0_1px_rgba(139,92,246,0.45),0_0_20px_rgba(139,92,246,0.15)]"
        >
          <code class="font-mono text-[11px] text-violet-900 dark:text-violet-200">
            rax run "your prompt" --cortex
          </code>
        </div>
        <div class="text-[9px] font-mono text-secondary/50 uppercase tracking-widest">or</div>
        <div
          class="px-5 py-2.5 rounded-lg bg-cyan-100/95 dark:bg-cyan-950/30 shadow-[0_0_0_1px_rgba(6,182,212,0.28),0_4px_14px_rgba(6,182,212,0.08)] dark:shadow-[0_0_0_1px_rgba(6,182,212,0.4),0_0_18px_rgba(6,182,212,0.12)]"
        >
          <code class="font-mono text-[10px] text-cyan-900 dark:text-cyan-200/95">
            .withCortex()
          </code>
          <span class="font-mono text-[9px] text-cyan-700/70 dark:text-cyan-400/50 ml-2">— one builder line</span>
        </div>
        <div class="text-[9px] font-mono text-outline/40 uppercase tracking-widest">or type below</div>
      </div>
    </div>
  {/if}

  <BottomInputBar
    bind:this={inputBarRef}
    loading={$stageStore.submitting}
    onSubmit={(prompt, cfg) => {
      void stageStore.submitPrompt(prompt, cfg);
    }}
  />
</CortexDeskShell>
