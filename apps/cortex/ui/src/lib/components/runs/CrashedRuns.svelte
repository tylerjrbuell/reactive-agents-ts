<script lang="ts">
  /**
   * "Stopped mid-run" strip on Runs (roadmap C13): durable desk runs a crash
   * left unfinished, each with **Resume** (the framework's `resumeRun` from the
   * last checkpoint, on the same run) and Open run. Renders nothing when there
   * are none. Loaded once on mount and after each resume. Rules and client:
   * `lib/crashed-runs.ts`.
   */
  import { onMount } from "svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { toast } from "$lib/stores/toast-store.js";
  import {
    crashedRunDetail,
    crashedRunLabel,
    fetchCrashedRuns,
    resumeCrashedRun,
    type CrashedRunWire,
  } from "$lib/crashed-runs.js";

  let runs = $state<CrashedRunWire[]>([]);
  let busy = $state<string | null>(null);

  async function load(): Promise<void> {
    runs = await fetchCrashedRuns();
  }

  async function resume(r: CrashedRunWire): Promise<void> {
    busy = r.runId;
    const out = await resumeCrashedRun(r.runId);
    busy = null;
    if (out.ok) {
      toast.success("Resuming run", crashedRunLabel(r));
      runs = runs.filter((x) => x.runId !== r.runId);
    } else {
      toast.error("Couldn't resume the run", out.error);
    }
    void load();
  }

  onMount(() => {
    void load();
  });
</script>

{#if runs.length > 0}
  <section class="crashed" aria-label="Stopped mid-run">
    {#each runs as r (r.runId)}
      <div class="item">
        <Status tone="attention" label="Stopped mid-run" />
        <span class="what">{crashedRunLabel(r)}</span>
        <span class="ctx">{crashedRunDetail(r)}</span>
        <div class="btns">
          <Button size="sm" variant="primary" icon="play" disabled={busy === r.runId} onclick={() => resume(r)}>Resume</Button>
          <Button size="sm" variant="ghost" href="/run/{encodeURIComponent(r.runId)}">Open run</Button>
        </div>
      </div>
    {/each}
  </section>
{/if}

<style>
  .crashed {
    display: grid;
    gap: 1px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--cortex-warn) 35%, var(--cortex-line));
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-line);
  }
  .item { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 16px; background: var(--cortex-surface-1); }
  .what { min-width: 0; font-weight: 500; color: var(--cortex-text); }
  .ctx { color: var(--cortex-text-2); font-size: var(--cortex-t-xs); }
  .btns { margin-left: auto; display: flex; flex-wrap: wrap; gap: 6px; }
</style>
