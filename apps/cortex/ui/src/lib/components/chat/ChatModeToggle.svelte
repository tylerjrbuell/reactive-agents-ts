<script lang="ts">
  /**
   * Plan | Execute: the chat session's mode as a two-segment control. Plan is reasoning only (no
   * tools) and reads calm and accent-tinted; Execute is the default. A radio group, so arrows move
   * between the two and a screen reader hears the state and what it means.
   */
  import { tooltip } from "$lib/actions/tooltip.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import { CHAT_MODES, modeHint, modeLabel, type ChatMode } from "$lib/chat-mode.js";

  interface Props {
    mode: ChatMode;
    onChange: (mode: ChatMode) => void;
    disabled?: boolean;
  }
  const { mode, onChange, disabled = false }: Props = $props();

  function onKey(e: KeyboardEvent) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    onChange(mode === "plan" ? "execute" : "plan");
  }
</script>

<div class="toggle" class:plan={mode === "plan"} role="radiogroup" aria-label="Chat mode" data-testid="mode-toggle" data-mode={mode}>
  {#each CHAT_MODES as m (m)}
    <button
      type="button"
      role="radio"
      aria-checked={mode === m}
      tabindex={mode === m ? 0 : -1}
      class="seg"
      class:on={mode === m}
      {disabled}
      data-testid="mode-{m}"
      use:tooltip={`${modeLabel(m)}: ${modeHint(m)} (Shift+Tab switches)`}
      onclick={() => mode !== m && onChange(m)}
      onkeydown={onKey}
    >
      <Icon name={m === "plan" ? "checklist" : "play"} size="sm" />{modeLabel(m)}
    </button>
  {/each}
</div>

<style>
  .toggle {
    display: inline-flex;
    padding: 2px;
    gap: 2px;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-2);
    transition: border-color var(--cortex-d-fast), background var(--cortex-d-fast);
  }
  .toggle.plan { border-color: var(--cortex-accent); background: var(--cortex-accent-tint); }
  .seg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 9px;
    border: 0;
    border-radius: calc(var(--cortex-r-ctl) - 2px);
    background: transparent;
    color: var(--cortex-text-2);
    font: 500 var(--cortex-t-xs) var(--cortex-font-ui);
    cursor: pointer;
    transition: background var(--cortex-d-fast), color var(--cortex-d-fast);
  }
  .seg:hover:not(.on):not(:disabled) { color: var(--cortex-text); }
  .seg.on { background: var(--cortex-surface-1); color: var(--cortex-text); box-shadow: 0 1px 2px rgb(0 0 0 / 0.18); }
  .toggle.plan .seg.on { color: var(--cortex-accent); }
  .seg:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 1px; }
  .seg:disabled { opacity: 0.5; cursor: not-allowed; }
  @media (prefers-reduced-motion: reduce) {
    .toggle, .seg { transition: none; }
  }
</style>
