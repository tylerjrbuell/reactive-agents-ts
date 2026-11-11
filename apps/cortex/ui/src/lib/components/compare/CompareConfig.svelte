<script lang="ts">
  /**
   * Run compare, config: the resolved config paths whose values differ
   * between the two runs (`AgentStarted.config`: harness mechanisms, builder
   * options, environment), with how many paths match.
   */
  import type { CompareConfig } from "$lib/run-compare.js";

  interface Props {
    config: CompareConfig;
  }
  const { config }: Props = $props();

  const neither = $derived(!config.a && !config.b);
</script>

{#if neither}
  <p class="note">Neither run reported its resolved config, so configs cannot be compared.</p>
{:else}
  <p class="note">
    {#if config.differs.length === 0}
      Same config: all {config.sameCount} settings match.
    {:else}
      {config.differs.length}{config.truncated ? "+" : ""} setting{config.differs.length === 1 ? "" : "s"} differ, {config.sameCount} match.
    {/if}
    {#if !config.a}Run A did not report its config.{/if}
    {#if !config.b}Run B did not report its config.{/if}
  </p>
  {#if config.differs.length > 0}
    <div class="table" role="table" aria-label="Config settings that differ">
      <div class="tr head" role="row">
        <span role="columnheader">Setting</span>
        <span role="columnheader"><span class="tag">A</span></span>
        <span role="columnheader"><span class="tag">B</span></span>
      </div>
      {#each config.differs as d (d.path)}
        <div class="tr" role="row">
          <span role="rowheader" class="path"><code>{d.path}</code></span>
          <span role="cell"><code class:unset={d.a === undefined}>{d.a ?? "not set"}</code></span>
          <span role="cell"><code class:unset={d.b === undefined}>{d.b ?? "not set"}</code></span>
        </div>
      {/each}
    </div>
  {/if}
{/if}

<style>
  .note { margin: 0 0 8px; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .table { display: grid; }
  .tr { display: grid; grid-template-columns: minmax(10rem, 1.1fr) minmax(0, 1fr) minmax(0, 1fr); gap: 12px; padding: 6px 4px; border-top: 1px solid var(--cortex-line); align-items: baseline; }
  .tr.head { border-top: 0; padding-top: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  [role="cell"], [role="rowheader"] { min-width: 0; }
  code { min-width: 0; overflow-wrap: anywhere; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .path code { color: var(--cortex-text-2); }
  .unset { color: var(--cortex-text-3); font-style: italic; }
  .tag { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: var(--cortex-surface-2); font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text); }
  @media (max-width: 640px) { .tr { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .path { grid-column: 1 / -1; } .tr.head > :first-child { display: none; } }
</style>
