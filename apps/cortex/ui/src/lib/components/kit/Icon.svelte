<script lang="ts">
  /**
   * One icon from the Cortex set (`lib/icons.ts`), as inline SVG stroked with
   * `currentColor`. Always `aria-hidden`: the control around it carries the
   * name (IconButton requires a `label`).
   */
  import { ICON_PATHS, ICON_SIZES, type IconName, type IconSize } from "../../icons.js";

  interface Props {
    name: IconName;
    size?: IconSize;
    class?: string;
  }

  let { name, size = "md", class: className = "" }: Props = $props();
  const px = $derived(ICON_SIZES[size]);
</script>

<svg
  class="cx-icon {className}"
  width={px}
  height={px}
  viewBox="0 0 24 24"
  aria-hidden="true"
  focusable="false"
  data-icon={name}
>{@html ICON_PATHS[name]}</svg>

<style>
  .cx-icon {
    flex: none;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>
