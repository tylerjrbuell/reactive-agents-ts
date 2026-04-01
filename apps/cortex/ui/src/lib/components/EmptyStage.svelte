<script lang="ts">
  interface Props {
    onFocusInput: () => void;
  }
  let { onFocusInput }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center h-full text-center animate-fade-up">
  <div
    class="w-16 h-16 rounded-full border border-outline-variant/20 flex items-center justify-center mb-8 bg-surface-container-low"
  >
    <span class="material-symbols-outlined text-2xl text-outline">hub</span>
  </div>

  <p class="font-mono text-xs text-outline uppercase tracking-widest mb-6">No agents connected yet.</p>

  <div class="space-y-3 text-center">
    <div class="px-4 py-2 bg-primary/5 border border-primary/10 rounded-lg">
      <code class="font-mono text-xs text-primary"> rax run "your prompt" --cortex </code>
    </div>
    <div class="px-4 py-2 bg-surface-container-low border border-outline-variant/10 rounded-lg">
      <code class="font-mono text-xs text-on-surface/50"> # or add .withCortex() to any agent </code>
    </div>
  </div>

  <button
    type="button"
    class="mt-8 text-xs font-mono text-secondary hover:underline transition-colors bg-transparent border-0 cursor-pointer"
    onclick={onFocusInput}
  >
    Or type below ↓
  </button>
</div>
