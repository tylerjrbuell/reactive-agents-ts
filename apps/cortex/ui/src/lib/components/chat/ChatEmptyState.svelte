<script lang="ts">
  interface Props {
    /** Starter prompts offered on an empty chat. */
    starters: readonly string[];
    /** A starter was picked: put it in the composer. */
    onPick: (starter: string) => void;
  }
  const { starters, onPick }: Props = $props();
</script>

      <div class="chat-turn-in flex h-full items-center justify-center">
        <div class="max-w-md text-center">
          <p class="m-0 text-[13px] text-[var(--cortex-text)]">Ask the agent anything</p>
          <p class="mx-0 mb-4 mt-1 text-[12px] text-[var(--cortex-text-muted)]">Type <kbd class="rounded border border-[color:var(--cortex-border)] px-1">/</kbd> for commands like compact, fork and rewind.</p>
          <div class="flex flex-col items-stretch gap-1.5">
            {#each starters as starter (starter)}
              <button
                type="button"
                onclick={() => onPick(starter)}
                class="cursor-pointer rounded-lg border border-[color:var(--cortex-border)] bg-[var(--cortex-surface-low)] px-3 py-2 text-left text-[12px] text-[var(--cortex-text-muted)] transition-colors hover:border-primary/40 hover:text-[var(--cortex-text)]"
              >{starter}</button>
            {/each}
          </div>
        </div>
      </div>
