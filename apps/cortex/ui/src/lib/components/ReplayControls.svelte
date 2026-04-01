<script lang="ts">
  /** Phase 4 stub — scrubber + speed wired when offline replay lands. */
  interface Props {
    status?: string;
  }
  let { status = "idle" }: Props = $props();
</script>

<div
  class="flex items-center gap-3 px-4 py-2 border border-outline-variant/10 rounded-lg bg-surface-container-low/50"
>
  <span class="material-symbols-outlined text-sm text-outline">replay</span>
  <span class="font-mono text-[9px] text-outline uppercase tracking-widest">Replay</span>
  <span class="font-mono text-[9px] text-on-surface/30">1× · scrubber · Phase 5+</span>
  <span class="font-mono text-[9px] text-outline/50">({status})</span>
</div>
