<script lang="ts">
  /**
   * The run vitals line (Bench spec section 8, `run.html`): duration, tokens,
   * cost, steps, the loop meter, entropy as `η 0.25` with the 64px entropy
   * line and its trajectory, then the provider / model, strategy and tool
   * disclosure chips. The line wraps; nothing is clipped. In replay the loop
   * meter follows the scrub. Numbers go through the ui-core formatters.
   */
  import { formatCostTotal, formatTurnDuration, partialCostNote, throughputOfCalls } from "@reactive-agents/ui-core";
  import { throughputView } from "$lib/llm-throughput.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import EntropyLine from "$lib/components/kit/EntropyLine.svelte";
  import Meter from "$lib/components/kit/Meter.svelte";
  import ModelLink from "$lib/components/ModelLink.svelte";
  import type { RunStatus, RunVitals } from "$lib/stores/run-store.js";
  import { loopsVitalLabel, trajectoryView } from "$lib/run-view.js";

  interface Props {
    vitals: RunVitals;
    status: RunStatus;
    /** Entropy per scored step (`entropySeriesOf`). */
    entropy: readonly number[];
    /** Replay scrub (1-based loop) or `null` when live. */
    replayLoop: number | null;
    replayMax: number;
    /** Strategy id to display name (framework manifest). */
    strategyLabel: (id: string) => string;
  }
  const { vitals, status, entropy, replayLoop, replayMax, strategyLabel }: Props = $props();

  const replaying = $derived(replayLoop !== null && replayMax > 0);
  const loopsKnown = $derived(vitals.maxIterations > 0 && vitals.loopIteration <= vitals.maxIterations);
  // replayMax is the trace's recorded loop count (one row per stored ReasoningIterationProgress).
  const loopLabel = $derived(
    loopsVitalLabel(vitals.loopIteration, vitals.maxIterations, replayMax, replaying && replayLoop !== null ? { loop: replayLoop, max: replayMax } : undefined),
  );
  const meter = $derived(
    replaying ? { value: replayLoop ?? 0, max: replayMax } : loopsKnown ? { value: vitals.loopIteration, max: vitals.maxIterations } : { value: status === "live" ? 0 : 1, max: 1 },
  );
  const tokensTitle = $derived(
    vitals.tokensIn !== undefined || vitals.tokensOut !== undefined
      ? `${(vitals.tokensIn ?? 0).toLocaleString()} in · ${(vitals.tokensOut ?? 0).toLocaleString()} out${vitals.billedTokens !== undefined ? ` · ${vitals.billedTokens.toLocaleString()} billed` : ""}`
      : "Tokens used this run",
  );
  const trend = $derived(trajectoryView(vitals.trajectory));
  // Run average over every LLM call (ui-core throughputOfCalls); `~` when a call had no first-token time.
  const speed = $derived(throughputView(throughputOfCalls(vitals.llmCalls ?? [])));
</script>

<div class="vitals" aria-label="Run vitals" role="group">
  <div class="vital"><span class="k">Duration</span><span class="v">{vitals.durationMs > 0 ? formatTurnDuration(vitals.durationMs) : "—"}</span></div>
  <div class="vital" use:tooltip={tokensTitle}><span class="k">Tokens</span><span class="v">{vitals.tokensUsed.toLocaleString()}</span></div>
  <div class="vital" use:tooltip={partialCostNote(vitals.costComplete !== false) || undefined}><span class="k">Cost</span><span class="v">{formatCostTotal(vitals.cost, vitals.costComplete !== false)}</span></div>
  {#if speed}
    <div class="vital" use:tooltip={speed.title}>
      <span class="k">Speed</span><span class="v">{speed.text}{#if speed.ttft}<span class="sub">{` · ${speed.ttft}`}</span>{/if}</span>
    </div>
  {/if}
  {#if vitals.reasoningSteps > 0}
    <div class="vital" use:tooltip={"Reasoning steps (ReasoningStepCompleted); can exceed loops when a strategy runs several steps per loop"}>
      <span class="k">Steps</span><span class="v">{vitals.reasoningSteps}</span>
    </div>
  {/if}
  <div class="vital loop" use:tooltip={"Loops the framework reported for this run; 'traced' counts the loop rows recorded in the trace (a reflection pass can count as a loop without a row). Replay steps through the traced rows."}>
    <span class="k">{loopLabel}</span>
    <Meter value={meter.value} max={meter.max} label={loopLabel} live={status === "live" && !replaying} tone={status === "failed" ? "bad" : "neutral"} />
  </div>
  <div class="vital">
    <span class="k">Entropy η</span>
    <span class="v ent">
      {#if entropy.length > 0}
        <EntropyLine values={entropy} width={64} height={22} label="Entropy per step" />
      {:else}
        —
      {/if}
      {#if entropy.length > 0}<Badge tone={trend.tone}>{trend.label}</Badge>{/if}
    </span>
  </div>
  <div class="chips">
    {#if vitals.provider || vitals.model}
      <Chip data title="Provider / model">
        {#if vitals.provider}<ModelLink provider={vitals.provider} />{/if}{#if vitals.provider && vitals.model}&nbsp;/&nbsp;{/if}{#if vitals.model}<ModelLink provider={vitals.provider} model={vitals.model} />{/if}
      </Chip>
    {/if}
    {#if vitals.fallbackProvider}<Chip title="Provider fallback activated">fell back to {vitals.fallbackProvider}</Chip>{/if}
    {#if vitals.strategy}
      <Chip title={vitals.switchedStrategy ? `Started ${vitals.strategy}, switched to ${vitals.switchedStrategy}` : "Reasoning strategy"}>
        {strategyLabel(vitals.strategy)}{#if vitals.switchedStrategy}&nbsp;→ {strategyLabel(vitals.switchedStrategy)}{/if}
      </Chip>
    {/if}
    {#if vitals.disclosure}
      <Chip title="Tool disclosure: how permitted tools are shown to the model (decided by {vitals.disclosure.source}); never which are permitted">
        Tools: {vitals.disclosure.mode} · {vitals.disclosure.source}
      </Chip>
    {/if}
  </div>
</div>

<style>
  .vitals {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 24px;
    padding: 12px 24px;
    border-top: 1px solid var(--cortex-line);
    border-bottom: 1px solid var(--cortex-line);
    background: var(--cortex-surface-1);
  }
  .vital { display: grid; gap: 1px; }
  .k { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); white-space: nowrap; }
  .v { font-family: var(--cortex-font-data); font-size: var(--cortex-t-sm); font-variant-numeric: tabular-nums; color: var(--cortex-text); }
  .sub { color: var(--cortex-text-2); }
  .ent { display: flex; align-items: center; gap: 8px; }
  .loop { min-width: 180px; }
  .loop :global(.cx-meter) { margin-top: 6px; }
  .chips { margin-left: auto; display: flex; flex-wrap: wrap; gap: 6px; }
</style>
