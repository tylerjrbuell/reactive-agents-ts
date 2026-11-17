<script lang="ts">
  /**
   * Text button (Bench spec section 7). `primary` is the solid accent fill
   * (white text 5.7:1 dark, 7.1:1 light), never a gradient. Pass `href` to
   * render a link styled as a button. Extra attributes (aria-*, data-*) pass
   * through to the element; `title` becomes the Cortex tooltip
   * (`use:tooltip`), never a native title.
   */
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";
  import type { IconName } from "../../icons.js";
  import { tooltip } from "../../actions/tooltip.js";

  interface Props extends Omit<HTMLButtonAttributes, "class" | "children" | "title"> {
    /** Tooltip text (the Cortex tooltip, not a native `title`). */
    title?: string;
    variant?: "default" | "primary" | "ghost" | "danger";
    /** `field` matches the Input/Select height, for a Save/Add button sharing a row with one. */
    size?: "sm" | "md" | "field";
    /** Leading icon. */
    icon?: IconName;
    /** Render an `<a>` with this href instead of a `<button>`. */
    href?: string;
    class?: string;
    children: Snippet;
  }

  let {
    variant = "default",
    size = "md",
    icon,
    href,
    title,
    type = "button",
    class: className = "",
    children,
    ...rest
  }: Props = $props();
</script>

{#if href}
  <a {href} class="cx-btn cx-btn-{variant} cx-btn-{size} {className}" data-variant={variant} use:tooltip={title}>
    {#if icon}<Icon name={icon} size="sm" />{/if}
    {@render children()}
  </a>
{:else}
  <button {type} class="cx-btn cx-btn-{variant} cx-btn-{size} {className}" data-variant={variant} use:tooltip={title} {...rest}>
    {#if icon}<Icon name={icon} size="sm" />{/if}
    {@render children()}
  </button>
{/if}

<style>
  .cx-btn {
    display: inline-flex;
    align-items: center;
    /* Never squash: in a scrolling column flex (Lab "Run this agent") a shrinkable button collapsed to a ~14px clipped pill. */
    flex-shrink: 0;
    gap: 6px;
    border-radius: var(--cortex-r-ctl);
    border: 1px solid var(--cortex-line-strong);
    background: var(--cortex-surface-1);
    color: var(--cortex-text);
    font-family: var(--cortex-font-ui);
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;
    text-decoration: none;
    cursor: pointer;
    transition: background-color var(--cortex-d-fast) var(--cortex-ease-out);
  }
  .cx-btn-md { height: 32px; padding: 0 12px; font-size: var(--cortex-t-sm); }
  .cx-btn-field { height: var(--cortex-control-h); padding: 0 12px; font-size: var(--cortex-t-sm); }
  .cx-btn-sm { height: 26px; padding: 0 8px; font-size: var(--cortex-t-xs); }
  .cx-btn:hover { background: var(--cortex-surface-2); }
  .cx-btn-primary { background: var(--cortex-accent-fill); border-color: transparent; color: #fff; }
  .cx-btn-primary:hover { background: var(--cortex-accent-fill); filter: brightness(1.08); }
  .cx-btn-ghost { background: transparent; border-color: transparent; color: var(--cortex-text-2); }
  .cx-btn-ghost:hover { color: var(--cortex-text); }
  .cx-btn-danger { color: var(--cortex-bad); }
  .cx-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .cx-btn:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
</style>
