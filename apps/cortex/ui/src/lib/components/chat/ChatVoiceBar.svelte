<script lang="ts">
  /**
   * The strip above the composer while voice is in use.
   * - Voice mode: where the loop is (listening, thinking, speaking, waiting on you,
   *   paused) in words and an icon, the words heard so far, and an always-visible Stop.
   *   Interrupt cuts the voice (or the reply) and listens again.
   * - Read aloud: play / pause, stop, previous / next sentence, speed, voice, and the
   *   sentence being read (also painted in the answer through the CSS Custom Highlight API).
   * State and rules: `lib/voice/*`; the loop itself is ui-core `voiceModeReduce`.
   */
  import { voice } from "$lib/stores/voice.js";
  import { ttsFor } from "$lib/voice/engines.js";
  import { highlightSentence, clearReadingHighlight } from "$lib/voice/highlight.js";
  import { VOICE_MODE_SOURCE } from "$lib/voice/voice-mode-host.js";
  import { RATE_STEPS } from "$lib/voice/voice-prefs.js";
  import { toast } from "$lib/stores/toast-store.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import IconButton from "$lib/components/kit/IconButton.svelte";
  import Button from "$lib/components/kit/Button.svelte";
  import Select from "$lib/components/kit/Select.svelte";
  import VoiceSpeedStepper from "./VoiceSpeedStepper.svelte";
  import VoiceQuestionStrip from "./VoiceQuestionStrip.svelte";
  import type { IconName } from "$lib/icons.js";
  import { toastDue } from "$lib/voice/audio-diagnostic.js";
  import type { VoiceInfo } from "@reactive-agents/ui-core";

  const v = voice();
  const modeState = v.modeState;
  const interim = v.modeInterim;
  const readerState = v.readerState;
  const settings = v.settings;
  const prefs = v.prefs;

  const modeOn = $derived($modeState.phase !== "idle");
  const reading = $derived($readerState.status !== "idle" && $readerState.sourceId !== VOICE_MODE_SOURCE && $readerState.sourceId !== null);

  const PHASE: Readonly<Record<string, { icon: IconName; label: string }>> = {
    listening: { icon: "mic", label: "Listening" },
    thinking: { icon: "think", label: "Thinking" },
    speaking: { icon: "speaker", label: "Speaking" },
    error: { icon: "alert", label: "Paused" },
  };
  const phase = $derived(PHASE[$modeState.phase]);
  const phaseLabel = $derived(
    $modeState.phase === "thinking" && $modeState.waitingOn === "approval"
      ? "Waiting for your approval"
      : $modeState.phase === "thinking" && $modeState.waitingOn === "question"
        ? "Waiting for your answer"
        : (phase?.label ?? ""),
  );

  // ── Read aloud ────────────────────────────────────────────────────────────
  const chunk = $derived($readerState.chunks[$readerState.index]);
  const paused = $derived($readerState.status === "paused");

  // Paint the sentence being read in the answer it came from.
  $effect(() => {
    const st = $readerState;
    const sentence = st.chunks[st.index]?.text;
    if ((st.status === "playing" || st.status === "paused" || st.status === "loading") && sentence !== undefined && st.sourceId !== null) {
      highlightSentence(document.querySelector(`[data-read-source="${CSS.escape(st.sourceId)}"]`), sentence);
    } else {
      clearReadingHighlight();
    }
    return () => clearReadingHighlight();
  });

  // A failed reading says why, once.
  let toldError: string | null = null;
  let toldExternalAt: number | null = null;
  $effect(() => {
    const e = $readerState.error;
    // The "something outside Cortex paused the audio" hint is rate-limited: once a minute, never per chunk.
    const due = e?.code !== "external-pause" || toastDue(toldExternalAt, Date.now());
    if (e !== null && e.message !== toldError && due && $readerState.sourceId !== VOICE_MODE_SOURCE) {
      toast.error("Read aloud", e.message);
      if (e.code === "external-pause") toldExternalAt = Date.now();
    }
    toldError = e?.message ?? null;
  });

  let voices = $state<readonly VoiceInfo[]>([]);
  $effect(() => {
    if (!reading) return;
    void ttsFor(v.engines, $settings).voices().then((list) => (voices = list));
  });
  const currentVoice = $derived($settings.tts.engine === "server" ? $settings.tts.voice : $prefs.browserVoice);
  const voiceOptions = $derived([
    { value: "", label: "Default voice" },
    ...voices.map((x) => ({ value: x.id, label: x.label })),
    ...(currentVoice !== "" && !voices.some((x) => x.id === currentVoice) ? [{ value: currentVoice, label: currentVoice }] : []),
  ]);
  async function pickVoice(id: string) {
    if ($settings.tts.engine === "server") {
      const r = await v.save({ tts: { voice: id === "" ? "alloy" : id } });
      if (!r.ok) toast.error("Voice not changed", r.error);
      else v.reader.refresh();
    } else {
      v.setPrefs({ browserVoice: id });
    }
  }
</script>

{#if modeOn}
  <section class="vbar" class:bad={$modeState.phase === "error"} aria-label="Voice mode" data-testid="voice-mode-bar">
    <span class="state" role="status" aria-live="polite">
      {#if phase}<Icon name={phase.icon} size="sm" />{/if}
      <strong>{phaseLabel}</strong>
    </span>
    <span class="said" aria-live="off">
      {#if $modeState.phase === "listening" && $interim}{$interim}{:else if $modeState.notice}{$modeState.notice}{:else if $modeState.phase === "thinking" && $modeState.waitingOn === "question"}Answer by voice here, or in the thread above, then voice mode carries on.{:else if $modeState.phase === "thinking" && $modeState.waitingOn}Answer in the thread above, then voice mode carries on.{:else if $modeState.phase === "listening"}Say something. It is sent when you stop talking.{/if}
    </span>
    {#if $modeState.phase === "speaking" || $modeState.phase === "thinking"}
      <Button size="sm" variant="ghost" icon="skip-forward" onclick={() => v.dispatchMode({ type: "interrupt" })}>Interrupt</Button>
    {/if}
    {#if $modeState.phase === "error"}
      <Button size="sm" onclick={() => v.dispatchMode({ type: "retry" })}>Listen again</Button>
    {/if}
    <VoiceSpeedStepper />
    <VoiceQuestionStrip />
    <Button size="sm" icon="stop" onclick={() => v.dispatchMode({ type: "stop" })} data-testid="voice-mode-stop">Stop voice mode</Button>
  </section>
{:else if reading}
  <section class="vbar" aria-label="Read aloud" data-testid="read-aloud-bar">
    <span class="ctl">
      <IconButton icon="skip-back" size="sm" label="Previous sentence" onclick={() => v.reader.seek($readerState.index - 1)} />
      {#if paused}
        <IconButton icon="play" label="Resume reading" onclick={() => v.reader.resume()} />
      {:else}
        <IconButton icon="pause" label="Pause reading" onclick={() => v.reader.pause()} />
      {/if}
      <IconButton icon="skip-forward" size="sm" label="Next sentence" onclick={() => v.reader.seek($readerState.index + 1)} />
      <IconButton icon="stop" label="Stop reading" onclick={() => v.reader.stop()} />
    </span>
    <span class="said" role="status" aria-live="off">
      <span class="count">{$readerState.index + 1} / {$readerState.chunks.length}</span>
      {#if $readerState.status === "loading"}Preparing audio… {/if}{chunk?.text ?? ""}
    </span>
    <label class="opt">
      <span class="sr">Reading speed</span>
      <Select
        id="read-rate"
        value={String($prefs.rate)}
        options={RATE_STEPS.map((r) => ({ value: String(r), label: `${r}×` }))}
        onchange={(x) => v.setPrefs({ rate: Number(x) })}
      />
    </label>
    <label class="opt vsel">
      <span class="sr">Voice</span>
      <Select id="read-voice" value={currentVoice} options={voiceOptions} onchange={(x) => void pickVoice(x)} />
    </label>
  </section>
{/if}

<style>
  .vbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    width: 100%;
    max-width: var(--cortex-chat-col);
    margin: 0 auto 8px;
    padding: 6px 10px;
    border: 1px solid var(--cortex-line-strong);
    border-radius: var(--cortex-r-panel);
    background: var(--cortex-surface-1);
    color: var(--cortex-text);
    font-size: var(--cortex-t-xs);
  }
  .vbar.bad { border-color: var(--cortex-bad); }
  .state { display: inline-flex; align-items: center; gap: 6px; color: var(--cortex-accent); font-size: var(--cortex-t-sm); }
  .bad .state { color: var(--cortex-bad); }
  .state strong { font-weight: 600; }
  .said { flex: 1; min-width: 8rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cortex-text-2); }
  .count { margin-right: 8px; font-family: var(--cortex-font-data); font-size: var(--cortex-t-2xs); color: var(--cortex-text-3); }
  .ctl { display: inline-flex; align-items: center; }
  .opt { display: inline-flex; }
  .vsel { max-width: 12rem; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
