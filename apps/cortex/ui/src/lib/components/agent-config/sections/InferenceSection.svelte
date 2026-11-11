<script lang="ts">
  import ConfigSection from "../ConfigSection.svelte";
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

<ConfigSection id="inference" {open} {onToggle}>
  {#snippet head()}
      <span class="material-symbols-outlined text-[15px] text-primary/80 shrink-0" aria-hidden="true">memory</span>
      <span class="font-display text-[12px] font-semibold text-[var(--cortex-text)] tracking-tight">Inference</span>
      <span class="ml-2 truncate font-mono text-[11px] text-[var(--cortex-text-muted)]">{config.provider} · {config.model?.trim() || "default model"}</span>
  {/snippet}
        <!-- Agent name (optional) -->
        <div>
          <label for="agent-name" class="config-label">Agent Name <span class="text-outline/70 normal-case font-normal">(optional)</span></label>
          <HighlightedField id="agent-name" bind:value={config.agentName} placeholder="e.g. research-assistant"
            frameClass="ci-frame" textClass="ci-text" />
        </div>
        <!-- Provider + Model -->
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label for="provider-select" class="config-label">Provider</label>
            <select id="provider-select" value={config.provider} onchange={(e) => setProvider((e.target as HTMLSelectElement).value)}
              class="config-input">
              {#each providerList as p}<option value={p.id}>{p.id}</option>{/each}
            </select>
          </div>
          <div>
            <label class="config-label">Model
              <button type="button" onclick={() => loadModelsForProvider(config.provider)}
                class="ml-1 text-secondary/60 hover:text-secondary bg-transparent border-0 cursor-pointer p-0 text-[11px]">
                {modelsLoading ? "…" : "↻"}
              </button>
            </label>
            {#if modelsError}
              <div class="text-[11px] font-mono text-error/60 mb-1">{modelsError}</div>
              <input bind:value={config.model} placeholder="Type model name…" class="config-input" />
            {:else if modelsLoading}
              <div class="config-input text-outline/70">Loading…</div>
            {:else if modelOptionsForSelect.length > 0}
              {#if modelsNote}<div class="text-[11px] font-mono text-outline/70 mb-1">{modelsNote}</div>{/if}
              <select bind:value={config.model} class="config-input">
                {#each modelOptionsForSelect as m}<option value={m.value}>{m.thinking ? "🧠 " : ""}{m.label}</option>{/each}
              </select>
            {:else}
              {#if modelsNote}<div class="text-[11px] font-mono text-outline/70 mb-1">{modelsNote}</div>{/if}
              <input bind:value={config.model} placeholder="Model name…" class="config-input" />
            {/if}
          </div>
        </div>
        <!-- Custom model override -->
        {#if modelOptionsForSelect.length > 0}
          <div>
            <label for="custom-model-override" class="config-label">Custom model override <span class="text-outline/70 normal-case font-normal">(optional — overrides dropdown)</span></label>
            <input id="custom-model-override" bind:value={config.model} placeholder="e.g. claude-opus-4-6"
              class="config-input" />
          </div>
        {/if}
        <!-- Thinking -->
        <div class="acp-field">
          <span class="config-label" id="thinking-label">Thinking
            {#if modelThinking === true}<span class="ml-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-normal text-primary">model supports it</span>
            {:else if modelThinking === false}<span class="ml-1 rounded-md bg-[var(--cortex-surface-mid)] px-1.5 py-0.5 text-[11px] font-normal text-[var(--cortex-text-muted)]">not supported</span>{/if}
          </span>
          <div class="inline-flex w-fit overflow-hidden rounded-lg border border-[var(--cortex-border)]" role="radiogroup" aria-labelledby="thinking-label">
            {#each [["auto", "Auto"], ["on", "On"], ["off", "Off"]] as [value, label] (value)}
              <button type="button" role="radio" aria-checked={thinkingChoice === value}
                onclick={() => setThinking(value as "auto" | "on" | "off")}
                class="cursor-pointer border-0 px-4 py-1.5 text-[12px] transition-colors
                       {thinkingChoice === value ? 'bg-primary/15 text-primary' : 'bg-transparent text-[var(--cortex-text-muted)] hover:text-[var(--cortex-text)]'}">{label}</button>
            {/each}
          </div>
          <p class="font-mono text-[11px] leading-relaxed text-outline/70">{thinkingNote}</p>
        </div>
        <!-- Temperature + Max Tokens -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label for="temperature-range" class="config-label flex items-center justify-between">
              Temperature
              <span class="font-mono text-primary tabular-nums">{config.temperature.toFixed(2)}</span>
            </label>
            <input id="temperature-range" type="range" min="0" max="1" step="0.05"
              bind:value={config.temperature}
              class="w-full accent-primary mt-1" />
            <div class="flex justify-between text-[10px] font-mono text-outline/70 mt-0.5">
              <span>0 — deterministic</span><span>1 — creative</span>
            </div>
          </div>
          <div>
            <label for="max-tokens" class="config-label">Max Tokens <span class="text-outline/70 normal-case font-normal">(0 = default)</span></label>
            <input id="max-tokens" type="number" min="0" max="200000" step="256"
              bind:value={config.maxTokens}
              class="config-input" />
          </div>
          <div class="col-span-2">
            <label for="num-ctx" class="config-label">Context length (numCtx) <span class="text-outline/70 normal-case font-normal">(0 = provider default)</span></label>
            <input id="num-ctx" type="number" min="0" max="1048576" step="1024"
              bind:value={config.numCtx}
              class="config-input" />
            <div class="text-[10px] font-mono text-outline/70 mt-0.5">
              Overrides the provider context window. Honored by local providers (Ollama num_ctx); cloud providers that don't expose a context knob ignore it.
            </div>
          </div>
        </div>
        <!-- System prompt -->
        <div>
          <div class="flex items-end justify-between gap-2 mb-1">
            <label for="system-prompt" class="config-label !mb-0">System Prompt <span class="text-outline/70 normal-case font-normal">(optional)</span></label>
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
            placeholder="Custom instructions prepended to every run…"
            rows={3}
            frameClass="ci-frame" textClass="ci-text resize-none" />
        </div>
        <div>
          <label for="task-context-lines" class="config-label">Task context <span class="text-outline/70 normal-case font-normal">(`withTaskContext` — one key=value per line)</span></label>
          <HighlightedField multiline id="task-context-lines"
            bind:value={taskContextLinesDraft}
            oninput={commitTaskContextDraft}
            onblur={commitTaskContextDraft}
            placeholder={"project=my-app\nenvironment=staging"}
            rows={3}
            frameClass="ci-frame" textClass="ci-text resize-none text-[11px]" />
        </div>
        <label class="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={config.healthCheck}
            onchange={() => (config = { ...config, healthCheck: !config.healthCheck })}
            class="accent-primary w-3.5 h-3.5" />
          <div>
            <div class="font-mono text-[11px] text-on-surface/80">Enable health check</div>
            <div class="font-mono text-[11px] text-outline/70">Calls `withHealthCheck()` so `agent.health()` is available after build</div>
          </div>
        </label>
</ConfigSection>
