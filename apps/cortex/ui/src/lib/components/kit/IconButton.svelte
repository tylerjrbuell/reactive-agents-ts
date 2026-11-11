<script lang="ts">
  /**
   * Icon-only button. `label` is required: it is the accessible name and the
   * hover title, so no icon ever announces as a ligature word (spec A8).
   * `pressed` makes it a toggle (`aria-pressed`). Pass `href` for a link.
   */
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";
  import type { IconName, IconSize } from "../../icons.js";

  interface Props extends Omit<HTMLButtonAttributes, "class" | "children" | "aria-label"> {
    icon: IconName;
    label: string;
    size?: IconSize;
    pressed?: boolean;
    href?: string;
    class?: string;
  }

  let { icon, label, size = "md", pressed, href, type = "button", class: className = "", ...rest }: Props = $props();
</script>

{#if href}
  <a {href} class="cx-iconbtn {className}" aria-label={label} title={label}>
    <Icon name={icon} {size} />
  </a>
{:else}
  <button
    {type}
    class="cx-iconbtn {className}"
    aria-label={label}
    title={label}
    aria-pressed={pressed}
    {...rest}
  >
    <Icon name={icon} {size} />
  </button>
{/if}

<style>
  .cx-iconbtn {
    display: inline-grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--cortex-r-ctl);
    border: 0;
    background: transparent;
    color: var(--cortex-text-2);
    cursor: pointer;
    text-decoration: none;
  }
  .cx-iconbtn:hover,
  .cx-iconbtn[aria-pressed="true"] { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .cx-iconbtn:disabled { opacity: 0.45; cursor: not-allowed; }
  .cx-iconbtn:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
</style>
