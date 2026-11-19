<script lang="ts">
  /**
   * Tree of thought, as the strategy goes. With parent links (the framework's `tot-node` payload) it
   * is a real tree: children nest under their parent, pruned nodes are dimmed, and the selected path
   * is highlighted. Without parents it is one line per level with the best option marked; with no
   * node data at all it falls back to the phase rows.
   */
  import { totForestOf, totHasEdges, totTreeOf, type StrategyRunState, type TotTreeNode } from "@reactive-agents/ui-core";
  import PhaseRows from "./PhaseRows.svelte";

  interface Props {
    run: StrategyRunState;
  }
  const { run }: Props = $props();
  const levels = $derived(totTreeOf(run));
  const forest = $derived(totForestOf(run));
  const edges = $derived(totHasEdges(run));
  const score = (n: number | undefined): string => (n === undefined ? "-" : n.toFixed(2));
</script>

{#snippet branch(t: TotTreeNode)}
  <li class="node" class:path={t.onPath} class:pruned={t.node.pruned === true} data-testid="tot-node" data-pruned={t.node.pruned === true} data-selected={t.onPath}>
    <span class="line">
      <span class="bar" role="img" aria-label={t.node.score === undefined ? "not scored" : `score ${t.node.score.toFixed(2)}`}>
        <span class="fill" style="width: {Math.round((t.node.score ?? 0) * 100)}%"></span>
      </span>
      <span class="score">{score(t.node.score)}</span>
      {#if t.node.content}<span class="text">{t.node.content}</span>{/if}
      {#if t.onPath}<span class="mark">selected</span>{:else if t.node.pruned}<span class="muted">pruned</span>{/if}
    </span>
    {#if t.children.length > 0}
      <ul class="kids">{#each t.children as c (c.node.id)}{@render branch(c)}{/each}</ul>
    {/if}
  </li>
{/snippet}

{#if levels.length === 0}
  <PhaseRows rows={run.rows} />
{:else if edges}
  <ul class="tree" data-testid="tot-tree">{#each forest as t (t.node.id)}{@render branch(t)}{/each}</ul>
{:else}
  <ol class="levels" data-testid="tot-levels">
    {#each levels as l (l.depth)}
      <li class="level" data-testid="tot-level">
        <span class="depth">Level {l.depth}</span>
        <ul class="nodes">
          {#each l.nodes as n (n.id)}
            <li class="node" class:path={n.best} data-testid="tot-node">
              <span class="line">
                <span class="bar" role="img" aria-label={n.score === undefined ? "not scored" : `score ${n.score.toFixed(2)}`}>
                  <span class="fill" style="width: {Math.round((n.score ?? 0) * 100)}%"></span>
                </span>
                <span class="score">{score(n.score)}</span>
                {#if n.content}<span class="text">{n.content}</span>{/if}
                {#if n.best}<span class="mark">best</span>{/if}
              </span>
            </li>
          {/each}
        </ul>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .levels, .tree, .kids, .nodes { margin: 0; padding: 0; list-style: none; }
  .levels { display: grid; gap: 6px; }
  .level { display: grid; gap: 2px; }
  .depth { font-size: var(--cortex-t-xs); font-weight: 600; color: var(--cortex-text-2); }
  .nodes { display: grid; gap: 2px; }
  .kids { margin-left: 8px; padding-left: 10px; border-left: 1px solid var(--cortex-line); }
  .node { color: var(--cortex-text-2); line-height: var(--cortex-lh-ui); min-width: 0; }
  .line { display: flex; align-items: center; gap: 6px; padding: 1px 4px; min-width: 0; }
  .node.path > .line { color: var(--cortex-text); }
  .node.pruned > .line { opacity: 0.55; }
  .bar { flex: none; width: 56px; height: 6px; border-radius: 3px; background: var(--cortex-surface-2); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--cortex-text-3); }
  .node.path > .line .fill { background: var(--cortex-accent); }
  .score { flex: none; font-family: var(--cortex-font-mono); font-size: var(--cortex-t-xs); font-variant-numeric: tabular-nums; }
  .text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mark { flex: none; color: var(--cortex-accent); font-weight: 600; }
  .muted { flex: none; color: var(--cortex-text-3); }
</style>
