<script lang="ts">
  /**
   * One Settings row: label and help text on the left, the control on the
   * right (stacked below 720px). `for` is the control's id so the label
   * targets it; the help text id is `${for}-hint` for `aria-describedby`.
   * Without `for` the label is plain text (the control labels itself).
   */
  import type { Snippet } from "svelte";

  interface Props {
    label: string;
    for?: string;
    description?: string;
    /** Rich help text in place of `description` (inline code). */
    help?: Snippet;
    /** The control (select, input, badges, button). */
    control?: Snippet;
    /** Wide control column (a range with its value, a button row). */
    wide?: boolean;
  }

  let { label, for: forId, description, help, control, wide = false }: Props = $props();
</script>

<div class="sr" class:sr-wide={wide}>
  <div class="sr-text">
    {#if forId}
      <label class="sr-label" for={forId}>{label}</label>
    {:else}
      <span class="sr-label">{label}</span>
    {/if}
    {#if help}
      <p class="sr-help" id={forId ? `${forId}-hint` : undefined}>{@render help()}</p>
    {:else if description}
      <p class="sr-help" id={forId ? `${forId}-hint` : undefined}>{description}</p>
    {/if}
  </div>
  {#if control}<div class="sr-control">{@render control()}</div>{/if}
</div>

<style>
  .sr {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 280px;
    gap: 16px;
    align-items: center;
    padding: 12px 16px;
  }
  .sr-wide { grid-template-columns: minmax(0, 1fr) 340px; }
  .sr-text { min-width: 0; }
  .sr-label { display: block; font-size: var(--cortex-t-sm); font-weight: 500; color: var(--cortex-text); }
  .sr-help { margin: 2px 0 0; font-size: var(--cortex-t-xs); line-height: var(--cortex-lh-ui); color: var(--cortex-text-2); }
  .sr-help :global(code) { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); }
  .sr-control { min-width: 0; display: flex; justify-content: flex-end; }
  @media (max-width: 720px) {
    .sr, .sr-wide { grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .sr-control { justify-content: flex-start; }
  }
</style>
