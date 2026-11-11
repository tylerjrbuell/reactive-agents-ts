<script lang="ts">
  /**
   * One agent-config section. Collapsible (a head button with the icon, title
   * and a short summary, then the body while open) by default; flat inside the
   * Lab builder (`flat` context set by AgentConfigPanel's `navSection`), where
   * the section nav picks what shows: a plain panel with a heading, always open.
   */
  import { getContext, type Snippet } from "svelte";
  import Icon from "$lib/components/kit/Icon.svelte";
  import type { IconName } from "$lib/icons.js";
  import { ACP_FLAT_CONTEXT, type AcpFlatContext } from "./flat-context.js";

  interface Props {
    /** Section id: drives the `acp-section-*` / `acp-head-*` / `acp-panel-*` ids. */
    id: string;
    open: boolean;
    onToggle: () => void;
    icon: IconName;
    title: string;
    /** A short summary beside the title (current value, count, on/off). */
    head?: Snippet;
    /** The section body (rendered while open). */
    children: Snippet;
  }
  const { id, open, onToggle, icon, title, head, children }: Props = $props();
  const flatCtx = getContext<AcpFlatContext | undefined>(ACP_FLAT_CONTEXT);
</script>

{#if flatCtx}
  <section id="acp-section-{id}" class="acp-section acp-set" aria-labelledby="acp-head-{id}">
    {#if flatCtx.single}
      <h3 id="acp-head-{id}" class="sr-only">{title}</h3>
    {:else}
      <div class="acp-set-h">
        <h3 id="acp-head-{id}">{title}</h3>
        {#if head}<span class="acp-sum">{@render head()}</span>{/if}
      </div>
    {/if}
    <div id="acp-panel-{id}" class="acp-set-body">
      {@render children()}
    </div>
  </section>
{:else}
  <div id="acp-section-{id}" class="acp-section acp-section-shell">
    <button type="button"
      id="acp-head-{id}"
      class="acp-section-trigger"
      aria-expanded={open}
      aria-controls="acp-panel-{id}"
      onclick={() => onToggle()}>
      <span class="acp-trigger-icon"><Icon name={icon} /></span>
      <span class="acp-trigger-title">{title}</span>
      {#if head}<span class="acp-sum">{@render head()}</span>{/if}
      <span class="acp-chev" class:open aria-hidden="true"><Icon name="down" size="sm" /></span>
    </button>
    {#if open}
      <div id="acp-panel-{id}" class="acp-section-body" role="region" aria-labelledby="acp-head-{id}">
        {@render children()}
      </div>
    {/if}
  </div>
{/if}

<style>
  .acp-set {
    display: grid;
    gap: 16px;
    padding: 16px;
    border-radius: var(--cortex-r-panel);
    border: 1px solid var(--cortex-line);
    background: var(--cortex-surface-1);
    scroll-margin-top: 12px;
  }
  .acp-set-h { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .acp-set-h h3 { margin: 0; font-size: var(--cortex-t-sm); font-weight: 600; color: var(--cortex-text); }
  .acp-set-body { display: flex; flex-direction: column; gap: 16px; min-width: 0; }

  .acp-section-shell {
    border-radius: var(--cortex-r-panel);
    border: 1px solid var(--cortex-line);
    background: var(--cortex-surface-1);
    overflow: hidden;
    scroll-margin-top: 12px;
  }
  .acp-section-trigger {
    display: flex;
    width: 100%;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border: 0;
    background: transparent;
    color: var(--cortex-text);
    text-align: left;
    cursor: pointer;
    font-family: var(--cortex-font-ui);
    transition: background-color var(--cortex-d-fast) var(--cortex-ease-out);
  }
  .acp-section-trigger:hover { background: var(--cortex-surface-2); }
  .acp-section-trigger:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: -2px; }
  .acp-trigger-icon { display: inline-flex; color: var(--cortex-text-2); }
  .acp-trigger-title { font-size: var(--cortex-t-sm); font-weight: 600; }
  .acp-chev { margin-left: auto; display: inline-flex; color: var(--cortex-text-3); transform: rotate(-90deg); transition: transform var(--cortex-d-fast) var(--cortex-ease-out); }
  .acp-chev.open { transform: none; }
  .acp-section-body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    border-top: 1px solid var(--cortex-line);
  }
  .acp-sum {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow: hidden;
    font-family: var(--cortex-font-data);
    font-size: var(--cortex-t-2xs);
    color: var(--cortex-text-3);
  }
  @media (prefers-reduced-motion: reduce) { .acp-chev { transition: none; } }
</style>
