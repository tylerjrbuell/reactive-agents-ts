<script lang="ts">
  import { onMount } from "svelte";
  import { settings } from "$lib/stores/settings.js";
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import { type AgentConfig, defaultConfig } from "$lib/types/agent-config.js";

  interface Props {
    placeholder?: string;
    loading?: boolean;
    onSubmit?: (prompt: string, config: AgentConfig) => void;
  }
  let {
    placeholder = "What should your agent do?",
    loading = false,
    onSubmit,
  }: Props = $props();

  let value = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);
  let expanded = $state(false);
  let config = $state<AgentConfig>(defaultConfig());

  onMount(() => {
    settings.init();
    const s = settings.get();
    config = { ...defaultConfig(), provider: s.defaultProvider, model: s.defaultModel ?? "" };
    const unsub = settings.subscribe((s) => {
      if (!expanded) {
        config = { ...config, provider: s.defaultProvider, model: s.defaultModel ?? "" };
      }
    });
    return unsub;
  });

  export function focus() { inputEl?.focus(); }

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSubmit?.(trimmed, config);
    value = "";
    expanded = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
    if (e.key === "Escape") expanded = false;
  }

  // Summary shown in collapsed pill
  const configSummary = $derived(
    [config.provider, config.model?.split("-").slice(-1)[0]].filter(Boolean).join("·")
  );
</script>

<div class="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-40">

  <!-- ── Config accordion (above pill) ──────────────────────────────── -->
  {#if expanded}
    <div
      class="mb-2 bg-surface-container-low/95 backdrop-blur-xl border border-primary/20 rounded-2xl
             shadow-neural-strong animate-fade-up overflow-y-auto max-h-[60vh] p-4"
    >
      <AgentConfigPanel bind:config compact={false} />
    </div>
  {/if}

  <!-- ── Main pill ───────────────────────────────────────────────────── -->
  <div
    class="bg-surface-container-low/80 backdrop-blur-md border border-primary/20 p-1.5
           flex items-center shadow-[0_0_30px_rgba(139,92,246,0.1)]
           focus-within:shadow-[0_0_40px_rgba(139,92,246,0.2)] focus-within:border-primary/40
           transition-all duration-300
           {expanded ? 'rounded-2xl' : 'rounded-full'}"
  >
    <!-- Config toggle -->
    <button
      type="button"
      onclick={() => (expanded = !expanded)}
      class="flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full border-0 bg-transparent
             cursor-pointer hover:bg-primary/8 transition-colors flex-shrink-0 group"
      title="Configure agent params ({configSummary})"
    >
      <span class="material-symbols-outlined text-primary text-base flex-shrink-0 transition-transform
                   {expanded ? 'rotate-180' : ''}">
        {expanded ? "keyboard_arrow_down" : "tune"}
      </span>
      {#if !expanded}
        <span class="text-[9px] font-mono text-outline/50 group-hover:text-outline/80 transition-colors
                     hidden sm:inline max-w-[120px] truncate">
          {configSummary}
        </span>
      {/if}
    </button>

    <div class="w-px h-5 bg-outline-variant/20 mx-1 flex-shrink-0"></div>

    <input
      bind:this={inputEl}
      bind:value
      type="text"
      {placeholder}
      disabled={loading}
      onkeydown={handleKeydown}
      class="flex-1 bg-transparent border-none outline-none text-on-surface font-mono text-xs
             uppercase tracking-widest py-3 px-2 placeholder:text-outline/40
             placeholder:normal-case placeholder:tracking-normal"
    />

    <!-- Submit: gradient neural pulse button -->
    <button
      type="button"
      onclick={handleSubmit}
      disabled={!value.trim() || loading}
      class="relative flex-shrink-0 h-11 w-11 rounded-full border-0 cursor-pointer
             disabled:opacity-40 disabled:cursor-not-allowed group"
      style="background: linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%);
             box-shadow: 0 0 20px rgba(139,92,246,0.4);"
    >
      {#if value.trim() && !loading}
        <span class="absolute inset-0 rounded-full animate-ping"
          style="background: rgba(139,92,246,0.25); animation-duration: 2s;"></span>
      {/if}
      <span class="relative z-10 flex items-center justify-center h-full w-full">
        {#if loading}
          <span class="material-symbols-outlined text-white text-sm animate-spin">progress_activity</span>
        {:else}
          <span class="material-symbols-outlined text-white font-bold text-base
                       group-hover:scale-110 group-active:scale-95 transition-transform">send</span>
        {/if}
      </span>
    </button>
  </div>
</div>
