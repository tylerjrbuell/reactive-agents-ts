<script lang="ts">
  import { secondClock } from "$lib/stores/clock.js";
  import { turnTiming } from "$lib/chat-turn-meta.js";

  /** Live "Running 12s" counter; mounted only while a turn streams, so idle turns never tick. */
  const { since }: { since: number } = $props();
  const label = $derived(turnTiming({ ts: since, streaming: true }, $secondClock).ran ?? "");
</script>

<span class="tabular-nums" aria-live="off">{label}</span>
