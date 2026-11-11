<script lang="ts">
  /** Shown when the reader scrolled up: one click back to the newest message (autoscroll resumes there). */
  const { onJump, live = false }: { onJump: () => void; live?: boolean } = $props();
</script>

<button type="button" class="jump" onclick={onJump} data-testid="jump-to-latest">
  <span class="material-symbols-outlined" aria-hidden="true">arrow_downward</span>{live ? "New activity" : "Jump to latest"}
</button>

<style>
  .jump {
    position: absolute;
    bottom: calc(100% + 0.5rem);
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1875rem 0.625rem 0.1875rem 0.4375rem;
    border: 1px solid var(--cortex-border);
    border-radius: 9999px;
    background: var(--cortex-surface-low);
    color: var(--cortex-text);
    font-family: ui-monospace, monospace;
    font-size: 10px;
    cursor: pointer;
  }
  .jump:hover { background: var(--cortex-surface-mid); }
  .jump:focus-visible { outline: 2px solid var(--color-secondary, #7ee3c3); }
  .jump .material-symbols-outlined { font-size: 13px; line-height: 1; }
</style>
