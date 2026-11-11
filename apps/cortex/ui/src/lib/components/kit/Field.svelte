<script lang="ts">
  /**
   * Form row: a sentence-case label, the control (children), then a hint or
   * an error. `id` must be the control's id so the label targets it; the hint
   * and error ids are `${id}-hint` / `${id}-error` for `aria-describedby`
   * (Input, Select and Textarea set it from `describedBy`).
   */
  import type { Snippet } from "svelte";

  interface Props {
    id: string;
    label: string;
    hint?: string;
    error?: string;
    class?: string;
    children: Snippet;
  }

  let { id, label, hint, error, class: className = "", children }: Props = $props();
</script>

<div class="cx-field {className}">
  <label for={id}>{label}</label>
  {@render children()}
  {#if error}
    <p id="{id}-error" class="cx-field-error" role="alert">{error}</p>
  {:else if hint}
    <p id="{id}-hint" class="cx-field-hint">{hint}</p>
  {/if}
</div>

<style>
  .cx-field { display: grid; gap: 6px; }
  label { font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-2); }
  p { margin: 0; font-size: var(--cortex-t-xs); }
  .cx-field-hint { color: var(--cortex-text-3); }
  .cx-field-error { color: var(--cortex-bad); }
</style>
