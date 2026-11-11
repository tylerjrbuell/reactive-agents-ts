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

  interface Props {
    ending: TurnOutcome | undefined;
    cause: string;
  }
  const { ending, cause }: Props = $props();

  const kind = $derived(ending?.ending === "abstained" ? "abstained" : ending?.ending === "partial" ? "partial" : "failed");
  const text = $derived(
    (kind === "abstained" ? (ending?.abstention?.reason ?? ending?.error) : ending?.error) ||
      cause ||
      "Agent terminated with failure — see trace for last known state.",
  );
  const items = $derived(
    kind === "abstained"
      ? (ending?.abstention?.missing ?? []).map((m) => `missing: ${m}`)
      : kind === "partial"
        ? (ending?.unfinished ?? [])
        : [],
  );
  const view = $derived(
    kind === "abstained"
      ? { title: "Agent abstained", icon: "do_not_disturb_on", box: "bg-surface-container/40 border-outline-variant/30", tone: "text-on-surface/70" }
      : kind === "partial"
        ? { title: "Run unfinished", icon: "pending", box: "bg-amber-500/10 border-amber-400/30", tone: "text-amber-800 dark:text-amber-300" }
        : { title: "Run failed", icon: "error", box: "bg-error/10 border-error/30", tone: "text-error" },
  );
</script>

<div data-testid="run-ending-banner" data-ending={kind} class="flex-shrink-0 mb-2 border rounded-lg p-3 {view.box}">
  <div class="flex items-center gap-2 mb-1.5">
    <span class="material-symbols-outlined text-sm {view.tone}" style="font-variation-settings: 'FILL' 1;">{view.icon}</span>
    <span class="font-display text-[11px] uppercase tracking-[0.12em] font-semibold {view.tone}">{view.title}</span>
  </div>
  <BoundedText {text} preview={1500} maxHeight="10rem" copy={false} class="text-[10px] {view.tone} opacity-80" />
  {#if items.length > 0}
    <ul class="m-0 mt-1 list-none pl-0 font-mono text-[10px] {view.tone} opacity-80">
      {#each items as item, i (i)}
        <li class="break-words before:mr-1 before:content-['–']">{item}</li>
      {/each}
    </ul>
  {/if}
</div>
