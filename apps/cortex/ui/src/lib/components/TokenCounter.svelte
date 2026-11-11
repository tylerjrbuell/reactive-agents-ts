<script lang="ts">
  import RollingNumber from "./RollingNumber.svelte";

  interface Props {
    /** "in" renders ↑ (prompt tokens), "out" renders ↓ (completion tokens). */
    direction: "in" | "out";
    value: number;
    /** True when this half is derived rather than provider-reported. */
    estimated?: boolean;
    format?: (n: number) => string;
  }
  const { direction, value, estimated = false, format }: Props = $props();

  const arrow = $derived(direction === "in" ? "↑" : "↓");
  const tone = $derived(
    direction === "in" ? "text-[var(--ra-cyan,#22d3ee)]" : "text-[var(--ra-primary,#8b5cf6)]",
  );
  const label = $derived(
    `${direction === "in" ? "Input" : "Output"} tokens${estimated && value > 0 ? " (estimated while streaming)" : ""}`,
  );

  // Pulse only the arrow, and never on first render: the number is the thing
  // that changes, the arrow just draws the eye to which half moved.
  let pulse = $state(false);
  let mounted = false;
  $effect(() => {
    // Named read, not a bare `value;` statement: this effect must re-run (and
    // pulse the arrow) on every change of `value`, and the dependency is only
    // explicit when the value is read into a binding.
    const current = value;
    if (!mounted) {
      mounted = true;
      return;
    }
    pulse = true;
    const timer = setTimeout(() => (pulse = false), 360);
    return () => clearTimeout(timer);
  });
</script>

<span class="inline-flex items-center gap-0.5" title={label}>
  <span
    aria-hidden="true"
    class="inline-block w-3 text-center {tone} transition-[transform,color] duration-300 ease-out {pulse
      ? 'scale-110'
      : 'scale-100'}"
  >{arrow}</span>
  {#if estimated && value > 0}<span class="text-[10px] leading-none opacity-60">~</span>{/if}
  <RollingNumber {value} {format} />
</span>
