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
    placeholder = "Ask or describe a task for the agent…",
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
      class="mb-2 rounded-2xl backdrop-blur-xl animate-fade-up overflow-y-auto max-h-[60vh] p-4
             bg-gradient-to-b from-white/98 via-violet-50/85 to-slate-100/95
             dark:from-[#1a1c26]/98 dark:via-[#151821]/98 dark:to-[#12141c]/98
             shadow-[0_0_0_1px_rgba(124,58,237,0.22),0_1px_3px_rgba(15,23,42,0.06),0_12px_32px_rgba(124,58,237,0.07)]
             dark:shadow-[0_0_0_1px_rgba(139,92,246,0.45),0_0_0_1px_rgba(6,182,212,0.12)_inset,0_12px_40px_rgba(139,92,246,0.18)]"
    >
      <AgentConfigPanel bind:config compact={false} />
    </div>
  {/if}

  <!-- ── Main pill ───────────────────────────────────────────────────── -->
  <div
    class="backdrop-blur-md p-1.5 flex items-center transition-all duration-300
           bg-gradient-to-r from-white/98 via-violet-50/75 to-slate-50/95
           dark:from-[#1e2130]/95 dark:via-[#161822]/98 dark:to-[#1a2330]/95
           shadow-[0_0_0_1px_rgba(124,58,237,0.28),0_0_0_1px_rgba(255,255,255,0.6)_inset,0_4px_22px_rgba(124,58,237,0.1)]
           dark:shadow-[0_0_0_1px_rgba(139,92,246,0.5),0_0_0_1px_rgba(6,182,212,0.15)_inset,0_4px_28px_rgba(139,92,246,0.2),0_0_48px_rgba(6,182,212,0.08)]
           focus-within:shadow-[0_0_0_1px_rgba(6,182,212,0.4),0_0_0_1px_rgba(124,58,237,0.2)_inset,0_6px_28px_rgba(124,58,237,0.18)]
           dark:focus-within:shadow-[0_0_0_1px_rgba(6,182,212,0.55),0_0_0_1px_rgba(139,92,246,0.35)_inset,0_6px_36px_rgba(139,92,246,0.35),0_0_60px_rgba(6,182,212,0.15)]
           {expanded ? 'rounded-2xl' : 'rounded-full'}"
  >
    <!-- Config toggle -->
    <button
      type="button"
      onclick={() => (expanded = !expanded)}
      class="flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full border-0 bg-transparent
             cursor-pointer hover:bg-primary/15 transition-colors flex-shrink-0 group text-primary"
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

    <div
      class="w-px h-6 mx-1 flex-shrink-0 bg-gradient-to-b from-transparent via-primary/60 to-transparent opacity-90"
    ></div>

    <input
      bind:this={inputEl}
      bind:value
      type="text"
      {placeholder}
      disabled={loading}
      onkeydown={handleKeydown}
      class="flex-1 bg-transparent border-none outline-none text-on-surface text-sm py-3 px-2
             placeholder:text-outline/45 placeholder:font-mono placeholder:text-[13px]"
    />

    <!-- Submit: gradient neural pulse button -->
    <button
      type="button"
      onclick={handleSubmit}
      disabled={!value.trim() || loading}
      class="relative flex-shrink-0 h-11 w-11 rounded-full border-0 cursor-pointer
             disabled:opacity-40 disabled:cursor-not-allowed group
             bg-gradient-to-br from-violet-600 via-violet-500 to-cyan-400
             shadow-[0_0_0_1px_rgba(124,58,237,0.45),0_6px_16px_rgba(124,58,237,0.35),0_0_12px_rgba(6,182,212,0.22)]
             dark:shadow-[0_0_0_1px_rgba(196,181,253,0.35),0_0_20px_rgba(139,92,246,0.55),0_0_28px_rgba(6,182,212,0.35)]"
    >
      {#if value.trim() && !loading}
        <span
          class="absolute inset-0 rounded-full animate-ping bg-violet-500/20 dark:bg-violet-400/25"
          style="animation-duration: 2s;"
        ></span>
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
