<script lang="ts">
  /**
   * Empty state. Plain (panel level): an optional icon, a title, one line of
   * copy and actions. `hero` (page level only: Chat empty session, Runs with
   * no runs, first run): the neural mark with its twinkle, a 30px headline and
   * the actions. Pair a hero with `CortexDeskShell ambient` (spec 5.2). Every
   * empty state names what to do next (spec principle 5).
   */
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import NeuralMark from "./NeuralMark.svelte";
  import type { IconName } from "../../icons.js";

  interface Props {
    title: string;
    description?: string;
    icon?: IconName;
    hero?: boolean;
    /** Hero mark size in px (96 by default; 132 for the Beacon first run). */
    markSize?: number;
    /** Gradient headline (hero only; the text is 30px, above the 22px floor). */
    brand?: boolean;
    /** Hero only: a word after the title set in the gradient wordmark (`Welcome to` + `Cortex`). */
    brandWord?: string;
    /** Rich copy in place of `description` (inline code, links). */
    body?: Snippet;
    actions?: Snippet;
    class?: string;
  }

  let {
    title,
    description,
    icon,
    hero = false,
    markSize = 96,
    brand = false,
    brandWord,
    body,
    actions,
    class: className = "",
  }: Props = $props();
</script>

<div class="cx-empty {className}" class:cx-empty-hero={hero}>
  {#if hero}
    <NeuralMark size={markSize} hero />
    <h2 class:brand-grad={brand}>{title}{#if brandWord}{" "}<span class="brand-grad">{brandWord}</span>{/if}</h2>
  {:else}
    {#if icon}<span class="cx-empty-icon"><Icon name={icon} size="lg" /></span>{/if}
    <h3>{title}</h3>
  {/if}
  {#if body}<p>{@render body()}</p>{:else if description}<p>{description}</p>{/if}
  {#if actions}<div class="cx-empty-acts">{@render actions()}</div>{/if}
</div>

<style>
  .cx-empty {
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 48px 24px;
    text-align: center;
    color: var(--cortex-text-2);
  }
  .cx-empty-icon { color: var(--cortex-text-3); }
  h3 { margin: 0; font-size: var(--cortex-t-lg); font-weight: 600; color: var(--cortex-text); }
  p { margin: 0; max-width: 46ch; font-size: var(--cortex-t-sm); line-height: var(--cortex-lh-ui); }
  .cx-empty-hero { gap: 12px; }
  .cx-empty-hero h2 {
    margin: 8px 0 0;
    font-size: var(--cortex-t-2xl);
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: var(--cortex-lh-tight);
    color: var(--cortex-text);
  }
  .cx-empty-hero h2.brand-grad { color: transparent; }
  .cx-empty-hero p { max-width: 52ch; font-size: var(--cortex-t-md); line-height: var(--cortex-lh-read); }
  .cx-empty-acts { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 12px; }
</style>
