<script lang="ts">
  /**
   * One OpenAI-compatible speech endpoint in Settings · Voice (listening or reading):
   * preset, URL, model, (reading) voice, the API key, and a Test button. The key is
   * sent once to the server's encrypted key store and never shown again; this block
   * only ever receives its mask. Rules and calls: `lib/voice/*`.
   */
  import { toast } from "$lib/stores/toast-store.js";
  import { voice } from "$lib/stores/voice.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import { modelInstallHelp, presetFor, leavesThisMachine, STT_PRESETS, TTS_PRESETS, type SttPreset, type TtsPreset } from "$lib/voice/voice-presets.js";
  import { endpointKeyLine } from "$lib/voice/voice-status.js";
  import { STT_KEY_ID, TTS_KEY_ID, type ServerVoiceOption } from "$lib/voice/voice-api.js";

  interface Props {
    direction: "stt" | "tts";
  }
  const { direction }: Props = $props();

  const v = voice();
  const settings = v.settings;
  const cfg = $derived($settings[direction]);
  const keyStatus = $derived($settings.keys[direction]);
  const keyId = $derived(direction === "stt" ? STT_KEY_ID : TTS_KEY_ID);
  const envName = $derived(direction === "stt" ? "CORTEX_VOICE_STT_API_KEY" : "CORTEX_VOICE_TTS_API_KEY");
  const presets = $derived<readonly (SttPreset | TtsPreset)[]>(direction === "stt" ? STT_PRESETS : TTS_PRESETS);

  let url = $state("");
  let model = $state("");
  let voiceName = $state("");
  let keyDraft = $state("");
  let editingKey = $state(false);
  let busy = $state(false);
  let result = $state<{ tone: "ok" | "bad"; text: string; help?: { hint: string; curl: string } } | null>(null);
  let voices = $state<readonly ServerVoiceOption[]>([]);

  // Drafts follow the saved settings (after a save, a preset-free reload, or an engine switch).
  $effect(() => {
    url = cfg.baseUrl;
    model = cfg.model;
    voiceName = "voice" in cfg ? cfg.voice : "";
  });

  const dirty = $derived(url.trim().replace(/\/+$/, "") !== cfg.baseUrl || model.trim() !== cfg.model || ("voice" in cfg && voiceName.trim() !== cfg.voice));
  const preset = $derived(presetFor(presets, url, model));
  const cloud = $derived(url.trim() !== "" && leavesThisMachine(url));

  function applyPreset(id: string) {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    url = p.baseUrl;
    model = p.model;
    if ("voice" in p) voiceName = p.voice;
    result = null;
  }

  async function saveEndpoint() {
    busy = true;
    const patch = direction === "stt" ? { stt: { baseUrl: url, model } } : { tts: { baseUrl: url, model, voice: voiceName } };
    const r = await v.save(patch);
    busy = false;
    if (!r.ok) {
      toast.error("Voice endpoint not saved", r.error);
      return;
    }
    result = null;
    toast.success("Voice endpoint saved");
  }

  async function saveKey() {
    if (!keyDraft.trim()) return;
    busy = true;
    const r = await v.api.saveKey(keyId, keyDraft.trim());
    busy = false;
    keyDraft = "";
    if (!r.ok) {
      toast.error("Key not saved", r.error);
      return;
    }
    editingKey = false;
    await v.load();
    toast.success("Key saved", "It stays on the Cortex server, encrypted.");
  }

  async function removeKey() {
    busy = true;
    const r = await v.api.removeKey(keyId);
    busy = false;
    if (!r.ok) {
      toast.error("Key not removed", r.error);
      return;
    }
    await v.load();
  }

  async function loadVoices() {
    const r = await v.api.voices();
    if (r.ok) voices = r.value.voices;
    else toast.error("Voices unavailable", r.error);
  }

  async function test() {
    busy = true;
    result = null;
    const r = await v.api.test(direction);
    busy = false;
    const failure = r.ok ? (r.value.ok ? "" : `${r.value.message} ${r.value.detail ?? ""}`) : r.error;
    // A local server that has not downloaded the model answers "not installed locally": say how to fix it.
    const help = modelInstallHelp(failure, cfg.baseUrl, cfg.model, preset?.model === cfg.model ? preset.hint : undefined);
    if (!r.ok) {
      result = { tone: "bad", text: r.error, ...(help ? { help } : {}) };
      return;
    }
    result = {
      tone: r.value.ok ? "ok" : "bad",
      text: r.value.detail ? `${r.value.message} (${r.value.detail})` : r.value.message,
      ...(help ? { help } : {}),
    };
    // Hearing it is the real test of a voice.
    if (r.value.ok && direction === "tts") v.reader.play("voice-test", "Cortex voice test. This is how replies will sound.");
  }
</script>

<div class="vb">
  <div class="vb-grid">
    <label class="vb-l" for="vb-preset-{direction}">Preset</label>
    <Select
      id="vb-preset-{direction}"
      value={preset?.id ?? ""}
      options={[{ value: "", label: "Custom" }, ...presets.map((p) => ({ value: p.id, label: p.label }))]}
      onchange={applyPreset}
    />

    <label class="vb-l" for="vb-url-{direction}">Endpoint URL</label>
    <Input id="vb-url-{direction}" mono autocomplete="off" spellcheck={false} placeholder="http://localhost:8000/v1" bind:value={url} />

    <label class="vb-l" for="vb-model-{direction}">Model</label>
    <Input id="vb-model-{direction}" mono autocomplete="off" spellcheck={false} bind:value={model} />

    {#if direction === "tts"}
      <label class="vb-l" for="vb-voice">Voice</label>
      <div class="vb-row">
        <Input id="vb-voice" mono autocomplete="off" spellcheck={false} list="vb-voices" bind:value={voiceName} />
        <datalist id="vb-voices">{#each voices as o (o.id)}<option value={o.id}>{o.label}</option>{/each}</datalist>
        <Button size="sm" variant="ghost" disabled={cfg.baseUrl === ""} onclick={loadVoices}>List voices</Button>
      </div>
    {/if}
  </div>

  {#if preset}<p class="vb-help">{preset.hint}</p>{/if}
  {#if cloud}<p class="vb-help vb-warn">{direction === "stt" ? "Your recordings are sent to this server." : "The text to be read is sent to this server."}</p>{/if}

  <div class="vb-row">
    <Button size="sm" variant="primary" disabled={!dirty || busy} onclick={saveEndpoint}>Save endpoint</Button>
    <Button size="sm" variant="ghost" disabled={busy || cfg.baseUrl === "" || dirty} onclick={test}>Test</Button>
    {#if dirty}<span class="vb-help">Save before testing.</span>{/if}
  </div>
  {#if result}<p class="vb-result" class:vb-ok={result.tone === "ok"} class:vb-bad={result.tone === "bad"} role="status">{result.text}</p>
    {#if result.help}
      <p class="vb-help" data-testid="voice-install-help">{result.help.hint}</p>
      <div class="vb-row">
        <code class="vb-curl">{result.help.curl}</code>
        <Button size="sm" variant="ghost" onclick={() => void navigator.clipboard?.writeText(result?.help?.curl ?? "")}>Copy command</Button>
      </div>
    {/if}
  {/if}

  <div class="vb-key">
    <span class="vb-l">API key</span>
    <p class="vb-help">{endpointKeyLine(keyStatus, envName)} Local servers usually need none.</p>
    {#if editingKey}
      <form class="vb-row" onsubmit={(e) => { e.preventDefault(); void saveKey(); }}>
        <label class="vb-sr" for="vb-key-{direction}">API key for this endpoint</label>
        <Input id="vb-key-{direction}" type="password" mono autocomplete="off" spellcheck={false} placeholder="Paste the API key" bind:value={keyDraft} />
        <Button size="sm" variant="primary" type="submit" disabled={!keyDraft.trim() || busy}>Save key</Button>
        <Button size="sm" variant="ghost" onclick={() => { editingKey = false; keyDraft = ""; }}>Cancel</Button>
      </form>
    {:else}
      <div class="vb-row">
        <Button size="sm" onclick={() => (editingKey = true)}>{keyStatus?.stored ? "Replace key" : "Add key"}</Button>
        {#if keyStatus?.stored}<Button size="sm" variant="ghost" disabled={busy} onclick={removeKey}>Remove</Button>{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .vb { display: grid; gap: 10px; padding: 4px 16px 14px; }
  .vb-grid { display: grid; grid-template-columns: 8rem minmax(0, 1fr); gap: 8px 12px; align-items: center; }
  .vb-l { font-size: var(--cortex-t-xs); font-weight: 500; color: var(--cortex-text-2); }
  .vb-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .vb-row :global(input) { flex: 1; min-width: 12rem; }
  .vb-help { margin: 0; font-size: var(--cortex-t-xs); line-height: var(--cortex-lh-ui); color: var(--cortex-text-2); }
  .vb-warn { color: var(--cortex-warn); }
  .vb-result { margin: 0; font-size: var(--cortex-t-xs); }
  .vb-curl { font-family: var(--cortex-font-data); font-size: var(--cortex-t-xs); overflow-wrap: anywhere; color: var(--cortex-text); }
  .vb-ok { color: var(--cortex-ok); }
  .vb-bad { color: var(--cortex-bad); }
  .vb-key { display: grid; gap: 4px; }
  .vb-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (max-width: 720px) { .vb-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
