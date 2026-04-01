<script lang="ts">
  import { onMount } from "svelte";
  import { settings } from "$lib/stores/settings.js";

  interface RunConfig {
    provider: string;
    model: string;
    tools: string[];
  }

  interface Props {
    placeholder?: string;
    loading?: boolean;
    /** Called with the prompt text and any config overrides */
    onSubmit?: (prompt: string, config: RunConfig) => void;
  }
  let {
    placeholder = "What should your agent do?",
    loading = false,
    onSubmit,
  }: Props = $props();

  let value = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);
  let expanded = $state(false);

  // Config — initialised from settings, editable inline
  let provider = $state("anthropic");
  let model    = $state("");
  let withTools = $state(true);

  const PROVIDERS = ["anthropic", "openai", "gemini", "ollama", "litellm", "test"] as const;

  const MODELS: Record<string, { value: string; label: string }[]> = {
    anthropic: [
      { value: "claude-sonnet-4-6",         label: "Sonnet 4.6" },
      { value: "claude-opus-4-6",           label: "Opus 4.6" },
      { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
    ],
    openai: [
      { value: "gpt-4o",      label: "GPT-4o" },
      { value: "gpt-4o-mini", label: "GPT-4o Mini" },
      { value: "o1",          label: "o1" },
    ],
    gemini: [
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
      { value: "gemini-2.0-pro",   label: "Gemini 2.0 Pro" },
    ],
    ollama: [
      { value: "llama3.2",   label: "Llama 3.2" },
      { value: "mistral",    label: "Mistral" },
      { value: "cogito:14b", label: "Cogito 14B" },
    ],
    litellm: [{ value: "", label: "Any (via LiteLLM)" }],
    test:    [{ value: "", label: "Test (mock)" }],
  };

  const modelOptions = $derived(MODELS[provider] ?? []);

  // Label shown in the pill when collapsed
  const configSummary = $derived(
    `${provider}${model ? ` · ${model}` : ""}${withTools ? " · tools" : ""}`,
  );

  onMount(() => {
    settings.init();
    const s = settings.get();
    provider  = s.defaultProvider;
    model     = s.defaultModel ?? "";
    // Stay in sync with settings changes (same session)
    const unsub = settings.subscribe((s) => {
      provider = s.defaultProvider;
      model    = s.defaultModel ?? "";
    });
    return unsub;
  });

  export function focus() { inputEl?.focus(); }

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSubmit?.(trimmed, {
      provider,
      model: model.trim() || provider === "test" ? model : model,
      tools: withTools ? ["web-search"] : [],
    });
    value = "";
    expanded = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
    if (e.key === "Escape") expanded = false;
  }
</script>

<div class="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-2xl px-4 z-40">

  <!-- ── Config accordion — slides in above the pill ────────────────── -->
  {#if expanded}
    <div
      class="mb-2 bg-surface-container-low/90 backdrop-blur-md border border-primary/20 rounded-2xl
             p-4 shadow-neural-strong animate-fade-up"
    >
      <div class="flex items-center justify-between mb-3">
        <span class="text-[9px] font-mono text-outline/60 uppercase tracking-widest">Run Config</span>
        <button
          type="button"
          class="text-[9px] font-mono text-secondary/60 hover:text-secondary bg-transparent border-0 cursor-pointer"
          onclick={() => { settings.init(); const s = settings.get(); provider = s.defaultProvider; model = s.defaultModel ?? ""; }}
        >
          Reset to defaults
        </button>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <!-- Provider -->
        <div>
          <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1">Provider</label>
          <select
            bind:value={provider}
            onchange={() => {
              const opts = MODELS[provider];
              if (opts?.[0]) model = opts[0].value;
              else model = "";
            }}
            class="w-full bg-surface-container border border-outline-variant/20 rounded-lg px-3 py-1.5
                   text-[11px] font-mono text-on-surface focus:border-primary/50 focus:outline-none"
          >
            {#each PROVIDERS as p}
              <option value={p}>{p}</option>
            {/each}
          </select>
        </div>

        <!-- Model -->
        <div>
          <label class="text-[9px] font-mono text-outline/60 uppercase tracking-widest block mb-1">Model</label>
          {#if modelOptions.length > 0}
            <select
              bind:value={model}
              class="w-full bg-surface-container border border-outline-variant/20 rounded-lg px-3 py-1.5
                     text-[11px] font-mono text-on-surface focus:border-primary/50 focus:outline-none"
            >
              {#each modelOptions as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
              <!-- Allow typing a custom model -->
            </select>
          {:else}
            <input
              bind:value={model}
              placeholder="Model name…"
              class="w-full bg-surface-container border border-outline-variant/20 rounded-lg px-3 py-1.5
                     text-[11px] font-mono text-on-surface placeholder:text-outline/40
                     focus:border-primary/50 focus:outline-none"
            />
          {/if}
        </div>
      </div>

      <!-- Custom model override when using a dropdown provider -->
      {#if modelOptions.length > 0}
        <div class="mt-2">
          <label class="text-[9px] font-mono text-outline/40 uppercase tracking-widest block mb-1">
            Custom model override <span class="normal-case text-outline/30">(optional)</span>
          </label>
          <input
            bind:value={model}
            placeholder="e.g. claude-opus-4-6 or leave blank for default"
            class="w-full bg-surface-container border border-outline-variant/15 rounded-lg px-3 py-1.5
                   text-[11px] font-mono text-on-surface placeholder:text-outline/30
                   focus:border-primary/50 focus:outline-none"
          />
        </div>
      {/if}

      <!-- Tools -->
      <div class="mt-3 flex items-center gap-3">
        <button
          type="button"
          class="flex items-center gap-2 text-[10px] font-mono cursor-pointer bg-transparent border-0 p-0"
          onclick={() => (withTools = !withTools)}
        >
          <span
            class="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors
                   {withTools ? 'bg-primary/20 border-primary/50' : 'border-outline-variant/30'}"
          >
            {#if withTools}
              <span class="material-symbols-outlined text-[10px] text-primary" style="font-variation-settings:'FILL' 1;">check</span>
            {/if}
          </span>
          <span class="{withTools ? 'text-on-surface/80' : 'text-outline/50'}">Enable tools <span class="text-outline/40">(web-search)</span></span>
        </button>

        <a href="/settings" class="ml-auto text-[9px] font-mono text-outline/40 hover:text-primary no-underline transition-colors flex items-center gap-1">
          <span class="material-symbols-outlined text-[11px]">settings</span>
          Edit defaults
        </a>
      </div>
    </div>
  {/if}

  <!-- ── Main pill input ─────────────────────────────────────────────── -->
  <div
    class="bg-surface-container-low/80 backdrop-blur-md border border-primary/20 p-1.5
           flex items-center shadow-[0_0_30px_rgba(139,92,246,0.1)]
           focus-within:shadow-[0_0_40px_rgba(139,92,246,0.2)] focus-within:border-primary/40
           transition-all duration-300
           {expanded ? 'rounded-2xl' : 'rounded-full'}"
  >
    <!-- Config toggle button — shows current config as a subtle label -->
    <button
      type="button"
      onclick={() => (expanded = !expanded)}
      class="flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full border-0 bg-transparent cursor-pointer
             hover:bg-primary/8 transition-colors flex-shrink-0 group"
      title="Configure run params"
    >
      <span class="material-symbols-outlined text-primary text-base flex-shrink-0">
        {expanded ? "keyboard_arrow_down" : "tune"}
      </span>
      {#if !expanded}
        <span class="text-[9px] font-mono text-outline/50 group-hover:text-outline/80 transition-colors hidden sm:inline max-w-[120px] truncate">
          {provider}{model ? `·${model.split("-").slice(-1)[0]}` : ""}
        </span>
      {/if}
    </button>

    <div class="w-px h-5 bg-outline-variant/20 mx-1 flex-shrink-0"></div>

    <div class="flex items-center gap-2 flex-1 px-2">
      <input
        bind:this={inputEl}
        bind:value
        type="text"
        {placeholder}
        disabled={loading}
        onkeydown={handleKeydown}
        class="w-full bg-transparent border-none outline-none text-on-surface font-mono text-xs
               uppercase tracking-widest py-3 placeholder:text-outline/40
               placeholder:normal-case placeholder:tracking-normal"
      />
    </div>

    <!-- Submit button — neural pulse style matching the Cortex brand -->
    <button
      type="button"
      onclick={handleSubmit}
      disabled={!value.trim() || loading}
      class="relative flex-shrink-0 h-11 w-11 rounded-full border-0 cursor-pointer
             disabled:opacity-40 disabled:cursor-not-allowed group"
      style="background: linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%);
             box-shadow: 0 0 20px rgba(139,92,246,0.4);"
    >
      <!-- Sonar ring when prompt has text -->
      {#if value.trim() && !loading}
        <span class="absolute inset-0 rounded-full animate-ping"
          style="background: rgba(139,92,246,0.25); animation-duration: 2s;"></span>
      {/if}
      <span class="relative z-10 flex items-center justify-center h-full w-full">
        {#if loading}
          <span class="material-symbols-outlined text-white text-sm animate-spin">progress_activity</span>
        {:else}
          <span class="material-symbols-outlined text-white font-bold text-base
                       group-hover:scale-110 group-active:scale-95 transition-transform">
            send
          </span>
        {/if}
      </span>
    </button>
  </div>
</div>
