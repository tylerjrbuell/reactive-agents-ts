<script lang="ts">
  /**
   * "Compare with…" from the run view's More menu: pick another run to compare
   * this one against (this run is A). Runs with the same name come first
   * (`compareCandidates` in `lib/run-compare.ts`); choosing one opens
   * `/runs/compare?a=<this>&b=<picked>`.
   */
  import { goto } from "$app/navigation";
  import { formatRelativeTime } from "@reactive-agents/ui-core";
  import Overlay from "$lib/components/kit/Overlay.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { runNameOf, runRowStatus, type RunRow } from "$lib/runs-table.js";
  import { compareCandidates, compareHref } from "$lib/run-compare.js";

  interface Props {
    open: boolean;
    runId: string;
    onclose: () => void;
  }
  const { open, runId, onclose }: Props = $props();

  let runs = $state<readonly RunRow[]>([]);
  let error = $state("");
  let loaded = $state(false);
  let query = $state("");

  $effect(() => {
    if (!open || loaded) return;
    fetch(`${CORTEX_SERVER_URL}/api/runs?limit=100`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        runs = (await res.json()) as RunRow[];
      })
      .catch((e: unknown) => (error = e instanceof Error ? e.message : String(e)))
      .finally(() => (loaded = true));
  });

  const options = $derived(compareCandidates(runs, runId, query));
  const now = $derived(Date.now());

  function pick(other: string) {
    onclose();
    void goto(compareHref(runId, other));
  }
</script>

<Overlay {open} title="Compare with another run" width={560} {onclose}>
  <input class="cx-control q" type="search" bind:value={query} placeholder="Search by name, model or id" aria-label="Search runs" />
  {#if error}
    <p class="note err" role="alert">Could not load runs: {error}</p>
  {:else if !loaded}
    <p class="note" role="status">Loading runs…</p>
  {:else if options.length === 0}
    <p class="note">No other finished runs{query ? " match" : ""}.</p>
  {:else}
    <ul class="list" aria-label="Runs to compare with">
      {#each options as r (r.runId)}
        {@const s = runRowStatus(r)}
        <li>
          <button type="button" class="opt" onclick={() => pick(r.runId)}>
            <span class="name">{runNameOf(r)}</span>
            <Status tone={s.tone} label={s.label} />
            <span class="meta">{[r.model ?? "—", r.strategy].filter(Boolean).join(" · ")}</span>
            <span class="meta">{formatRelativeTime(r.startedAt, now)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</Overlay>

<style>
  .q { width: 100%; margin-bottom: 10px; }
  .note { margin: 8px 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .err { color: var(--cortex-bad); }
  .list { display: grid; gap: 2px; max-height: 24rem; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
  .opt { display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; align-items: center; gap: 10px; width: 100%; padding: 8px 10px; border: 0; border-radius: var(--cortex-r-ctl); background: transparent; color: var(--cortex-text); font: inherit; font-size: var(--cortex-t-sm); text-align: left; cursor: pointer; }
  .opt:hover { background: var(--cortex-surface-2); }
  .opt:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); white-space: nowrap; }
  @media (max-width: 560px) { .opt { grid-template-columns: minmax(0, 1fr) auto; } .meta { display: none; } }
</style>
