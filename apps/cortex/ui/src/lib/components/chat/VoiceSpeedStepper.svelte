<script lang="ts">
  /**
   * Reading speed for voice mode: slower / faster steps between 0.75x and 2x. The speed
   * is the saved Settings · Voice reading speed, so a change here persists and is what
   * the next sentence is read at (the browser voice's `rate`, the server voice's
   * `speed`). A server voice may ignore the speed; a one-line hint says so.
   * Rules: `lib/voice/voice-speed.ts`.
   */
  import { voice } from "$lib/stores/voice.js";
  import Button from "$lib/components/kit/Button.svelte";
  import { atRateLimit, rateLabel, speedHint, stepRate, type SpeedDirection } from "$lib/voice/voice-speed.js";

  const v = voice();
  const prefs = v.prefs;
  const settings = v.settings;

  const hint = $derived(speedHint($settings.tts.engine));

  function step(direction: SpeedDirection) {
    v.setPrefs({ rate: stepRate($prefs.rate, direction) });
  }
</script>

<span class="speed" role="group" aria-label="Reading speed" data-testid="voice-speed">
  <Button size="sm" variant="ghost" aria-label="Slower" disabled={atRateLimit($prefs.rate, "slower")} onclick={() => step("slower")} data-testid="voice-speed-slower">&minus;</Button>
  <output class="val" aria-live="polite" data-testid="voice-speed-value">{rateLabel($prefs.rate)}</output>
  <Button size="sm" variant="ghost" aria-label="Faster" disabled={atRateLimit($prefs.rate, "faster")} onclick={() => step("faster")} data-testid="voice-speed-faster">+</Button>
</span>
{#if hint}<span class="hint" data-testid="voice-speed-hint">{hint}</span>{/if}

<style>
  .speed { display: inline-flex; align-items: center; gap: 2px; }
  .val { min-width: 3.2em; text-align: center; font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); color: var(--cortex-text); }
  .hint { flex-basis: 100%; font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
