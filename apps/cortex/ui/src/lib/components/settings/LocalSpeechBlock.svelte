<script lang="ts">
  /**
   * Settings · Voice, under the endpoint blocks: let Cortex keep the local Speaches server
   * running. Off by default. The switch, a status pill with the last error, and Retry.
   * Shown only when the saved endpoints point at a local Speaches server. The work (docker,
   * model downloads) runs on the Cortex server; rules for labels and polling: `lib/voice/local-speech.ts`.
   */
  import { onDestroy, onMount } from "svelte";
  import { voice } from "$lib/stores/voice.js";
  import { toast } from "$lib/stores/toast-store.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import { canRetry, nextPollMs, phaseLabel, phaseTone, type LocalSpeechStatus } from "$lib/voice/local-speech.js";

  const v = voice();
  const settings = v.settings;

  let status = $state<LocalSpeechStatus | null>(null);
  let busy = $state(false);
  let rev = $state(0);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  async function refresh() {
    const r = await v.api.localStatus();
    if (!alive) return;
    if (r.ok && r.value) status = r.value;
    schedule();
  }

  function schedule() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const ms = nextPollMs(status);
    if (alive && ms !== null) timer = setTimeout(() => void refresh(), ms);
  }

  onMount(() => void refresh());
  onDestroy(() => {
    alive = false;
    if (timer !== null) clearTimeout(timer);
  });

  // A saved endpoint change can make the server eligible (or not).
  $effect(() => {
    void $settings.stt.baseUrl;
    void $settings.stt.model;
    void $settings.tts.baseUrl;
    void $settings.tts.model;
    void refresh();
  });

  async function toggle(on: boolean) {
    busy = true;
    const r = await v.api.setKeepRunning(on);
    busy = false;
    if (!r.ok) {
      toast.error("Could not change this", r.error);
      rev += 1; // remount the switch so it shows the real state again
      return;
    }
    if (r.value) status = r.value;
    schedule();
  }

  async function retry() {
    busy = true;
    const r = await v.api.localEnsure();
    busy = false;
    if (!r.ok) {
      toast.error("Could not retry", r.error);
      return;
    }
    if (r.value) status = r.value;
    schedule();
  }
</script>

{#if status?.eligible}
  <div class="ls" data-testid="local-speech">
    {#key rev}
      <Switch
        id="voice-keep-local"
        label="Keep the local speech server running"
        hint="Cortex checks the local Speaches server at startup, when voice is used, and every minute; if it is down, Cortex starts its Docker container (creating it, and downloading the models, if needed). It will run docker on this machine."
        checked={status.keepRunning}
        disabled={busy}
        onchange={(c) => void toggle(c)}
      />
    {/key}
    {#if status.keepRunning}
      <div class="ls-row" role="status" aria-live="polite">
        <span class="ls-pill ls-{phaseTone(status.phase)}">{phaseLabel(status.phase)}</span>
        <span class="ls-msg">{status.message}</span>
        {#if canRetry(status)}<Button size="sm" variant="ghost" disabled={busy} onclick={() => void retry()}>Retry</Button>{/if}
      </div>
      {#if status.phase === "failed" && status.lastError}<p class="ls-err" data-testid="local-speech-error">{status.lastError}</p>{/if}
    {/if}
  </div>
{/if}

<style>
  .ls { display: grid; gap: 8px; padding: 8px 16px; }
  .ls-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .ls-pill { font-size: var(--cortex-t-xs); font-weight: 500; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; }
  .ls-ok { color: var(--cortex-ok); }
  .ls-warn { color: var(--cortex-warn); }
  .ls-bad { color: var(--cortex-bad); }
  .ls-muted { color: var(--cortex-text-2); }
  .ls-msg { font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
  .ls-err { margin: 0; font-size: var(--cortex-t-xs); line-height: var(--cortex-lh-ui); color: var(--cortex-bad); overflow-wrap: anywhere; }
</style>
