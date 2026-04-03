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

  const runShort = $derived(runId.length > 12 ? `${runId.slice(0, 8)}…` : runId);

  const loopTooltipText = $derived(
    vitals.maxIterations > 0
      ? `Kernel loops (ReasoningIterationProgress). Same axis as trace rows and replay.\nConfigured max: ${vitals.maxIterations}.`
      : `Kernel loops (ReasoningIterationProgress). Same axis as trace rows and replay.`,
  );

  const stepsTooltipText =
    "Reasoning steps (ReasoningStepCompleted). Can exceed LOOP when a strategy emits multiple inner steps per kernel loop. Replay does not step through these individually.";

  /** Kernel-loop progress when maxIterations is known; null → indeterminate UI. */
  const loopProgressPct = $derived.by((): number | null => {
    const max = vitals.maxIterations;
    if (max <= 0) return null;
    const cur = Math.max(0, vitals.loopIteration);
    return Math.min(100, (cur / max) * 100);
  });

  const loopExceededMax = $derived(
    vitals.maxIterations > 0 && vitals.loopIteration > vitals.maxIterations,
  );

  const progressBarTooltip = $derived.by(() => {
    const max = vitals.maxIterations;
    const cur = vitals.loopIteration;
    if (max > 0) {
      const tail = loopExceededMax ? " (at or past configured max)" : "";
      return `Kernel loop progress: ${cur} / ${max} configured outer iterations.${tail}\nMatches trace rows and replay.`;
    }
    if (status === "live" || status === "loading") {
      return `Kernel loops: ${cur || "—"} (no maxIterations from the framework yet — relative bar unavailable).`;
    }
    if (status === "completed") {
      return `Run finished after ${cur} kernel loop${cur === 1 ? "" : "s"}.`;
    }
    if (status === "failed") {
      return `Run ended after ${cur} kernel loop${cur === 1 ? "" : "s"}.`;
    }
    return "Kernel loop progress";
  });

  const showIndeterminateProgress = $derived(
    loopProgressPct === null && (status === "live" || status === "loading"),
  );

  const progressFillPct = $derived.by(() => {
    if (status === "completed" && loopProgressPct === null) return 100;
    if (loopProgressPct === null) return 0;
    if (status === "completed" || status === "failed") {
      return loopExceededMax ? 100 : Math.max(loopProgressPct, 100);
    }
    return loopExceededMax ? 100 : loopProgressPct;
  });

  /** Completed/failed with a known cap: show exact final ratio, not forced 100% width, unless exceeded. */
  const terminalDeterminateWidth = $derived(
    (status === "completed" || status === "failed") &&
      loopProgressPct !== null &&
      !loopExceededMax,
  );
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

  <!-- Kernel loop progress — LOOP / maxIterations (indeterminate when cap unknown) -->
  <Tooltip text={progressBarTooltip} class="w-full block min-w-0">
    <div
      class="w-full flex items-center gap-3 px-4 sm:px-6 py-2 box-border border-t border-white/[0.03] cursor-help"
      role="group"
      aria-label="Kernel loop progress"
    >
      <span class="material-symbols-outlined text-[16px] text-outline/50 flex-shrink-0" aria-hidden="true"
        >linear_scale</span
      >
      <div
        class="flex-1 min-w-[100px] h-2 rounded-full bg-white/[0.06] overflow-hidden relative
               {status === 'paused' ? 'ring-1 ring-dashed ring-outline-variant/25' : ''}"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={showIndeterminateProgress
          ? undefined
          : Math.round(terminalDeterminateWidth ? loopProgressPct! : progressFillPct)}
        aria-valuetext={showIndeterminateProgress ? "Indeterminate" : `${Math.round(terminalDeterminateWidth ? loopProgressPct! : progressFillPct)} percent`}
      >
        {#if showIndeterminateProgress || (status === "paused" && loopProgressPct === null)}
          <div
            class="absolute inset-y-0 left-0 w-[38%] rounded-full bg-gradient-to-r from-transparent via-primary/55 to-transparent vitals-progress-indeterminate
                   {status === 'paused' ? 'opacity-50 motion-reduce:animate-none' : 'motion-reduce:animate-none'}"
          ></div>
        {:else if loopProgressPct !== null}
          <div
            class="h-full rounded-full transition-[width] duration-500 ease-out
                   {status === 'failed'
              ? 'bg-gradient-to-r from-error/90 to-error'
              : loopExceededMax
                ? 'bg-gradient-to-r from-tertiary to-tertiary/70'
                : 'bg-gradient-to-r from-primary to-secondary'}"
            style="width: {terminalDeterminateWidth ? `${loopProgressPct}%` : `${progressFillPct}%`}"
          ></div>
        {:else}
          <!-- Completed / terminal with no maxIterations cap -->
          <div
            class="h-full w-full rounded-full opacity-40 bg-gradient-to-r from-primary/50 to-secondary/50
                   {status === 'failed' ? 'from-error/40 to-error/30 opacity-60' : ''}"
          ></div>
        {/if}
      </div>
      <span class="font-mono text-[9px] text-outline/70 tabular-nums flex-shrink-0 w-[4.5rem] text-right">
        {#if vitals.maxIterations > 0}
          {vitals.loopIteration}<span class="text-outline/40">/{vitals.maxIterations}</span>
        {:else if vitals.loopIteration > 0}
          {vitals.loopIteration}<span class="text-outline/35">/—</span>
        {:else}
          <span class="text-outline/35">—</span>
        {/if}
      </span>
    </div>
  </Tooltip>
</div>
