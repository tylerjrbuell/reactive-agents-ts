<script lang="ts">
  import type { RunVitals, RunStatus } from "$lib/stores/run-store.js";
  import Tooltip from "$lib/components/Tooltip.svelte";

  interface Props {
    vitals: RunVitals;
    status: RunStatus;
    runId: string;
  }
  let { vitals, status, runId }: Props = $props();

  const statusLabel = $derived(
    status === "live"
      ? "LIVE"
      : status === "paused"
        ? "PAUSED"
        : status === "completed"
          ? "DONE"
          : status === "failed"
            ? "FAILED"
            : status === "loading"
              ? "…"
              : "…",
  );

  const statusClass = $derived(
    status === "live"
      ? "text-green-400 border-green-500/20 bg-green-500/10"
      : status === "failed"
        ? "text-error border-error/20 bg-error/10"
        : "text-secondary border-secondary/20 bg-secondary/10",
  );

  const trajectoryClass = $derived(
    vitals.trajectory === "CONVERGING"
      ? "text-primary border-primary/30 bg-primary/10"
      : vitals.trajectory === "STRESSED"
        ? "text-error border-error/30 bg-error/10"
        : "text-tertiary border-tertiary/30 bg-tertiary/10",
  );

  const costStr = $derived(vitals.cost < 0.001 ? `<$0.001` : `$${vitals.cost.toFixed(4)}`);

  const durationStr = $derived(
    vitals.durationMs < 1000
      ? `${vitals.durationMs}ms`
      : `${(vitals.durationMs / 1000).toFixed(1)}s`,
  );

  // EKG uses the scrollbar gradient (violet→cyan) defined as SVG linearGradient.
  // Only STRESSED/FAILED override to red for semantic clarity.

  const runShort = $derived(runId.length > 12 ? `${runId.slice(0, 8)}…` : runId);

  const loopTooltipText = $derived(
    vitals.maxIterations > 0
      ? `Kernel loops (ReasoningIterationProgress). Same axis as trace rows and replay.\nConfigured max: ${vitals.maxIterations}.`
      : `Kernel loops (ReasoningIterationProgress). Same axis as trace rows and replay.`,
  );

  const stepsTooltipText =
    "Reasoning steps (ReasoningStepCompleted). Can exceed LOOP when a strategy emits multiple inner steps per kernel loop. Replay does not step through these individually.";
</script>

<div class="w-full bg-[#111317] border-b border-white/5 relative overflow-hidden flex-shrink-0">
  <div
    class="max-w-full px-6 py-3 flex items-center gap-0 font-mono text-[11px] uppercase tracking-widest text-on-surface-variant overflow-x-auto"
  >
    <div class="flex items-center gap-2 pr-5">
      <Tooltip text={runId} class="max-w-[100px] min-w-0">
        <span class="text-[9px] text-outline normal-case tracking-normal truncate block">{runShort}</span>
      </Tooltip>
      <div class="flex items-center gap-2 px-2 py-0.5 rounded-full border {statusClass}">
        {#if status === "live"}
          <span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
        {/if}
        <span class="text-[10px]">{statusLabel}</span>
      </div>
    </div>

    <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>

    <div class="flex items-center gap-2 pr-5">
      <span class="text-primary">η</span>
      <span class="text-on-surface tabular-nums">{vitals.entropy.toFixed(2)}</span>
    </div>
    <div class="px-2 py-0.5 rounded text-[10px] border mr-5 {trajectoryClass}">
      {vitals.trajectory}
    </div>

    <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>

    <div class="flex items-center gap-2 mr-5">
      <span class="text-primary tabular-nums">{vitals.tokensUsed.toLocaleString()}</span>
      <span class="text-on-surface-variant">TOKENS</span>
    </div>

    <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>

    <div class="flex items-center gap-2 mr-5">
      <span class="text-primary">{costStr}</span>
      <span class="text-on-surface-variant">COST</span>
    </div>

    <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>

    <div class="flex items-center gap-2 mr-5">
      <span class="text-primary tabular-nums">{durationStr}</span>
      <span class="text-on-surface-variant">DURATION</span>
    </div>

    {#if vitals.loopIteration > 0 || vitals.reasoningSteps > 0}
      <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>
      {#if vitals.loopIteration > 0}
        <Tooltip text={loopTooltipText} class="mr-3">
          <div class="flex cursor-help items-center gap-2">
            <span class="text-tertiary">LOOP</span>
            <span
              class="tabular-nums {vitals.loopIteration > vitals.maxIterations && vitals.maxIterations > 0
                ? 'text-tertiary'
                : 'text-on-surface'}"
            >
              {vitals.loopIteration}{vitals.maxIterations > 0 && vitals.loopIteration <= vitals.maxIterations
                ? `/${vitals.maxIterations}`
                : ""}
            </span>
          </div>
        </Tooltip>
      {/if}
      {#if vitals.reasoningSteps > 0}
        <Tooltip text={stepsTooltipText} class="mr-5">
          <div class="flex cursor-help items-center gap-2">
            <span class="text-tertiary">STEPS</span>
            <span class="tabular-nums text-on-surface">{vitals.reasoningSteps}</span>
          </div>
        </Tooltip>
      {/if}
    {/if}

    <!-- Config pills: provider · model · strategy -->
    {#if vitals.provider || vitals.model || vitals.strategy}
      <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>
      <div class="flex items-center gap-2">
        {#if vitals.provider}
          <Tooltip text={`LLM provider: ${vitals.provider}`}>
            <span
              class="px-1.5 py-0.5 bg-surface-container border border-outline-variant/20 rounded text-[9px] font-mono text-outline/70 uppercase tracking-wider"
            >
              {vitals.provider}
            </span>
          </Tooltip>
        {/if}
        {#if vitals.model}
          <Tooltip text={`Model: ${vitals.model}`} class="max-w-[140px] min-w-0">
            <span
              class="w-full truncate px-1.5 py-0.5 bg-primary/8 border border-primary/20 rounded text-[9px] font-mono text-primary/70 block"
            >
              {vitals.model}
            </span>
          </Tooltip>
        {/if}
        {#if vitals.strategy}
          <Tooltip text={`Reasoning strategy: ${vitals.strategy}`}>
            <span
              class="px-1.5 py-0.5 bg-secondary/8 border border-secondary/20 rounded text-[9px] font-mono text-secondary/60 uppercase tracking-wider"
            >
              {vitals.strategy}
            </span>
          </Tooltip>
        {/if}
      </div>
    {/if}

    {#if vitals.fallbackProvider}
      <div
        class="ml-2 flex items-center gap-1 px-2 py-0.5 bg-tertiary/10 border border-tertiary/30 rounded text-[10px] text-tertiary"
      >
        <span class="material-symbols-outlined text-xs">electric_bolt</span>
        → {vitals.fallbackProvider}
      </div>
    {/if}
  </div>

  <!-- EKG heartbeat row — separate from metrics, never overlaps text -->
  <div class="w-full h-7 relative overflow-hidden bg-transparent border-t border-white/[0.03]">
    <svg class="w-full h-full" preserveAspectRatio="none" viewBox="0 0 1000 28">
      <defs>
        <!-- Scrollbar-matching gradient: violet → cyan (left to right along the pulse) -->
        <linearGradient id="ekg-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="#8b5cf6" />
          <stop offset="100%" stop-color="#06b6d4" />
        </linearGradient>
        <!-- Glow filter -->
        <filter id="ekg-glow" x="-5%" y="-100%" width="110%" height="300%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {#if status === 'live' || status === 'loading'}
        <!-- Glow bloom layer -->
        <path
          d="M0 14 L100 14 L110 4 L120 24 L130 14 L300 14 L310 14 L320 2 L330 26 L340 14 L600 14 L610 7 L620 21 L630 14 L850 14 L860 0 L870 28 L880 14 L1000 14"
          fill="none"
          stroke="url(#ekg-grad)"
          stroke-width="5"
          opacity="0.2"
          filter="url(#ekg-glow)"
          class="ekg-line"
        />
        <!-- Sharp gradient line -->
        <path
          class="ekg-line"
          d="M0 14 L100 14 L110 4 L120 24 L130 14 L300 14 L310 14 L320 2 L330 26 L340 14 L600 14 L610 7 L620 21 L630 14 L850 14 L860 0 L870 28 L880 14 L1000 14"
          fill="none"
          stroke="url(#ekg-grad)"
          stroke-width="1.5"
          opacity="0.9"
        />
      {:else if status === 'paused'}
        <path
          d="M0 14 L100 14 L110 4 L120 24 L130 14 L500 14"
          fill="none"
          stroke="url(#ekg-grad)"
          stroke-width="4"
          opacity="0.12"
          filter="url(#ekg-glow)"
        />
        <path
          d="M0 14 L100 14 L110 4 L120 24 L130 14 L500 14"
          fill="none"
          stroke="url(#ekg-grad)"
          stroke-width="1.5"
          opacity="0.45"
          stroke-dasharray="4 3"
        />
      {:else}
        <!-- Settled flat line -->
        <line
          x1="0" y1="14" x2="1000" y2="14"
          stroke={status === 'failed' ? '#ef4444' : 'url(#ekg-grad)'}
          stroke-width="1"
          opacity="0.2"
        />
        <!-- Terminal dot — cyan end of gradient -->
        <circle cx="980" cy="14" r="3.5"
          fill={status === 'failed' ? '#ef4444' : '#06b6d4'}
          opacity="0.35" filter="url(#ekg-glow)" />
        <circle cx="980" cy="14" r="2"
          fill={status === 'failed' ? '#ef4444' : '#06b6d4'}
          opacity="0.7" />
      {/if}
    </svg>
  </div>
</div>
