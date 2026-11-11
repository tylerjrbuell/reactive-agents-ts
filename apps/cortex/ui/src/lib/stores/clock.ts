import { readable } from "svelte/store";

/** Wall clock for relative timestamps ("3 minutes ago"); one shared 30 s tick, idle when nothing subscribes. */
export const clock = readable(Date.now(), (set) => {
  const id = setInterval(() => set(Date.now()), 30_000);
  return () => clearInterval(id);
});

/** One-second tick for live elapsed counters (a running turn); idle when nothing subscribes. */
export const secondClock = readable(Date.now(), (set) => {
  const id = setInterval(() => set(Date.now()), 1_000);
  return () => clearInterval(id);
});
