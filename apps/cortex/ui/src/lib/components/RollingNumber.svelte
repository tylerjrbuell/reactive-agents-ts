<script lang="ts">
  interface Props {
    value: number;
    format?: (n: number) => string;
    duration?: number;
  }
  const { value, format = (n: number) => String(Math.round(n)), duration = 600 }: Props = $props();

  let displayed = $state(value);
  let raf = 0;

  $effect(() => {
    const target = value;
    const from = displayed;
    if (target === from) return;
    const start = performance.now();
    cancelAnimationFrame(raf);
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      displayed = from + (target - from) * eased;
      if (p < 1) raf = requestAnimationFrame(step);
      else displayed = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });
</script>

{format(Math.round(displayed))}