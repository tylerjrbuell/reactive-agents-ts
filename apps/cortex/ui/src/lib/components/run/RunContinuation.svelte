<script lang="ts">
  /**
   * The link between a run and the runs it continues or was continued by (Continue starts a new
   * run, `resumeRun({ newRun: true })`): "continued from <id>" and "continued as <id>", each a link
   * to that run. Renders nothing for an ordinary or older run. Words and hrefs: `lib/run-continuation.ts`.
   */
  import { tooltip } from "$lib/actions/tooltip.js";
  import { continuedFromWords, continuedIntoWords, type RunLink } from "$lib/run-continuation.js";

  interface Props {
    /** The run this one continues. */
    from?: RunLink | undefined;
    /** The runs that continued this one. */
    into?: readonly RunLink[];
  }
  const { from, into = [] }: Props = $props();
  const intoWords = $derived(continuedIntoWords(into));
</script>

{#if from || intoWords}
  <span class="cont" data-testid="run-continuation">
    {#if from}
      <span>{continuedFromWords} <a class="data" href={from.href} use:tooltip={`Open the run this one continues (${from.runId})`}>{from.short}</a></span>
    {/if}
    {#if intoWords}
      <span>
        {intoWords}
        {#each into as link, i (link.runId)}{i > 0 ? ", " : " "}<a class="data" href={link.href} use:tooltip={`Open the continuation (${link.runId})`}>{link.short}</a>{/each}
      </span>
    {/if}
  </span>
{/if}

<style>
  .cont { display: inline-flex; flex-wrap: wrap; gap: 4px 12px; color: var(--cortex-text-3); font-size: var(--cortex-t-xs); }
  .cont a { color: var(--cortex-text-2); text-decoration: underline; text-underline-offset: 2px; font-size: var(--cortex-t-2xs); }
  .cont a:hover { color: var(--cortex-text); }
</style>
