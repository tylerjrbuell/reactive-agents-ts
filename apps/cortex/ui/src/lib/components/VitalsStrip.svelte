<script lang="ts">
  import type { RunVitals, RunStatus } from "$lib/stores/run-store.js";
  import Tooltip from "$lib/components/Tooltip.svelte";

  export interface Props {
    vitals: RunVitals;
    status: RunStatus;
    runId: string;
    /** When set with replayMaxLoops &gt; 0, bar and LOOP readout follow replay scrub (not live vitals). */
    replayLoopIndex?: number | null;
    replayMaxLoops?: number;
    replayPlaying?: boolean;
  }
  let {
    vitals,
    status,
    runId,
    replayLoopIndex = null,
    replayMaxLoops = 0,
    replayPlaying = false,
  }: Props = $props();

  const replayActive = $derived(replayLoopIndex !== null && replayMaxLoops > 0);

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
      ? "text-cyan-800 dark:text-cyan-200 border-cyan-500/40 dark:border-cyan-400/50 bg-cyan-500/12 dark:bg-cyan-500/15 shadow-sm dark:shadow-[0_0_12px_rgba(34,211,238,0.28)]"
      : status === "failed"
        ? "text-red-800 dark:text-red-200 border-red-400/45 dark:border-red-500/45 bg-red-500/12 dark:bg-red-600/18 shadow-sm dark:shadow-[0_0_12px_rgba(239,68,68,0.3)]"
        : status === "completed"
          ? "text-emerald-900 border-emerald-600/50 bg-emerald-100/90 shadow-sm dark:text-emerald-600/90 dark:border-emerald-900/50 dark:bg-emerald-950/45 dark:shadow-none"
          : "text-violet-800 dark:text-violet-200 border-violet-400/40 dark:border-secondary/45 bg-violet-100/80 dark:bg-secondary/14 shadow-sm dark:shadow-[0_0_10px_rgba(6,182,212,0.2)]",
  );

  const trajectoryClass = $derived(
    vitals.trajectory === "CONVERGING"
      ? "text-violet-800 dark:text-violet-200 border-violet-500/40 dark:border-primary/50 bg-violet-100/90 dark:bg-primary/18 shadow-sm dark:shadow-[0_0_10px_rgba(139,92,246,0.28)]"
      : vitals.trajectory === "STRESSED"
        ? "text-red-800 dark:text-red-200 border-red-400/45 dark:border-error/50 bg-red-50 dark:bg-error/16 shadow-sm dark:shadow-[0_0_10px_rgba(239,68,68,0.25)]"
        : "text-amber-900 border-amber-400/50 bg-amber-100/85 shadow-sm dark:text-amber-600/95 dark:border-amber-800/50 dark:bg-amber-950/45 dark:shadow-none",
  );

  /** Muted amber for LOOP / max / tool-adjacent labels — avoids neon #eab308 on dark desk. */
  const runAccentAmber = "text-amber-800 dark:text-amber-600";
  const runAccentAmberStrong = "text-amber-900 dark:text-amber-500/90";

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

  const loopTooltipReplay = $derived(
    replayLoopIndex !== null && replayMaxLoops > 0
      ? `Replay scrub: ${replayLoopIndex}/${replayMaxLoops} stored ReasoningIterationProgress boundaries.\nTrace, signal, and summaries below reflect this slice only.`
      : "",
  );

  const stepsTooltipText =
    "Reasoning steps (ReasoningStepCompleted). Can exceed LOOP when a strategy emits multiple inner steps per kernel loop. Replay does not step through these individually.";

  /** Kernel-loop progress when maxIterations is known; null → indeterminate UI. In replay, uses stored RIP count. */
  const loopProgressPct = $derived.by((): number | null => {
    if (replayActive && replayLoopIndex !== null) {
      return Math.min(100, (replayLoopIndex / replayMaxLoops) * 100);
    }
    const max = vitals.maxIterations;
    if (max <= 0) return null;
    const cur = Math.max(0, vitals.loopIteration);
    return Math.min(100, (cur / max) * 100);
  });

  const loopExceededMax = $derived(
    !replayActive &&
      vitals.maxIterations > 0 &&
      vitals.loopIteration > vitals.maxIterations,
  );

  const progressBarTooltip = $derived.by(() => {
    if (replayActive && replayLoopIndex !== null) {
      const tail = replayPlaying
        ? "\n\nReplay is auto-advancing through stored loops."
        : "\n\nScrub with the REPLAY toolbar or step controls.";
      return `Replay: ${replayLoopIndex} / ${replayMaxLoops} stored kernel-loop boundaries (ReasoningIterationProgress). The bar matches the trace slice below.${tail}`;
    }
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
    !replayActive && loopProgressPct === null && (status === "live" || status === "loading"),
  );

  const progressFillPct = $derived.by(() => {
    if (replayActive && replayLoopIndex !== null) {
      return Math.min(100, (replayLoopIndex / replayMaxLoops) * 100);
    }
    if (status === "completed" && loopProgressPct === null) return 100;
    if (loopProgressPct === null) return 0;
    if (status === "completed" || status === "failed") {
      return loopExceededMax ? 100 : Math.max(loopProgressPct, 100);
    }
    return loopExceededMax ? 100 : loopProgressPct;
  });

  /** Completed/failed with a known cap: show exact final ratio, not forced 100% width, unless exceeded. Replay always uses exact scrub ratio. */
  const terminalDeterminateWidth = $derived(
    replayActive ||
      ((status === "completed" || status === "failed") &&
        loopProgressPct !== null &&
        !loopExceededMax),
  );
</script>

<div
  class="w-full bg-surface-container-lowest/90 dark:bg-surface-container-lowest/75 border-b border-[var(--cortex-border)] relative overflow-hidden flex-shrink-0"
>
  <div
    class="max-w-full px-6 py-3 flex items-center gap-0 font-mono text-[11px] uppercase tracking-widest text-on-surface-variant overflow-x-auto"
  >
    <div class="flex items-center gap-2 pr-5">
      <Tooltip text={runId} class="max-w-[100px] min-w-0">
        <span class="text-[9px] text-outline normal-case tracking-normal truncate block">{runShort}</span>
      </Tooltip>
      <div class="flex items-center gap-2 px-2 py-0.5 rounded-full border {statusClass}">
        {#if status === "live"}
          <span
            class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_rgba(34,211,238,0.85)]"
          ></span>
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

    {#if replayActive || vitals.loopIteration > 0 || vitals.reasoningSteps > 0}
      <div class="h-4 w-px bg-primary/20 mx-4 flex-shrink-0"></div>
      {#if replayActive || vitals.loopIteration > 0}
        <Tooltip text={replayActive ? loopTooltipReplay : loopTooltipText} class="mr-3">
          <div class="flex cursor-help items-center gap-2">
            <span class={runAccentAmber}>{replayActive ? "REPLAY" : "LOOP"}</span>
            {#if replayActive && replayLoopIndex !== null}
              <span class="tabular-nums text-on-surface">
                {replayLoopIndex}<span class="text-amber-800 dark:text-amber-600/95">/{replayMaxLoops}</span>
              </span>
            {:else}
              <span
                class="tabular-nums {vitals.loopIteration > vitals.maxIterations && vitals.maxIterations > 0
                  ? runAccentAmberStrong
                  : 'text-on-surface'}"
              >
                {vitals.loopIteration}{vitals.maxIterations > 0 && vitals.loopIteration <= vitals.maxIterations
                  ? `/${vitals.maxIterations}`
                  : ""}
              </span>
            {/if}
          </div>
        </Tooltip>
      {/if}
      {#if vitals.reasoningSteps > 0}
        <Tooltip text={stepsTooltipText} class="mr-5">
          <div class="flex cursor-help items-center gap-2">
            <span class={runAccentAmber}>STEPS</span>
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
        class="ml-2 flex items-center gap-1 rounded border border-amber-300/50 bg-amber-100/70 px-2 py-0.5 text-[10px] text-amber-900 dark:border-amber-800/45 dark:bg-amber-950/40 dark:text-amber-600/95"
      >
        <span class="material-symbols-outlined text-xs">electric_bolt</span>
        → {vitals.fallbackProvider}
      </div>
    {/if}
  </div>

  <!-- Kernel loop progress — live: LOOP/maxIterations; replay: stored RIP scrub (matches trace slice) -->
  <Tooltip text={progressBarTooltip} class="w-full block min-w-0">
    <div
      class="w-full flex items-center gap-3 px-4 sm:px-6 py-2.5 box-border border-t cursor-help
             {replayActive
        ? 'border-amber-500/25 dark:border-amber-700/35 bg-gradient-to-r from-amber-500/[0.07] via-amber-50/35 to-amber-100/25 dark:from-amber-950/50 dark:via-amber-950/25 dark:to-amber-950/15'
        : 'border-primary/15 dark:border-primary/12 bg-gradient-to-r from-primary/[0.08] via-violet-50/40 to-cyan-50/50 dark:from-primary/[0.04] dark:via-transparent dark:to-secondary/[0.05]'}"
      role="group"
      aria-label={replayActive ? "Replay kernel loop progress" : "Kernel loop progress"}
    >
      <span
        class="material-symbols-outlined text-[18px] flex-shrink-0 {replayActive
          ? 'text-amber-800 dark:text-amber-600/95 dark:drop-shadow-[0_0_6px_rgba(217,119,6,0.35)]'
          : 'text-cyan-700 dark:text-secondary dark:drop-shadow-[0_0_6px_rgba(6,182,212,0.45)]'}"
        aria-hidden="true"
        >{replayActive ? "replay" : "linear_scale"}</span>
      <div
        class="cortex-progress-track flex-1 min-w-[100px] overflow-hidden relative
               {replayActive
          ? 'ring-1 ring-amber-500/30 dark:ring-amber-700/40'
          : status === 'paused'
            ? 'ring-1 ring-dashed ring-secondary/40'
            : ''}"
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
            class="cortex-progress-indeterminate-bar vitals-progress-indeterminate {status === 'paused'
              ? 'opacity-45 motion-reduce:animate-none'
              : 'motion-reduce:animate-none'}"
          ></div>
        {:else if loopProgressPct !== null}
          <div
            class="h-full rounded-full {replayActive
              ? replayPlaying
                ? 'cortex-progress-fill--replay cortex-progress-fill--shimmer'
                : 'cortex-progress-fill--replay'
              : status === 'failed'
                ? 'bg-gradient-to-r from-red-800 via-red-600 to-red-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.2),inset_0_-1px_0_rgba(0,0,0,0.12),0_0_14px_rgba(239,68,68,0.45),0_0_24px_rgba(220,38,38,0.15)]'
                : loopExceededMax
                  ? 'bg-gradient-to-r from-amber-600 via-amber-500 to-amber-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_0_12px_rgba(180,83,9,0.22)] dark:from-amber-800 dark:via-amber-700 dark:to-amber-800 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_0_14px_rgba(120,53,15,0.35)]'
                  : status === 'live'
                    ? 'cortex-progress-fill cortex-progress-fill--shimmer'
                    : 'cortex-progress-fill cortex-progress-fill--terminal'}"
            style="width: {terminalDeterminateWidth ? `${loopProgressPct}%` : `${progressFillPct}%`}"
          ></div>
        {:else}
          <div
            class="h-full w-full rounded-full {status === 'failed'
              ? 'bg-gradient-to-r from-red-800/90 to-error opacity-95 shadow-[0_0_12px_rgba(239,68,68,0.4)]'
              : 'cortex-progress-fill opacity-80 cortex-progress-fill--terminal'}"
          ></div>
        {/if}
      </div>
      <span
        class="font-mono text-[10px] tabular-nums flex-shrink-0 w-[4.75rem] text-right {replayActive
          ? 'text-amber-950 dark:text-amber-500/95 dark:drop-shadow-[0_0_8px_rgba(217,119,6,0.2)]'
          : 'text-slate-700 dark:text-secondary/90 dark:drop-shadow-[0_0_8px_rgba(6,182,212,0.25)]'}"
      >
        {#if replayActive && replayLoopIndex !== null}
          {replayLoopIndex}<span class="text-amber-800/90 dark:text-amber-600/90">/{replayMaxLoops}</span>
        {:else if vitals.maxIterations > 0}
          {vitals.loopIteration}<span class="text-primary/70">/{vitals.maxIterations}</span>
        {:else if vitals.loopIteration > 0}
          {vitals.loopIteration}<span class="text-primary/50">/—</span>
        {:else}
          <span class="text-outline/50">—</span>
        {/if}
      </span>
    </div>
  </Tooltip>
</div>
