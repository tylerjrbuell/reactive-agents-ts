<script lang="ts">
  /**
   * A strategy that cannot run behind the agent's approval gate, said before the run is refused:
   * one friendly sentence and a button per way out. A button changes the config only when pressed;
   * nothing is dropped silently.
   */
  import type { ConflictResolution, StrategyApprovalConflict } from "@reactive-agents/ui-core";
  import Icon from "../kit/Icon.svelte";

  interface Props {
    conflict: StrategyApprovalConflict | undefined;
    onResolve: (resolution: ConflictResolution) => void;
  }
  const { conflict, onResolve }: Props = $props();
</script>

{#if conflict}
  <div class="note" role="status" data-testid="strategy-conflict">
    <span class="msg"><Icon name="alert-circle" size="sm" />{conflict.message}</span>
    <span class="acts">
      {#each conflict.resolutions as r (r.id)}
        <button type="button" class="act" data-testid="conflict-{r.id}" onclick={() => onResolve(r)}>{r.label}</button>
      {/each}
    </span>
  </div>
{/if}

<style>
  .note {
    display: grid;
    gap: 6px;
    padding: 6px 10px;
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-warn-tint);
    color: var(--cortex-text);
    font-size: var(--cortex-t-xs);
    line-height: var(--cortex-lh-ui);
  }
  .msg { display: flex; align-items: flex-start; gap: 6px; color: var(--cortex-warn); }
  .acts { display: flex; flex-wrap: wrap; gap: 6px; }
  .act {
    height: 22px;
    padding: 0 8px;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-chip);
    background: var(--cortex-surface-2);
    color: var(--cortex-text);
    font: inherit;
    font-size: var(--cortex-t-xs);
    cursor: pointer;
  }
  .act:hover { background: var(--cortex-surface-3); }
</style>
