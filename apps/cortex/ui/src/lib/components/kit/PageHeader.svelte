<script lang="ts">
  /**
   * Page header: title (22px Geist 600), an optional one-line description and
   * actions on the right. By default it sits on the header band (`.band`: the
   * engineering grid fading out, spec section 5.2); `band={false}` turns it
   * off. `lead` renders above the title (a breadcrumb); no eyebrow labels.
   */
  import type { Snippet } from "svelte";

  interface Props {
    title: string;
    description?: string;
    actions?: Snippet;
    /** Above the title: a breadcrumb, never an uppercase eyebrow. */
    lead?: Snippet;
    /** Beside the title: a status or a count. */
    meta?: Snippet;
    band?: boolean;
    class?: string;
  }

  let { title, description, actions, lead, meta, band = true, class: className = "" }: Props = $props();
</script>

<header class="cx-page-h {className}" class:band>
  <div class="cx-page-h-main">
    {#if lead}<div class="cx-page-h-lead">{@render lead()}</div>{/if}
    <div class="cx-page-h-title">
      <h1>{title}</h1>
      {#if meta}{@render meta()}{/if}
    </div>
    {#if description}<p>{description}</p>{/if}
  </div>
  {#if actions}<div class="cx-page-h-actions">{@render actions()}</div>{/if}
</header>

<style>
  .cx-page-h {
    display: flex;
    align-items: flex-end;
    gap: 16px;
    padding: 24px 32px 16px;
  }
  .cx-page-h-main { min-width: 0; }
  .cx-page-h-lead { margin-bottom: 6px; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
  .cx-page-h-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
  h1 {
    margin: 0;
    font-size: var(--cortex-t-xl);
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: var(--cortex-lh-tight);
    color: var(--cortex-text);
  }
  p { margin: 4px 0 0; font-size: var(--cortex-t-sm); color: var(--cortex-text-2); }
  .cx-page-h-actions { margin-left: auto; display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
</style>
