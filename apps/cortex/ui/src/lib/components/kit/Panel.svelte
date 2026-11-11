<script lang="ts">
  /**
   * Panel: surface-1, a hairline edge, 12px radius, optional header with a
   * title and actions. Replaces `gradient-border` panels. `live` adds the
   * live glow and gradient edge (`.glow-live`), only for a card whose work is
   * running now (spec section 5.2).
   */
  import type { Snippet } from "svelte";

  interface Props {
    title?: string;
    /** Heading level for `title` (default 2). */
    level?: 2 | 3;
    /** Right side of the header (buttons, a badge). */
    actions?: Snippet;
    /** Running now: gradient edge and halo. */
    live?: boolean;
    /** Pad the body (default true). */
    padded?: boolean;
    class?: string;
    children: Snippet;
  }

  let { title, level = 2, actions, live = false, padded = true, class: className = "", children }: Props = $props();
</script>

<section class="cx-panel {className}" class:glow-live={live} data-live={live || undefined}>
  {#if title || actions}
    <header class="cx-panel-h">
      {#if title}<svelte:element this={`h${level}`} class="cx-panel-title">{title}</svelte:element>{/if}
      {#if actions}<div class="cx-panel-actions">{@render actions()}</div>{/if}
    </header>
  {/if}
  <div class:cx-panel-b={padded}>{@render children()}</div>
</section>

<style>
  .cx-panel {
    background: var(--cortex-surface-1);
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-panel);
    color: var(--cortex-text);
  }
  .cx-panel-h {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--cortex-line);
  }
  .cx-panel-title { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; line-height: var(--cortex-lh-tight); }
  .cx-panel-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .cx-panel-b { padding: 16px; }
</style>
