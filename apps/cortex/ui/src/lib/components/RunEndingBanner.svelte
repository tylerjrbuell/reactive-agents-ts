<script lang="ts">
  /**
   * Run view banner for a run that did not succeed, by how it ended: a failed run
   * shows its cause in red; an abstention is a quiet decline with its reason and
   * what was missing; a partial run lists what was left unfinished. The ending
   * comes from `AgentCompleted` (`runEnding` in `$lib/turn-ending.ts`); `cause`
   * is the fallback text when it carried none (TaskFailed, DB-hydrated error).
   */
  import type { TurnOutcome } from "@reactive-agents/ui-core";
  import BoundedText from "$lib/components/BoundedText.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    ending: TurnOutcome | undefined;
    cause: string;
  }
  const { ending, cause }: Props = $props();

  const kind = $derived(ending?.ending === "abstained" ? "abstained" : ending?.ending === "partial" ? "partial" : "failed");
  const text = $derived(
    (kind === "abstained" ? (ending?.abstention?.reason ?? ending?.error) : ending?.error) ||
      cause ||
      "The agent ended with a failure. The trace below shows its last known state.",
  );
  const items = $derived(
    kind === "abstained"
      ? (ending?.abstention?.missing ?? []).map((m) => `Missing: ${m}`)
      : kind === "partial"
        ? (ending?.unfinished ?? [])
        : [],
  );
  const title = $derived(kind === "abstained" ? "The agent abstained" : kind === "partial" ? "The run is unfinished" : "The run failed");
</script>

<div data-testid="run-ending-banner" data-ending={kind} class="banner rail" class:rail-failed={kind === "failed"} class:rail-attention={kind === "partial"} role={kind === "failed" ? "alert" : "status"}>
  <div class="h"><Icon name={kind === "failed" ? "alert-circle" : kind === "partial" ? "clock" : "ban"} size="sm" />{title}</div>
  <BoundedText {text} preview={1500} maxHeight="10rem" copy={false} />
  {#if items.length > 0}
    <ul>{#each items as item, i (i)}<li>{item}</li>{/each}</ul>
  {/if}
</div>

<style>
  .banner { display: grid; gap: 6px; padding: 12px 16px 12px 20px; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-panel); background: var(--cortex-surface-1); font-size: var(--cortex-t-sm); color: var(--cortex-text); }
  .h { display: flex; align-items: center; gap: 6px; font-weight: 600; color: var(--cortex-text-2); }
  [data-ending="failed"] .h { color: var(--cortex-bad); }
  [data-ending="partial"] .h { color: var(--cortex-warn); }
  ul { margin: 0; padding-left: 18px; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
</style>
