<script lang="ts">
  interface Props {
    placeholder?: string;
    loading?: boolean;
    onSubmit?: (value: string) => void;
  }
  let { placeholder = "What should your agent do?", loading = false, onSubmit }: Props = $props();

  let value = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);

  export function focus() {
    inputEl?.focus();
  }

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSubmit?.(trimmed);
    value = "";
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }
</script>

<div class="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-40">
  <div
    class="bg-surface-container-low/80 backdrop-blur-md rounded-full border border-primary/20 p-1.5 flex items-center shadow-[0_0_30px_rgba(208,188,255,0.1)] focus-within:shadow-[0_0_40px_rgba(208,188,255,0.2)] focus-within:border-primary/40 transition-all duration-300"
  >
    <div class="flex items-center gap-3 w-full px-4">
      <span class="material-symbols-outlined text-primary text-xl flex-shrink-0">keyboard_command_key</span>
      <input
        bind:this={inputEl}
        bind:value
        type="text"
        {placeholder}
        disabled={loading}
        onkeydown={handleKeydown}
        class="w-full bg-transparent border-none outline-none text-on-surface font-mono text-xs uppercase tracking-widest py-3 placeholder:text-outline/40 placeholder:normal-case placeholder:tracking-normal"
      />
    </div>

    <button
      type="button"
      onclick={handleSubmit}
      disabled={!value.trim() || loading}
      class="bg-primary text-on-primary h-10 w-10 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-glow-primary disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 border-0 cursor-pointer"
    >
      {#if loading}
        <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
      {:else}
        <span class="material-symbols-outlined font-bold">arrow_forward</span>
      {/if}
    </button>
  </div>
</div>
