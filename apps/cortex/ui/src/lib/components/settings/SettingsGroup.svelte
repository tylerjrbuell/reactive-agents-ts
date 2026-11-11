<script lang="ts">
  /**
   * One Settings section (also used by the Model page): a 17px title, one
   * line of copy, then its rows in a single panel (`SettingsRow` children).
   * `id` is the anchor the section nav links to.
   */
  import type { Snippet } from "svelte";

  interface Props {
    id: string;
    title: string;
    description?: string;
    /** Rich copy in place of `description` (inline code). */
    body?: Snippet;
    /** Render children without the row panel (custom layouts). */
    bare?: boolean;
    children: Snippet;
  }

  let { id, title, description, body, bare = false, children }: Props = $props();
</script>

<section {id} class="sg" aria-labelledby="{id}-title">
  <h2 id="{id}-title">{title}</h2>
  {#if body}<p>{@render body()}</p>{:else if description}<p>{description}</p>{/if}
  {#if bare}
    {@render children()}
  {:else}
    <div class="sg-rows">{@render children()}</div>
  {/if}
</section>

<style>
  .sg { scroll-margin-top: 16px; }
  h2 { margin: 0 0 4px; font-size: var(--cortex-t-lg); font-weight: 600; line-height: var(--cortex-lh-tight); color: var(--cortex-text); }
  p { margin: 0 0 12px; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .sg-rows {
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
  }
  .sg-rows > :global(*:not(:last-child)) { border-bottom: 1px solid var(--cortex-line); }
</style>
