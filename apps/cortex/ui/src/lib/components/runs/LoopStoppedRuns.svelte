<script lang="ts">
  /**
   * "Can continue" strip on Runs: durable desk runs that ended without completing (paused or
   * stopped by you, a loop guard, budget, timeout, error) that the framework left resumable,
   * each with a chip from the stop's kind, what was done and left, a note field, a step grant
   * and **Continue** (the framework's `resumeRun` on the same run) plus Open run. Renders
   * nothing when there are none. Loaded once on mount and after each Continue. Rules and
   * client: `lib/loop-stop-resume.ts`; wording: `lib/run-stop.ts`.
   */
  import { onMount } from "svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import ContinueStopped from "$lib/components/ContinueStopped.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import { runStatusChip } from "$lib/run-stop.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { crashedRunLabel } from "$lib/crashed-runs.js";
  import { continueDeskRun, fetchLoopStoppedRuns, type ContinueBody, type LoopStoppedRunWire } from "$lib/loop-stop-resume.js";

  interface Props {
    /** Told the Cortex run ids that can continue after every load (the Runs "Can continue" segment filters by them). */
    onChange?: (ids: ReadonlySet<string>) => void;
  }
  const { onChange }: Props = $props();

  let runs = $state<LoopStoppedRunWire[]>([]);
  let busy = $state<string | null>(null);
  let errors = $state<Record<string, string>>({});

  async function load(): Promise<void> {
    runs = await fetchLoopStoppedRuns();
    onChange?.(new Set(runs.map((r) => r.runId)));
  }

  async function onContinue(r: LoopStoppedRunWire, body: ContinueBody): Promise<void> {
    busy = r.runId;
    const { [r.runId]: _cleared, ...rest } = errors;
    errors = rest;
    const out = await continueDeskRun(r.runId, body);
    busy = null;
    if (out.ok) {
      toast.success("Continuing run", crashedRunLabel(r));
      runs = runs.filter((x) => x.runId !== r.runId);
    } else {
      errors = { ...errors, [r.runId]: out.error };
    }
    void load();
  }

  onMount(() => {
    void load();
  });
</script>

{#if runs.length > 0}
  <section class="stopped" aria-label="Runs that can continue">
    {#each runs as r (r.runId)}
      <div class="item" data-testid="loop-stopped-run" data-run-id={r.runId}>
        <p class="what">{crashedRunLabel(r)} <Status tone={runStatusChip(r.status).tone} label={runStatusChip(r.status).label} /></p>
        <ContinueStopped kind={r.kind} stop={r.stop} busy={busy === r.runId} error={errors[r.runId]} onContinue={(b) => void onContinue(r, b)} />
        <div class="btns"><Button size="sm" variant="ghost" href="/run/{encodeURIComponent(r.runId)}">Open run</Button></div>
      </div>
    {/each}
  </section>
{/if}

<style>
  .stopped {
    display: grid;
    gap: 1px;
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--cortex-warn) 35%, var(--cortex-line));
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-line);
  }
  .item { display: grid; gap: 8px; padding: 12px 16px; background: var(--cortex-surface-1); }
  .what { margin: 0; min-width: 0; font-weight: 500; color: var(--cortex-text); }
  .btns { display: flex; gap: 6px; }
</style>
