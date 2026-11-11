<script lang="ts">
  /**
   * Icon-only button. `label` is required: it is the accessible name and the
   * Cortex tooltip (`use:tooltip`, never a native `title`), so no icon ever
   * announces as a ligature word (spec A8). `tip` overrides the tooltip text
   * when it should say more than the name. `pressed` makes it a toggle
   * (`aria-pressed`). Pass `href` for a link.
   */
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";
  import type { IconName, IconSize } from "../../icons.js";
  import { tooltip } from "../../actions/tooltip.js";

  interface Props extends Omit<HTMLButtonAttributes, "class" | "children" | "aria-label" | "title"> {
    icon: IconName;
    label: string;
    /** Tooltip text when it differs from `label` (default: `label`). */
    tip?: string;
    size?: IconSize;
    pressed?: boolean;
    href?: string;
    class?: string;
  }

  let { icon, label, tip, size = "md", pressed, href, type = "button", class: className = "", ...rest }: Props = $props();
</script>

{#if href}
  <a {href} class="cx-iconbtn {className}" aria-label={label} use:tooltip={tip ?? label}>
    <Icon name={icon} {size} />
  </a>
{:else}
  <button
    {type}
    class="cx-iconbtn {className}"
    aria-label={label}
    use:tooltip={tip ?? label}
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
