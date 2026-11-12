<script lang="ts">
  /**
   * Judgment: the backend that answers typed judgments (`.withJudgment()`): TypeSafe Jev
   * (calibrated), an Ollama System One model, or the agent's own model (uncalibrated). Off
   * by default. Applied by the server as an overlay (the framework has no AgentConfig form
   * for it); the TypeSafe key comes from Settings · Providers. Rules: `lib/judgment-config.ts`.
   * What the run asked and decided shows in the run view's Judgments tab.
   */
  import { onMount } from "svelte";
  import ConfigSection from "../ConfigSection.svelte";
  import { CORTEX_SERVER_URL } from "$lib/constants.js";
  import { providerKeysApi } from "$lib/provider-keys.js";
  import {
    JUDGMENT_BACKEND_OPTIONS,
    OLLAMA_JUDGMENT_MODELS,
    activeBackendOf,
    judgmentHeadOf,
    ollamaJudgmentNote,
    type JudgmentBackendChoice,
    type JudgmentFormConfig,
    type TypesafeKeySource,
  } from "$lib/judgment-config.js";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
  }
  let { config = $bindable(), open, onToggle }: Props = $props();

  const j = $derived<JudgmentFormConfig>(config.judgment ?? { enabled: false });
  function patch(next: Partial<JudgmentFormConfig>) {
    config = { ...config, judgment: { ...j, ...next } };
  }

  let keySource = $state<TypesafeKeySource>("none");
  let ollamaCloud = $state(false);
  let catalog = $state<readonly { name: string; description: string }[]>([]);
  let catalogNote = $state<string | null>(null);

  onMount(() => {
    void providerKeysApi(CORTEX_SERVER_URL)
      .list()
      .then((r) => {
        if (!r.ok) return;
        const s = r.value.providers.find((p) => p.provider === "typesafe");
        keySource = s?.source ?? "none";
      });
    void fetch(`${CORTEX_SERVER_URL}/api/settings/ollama`)
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { cloud?: boolean } | null) => {
        ollamaCloud = v?.cloud === true;
      })
      .catch(() => undefined);
  });

  const active = $derived(activeBackendOf(j, keySource));

  // TypeSafe's model catalog, only while Jev is the active backend (a catalog call needs the key).
  let catalogFor = "";
  $effect(() => {
    if (!j.enabled || active.backend !== "jev" || keySource === "none") {
      catalog = [];
      catalogNote = null;
      catalogFor = "";
      return;
    }
    const mark = `${keySource}`;
    if (catalogFor === mark) return;
    catalogFor = mark;
    void fetch(`${CORTEX_SERVER_URL}/api/judgment/models`)
      .then((r) => r.json() as Promise<{ available?: boolean; reason?: string; models?: { name: string; description: string }[] }>)
      .then((v) => {
        catalog = v.available ? (v.models ?? []) : [];
        catalogNote = v.available ? null : (v.reason ?? "Could not read the TypeSafe model list.");
      })
      .catch(() => {
        catalogNote = "Could not reach the Cortex server.";
      });
  });

  const modelSuggestions = $derived(
    active.backend === "jev" ? catalog.map((m) => m.name) : active.backend === "ollama" ? [...OLLAMA_JUDGMENT_MODELS] : [],
  );
  const backendValue = $derived(j.backend ?? "auto");
</script>

<ConfigSection id="judgment" icon="goal" title="Judgment" {open} {onToggle}>
  {#snippet head()}<span class="truncate">{judgmentHeadOf(j)}</span>{/snippet}
  <p class="acp-hint leading-relaxed">
    Typed judgments (Noul, Score, Choice) for <code>agent.judge()</code> and the framework's judgment checks. Every judgment a run asks is listed in the run's <strong>Judgments</strong> tab. Off by default; with Ollama running on this machine the framework may still sample observation-only shadow judgments (set <code>REACTIVE_AGENTS_NO_AUTO_SHADOW=1</code> to stop that).
  </p>

  <label class="flex items-center gap-3 cursor-pointer">
    <input type="checkbox" checked={j.enabled} onchange={(e) => patch({ enabled: (e.target as HTMLInputElement).checked })} class="accent-accent-fill w-3.5 h-3.5" />
    <div>
      <div class="acp-check-t">Use a judgment backend</div>
      <div class="acp-hint">Calls <code>.withJudgment()</code> when the agent is built</div>
    </div>
  </label>

  {#if j.enabled}
    <div>
      <label for="judgment-backend" class="config-label">Backend</label>
      <select
        id="judgment-backend"
        class="config-input"
        value={backendValue}
        onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          patch({ backend: v === "auto" ? undefined : (v as JudgmentBackendChoice) });
        }}
      >
        {#each JUDGMENT_BACKEND_OPTIONS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
      </select>
      <p class="acp-hint mt-1" data-testid="judgment-active">
        Active: <strong>{active.backend}</strong> ({active.why}).
        {#if active.backend === "jev" && keySource === "none"}
          No TypeSafe key yet. <a class="underline" href="/settings#providers">Add one in Settings · Providers</a> or set <code>TYPESAFE_API_KEY</code>.
        {:else if active.backend === "llm"}
          Answers are uncalibrated (<code>calibrated: false</code>) and cost the agent's own model calls.
        {/if}
      </p>
    </div>

    <div>
      <label for="judgment-model" class="config-label">Model <span class="text-text-3/70 font-normal">(optional)</span></label>
      <input
        id="judgment-model"
        class="config-input"
        list="judgment-model-options"
        placeholder={active.backend === "ollama" ? "nimble" : active.backend === "jev" ? "TypeSafe default" : "the agent's model"}
        value={j.model ?? ""}
        oninput={(e) => patch({ model: (e.target as HTMLInputElement).value })}
      />
      <datalist id="judgment-model-options">
        {#each modelSuggestions as m (m)}<option value={m}></option>{/each}
      </datalist>
      {#if active.backend === "jev"}
        <p class="acp-hint mt-1">{catalogNote ?? (catalog.length > 0 ? `${catalog.length} models on your TypeSafe account.` : "Type a model id, or leave blank for the account default.")}</p>
      {:else if active.backend === "ollama"}
        <p class="acp-hint mt-1">{ollamaJudgmentNote(ollamaCloud)}</p>
      {/if}
    </div>

    <div>
      <label for="judgment-timeout" class="config-label">Timeout (ms) <span class="text-text-3/70 font-normal">(optional)</span></label>
      <input
        id="judgment-timeout"
        type="number"
        min="1"
        class="config-input"
        placeholder={active.backend === "ollama" ? "30000" : "3000"}
        value={j.timeoutMs ?? ""}
        oninput={(e) => {
          const n = Number((e.target as HTMLInputElement).value);
          patch({ timeoutMs: Number.isFinite(n) && n > 0 ? n : undefined });
        }}
      />
    </div>

    <div>
      <label for="judgment-baseurl" class="config-label">Base URL <span class="text-text-3/70 font-normal">(optional)</span></label>
      <input
        id="judgment-baseurl"
        class="config-input"
        placeholder={active.backend === "ollama" ? "http://localhost:11434" : "the TypeSafe API"}
        value={j.baseUrl ?? ""}
        oninput={(e) => patch({ baseUrl: (e.target as HTMLInputElement).value })}
      />
      {#if active.backend === "ollama"}
        <p class="acp-hint mt-1">Blank uses the Ollama endpoint from Settings · Providers. The Ollama API key is not sent for judgments (the framework's System One call has no auth).</p>
      {/if}
    </div>

    {#if active.backend === "ollama"}
      <div>
        <label for="judgment-keepalive" class="config-label">Keep alive <span class="text-text-3/70 font-normal">(optional)</span></label>
        <input
          id="judgment-keepalive"
          class="config-input"
          placeholder="5m"
          value={j.keepAlive ?? ""}
          oninput={(e) => patch({ keepAlive: (e.target as HTMLInputElement).value })}
        />
        <p class="acp-hint mt-1">How long Ollama keeps the model loaded after a judgment: seconds (<code>300</code>) or <code>5m</code>; <code>0</code> unloads at once, <code>-1</code> never.</p>
      </div>
    {/if}
  {/if}
</ConfigSection>
