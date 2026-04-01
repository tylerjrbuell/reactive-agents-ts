<script lang="ts">
  import { goto } from "$app/navigation";
  import { onMount } from "svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { resolveRunIdFromRunsApi } from "$lib/resolve-run-id.js";
  import { settings } from "$lib/stores/settings.js";
  import { toast } from "$lib/stores/toast-store.js";

  // Initialise from persisted settings — populated in onMount so SSR is safe
  let provider = $state("anthropic");
  let model = $state("");
  let prompt = $state("");
  let loading = $state(false);
  let error = $state<string | null>(null);
  let enabledCapabilities = $state<Set<string>>(new Set());

  // Settings-sourced label shown next to dropdowns
  let settingsSource = $state(false);

  onMount(() => {
    settings.init();
    const s = settings.get();
    provider = s.defaultProvider;
    model = s.defaultModel;
    settingsSource = true;
  });

  // Keep in sync when settings page updates (same-session changes)
  const unsubSettings = settings.subscribe((s) => {
    // Only apply if the user hasn't manually changed the values away from defaults
    if (settingsSource) {
      provider = s.defaultProvider;
      model = s.defaultModel;
    }
  });

  const capabilities = [
    { id: "reasoning",  label: "Reasoning",   icon: "psychology"   },
    { id: "tools",      label: "Tools",        icon: "construction" },
    { id: "guardrails", label: "Guardrails",   icon: "security"     },
    { id: "memory",     label: "Memory",       icon: "account_tree" },
  ] as const;

  const providers = ["anthropic", "openai", "gemini", "ollama", "litellm", "test"] as const;

  function toggleCapability(id: string) {
    const next = new Set(enabledCapabilities);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    enabledCapabilities = next;
  }

  async function handleRun() {
    if (!prompt.trim()) return;
    loading = true;
    error = null;
    const sinceMs = Date.now();
    const tools = enabledCapabilities.has("tools") ? ["web-search"] : undefined;
    try {
      const body: Record<string, unknown> = {
        prompt: prompt.trim(),
        provider,
      };
      if (tools?.length) body.tools = tools;
      if (model.trim()) body.model = model.trim();

      const res = await fetch(`${CORTEX_SERVER_URL}/api/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 501) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Run submission not available (501).");
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = (await res.json()) as { runId?: string; agentId?: string };

      let runId = data.runId;
      if (!runId && data.agentId) {
        runId = (await resolveRunIdFromRunsApi(fetch, data.agentId, sinceMs)) ?? undefined;
      }
      if (!runId) throw new Error("Run started but run ID was not available. Check Stage.");

      toast.info("Agent starting…", `${provider}${model ? ` · ${model}` : ""}`);
      void goto(`/run/${runId}`);
    } catch (e) {
      const msg = String(e).replace(/^Error: /, "");
      error = msg;
      toast.error("Failed to start agent", msg);
    } finally {
      loading = false;
    }
  }
</script>

<div class="rounded-lg border border-outline-variant/20 bg-surface-container-low/40 p-6 space-y-5">

  <!-- Provider + model row -->
  <div class="flex flex-col sm:flex-row gap-3">
    <div class="flex-1">
      <label class="text-[9px] font-mono text-outline uppercase tracking-widest block mb-1.5">
        Provider
        {#if settingsSource}
          <span class="text-primary/40 ml-1">· from settings</span>
        {/if}
      </label>
      <select
        bind:value={provider}
        class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2
               text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none"
      >
        {#each providers as p}
          <option value={p}>{p}</option>
        {/each}
      </select>
    </div>
    <div class="flex-1">
      <label class="text-[9px] font-mono text-outline uppercase tracking-widest block mb-1.5">
        Model
        {#if settingsSource && model}
          <span class="text-primary/40 ml-1">· from settings</span>
        {/if}
      </label>
      <input
        bind:value={model}
        placeholder="Default model"
        class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2
               text-sm font-mono text-on-surface placeholder:text-outline/40
               focus:border-primary/50 focus:outline-none"
      />
    </div>
  </div>

  <!-- Prompt -->
  <div>
    <label class="text-[9px] font-mono text-outline uppercase tracking-widest block mb-1.5">Prompt</label>
    <textarea
      bind:value={prompt}
      placeholder="Describe what you want the agent to do…"
      rows="4"
      class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded px-4 py-3
             text-sm font-mono text-on-surface placeholder:text-outline/40 resize-none
             focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
    ></textarea>
  </div>

  <!-- Capabilities -->
  <div>
    <span class="text-[9px] font-mono text-outline uppercase tracking-widest block mb-2">Capabilities</span>
    <div class="flex flex-wrap gap-2">
      {#each capabilities as cap}
        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono border transition-all
                 {enabledCapabilities.has(cap.id)
                   ? 'bg-primary/10 border-primary/40 text-primary'
                   : 'bg-surface-container border-outline-variant/20 text-outline hover:border-primary/30 hover:text-primary'}"
          onclick={() => toggleCapability(cap.id)}
        >
          <span class="material-symbols-outlined text-xs">{cap.icon}</span>
          {cap.label}
        </button>
      {/each}
    </div>
  </div>

  {#if error}
    <p class="text-[11px] font-mono text-error bg-error/5 border border-error/20 rounded px-3 py-2">{error}</p>
  {/if}

  <!-- Actions -->
  <div class="flex items-center justify-between pt-1">
    <a
      href="/settings"
      class="text-[10px] font-mono text-outline/50 hover:text-primary transition-colors no-underline flex items-center gap-1"
    >
      <span class="material-symbols-outlined text-sm">settings</span>
      Change defaults
    </a>

    <button
      type="button"
      disabled={!prompt.trim() || loading}
      onclick={handleRun}
      class="flex items-center gap-2 px-5 py-2 bg-primary text-on-primary font-mono text-xs uppercase
             rounded hover:brightness-110 active:scale-95 transition-all shadow-glow-violet
             disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {#if loading}
        <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
      {:else}
        <span class="material-symbols-outlined text-sm">play_arrow</span>
      {/if}
      Run Agent
    </button>
  </div>
</div>
