<script lang="ts">
  /** Shown when the reader scrolled up: one click back to the newest message (autoscroll resumes there). */
  import Icon from "$lib/components/kit/Icon.svelte";

  const { onJump, live = false }: { onJump: () => void; live?: boolean } = $props();
</script>

<button type="button" class="jump" onclick={onJump} data-testid="jump-to-latest">
  <Icon name="down" size="sm" />{live ? "New activity" : "Jump to latest"}
</button>

<style>
  .jump {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    right: 0;
    width: fit-content;
    margin: 0 auto;
    z-index: var(--cortex-z-sticky);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 28px;
    padding: 0 12px 0 8px;
    border: 1px solid var(--cortex-line-strong);
    border-radius: 9999px;
    background: var(--cortex-surface-1);
    box-shadow: var(--cortex-shadow-pop);
    color: var(--cortex-text);
    font: 500 var(--cortex-t-xs) var(--cortex-font-ui);
    cursor: pointer;
  }
  .jump:hover { background: var(--cortex-surface-2); }
  .jump:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
</style>
