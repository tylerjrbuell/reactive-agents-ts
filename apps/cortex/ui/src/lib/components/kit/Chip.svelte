<script lang="ts">
  /**
   * Small chip for settings and values (quick-bar chips, tool and model
   * chips). `data` sets machine values in JetBrains Mono. With `onclick` it is
   * a button (a setting you can change); without, a plain label. `on` marks a
   * selected setting.
   */
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import type { IconName } from "../../icons.js";
  import { tooltip } from "../../actions/tooltip.js";

  interface Props {
    icon?: IconName;
    /** Machine value (model id, tool name, count): JetBrains Mono. */
    data?: boolean;
    /** Selected / active setting. */
    on?: boolean;
    /** Tooltip text (the Cortex tooltip, not a native `title`). */
    title?: string;
    onclick?: (e: MouseEvent) => void;
    class?: string;
    children: Snippet;
  }

  let { icon, data = false, on = false, title, onclick, class: className = "", children }: Props = $props();
</script>

{#if onclick}
  <button type="button" class="cx-chip {className}" class:cx-chip-data={data} class:cx-chip-on={on} aria-pressed={on} use:tooltip={title} {onclick}>
    {#if icon}<Icon name={icon} size="sm" />{/if}
    {@render children()}
  </button>
{:else}
  <span class="cx-chip {className}" class:cx-chip-data={data} class:cx-chip-on={on} use:tooltip={title}>
    {#if icon}<Icon name={icon} size="sm" />{/if}
    {@render children()}
  </span>
{/if}

<style>
  .cx-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
    border-radius: var(--cortex-r-chip);
    border: 1px solid transparent;
    background: var(--cortex-surface-2);
    color: var(--cortex-text-2);
    font-family: var(--cortex-font-ui);
    font-size: var(--cortex-t-xs);
    white-space: nowrap;
  }
  button.cx-chip { cursor: pointer; }
  button.cx-chip:hover { color: var(--cortex-text); border-color: var(--cortex-line-strong); }
  button.cx-chip:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .cx-chip-data { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); font-variant-numeric: tabular-nums; }
  .cx-chip-on { color: var(--cortex-text); background: var(--cortex-surface-3); }
</style>
