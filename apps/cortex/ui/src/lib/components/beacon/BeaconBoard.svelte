<script lang="ts">
  /**
   * Beacon's Board view (the default; spec section 8): "Running now" live
   * cards, then the Agents grid with the All / Needs you / Failed / Idle
   * filter. The page builds the model with `boardOf` (`lib/beacon-board.ts`);
   * this only renders it.
   */
  import Chip from "../kit/Chip.svelte";
  import EmptyState from "../kit/EmptyState.svelte";
  import BeaconAgentCard from "./BeaconAgentCard.svelte";
  import BeaconLiveCard from "./BeaconLiveCard.svelte";
  import { AGENT_FILTERS, type AgentFilter, type BoardModel } from "../../beacon-board.js";

  interface Props {
    board: BoardModel;
    filter: AgentFilter;
    now: number;
    onfilter: (filter: AgentFilter) => void;
  }

  let { board, filter, now, onfilter }: Props = $props();
</script>

<div class="board" data-view="board">
  {#if board.live.length > 0}
    <section aria-labelledby="beacon-live-h">
      <div class="sec-h">
        <h2 id="beacon-live-h">Running now</h2>
        <span class="n">{board.live.length}</span>
      </div>
      <div class="live">
        {#each board.live as card (card.runId)}
          <BeaconLiveCard {card} />
        {/each}
      </div>
    </section>
  {/if}

  {#if board.total > 0}
    <section aria-labelledby="beacon-agents-h">
      <div class="sec-h">
        <h2 id="beacon-agents-h">Agents</h2>
        <span class="n">{board.total}</span>
        <div class="filters" role="group" aria-label="Filter agents">
          {#each AGENT_FILTERS as f (f.id)}
            <Chip on={filter === f.id} onclick={() => onfilter(f.id)}>
              {f.label}{#if f.id !== "all" && board.counts[f.id] > 0}<span class="c">{board.counts[f.id]}</span>{/if}
            </Chip>
          {/each}
        </div>
      </div>
      {#if board.agents.length > 0}
        <div class="grid">
          {#each board.agents as row (row.runId)}
            <BeaconAgentCard {row} {now} />
          {/each}
        </div>
      {:else}
        <EmptyState icon="filter" title="No agents match" description="Pick another filter to see the rest.">
          {#snippet actions()}
            <Chip onclick={() => onfilter("all")}>Show all</Chip>
          {/snippet}
        </EmptyState>
      {/if}
    </section>
  {/if}
</div>

<style>
  .board { display: grid; gap: 24px; align-content: start; }
  .sec-h { display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px; }
  .sec-h h2 { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .n { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .filters { margin-left: auto; display: inline-flex; flex-wrap: wrap; gap: 4px; }
  .c { margin-left: 4px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .live { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(420px, 100%), 1fr)); gap: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr)); gap: 12px; }
</style>
