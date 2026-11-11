<script lang="ts">
  /**
   * An empty chat: the hero (neural mark, headline, one line on what the agent can
   * do) and starter prompts. The page turns the ambient orbs on behind it
   * (`CortexDeskShell ambient`): the only chat state with orbs, since the thread is empty.
   */
  import EmptyState from "$lib/components/kit/EmptyState.svelte";
  import Icon from "$lib/components/kit/Icon.svelte";

  interface Props {
    /** Starter prompts offered on an empty chat. */
    starters: readonly string[];
    /** Tools the session has picked (the copy names how many). */
    toolCount?: number;
    /** A starter was picked: put it in the composer. */
    onPick: (starter: string) => void;
  }
  const { starters, toolCount = 0, onPick }: Props = $props();

  const toolsLine = $derived(
    toolCount > 0
      ? `It can use the ${toolCount === 1 ? "tool" : `${toolCount} tools`} picked below.`
      : "It answers from the model alone until you pick tools below.",
  );
</script>

<div class="chat-turn-in empty" data-testid="chat-empty">
  <EmptyState hero markSize={88} title="Ask the agent anything" description="{toolsLine} Type / for commands like compact, fork and rewind.">
    {#snippet actions()}
      <div class="suggest">
        {#each starters as starter (starter)}
          <button type="button" onclick={() => onPick(starter)}><Icon name="chevron" size="sm" />{starter}</button>
        {/each}
      </div>
    {/snippet}
  </EmptyState>
</div>

<style>
  .empty { position: relative; z-index: 1; }
  .empty :global(.cx-empty-hero h2) { font-size: var(--cortex-t-xl); }
  .suggest { display: grid; gap: 6px; width: min(520px, 100%); margin-top: 4px; }
  .suggest button {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border: 1px solid var(--cortex-line);
    border-radius: var(--cortex-r-ctl);
    background: var(--cortex-surface-1);
    color: var(--cortex-text);
    font: inherit;
    font-size: var(--cortex-t-sm);
    text-align: left;
    cursor: pointer;
  }
  .suggest button :global(.cx-icon) { color: var(--cortex-text-3); }
  .suggest button:hover { border-color: var(--cortex-line-strong); background: var(--cortex-surface-2); }
</style>
