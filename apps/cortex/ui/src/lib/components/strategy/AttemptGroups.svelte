<script lang="ts">
  /**
   * Rounds of a strategy that tries again: reflexion's draft / critique / improve rounds, code
   * action's execute / verify attempts. Rows group by round number; the first draft (no number)
   * reads "First try". Each group reuses the phase rows.
   */
  import { attemptsOf, type StrategyRunState } from "@reactive-agents/ui-core";
  import PhaseRows from "./PhaseRows.svelte";

  interface Props {
    run: StrategyRunState;
    /** What one round is called: "Round" or "Attempt". */
    noun?: string;
  }
  const { run, noun = "Round" }: Props = $props();
  const groups = $derived(attemptsOf(run));
</script>

{#each groups as g (g.n)}
  <section class="group" data-testid="strategy-attempt">
    {#if groups.length > 1}<h4 class="sec">{g.n === 0 ? "First try" : `${noun} ${g.n}`}</h4>{/if}
    <PhaseRows rows={g.rows} />
  </section>
{/each}

<style>
  .sec { margin: 4px 0 2px; font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
</style>
