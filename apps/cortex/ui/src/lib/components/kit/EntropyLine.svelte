<script lang="ts">
  /**
   * The small entropy line (spec section 5.4): the signal gradient over the
   * accent tint, a dot at the latest value, and the value printed beside it
   * (`η 0.30`) so the chart is never the only carrier. A graphical object at
   * 3.9:1 (dark) / 7.1:1 (light) against surface-1. Sizes: 64px in run
   * vitals, 96px on Beacon live cards.
   */
  import { entropyLabel, entropyLineGeometry } from "../../entropy-line.js";

  interface Props {
    /** Entropy per step, 0..1. */
    values: readonly number[];
    width?: number;
    height?: number;
    /** Accessible name of the chart. */
    label?: string;
    /** Print `η 0.30` beside the line (default true). */
    showValue?: boolean;
    class?: string;
  }

  let { values, width = 96, height = 24, label = "Entropy per step", showValue = true, class: className = "" }: Props = $props();

  const uid = $props.id();
  /** One sample is a reading, not a trend: just the dot (and the value beside it), no line or area. */
  const single = $derived(values.length === 1);
  const w = $derived(single ? 8 : width);
  const g = $derived(entropyLineGeometry(values, w, height));
  const text = $derived(entropyLabel(values));
</script>

<span class="cx-entropy {className}" data-single={single || undefined}>
  <svg width={w} {height} viewBox="0 0 {w} {height}" role="img" aria-label="{label}: {text}">
    <defs>
      <!-- userSpaceOnUse: a flat line (one sample, or a steady signal) has a zero-height
           bounding box, and an objectBoundingBox gradient then paints nothing. -->
      <linearGradient id="{uid}-sig" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={w} y2="0">
        <stop offset="0" stop-color="#8b5cf6" />
        <stop offset="1" stop-color="#22d3ee" />
      </linearGradient>
    </defs>
    {#if single && g.last}
      <!-- Centred on the value text: with one sample there is no axis for the height to mean anything. -->
      <circle cx={w / 2} cy={height / 2} r="3" fill="#22d3ee" />
    {:else if g.last}
      <polygon points={g.area} fill="var(--cortex-accent-tint)" />
      <polyline points={g.line} fill="none" stroke="url(#{uid}-sig)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <circle cx={g.last.x} cy={g.last.y} r="2.6" fill="#22d3ee" />
    {/if}
  </svg>
  {#if showValue}<span class="cx-entropy-v" aria-hidden="true">{text}</span>{/if}
</span>

<style>
  .cx-entropy { display: inline-flex; align-items: center; gap: 8px; }
  svg { display: block; overflow: visible; }
  .cx-entropy-v { font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-2); font-variant-numeric: tabular-nums; }
</style>
