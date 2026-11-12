<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
  import Badge from "$lib/components/kit/Badge.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import HighlightedField from "$lib/components/HighlightedField.svelte";
  import PromptPickerButton from "$lib/components/PromptPickerButton.svelte";
  import { formatTaskContextLines, parseTaskContextLines } from "$lib/task-context-lines.js";
  import type { ProviderOption } from "$lib/providers.js";
  import type { UiModelOption } from "$lib/framework-models.js";
  import type { PanelAgentConfig } from "../types.js";

  interface Props {
    config: PanelAgentConfig;
    open: boolean;
    onToggle: () => void;
    providerList: readonly ProviderOption[];
    /** Models for the selected provider (the panel loads them). */
    providerModels: UiModelOption[];
    modelsLoading: boolean;
    modelsError: string | null;
    modelsNote: string | null;
    loadModelsForProvider: (p: string) => void | Promise<void>;
  }
  let { config = $bindable(), open, onToggle, providerList, providerModels, modelsLoading, modelsError, modelsNote, loadModelsForProvider }: Props = $props();

  let taskContextLinesDraft = $state("");
  let lastTaskContextSig = $state("");
  $effect(() => {
    const sig = JSON.stringify(config.taskContext ?? {});
    if (sig !== lastTaskContextSig) {
      lastTaskContextSig = sig;
      taskContextLinesDraft = formatTaskContextLines(config.taskContext ?? {});
    }
  });

  function commitTaskContextDraft() {
    const next = parseTaskContextLines(taskContextLinesDraft);
    lastTaskContextSig = JSON.stringify(next);
    config = { ...config, taskContext: next };
  }

  const modelOptionsForSelect = $derived.by(() => {
    const cur = config.model.trim();
    const base = providerModels;
    if (cur && !base.some((m) => m.value === cur)) {
      return [{ value: cur, label: `${cur} (custom)` }, ...base];
    }
    return base;
  });

  /** Does the selected model have a thinking mode? true / false / null = not known. */
  const modelThinking = $derived.by((): boolean | null => {
    const cur = config.model.trim();
    const hit = providerModels.find((m) => m.value === cur);
    return hit?.thinking ?? null;
  });
  const thinkingChoice = $derived(config.thinking === true ? "on" : config.thinking === false ? "off" : "auto");
  const thinkingNote = $derived(
    modelThinking === false
      ? "This model has no thinking mode, so this setting has no effect."
      : modelThinking === null
        ? "Not known for this model. The setting applies if the model supports it."
        : thinkingChoice === "auto"
          ? "Supported. Auto uses the model's own default."
          : thinkingChoice === "on"
            ? "Supported. The model reasons before it answers, which is slower and uses more tokens."
            : "Supported but switched off. The model answers directly.",
  );
  function setThinking(choice: "auto" | "on" | "off") {
    if (choice === "auto") {
      const { thinking: _drop, ...rest } = config;
      config = rest as typeof config;
    } else {
      config = { ...config, thinking: choice === "on" };
    }
  }

  function setProvider(p: string) {
    config = { ...config, provider: p, model: "" };
  }
</script>

<ConfigSection id="inference" icon="model" title="Model" {open} {onToggle}>
  {#snippet head()}
      <span class="truncate">{config.provider} / {config.model?.trim() || "default model"}</span>
  {/snippet}
        <!-- Provider + Model -->
        <div class="grid grid-cols-2 gap-4">
          <div class="acp-field">
            <label for="provider-select" class="config-label">Provider</label>
            <Select id="provider-select" class="config-input" value={config.provider} onchange={setProvider}
              options={providerList.map((p) => ({ value: p.id, label: p.id }))} />
          </div>
          <div class="acp-field">
            <div class="flex items-center justify-between gap-2">
              <label for="model-select" class="config-label">Model</label>
              <Button size="sm" variant="ghost" icon="retry" onclick={() => loadModelsForProvider(config.provider)} disabled={modelsLoading}>
                {modelsLoading ? "Loading…" : "Reload list"}
              </Button>
            </div>
            {#if modelsError}
              <input id="model-select" bind:value={config.model} placeholder="Type a model name" class="config-input acp-mono" />
              <p class="acp-hint acp-bad">{modelsError}</p>
            {:else if modelsLoading}
              <div class="config-input acp-muted" role="status">Loading models…</div>
            {:else if modelOptionsForSelect.length > 0}
              <Select id="model-select" class="config-input" bind:value={config.model}
                options={modelOptionsForSelect.map((m) => ({ value: m.value, label: `${m.label}${m.thinking ? " (thinking)" : ""}` }))} />
              {#if modelsNote}<p class="acp-hint">{modelsNote}</p>{/if}
            {:else}
              <input id="model-select" bind:value={config.model} placeholder="Model name" class="config-input acp-mono" />
              {#if modelsNote}<p class="acp-hint">{modelsNote}</p>{/if}
            {/if}
          </div>
        </div>
        <!-- Custom model override -->
        {#if modelOptionsForSelect.length > 0}
          <div class="acp-field">
            <label for="custom-model-override" class="config-label">Model id</label>
            <input id="custom-model-override" bind:value={config.model} placeholder="e.g. claude-opus-4-6"
              class="config-input acp-mono" />
            <p class="acp-hint">Type any id the provider serves; it replaces the choice above.</p>
          </div>
        {/if}
        <!-- Thinking -->
        <div class="acp-field">
          <span class="config-label" id="thinking-label">Thinking
            {#if modelThinking === true}<Badge tone="accent">Model supports it</Badge>
            {:else if modelThinking === false}<Badge>Not supported</Badge>{/if}
          </span>
          <div class="acp-seg" role="radiogroup" aria-labelledby="thinking-label">
            {#each [["auto", "Auto"], ["on", "On"], ["off", "Off"]] as [value, label] (value)}
              <button type="button" role="radio" aria-checked={thinkingChoice === value}
                onclick={() => setThinking(value as "auto" | "on" | "off")}>{label}</button>
            {/each}
          </div>
          <p class="acp-hint">{thinkingNote}</p>
        </div>
        <!-- Temperature + Max tokens -->
        <div class="grid grid-cols-2 gap-4">
          <div class="acp-field">
            <label for="temperature-range" class="config-label flex items-center justify-between">
              Temperature
              <span class="acp-data">{config.temperature.toFixed(2)}</span>
            </label>
            <input id="temperature-range" type="range" min="0" max="1" step="0.05"
              bind:value={config.temperature}
              class="acp-range" />
            <div class="flex justify-between">
              <span class="acp-hint">0 · deterministic</span><span class="acp-hint">1 · creative</span>
            </div>
          </div>
          <div class="acp-field">
            <label for="max-tokens" class="config-label">Max output tokens</label>
            <input id="max-tokens" type="number" min="0" max="200000" step="256"
              bind:value={config.maxTokens}
              class="config-input acp-mono" />
            <p class="acp-hint">0 keeps the framework default.</p>
          </div>
          <div class="acp-field col-span-2">
            <label for="num-ctx" class="config-label">Context length (numCtx)</label>
            <input id="num-ctx" type="number" min="0" max="1048576" step="1024"
              bind:value={config.numCtx}
              class="config-input acp-mono" />
            <p class="acp-hint">
              0 lets the provider decide. Local providers honour it (Ollama num_ctx); cloud providers without a context setting ignore it.
            </p>
          </div>
        </div>
        <!-- Model routing -->
        <div>
          <label class="config-label flex items-center gap-2">
            <input type="checkbox" bind:checked={config.modelRouting.enabled} />
            Cost-aware model routing
          </label>
          {#if config.modelRouting.enabled}
            <label for="routing-min-tier" class="config-label mt-1">Minimum tier</label>
            <Select
              id="routing-min-tier"
              class="config-input"
              value={config.modelRouting.minTier ?? ""}
              options={[
                { value: "", label: "Auto", description: "Cheapest capable" },
                { value: "haiku", label: "Haiku" },
                { value: "sonnet", label: "Sonnet" },
                { value: "opus", label: "Opus" },
              ]}
              onchange={(v) => (config.modelRouting.minTier = v === "haiku" || v === "sonnet" || v === "opus" ? v : undefined)}
            />
          {/if}
          <p class="mt-1 acp-hint">Routes each turn to the cheapest capable model for the provider (<code>.withModelRouting</code>); degrades to the configured model on any routing error.</p>
        </div>
        <!-- Agent name (optional) -->
        <div class="acp-field">
          <label for="agent-name" class="config-label">Agent name</label>
          <HighlightedField id="agent-name" bind:value={config.agentName} placeholder="e.g. research-assistant"
            frameClass="ci-frame" textClass="ci-text" />
          <p class="acp-hint">Optional. Shown on runs; a saved agent uses the name in Run this agent.</p>
        </div>
        <!-- System prompt -->
        <div class="acp-field">
          <div class="flex items-center justify-between gap-2">
            <label for="system-prompt" class="config-label">System prompt</label>
            <PromptPickerButton
              types={["system", "persona"]}
              defaultSaveType="system"
              placement="down"
              title="Insert from prompt library"
              onSelect={(body) => {
                config = { ...config, systemPrompt: config.systemPrompt ? `${config.systemPrompt}\n${body}` : body };
              }}
            />
          </div>
          <HighlightedField multiline id="system-prompt" bind:value={config.systemPrompt}
            placeholder="Instructions added before every run (optional)"
            rows={3}
            frameClass="ci-frame" textClass="ci-text resize-none" />
        </div>
        <div class="acp-field">
          <label for="task-context-lines" class="config-label">Task context</label>
          <HighlightedField multiline id="task-context-lines"
            bind:value={taskContextLinesDraft}
            oninput={commitTaskContextDraft}
            onblur={commitTaskContextDraft}
            placeholder={"project=my-app\nenvironment=staging"}
            rows={3}
            frameClass="ci-frame" textClass="ci-text resize-none" />
          <p class="acp-hint">One <code>key=value</code> per line (<code>withTaskContext</code>).</p>
        </div>
        <label class="acp-check">
          <input type="checkbox" checked={config.healthCheck}
            onchange={() => (config = { ...config, healthCheck: !config.healthCheck })} />
          <span>
            <span class="acp-check-t">Health check</span>
            <span class="acp-hint">Builds with <code>withHealthCheck()</code>, so <code>agent.health()</code> works.</span>
          </span>
        </label>
</ConfigSection>
