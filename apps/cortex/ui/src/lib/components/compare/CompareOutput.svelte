<script lang="ts">
  /**
   * Run compare, answer: the framework diff's `outputDiff` (A's answer, B's
   * answer) as a line diff (ui-core `skillLineDiff`): removed lines are A only,
   * added lines B only.
   */
  import { skillLineDiff } from "@reactive-agents/ui-core";

  interface Props {
    a: string | undefined;
    b: string | undefined;
    equal: boolean;
  }
  const { a, b, equal }: Props = $props();

  const lines = $derived(equal ? [] : skillLineDiff(a ?? "", b ?? ""));
</script>

{#if equal}
  <p class="note">Both runs gave the same answer{a ? "" : " (none)"}.</p>
{:else}
  <p class="note">
    Lines only in A are marked <span class="k del">A</span>, lines only in B <span class="k add">B</span>.
    {#if !a}Run A gave no answer.{/if}
    {#if !b}Run B gave no answer.{/if}
  </p>
  <pre class="diff" aria-label="Answer difference">{#each lines as l, i (i)}<span class="ln {l.kind}"><span class="mk" aria-label={l.kind === "add" ? "only in B" : l.kind === "del" ? "only in A" : undefined}>{l.kind === "add" ? "B" : l.kind === "del" ? "A" : " "}</span>{l.text || " "}</span>{/each}</pre>
{/if}

<style>
  .note { margin: 0 0 8px; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .k { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 5px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  .diff { max-height: 28rem; overflow: auto; margin: 0; padding: 8px 0; border: 1px solid var(--cortex-line); border-radius: var(--cortex-r-ctl); background: var(--cortex-surface-2); font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
  .ln { display: grid; grid-template-columns: 1.75rem minmax(0, 1fr); padding: 0 12px 0 0; color: var(--cortex-text-2); }
  .mk { text-align: center; color: var(--cortex-text-3); user-select: none; }
  .del, .ln.del { background: var(--cortex-bad-tint); color: var(--cortex-text); }
  .add, .ln.add { background: var(--cortex-ok-tint); color: var(--cortex-text); }
</style>
