<script lang="ts">
  /**
   * The inspector's Safety tab: every time a guardrail, verifier, budget, the
   * context window, calibration or the reactive controller stepped in during
   * the run, in plain words, in event order. Entries come from ui-core
   * `safetyEntriesOf`; a loop entry selects that loop and opens its trace row.
   * A passed check is listed (green) but never counted.
   */
  import type { SafetyEntry } from "@reactive-agents/ui-core";
  import { safetyPlaceLabel } from "@reactive-agents/ui-core";
  import Icon from "$lib/components/kit/Icon.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import { safetyBadgeTone, safetyIcon, safetyKindLabel } from "$lib/run-safety.js";

  interface Props {
    entries: readonly SafetyEntry[];
    /** Loops that have a trace row; an entry in one of them is a link. */
    loops: ReadonlySet<number>;
    onSelectLoop: (loop: number) => void;
  }
  let { entries, loops, onSelectLoop }: Props = $props();
</script>

<section class="safety" aria-label="Safety">
  {#if entries.length === 0}
    <p class="empty">Nothing stepped in. No guardrail, verifier, budget, context or controller event was recorded for this run.</p>
  {:else}
    <ul>
      {#each entries as e (e.id)}
        {@const linked = e.loop !== undefined && loops.has(e.loop)}
        <li class="entry tone-{e.tone}">
          <span class="ic"><Icon name={safetyIcon(e.kind)} size="sm" /></span>
          <div class="txt">
            <p class="ttl">{e.title}</p>
            {#if e.detail}<p class="det">{e.detail}</p>{/if}
            <p class="meta">
              <Badge tone={safetyBadgeTone(e.tone)}>{safetyKindLabel(e.kind)}</Badge>
              {#if linked && e.loop !== undefined}
                {@const n = e.loop}
                <button type="button" class="where link" onclick={() => onSelectLoop(n)}>{safetyPlaceLabel(e)}</button>
              {:else}
                <span class="where">{safetyPlaceLabel(e)}</span>
              {/if}
              <code class="src">{e.source}</code>
            </p>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .safety { display: grid; gap: 8px; font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .empty { margin: 0; color: var(--cortex-text-2); }
  ul { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .entry { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 10px; padding: 10px 12px; border: 1px solid var(--cortex-line); border-left-width: 3px; border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-1); }
  .entry.tone-bad { border-left-color: var(--cortex-bad); }
  .entry.tone-warn { border-left-color: var(--cortex-warn); }
  .entry.tone-info { border-left-color: var(--cortex-accent); }
  .entry.tone-ok { border-left-color: var(--cortex-ok); }
  .ic { display: inline-flex; padding-top: 2px; color: var(--cortex-text-2); }
  .tone-bad .ic { color: var(--cortex-bad); }
  .tone-warn .ic { color: var(--cortex-warn); }
  .tone-info .ic { color: var(--cortex-accent); }
  .tone-ok .ic { color: var(--cortex-ok); }
  .txt { display: grid; gap: 4px; min-width: 0; }
  p { margin: 0; }
  .ttl { overflow-wrap: anywhere; }
  .det { overflow-wrap: anywhere; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
  .where { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); white-space: nowrap; }
  .link { padding: 0; border: 0; background: none; color: var(--cortex-accent); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
  .link:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; border-radius: 2px; }
  .src { margin-left: auto; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  @media (max-width: 640px) { .src { display: none; } }
</style>
