<script lang="ts">
  /**
   * Replay controls, shown while the run view replays its stored kernel loops
   * (`replaySlice` in `lib/run-view.ts`): which loop, step back / play / step
   * forward, and Exit. The trace, signal and inspector below show the slice.
   */
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Button from "$lib/components/kit/Button.svelte";

  interface Props {
    loop: number;
    max: number;
    playing: boolean;
    onBack: () => void;
    onForward: () => void;
    onPlay: () => void;
    onPause: () => void;
    onExit: () => void;
  }
  const { loop, max, playing, onBack, onForward, onPlay, onPause, onExit }: Props = $props();
</script>

<div class="replay" role="group" aria-label="Replay">
  <span class="what">Replaying loop <b>{loop}</b> of <b>{max}</b></span>
  <IconButton icon="skip-back" label="Previous loop" size="sm" disabled={loop <= 1} onclick={onBack} />
  {#if playing}
    <IconButton icon="pause" label="Pause replay" size="sm" onclick={onPause} />
  {:else}
    <IconButton icon="play" label="Play replay" size="sm" onclick={onPlay} />
  {/if}
  <IconButton icon="skip-forward" label="Next loop" size="sm" disabled={loop >= max} onclick={onForward} />
  <Button size="sm" variant="ghost" icon="x" onclick={onExit}>Exit replay</Button>
</div>

<style>
  .replay {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 24px;
    border-bottom: 1px solid var(--cortex-line);
    background: var(--cortex-surface-2);
    font-size: var(--cortex-t-sm);
    color: var(--cortex-text-2);
  }
  .what { margin-right: 8px; }
  b { font-family: var(--cortex-font-data); font-weight: 500; color: var(--cortex-text); }
</style>
