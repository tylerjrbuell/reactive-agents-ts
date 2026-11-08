<script lang="ts">
  interface Props {
    value: number;
    format?: (n: number) => string;
    /** Fixed animation length in ms; omitted means an adaptive 180-520 ms based on the delta. */
    duration?: number;
  }
  const { value, format = (n: number) => String(Math.round(n)), duration }: Props = $props();

  // `displayed` is the rendered value; `current` is the animation cursor. The
  // effect reads only `value`, so per-frame writes to `displayed` cannot
  // re-trigger it and restart the roll.
  // svelte-ignore state_referenced_locally
  let displayed = $state(value);
  // svelte-ignore state_referenced_locally
  let current = value;
  let raf = 0;

  // Streaming retargets this many times a second. A short ease that restarts
  // from wherever the last one reached reads as one continuous roll; a long
  // ease would lag behind the provider and then snap.
  const lengthFor = (delta: number): number => {
    if (duration !== undefined) return duration;
    if (delta === 0) return 0;
    return Math.min(520, Math.max(180, 170 + Math.sqrt(delta) * 6));
  };

  const reducedMotion = (): boolean =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  $effect(() => {
    const target = value;
    if (!Number.isFinite(target)) return;
    const from = current;
    cancelAnimationFrame(raf);
    if (target === from) {
      displayed = target;
      return;
    }
    if (reducedMotion()) {
      current = target;
      displayed = target;
      return;
    }
    const startedAt = performance.now();
    const ms = lengthFor(Math.abs(target - from));
    const step = (now: number) => {
      const p = ms <= 0 ? 1 : Math.min(1, (now - startedAt) / ms);
      // Quartic ease-out: fast first movement, gentle settle, no overshoot.
      const eased = 1 - Math.pow(1 - p, 4);
      current = p < 1 ? from + (target - from) * eased : target;
      displayed = current;
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });
</script>

{format(Math.round(displayed))}
