<script lang="ts">
  /**
   * Flat 4px meter (replaces the gel progress bars). Neutral fill at rest; the
   * signal gradient only while `live`. `role="meter"` with the value and a
   * required accessible `label`.
   */
  import { meterFraction, meterWidth } from "../../meter.js";

  interface Props {
    value: number;
    max?: number;
    label: string;
    live?: boolean;
    tone?: "neutral" | "warn" | "bad";
    class?: string;
  }

  let { value, max = 1, label, live = false, tone = "neutral", class: className = "" }: Props = $props();
  const fill = $derived(meterWidth(value, max));
  const pct = $derived(Math.round(meterFraction(value, max) * 100));
</script>

<div
  class="cx-meter {className}"
  class:cx-meter-live={live}
  data-tone={tone}
  role="meter"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={pct}
>
  <i style:width={fill}></i>
</div>

<style>
  .cx-meter { position: relative; height: 4px; border-radius: 4px; background: var(--cortex-surface-3); overflow: hidden; }
  .cx-meter > i {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: inherit;
    background: var(--cortex-text-2);
    transition: width var(--cortex-d-med) var(--cortex-ease-out);
  }
  .cx-meter[data-tone="warn"] > i { background: var(--cortex-warn); }
  .cx-meter[data-tone="bad"] > i { background: var(--cortex-bad); }
  .cx-meter-live > i { background: var(--cortex-signal); }
</style>
