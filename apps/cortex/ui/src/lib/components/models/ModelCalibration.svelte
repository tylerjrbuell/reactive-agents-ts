<script lang="ts">
  /**
   * Model page Calibration section (roadmap C13): the framework's calibration
   * for the model as a run receives it, each setting in plain words with what
   * it does and whether it is shipped or learned from your runs; then the
   * local observations behind the learned values, the entropy thresholds, and
   * what the strategy-choice bandit learned per task category. Rules:
   * `lib/model-insights.ts`. Read only: Cortex never writes calibration.
   */
  import { tooltip } from "$lib/actions/tooltip.js";
  import Badge from "$lib/components/kit/Badge.svelte";
  import SettingsGroup from "$lib/components/settings/SettingsGroup.svelte";
  import SettingsRow from "$lib/components/settings/SettingsRow.svelte";
  import StatGrid from "$lib/components/settings/StatGrid.svelte";
  import {
    calibrationNote,
    calibrationRows,
    entropyStats,
    observationLine,
    observationStats,
    strategyLearningLine,
    strategyLearningRows,
    type ModelCalibrationView,
  } from "$lib/model-insights.js";

  interface Props {
    /** `undefined` while loading, `null` when the server could not answer. */
    view: ModelCalibrationView | null | undefined;
  }

  let { view }: Props = $props();

  const rows = $derived(view ? calibrationRows(view) : []);
  const obsItems = $derived(view ? observationStats(view.observations) : []);
  const entropyItems = $derived(view ? entropyStats(view.entropy) : []);
  const strategyRows = $derived(view ? strategyLearningRows(view.bandit) : []);
</script>

<SettingsGroup
  id="calibration"
  title="Calibration"
  description="How the harness adapts to this model. Values come from the framework's calibration for the model and from what it learned on your runs."
  bare
>
  {#if view === undefined}
    <p class="mc-muted" role="status">Loading calibration…</p>
  {:else if view === null}
    <p class="mc-warn" role="alert">Couldn't load this model's calibration.</p>
  {:else}
    <div class="mc-panel">
      <p class="mc-note">{calibrationNote(view)}</p>
      {#if rows.length > 0}
        <div class="mc-rows">
          {#each rows as row (row.key)}
            <SettingsRow label={row.label} description={row.help}>
              {#snippet control()}
                <span class="mc-value">
                  <span class="mc-data" use:tooltip={row.raw}>{row.value}</span>
                  <span use:tooltip={row.sourceLabel}>
                    <Badge tone={row.source === "learned" ? "accent" : "neutral"}>{row.source === "learned" ? "Learned" : "Shipped"}</Badge>
                  </span>
                </span>
              {/snippet}
            </SettingsRow>
          {/each}
        </div>
      {/if}
    </div>

    <div class="mc-sub">
      <h3>From your runs</h3>
      <p class="mc-line">{observationLine(view.observations)}</p>
      {#if obsItems.length > 0}<StatGrid items={obsItems} />{/if}
    </div>

    <div class="mc-sub">
      <h3>Uncertainty thresholds</h3>
      {#if entropyItems.length > 0}
        <p class="mc-line">Learned by the reactive-intelligence sensor from scored steps on this model.</p>
        <StatGrid items={entropyItems} />
      {:else}
        <p class="mc-line">No scored steps stored for this model yet, so the sensor uses its default thresholds.</p>
      {/if}
    </div>

    <div class="mc-sub">
      <h3>Strategy learning</h3>
      <p class="mc-line">{strategyLearningLine(view.bandit)}</p>
      {#each strategyRows as cat (cat.category)}
        <div class="mc-panel">
          <p class="mc-cat"><span class="mc-cat-name">{cat.category}</span><span class="mc-cat-time">{cat.updated}</span></p>
          <div class="mc-rows">
            {#each cat.arms as arm (arm.strategy)}
              <div class="mc-arm">
                <span class="mc-data">{arm.strategy}</span>
                <span class="mc-value">
                  <span class="mc-data" use:tooltip={arm.title}>{arm.rate}</span>
                  <span class="mc-trials">{arm.trials}</span>
                  {#if arm.best}<Badge tone="accent">Best so far</Badge>{/if}
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</SettingsGroup>

<style>
  .mc-panel {
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    overflow: hidden;
  }
  .mc-note {
    margin: 0;
    padding: 12px 16px;
    border-bottom: 1px solid var(--cortex-line);
    font-size: var(--cortex-t-xs);
    line-height: var(--cortex-lh-ui);
    color: var(--cortex-text-2);
  }
  .mc-rows > :global(*:not(:last-child)) { border-bottom: 1px solid var(--cortex-line); }
  .mc-value { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .mc-data { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); text-align: right; }
  .mc-sub { display: grid; gap: 8px; margin-top: 16px; }
  .mc-sub h3 { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .mc-line { margin: 0; font-size: var(--cortex-t-xs); line-height: var(--cortex-lh-ui); color: var(--cortex-text-2); }
  .mc-cat { display: flex; justify-content: space-between; gap: 8px; margin: 0; padding: 8px 16px; border-bottom: 1px solid var(--cortex-line); font-size: var(--cortex-t-xs); }
  .mc-cat-name { font-weight: 600; color: var(--cortex-text); }
  .mc-cat-time { color: var(--cortex-text-3); }
  .mc-arm { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 8px 16px; }
  .mc-trials { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .mc-muted { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-3); }
  .mc-warn { margin: 0; font-size: var(--cortex-t-sm); color: var(--cortex-warn); }
</style>
