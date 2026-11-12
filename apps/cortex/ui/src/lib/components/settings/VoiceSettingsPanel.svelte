<script lang="ts">
  /**
   * Settings · Voice: how the mic listens (speech to text), how replies are read
   * (text to speech), and how voice mode behaves. Each direction picks an engine: the
   * browser's own (the default, nothing to install) or an OpenAI-compatible server
   * endpoint (local Whisper / Kokoro / Piper servers, or a cloud). Changes apply at
   * once and are not part of the page's Save. Server choices live on the Cortex server;
   * language, speed, browser voice and the mic mode live in this browser. Render
   * inside a `SettingsGroup`.
   */
  import { onMount } from "svelte";
  import { voice } from "$lib/stores/voice.js";
  import { toast } from "$lib/stores/toast-store.js";
  import Button from "$lib/components/kit/Button.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import Switch from "$lib/components/kit/Switch.svelte";
  import Input from "$lib/components/kit/Input.svelte";
  import SettingsRow from "$lib/components/settings/SettingsRow.svelte";
  import VoiceEndpointBlock from "$lib/components/settings/VoiceEndpointBlock.svelte";
  import { ttsFor } from "$lib/voice/engines.js";
  import { sttStatus, ttsStatus, type VoiceStatusLine } from "$lib/voice/voice-status.js";
  import { isLanguageTag, LANGUAGES, RATE_STEPS, SILENCE_STEPS } from "$lib/voice/voice-prefs.js";
  import type { VoiceInfo } from "@reactive-agents/ui-core";

  const v = voice();
  const settings = v.settings;
  const prefs = v.prefs;
  const readerState = v.readerState;

  onMount(() => void v.load());

  const stt = $derived(sttStatus($settings, v.engines.caps));
  const tts = $derived(ttsStatus($settings, v.engines.caps));

  async function setEngine(direction: "stt" | "tts", engine: string) {
    const e = engine === "server" ? "server" : "browser";
    const r = await v.save(direction === "stt" ? { stt: { engine: e } } : { tts: { engine: e } });
    if (!r.ok) toast.error("Engine not changed", r.error);
  }

  let browserVoices = $state<readonly VoiceInfo[]>([]);
  $effect(() => {
    if ($settings.tts.engine !== "browser") return;
    void ttsFor(v.engines, $settings).voices().then((list) => (browserVoices = list));
  });

  let langDraft = $state("");
  $effect(() => {
    langDraft = $prefs.language;
  });
  function applyLanguage(code: string) {
    if (!isLanguageTag(code.trim())) {
      toast.error("Not a language code", "Use a code such as en-US or fr-FR.");
      return;
    }
    v.setPrefs({ language: code.trim() });
  }

  function testBrowserVoice() {
    v.reader.play("voice-test", "Cortex voice test. This is how replies will sound.");
  }
  const testing = $derived($readerState.sourceId === "voice-test" && ($readerState.status === "loading" || $readerState.status === "playing"));
</script>

{#snippet lines(items: VoiceStatusLine[])}
  <ul class="vs" aria-label="Status">
    {#each items as l (l.text)}<li class="vs-{l.tone}">{l.text}</li>{/each}
  </ul>
{/snippet}

<SettingsRow label="Listening engine" for="voice-stt-engine" description="Turns your voice into text for the mic button and voice mode.">
  {#snippet control()}
    <Select
      id="voice-stt-engine"
      value={$settings.stt.engine}
      options={[{ value: "browser", label: "Browser (nothing to install)" }, { value: "server", label: "Server (OpenAI-compatible)" }]}
      onchange={(x) => void setEngine("stt", x)}
    />
  {/snippet}
</SettingsRow>
<div class="vp">{@render lines(stt)}</div>
{#if $settings.stt.engine === "server"}<VoiceEndpointBlock direction="stt" />{/if}

<SettingsRow label="Mic button" for="voice-mic-mode" description="Toggle: click to start and again to stop. Push to talk: hold the button (or Space on it) while you speak.">
  {#snippet control()}
    <Select
      id="voice-mic-mode"
      value={$prefs.micMode}
      options={[{ value: "toggle", label: "Click to start and stop" }, { value: "push-to-talk", label: "Push to talk" }]}
      onchange={(x) => v.setPrefs({ micMode: x === "push-to-talk" ? "push-to-talk" : "toggle" })}
    />
  {/snippet}
</SettingsRow>
<SettingsRow label="Language" for="voice-language" description="What you speak. The browser's default follows the page language.">
  {#snippet control()}
    <Input id="voice-language" mono autocomplete="off" spellcheck={false} placeholder="Browser default" list="voice-languages" bind:value={langDraft} onchange={() => applyLanguage(langDraft)} />
    <datalist id="voice-languages">{#each LANGUAGES.filter((l) => l.code !== "") as l (l.code)}<option value={l.code}>{l.label}</option>{/each}</datalist>
  {/snippet}
</SettingsRow>
<div class="vsw"><Switch id="voice-autosend" label="Send when I stop talking" hint="The mic sends the message after a quiet moment. Off: the words wait in the box for you to send." checked={$prefs.autoSend} onchange={(c) => v.setPrefs({ autoSend: c })} /></div>
{#if $prefs.autoSend}
  <SettingsRow label="Quiet moment" for="voice-silence" description="How long you stay silent before it counts as finished. Voice mode uses the same value.">
    {#snippet control()}
      <Select id="voice-silence" value={String($prefs.silenceMs)} options={SILENCE_STEPS.map((ms) => ({ value: String(ms), label: `${ms / 1000} s` }))} onchange={(x) => v.setPrefs({ silenceMs: Number(x) })} />
    {/snippet}
  </SettingsRow>
{/if}

<SettingsRow label="Reading engine" for="voice-tts-engine" description="Reads answers aloud (the speaker on a reply, Read aloud on the Answer, voice mode).">
  {#snippet control()}
    <Select
      id="voice-tts-engine"
      value={$settings.tts.engine}
      options={[{ value: "browser", label: "Browser (nothing to install)" }, { value: "server", label: "Server (OpenAI-compatible)" }]}
      onchange={(x) => void setEngine("tts", x)}
    />
  {/snippet}
</SettingsRow>
<div class="vp">{@render lines(tts)}</div>
{#if $settings.tts.engine === "server"}<VoiceEndpointBlock direction="tts" />{/if}

<SettingsRow label="Reading speed" for="voice-rate" description="Applies at once, also to a reading in progress.">
  {#snippet control()}
    <Select id="voice-rate" value={String($prefs.rate)} options={RATE_STEPS.map((r) => ({ value: String(r), label: `${r}×` }))} onchange={(x) => v.setPrefs({ rate: Number(x) })} />
  {/snippet}
</SettingsRow>
{#if $settings.tts.engine === "browser"}
  <SettingsRow label="Browser voice" for="voice-browser-voice" description="The voices installed on this device. Better ones usually come from the operating system.">
    {#snippet control()}
      <Select
        id="voice-browser-voice"
        value={$prefs.browserVoice}
        options={[{ value: "", label: "Default voice" }, ...browserVoices.map((x) => ({ value: x.id, label: x.label }))]}
        onchange={(x) => v.setPrefs({ browserVoice: x })}
      />
      <Button size="sm" variant="ghost" icon="speaker" disabled={testing} onclick={testBrowserVoice}>Test</Button>
    {/snippet}
  </SettingsRow>
{/if}

<div class="vsw"><Switch id="voice-autospeak" label="Voice mode reads each reply aloud" hint="Off: voice mode only listens and sends; replies stay on screen." checked={$prefs.autoSpeak} onchange={(c) => v.setPrefs({ autoSpeak: c })} /></div>
<div class="vsw"><Switch id="voice-bargein" label="Speaking over the voice stops it" hint="Voice mode keeps the mic open while it reads. Speakers can feed the voice back into the mic, so headphones work best; Interrupt always works." checked={$prefs.bargeIn} onchange={(c) => v.setPrefs({ bargeIn: c })} /></div>

<div class="vp">
  <p class="vs-note">Audio is relayed, never saved: Cortex keeps no recordings and no generated speech. Endpoint keys stay on the server, encrypted.</p>
</div>

<style>
  .vp { padding: 0 16px 8px; }
  .vsw { padding: 8px 16px; }
  .vs { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; font-size: var(--cortex-t-xs); line-height: var(--cortex-lh-ui); }
  .vs-ok { color: var(--cortex-ok); }
  .vs-warn { color: var(--cortex-warn); }
  .vs-bad { color: var(--cortex-bad); }
  .vs-note { margin: 0; font-size: var(--cortex-t-xs); color: var(--cortex-text-2); }
</style>
