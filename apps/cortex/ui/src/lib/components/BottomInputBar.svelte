<script lang="ts">
  /**
   * Beacon's prompt bar (spec section 8): the model chip (opens the full
   * agent blueprint, `AgentConfigPanel`, above the bar), the task input, the
   * prompt library and Run. Runs through `stageStore.submitPrompt` (the page
   * passes `onSubmit`). `focus()` serves the R shortcut.
   */
  import { onMount } from "svelte";
  import { settings } from "$lib/stores/settings.js";
  import AgentConfigPanel from "$lib/components/AgentConfigPanel.svelte";
  import PromptPickerButton from "$lib/components/PromptPickerButton.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Chip from "$lib/components/kit/Chip.svelte";
  import { type AgentConfig, defaultConfig } from "$lib/types/agent-config.js";
  import { toastKeepClear } from "$lib/toast-clearance.js";
  import { clickOutside } from "$lib/actions/click-outside.js";

  interface Props {
    placeholder?: string;
    loading?: boolean;
    /** Show the prompt library button (the first-run bar leaves it out). */
    library?: boolean;
    onSubmit?: (prompt: string, config: AgentConfig) => void;
  }
  let {
    placeholder = "Describe a task to run as a new agent",
    loading = false,
    library = true,
    onSubmit,
  }: Props = $props();

  let value = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);
  let expanded = $state(false);
  /** The model chip's wrapper: a press on it toggles the panel, so it is not an outside press. */
  let chipWrap = $state<HTMLElement>();
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

  /** `ollama / qwen3:14b`, or the provider alone while no model is chosen. */
  const modelLabel = $derived([config.provider, config.model].filter(Boolean).join(" / ") || "Choose a model");
</script>

<div class="bar">
  <div class="anchor" use:toastKeepClear>
    {#if expanded}
      <div
        class="config"
        role="region"
        aria-label="Agent settings for this run"
        use:clickOutside={{ onclose: () => (expanded = false), ignore: [chipWrap] }}
      >
        <AgentConfigPanel bind:config compact={false} />
      </div>
    {/if}
    <div class="prompt">
      <span class="chip-wrap" bind:this={chipWrap}>
        <Chip icon="model" data on={expanded} title="Agent settings for this run" onclick={() => (expanded = !expanded)}>{modelLabel}</Chip>
      </span>
      <input
        bind:this={inputEl}
        bind:value
        type="text"
        data-cortex-beacon-prompt
        aria-label="Task for a new agent"
        {placeholder}
        disabled={loading}
        onkeydown={handleKeydown}
      />
      {#if library}
        <PromptPickerButton
          types={["task", "snippet"]}
          defaultSaveType="task"
          onSelect={(body) => {
            value = body;
            inputEl?.focus();
          }}
        />
      {/if}
      <Button variant="primary" icon="send" disabled={!value.trim() || loading} onclick={handleSubmit}>
        {loading ? "Starting…" : "Run"}
      </Button>
    </div>
  </div>
</div>

<style>
  .bar { position: relative; z-index: 2; padding: 12px 32px 20px; }
  .anchor { position: relative; max-width: 820px; margin: 0 auto; }
  .config {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 8px);
    max-height: 60vh;
    overflow-y: auto;
    padding: 16px;
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    border: 1px solid var(--cortex-line-strong);
    box-shadow: var(--cortex-shadow-pop);
  }
  .prompt {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 8px;
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    border: 1px solid var(--cortex-line-strong);
  }
  .prompt:focus-within { border-color: var(--cortex-accent); box-shadow: 0 0 0 3px var(--cortex-accent-tint); }
  .chip-wrap { display: contents; }
  .prompt :global(.cx-chip) { max-width: 220px; overflow: hidden; text-overflow: ellipsis; flex: none; }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    background: transparent;
    color: var(--cortex-text);
    font: 400 var(--cortex-t-md) var(--cortex-font-ui);
    padding: 6px 4px;
    outline: none;
  }
  input::placeholder { color: var(--cortex-text-3); }
  @media (max-width: 640px) { .bar { padding: 8px 12px 12px; } }
</style>
