<script lang="ts">
  /**
   * Settings · Voice, under the endpoint blocks: the local Speaches server that Cortex runs in
   * Docker. Keep-running switch (off by default; switching it off stops the container), the
   * server's state with Start / Stop / Retry, and its port and hardware (CPU or GPU image).
   * Shown only when the saved endpoints point at a local Speaches server. The work (docker,
   * model downloads) runs on the Cortex server; rules for labels, buttons and polling:
   * `lib/voice/local-speech.ts`.
   */
  import { onDestroy, onMount } from "svelte";
  import { voice } from "$lib/stores/voice.js";
  import { toast } from "$lib/stores/toast-store.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import {
    cacheLine,
    canRetry,
    canStart,
    canStop,
    DEVICE_OPTIONS,
    nextPollMs,
    phaseLabel,
    phaseTone,
    portProblem,
    serverLine,
    type LocalSpeechDevice,
    type LocalSpeechStatus,
  } from "$lib/voice/local-speech.js";
  import type { VoiceCall } from "$lib/voice/voice-api.js";

  const v = voice();
  const settings = v.settings;

  let status = $state<LocalSpeechStatus | null>(null);
  let busy = $state(false);
  let rev = $state(0);
  let portDraft = $state("");
  let deviceDraft = $state<LocalSpeechDevice>("auto");
  let timer: ReturnType<typeof setTimeout> | null = null;
  let alive = true;

  // Drafts follow the server's values whenever they change there.
  let shownPort = -1;
  let shownDevice = "";
  $effect(() => {
    if (status === null) return;
    if (status.port !== shownPort) portDraft = String((shownPort = status.port));
    if (status.device !== shownDevice) deviceDraft = (shownDevice = status.device) as LocalSpeechDevice;
  });

  const portError = $derived(portProblem(portDraft));
  const cache = $derived(status === null ? null : cacheLine(status));
  const configDirty = $derived(status !== null && (portDraft.trim() !== String(status.port) || deviceDraft !== status.device));

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

  // A saved endpoint change can make the server eligible (or not), or start a model download.
  $effect(() => {
    void $settings.stt.baseUrl;
    void $settings.stt.model;
    void $settings.tts.baseUrl;
    void $settings.tts.model;
    void refresh();
  });

  /** Run one control call; a refusal toasts, a status replaces the shown one. */
  async function act(title: string, call: () => Promise<VoiceCall<LocalSpeechStatus | null>>) {
    busy = true;
    const r = await call();
    busy = false;
    if (!r.ok) {
      toast.error(title, r.error);
      rev += 1; // remount the switch so it shows the real state again
      return false;
    }
    if (r.value) status = r.value;
    schedule();
    return true;
  }

  const toggle = (on: boolean) => act("Could not change this", () => v.api.setKeepRunning(on));
  const start = () => act("Could not start the speech server", () => v.api.localStart());
  const stop = () => act("Could not stop the speech server", () => v.api.localStop());
  const retry = () => act("Could not retry", () => v.api.localEnsure());

  async function applyConfig() {
    if (status === null || portError !== null) return;
    const port = Number(portDraft.trim());
    const ok = await act("Speech server settings not saved", () =>
      v.api.localConfig({ ...(port !== status?.port ? { port } : {}), ...(deviceDraft !== status?.device ? { device: deviceDraft } : {}) }),
    );
    // A port change moves the listening and reading endpoints: show their new URLs.
    if (ok) await v.load();
  }
</script>

{#if status?.eligible}
  <div class="ls" data-testid="local-speech">
    {#key rev}
      <Switch
        id="voice-keep-local"
        label="Keep the local speech server running"
        hint="Cortex checks the local Speaches server at startup, when voice is used, and every minute; if it is down, Cortex starts its Docker container (creating it, and downloading the models, if needed). Switching this off stops the container. It runs docker on this machine."
        checked={status.keepRunning}
        disabled={busy}
        onchange={(c) => void toggle(c)}
      />
    {/key}

    <div class="ls-row" role="status" aria-live="polite">
      <span class="ls-pill ls-{phaseTone(status.phase)}">{phaseLabel(status.phase)}</span>
      <span class="ls-msg">{status.message} {serverLine(status)}</span>
    </div>
    <div class="ls-row">
      {#if canStart(status)}<Button size="sm" variant="primary" disabled={busy} onclick={() => void start()}>Start server</Button>{/if}
      {#if canStop(status)}<Button size="sm" disabled={busy} onclick={() => void stop()}>Stop server</Button>{/if}
      {#if canRetry(status)}<Button size="sm" variant="ghost" disabled={busy} onclick={() => void retry()}>Retry</Button>{/if}
    </div>
    {#if status.phase === "failed" && status.lastError}<p class="ls-err" data-testid="local-speech-error">{status.lastError}</p>{/if}
    <!-- A failure already names a full disk with the free space; the cache line would repeat it. -->
    {#if cache && status.phase !== "failed"}<p class={cache.low ? "ls-err" : "ls-msg"} data-testid="local-speech-cache">{cache.text}</p>{/if}

    <form class="ls-grid" onsubmit={(e) => { e.preventDefault(); void applyConfig(); }}>
      <label class="ls-l" for="voice-local-port">Port</label>
      <div class="ls-port">
        <Input id="voice-local-port" mono inputmode="numeric" autocomplete="off" spellcheck={false} invalid={portError !== null} bind:value={portDraft} />
      </div>
      <label class="ls-l" for="voice-local-device">Hardware</label>
      <Select id="voice-local-device" value={deviceDraft} options={DEVICE_OPTIONS} onchange={(x) => (deviceDraft = x === "cpu" || x === "cuda" ? x : "auto")} />
      <span></span>
      <div class="ls-row">
        <Button size="sm" type="submit" disabled={busy || !configDirty || portError !== null}>Apply</Button>
        {#if configDirty && portError !== null}<span class="ls-err" role="alert">{portError}</span>{/if}
      </div>
    </form>
    <p class="ls-msg">Changing the port moves the listening and reading endpoints to it. A running server is re-created on the new port or hardware; downloaded models are kept.</p>
  </div>
{/if}

<style>
  .ls { display: grid; gap: 8px; padding: 8px 16px; }
  .ls-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .ls-grid { display: grid; grid-template-columns: 8rem minmax(0, 1fr); gap: 8px 12px; align-items: center; }
  .ls-l { font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-2); }
  .ls-port { max-width: 8rem; }
  .ls-pill { font-size: var(--cortex-t-xs); font-weight: 500; padding: 1px 8px; border-radius: 999px; border: 1px solid currentColor; }
  .ls-ok { color: var(--cortex-ok); }
  .ls-warn { color: var(--cortex-warn); }
  .ls-bad { color: var(--cortex-bad); }
  .ls-muted { color: var(--cortex-text-2); }
  .ls-msg { margin: 0; font-size: var(--cortex-t-xs); line-height: var(--cortex-lh-ui); color: var(--cortex-text-2); }
  .ls-err { margin: 0; font-size: var(--cortex-t-xs); line-height: var(--cortex-lh-ui); color: var(--cortex-bad); overflow-wrap: anywhere; }
  @media (max-width: 720px) { .ls-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
