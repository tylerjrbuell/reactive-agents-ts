<script lang="ts">
  /**
   * The run inspector's Summary (Bench spec section 8, `run.html`): the run's
   * configuration, its entropy line (one sample is a line too: B7) and the
   * tools it called. Vitals (tokens, cost, time) live in the vitals line and a
   * failure's cause in the ending banner, not here.
   */
  import ModelLink from "$lib/components/ModelLink.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import EntropyLine from "$lib/components/kit/EntropyLine.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import type { RunStatus, RunVitals } from "$lib/stores/run-store.js";
  import type { SignalData } from "$lib/stores/signal-store.js";
  import { trajectoryView } from "$lib/run-view.js";

  interface Props {
    vitals: RunVitals;
    status: RunStatus;
    signal: SignalData;
    /** Entropy per scored step (`entropySeriesOf(signal.entropy)`). */
    entropy: readonly number[];
    /** Strategy id to display name (framework manifest). */
    strategyLabel?: (id: string) => string;
  }
  const { vitals, status, signal, entropy, strategyLabel = (id: string) => id }: Props = $props();

  const trend = $derived(trajectoryView(vitals.trajectory));

  const tools = $derived.by(() => {
    const map = new Map<string, { calls: number; errors: number; ms: number }>();
    for (const t of signal.tools) {
      const e = map.get(t.name) ?? { calls: 0, errors: 0, ms: 0 };
      if (t.status !== "active") e.calls++;
      if (t.status === "error") e.errors++;
      if (t.latencyMs) e.ms += t.latencyMs;
      map.set(t.name, e);
    }
    return [...map.entries()].map(([name, s]) => ({ name, ...s }));
  });
</script>

<section class="sec">
  <h3>Configuration</h3>
  <dl>
    <dt>Provider</dt>
    <dd>{#if vitals.provider}<ModelLink provider={vitals.provider} />{#if vitals.fallbackProvider}<span class="warn"> → {vitals.fallbackProvider}</span>{/if}{:else}—{/if}</dd>
    <dt>Model</dt>
    <dd class="data">{#if vitals.model}<ModelLink provider={vitals.provider} model={vitals.model} />{:else}—{/if}</dd>
    <dt>Strategy</dt>
    <dd>{vitals.strategy ? strategyLabel(vitals.strategy) : "—"}{#if vitals.switchedStrategy}<span class="warn"> → {strategyLabel(vitals.switchedStrategy)}</span>{/if}</dd>
    {#if vitals.maxIterations > 0}
      <dt>Max loops</dt>
      <dd class="data">{vitals.maxIterations}</dd>
    {/if}
  </dl>
</section>

<section class="sec">
  <h3>Entropy</h3>
  {#if entropy.length > 0}
    <div class="ent">
      <EntropyLine values={entropy} width={220} height={48} label="Entropy per step" />
      <Badge tone={trend.tone}>{trend.label}</Badge>
    </div>
    <p class="hint">η per scored step; lower is more settled. The Signal tab charts it with tokens and latency.</p>
  {:else}
    <p class="hint">{status === "live" ? "Entropy appears once the first step is scored." : "No step of this run was scored for entropy."}</p>
  {/if}
</section>

{#if tools.length > 0}
  <section class="sec">
    <h3>Tools</h3>
    <ul class="tools">
      {#each tools as t (t.name)}
        <li>
          <span class="tname" class:bad={t.errors > 0}><Icon name={t.errors > 0 ? "alert-circle" : "check-circle"} size="sm" />{t.name}</span>
          <span class="data">{[`${t.calls}×`, t.errors > 0 ? `${t.errors} failed` : "", t.ms > 0 ? `${t.ms} ms` : ""].filter(Boolean).join(" · ")}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .sec h3 { margin: 0 0 8px; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  dt { align-self: center; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  dd { margin: 0; min-width: 0; text-align: right; overflow-wrap: anywhere; }
  .data { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); }
  .warn { color: var(--cortex-warn); }
  .ent { display: flex; align-items: center; gap: 12px; }
  .hint { margin: 6px 0 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); line-height: var(--cortex-lh-ui); }
  .tools { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }
  .tools li { display: flex; justify-content: space-between; gap: 8px; font-size: var(--cortex-t-sm); }
  .tname { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-io); }
  .tname.bad { color: var(--cortex-bad); }
  .tools .data { color: var(--cortex-text-3); white-space: nowrap; }
</style>
