<script lang="ts">
  import { goto } from "$app/navigation";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { resolveRunIdFromRunsApi } from "$lib/resolve-run-id.js";

  let provider = $state("anthropic");
  let model = $state("");
  let prompt = $state("");
  let loading = $state(false);
  let error = $state<string | null>(null);
  let enabledCapabilities = $state<Set<string>>(new Set());

  const capabilities = [
    { id: "reasoning", label: "Reasoning", icon: "psychology" },
    { id: "tools", label: "Tools", icon: "construction" },
    { id: "guardrails", label: "Guardrails", icon: "security" },
    { id: "memory", label: "Memory", icon: "account_tree" },
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
    const tools = enabledCapabilities.has("tools") ? (["web-search"] as string[]) : undefined;
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
      if (!runId) {
        throw new Error(
          "Run started but run id was not available yet. Check Stage or try again in a moment.",
        );
      }
      void goto(`/run/${runId}`);
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }
</script>

<div class="rounded-lg border border-outline-variant/20 bg-surface-container-low/40 p-6 space-y-5">
  <div class="flex flex-wrap gap-3 text-[10px] font-mono text-outline">
    <span class="px-3 py-1.5 rounded border border-outline-variant/20">New agent</span>
    <span class="px-3 py-1.5 rounded border border-outline-variant/10 text-on-surface-variant"
      >Load config — soon</span
    >
  </div>

  <div class="flex flex-col sm:flex-row gap-3">
    <select
      bind:value={provider}
      class="flex-1 bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2 text-sm font-mono text-on-surface focus:border-primary/50 focus:outline-none"
    >
      {#each providers as p}
        <option value={p}>{p}</option>
      {/each}
    </select>
    <input
      bind:value={model}
      placeholder="Model (optional)"
      class="flex-1 bg-surface-container-lowest border border-outline-variant/20 rounded px-3 py-2 text-sm font-mono text-on-surface placeholder:text-outline/40 focus:border-primary/50 focus:outline-none"
    />
  </div>

  <textarea
    bind:value={prompt}
    placeholder="Describe what you want the agent to do…"
    rows="4"
    class="w-full bg-surface-container-lowest border border-outline-variant/20 rounded px-4 py-3 text-sm font-mono text-on-surface placeholder:text-outline/40 resize-none focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
  ></textarea>

  <div>
    <span class="text-[9px] font-mono text-outline uppercase tracking-widest block mb-2"
      >Capabilities</span
    >
    <div class="flex flex-wrap gap-2">
      {#each capabilities as cap}
        <button
          type="button"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-mono border transition-all {enabledCapabilities.has(
            cap.id,
          )
            ? 'bg-primary/10 border-primary/40 text-primary'
            : 'bg-surface-container border-outline-variant/20 text-outline hover:border-primary/30'}"
          onclick={() => toggleCapability(cap.id)}
        >
          <span class="material-symbols-outlined text-xs">{cap.icon}</span>
          {cap.label}
        </button>
      {/each}
    </div>
    <p class="mt-2 text-[10px] font-mono text-on-surface-variant">
      Reasoning / guardrails / memory are visual tags for now; runner wiring can follow the same paths
      as `rax run`.
    </p>
  </div>

  {#if error}
    <p class="text-xs font-mono text-error">{error}</p>
  {/if}

  <div class="flex items-center justify-end gap-3 pt-2">
    <button
      type="button"
      disabled={!prompt.trim() || loading}
      onclick={handleRun}
      class="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-primary-container to-primary text-on-primary font-mono text-xs uppercase rounded shadow-glow-primary hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
    >
      {#if loading}
        <span class="material-symbols-outlined text-sm animate-spin">progress_activity</span>
      {:else}
        <span class="material-symbols-outlined text-sm">play_arrow</span>
      {/if}
      Run agent
    </button>
  </div>
</div>
