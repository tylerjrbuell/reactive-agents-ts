<script lang="ts">
  import { onMount } from "svelte";

  interface Props {
    agentId: string;
    onClose: () => void;
  }
  let { agentId, onClose }: Props = $props();

  onMount(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  });
</script>

<div
  class="fixed bottom-10 right-6 z-[60] animate-slide-right bg-surface-container-high border border-primary/30 p-4 rounded-lg shadow-neural-strong flex flex-col gap-1 min-w-[280px] max-w-[320px] relative overflow-hidden"
>
  <div class="absolute top-0 left-0 w-1 h-full bg-primary rounded-l-lg"></div>

  <div class="flex justify-between items-center pl-2">
    <div class="flex items-center gap-2">
      <span class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
      <span class="font-mono font-bold text-xs text-primary uppercase tracking-widest">
        {agentId}
      </span>
    </div>
    <button
      type="button"
      class="material-symbols-outlined text-sm text-outline/60 hover:text-outline transition-colors cursor-pointer bg-transparent border-0 p-0"
      onclick={onClose}
      aria-label="Dismiss"
    >
      close
    </button>
  </div>
  <p class="font-body text-sm text-on-surface-variant pl-2">connected to Cortex</p>
</div>
