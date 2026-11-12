<script lang="ts">
  /**
   * The composer's voice controls: the mic (dictation into the draft at the caret) and
   * the voice-mode switch (hands-free: listen, send on silence, read the reply, listen
   * again). Logic is in `lib/voice/*` and ui-core (`createDictation`, `voiceModeReduce`);
   * this component only wires them to the draft, the chat store and the buttons.
   * The mic is push-to-talk or toggle (Settings · Voice); words appear at the caret as
   * they are heard and never replace what is typed. While voice mode runs it owns the mic.
   */
  import { onMount, tick } from "svelte";
  import { chatStore } from "$lib/stores/chat-store.js";
  import { voice } from "$lib/stores/voice.js";
  import { toast } from "$lib/stores/toast-store.js";
  import { tooltip } from "$lib/actions/tooltip.js";
  import Icon from "$lib/components/kit/Icon.svelte";
  import { createComposerDictation } from "$lib/voice/composer-dictation.js";
  import { sttReadiness, ttsReadiness } from "$lib/voice/voice-status.js";
  import { replyEventOf, waitingOf, type ChatSnapshot } from "$lib/voice/voice-text.js";
  import type { DictationState, VoiceWaitingOn } from "@reactive-agents/ui-core";

  interface Props {
    /** The composer draft. */
    message: string;
    /** Caret offset in the draft, kept current by the composer. */
    caret: number;
    inputEl: HTMLTextAreaElement | null;
    /** Send the draft (the composer's own send). */
    onSend: () => void;
  }
  let { message = $bindable(), caret = $bindable(), inputEl, onSend }: Props = $props();

  const v = voice();
  const settings = v.settings;
  const prefs = v.prefs;
  const modeState = v.modeState;

  let mic = $state<DictationState>({ status: "idle", interim: "", finals: "", error: null });

  const dictation = createComposerDictation({
    engine: () => v.sttEngine(),
    field: {
      read: () => ({ text: message, caret: inputEl?.selectionEnd ?? message.length }),
      write: (text, at) => {
        message = text;
        caret = at;
        void tick().then(() => inputEl?.setSelectionRange(at, at));
      },
    },
    language: () => $prefs.language,
    silenceMs: () => ($prefs.autoSend ? $prefs.silenceMs : 0),
    autoSend: () => $prefs.autoSend,
    onAutoSend: () => onSend(),
  });
  let lastError: string | null = null;
  dictation.subscribe((s) => {
    mic = s;
    const msg = s.status === "error" ? (s.error?.message ?? null) : null;
    if (msg !== null && msg !== lastError) toast.error("Microphone", msg);
    lastError = msg;
  });

  const ready = $derived(sttReadiness($settings, v.engines.caps));
  const listening = $derived(mic.status === "listening");
  const transcribing = $derived(mic.status === "processing");
  const modeOn = $derived($modeState.phase !== "idle");
  const ptt = $derived($prefs.micMode === "push-to-talk");

  const micTip = $derived(
    !ready.ready
      ? `Dictation is unavailable: ${ready.reason}`
      : listening
        ? ptt ? "Release to stop" : "Stop dictating"
        : transcribing
          ? "Transcribing…"
          : ptt ? "Hold to dictate" : "Dictate (words go in at the cursor)",
  );

  function begin() {
    if (!ready.ready || modeOn || listening || transcribing) return;
    inputEl?.focus();
    dictation.start();
  }
  /** Push-to-talk release; in toggle mode only the next click stops. */
  function end() {
    if (ptt && listening) dictation.stop();
  }
  function onMicClick() {
    if (ptt) return;
    if (listening) dictation.stop();
    else begin();
  }
  function onMicKeydown(e: KeyboardEvent) {
    if (!ptt || e.repeat || (e.key !== " " && e.key !== "Enter")) return;
    e.preventDefault();
    begin();
  }
  function onMicKeyup(e: KeyboardEvent) {
    if (ptt && (e.key === " " || e.key === "Enter")) end();
  }

  // ── Voice mode ────────────────────────────────────────────────────────────
  const host = v.voiceMode({
    send: (text) => chatStore.sendMessageStream(text),
    stopRun: () => chatStore.stop(),
  });

  function toggleMode() {
    if (modeOn) {
      host.dispatch({ type: "stop" });
      return;
    }
    const s = v.engines.caps;
    const stt = sttReadiness($settings, s);
    if (!stt.ready) {
      toast.error("Voice mode needs listening", stt.reason);
      return;
    }
    if ($prefs.autoSpeak) {
      const tts = ttsReadiness($settings, s);
      if (!tts.ready) {
        toast.error("Voice mode needs a voice", tts.reason);
        return;
      }
    }
    dictation.abort();
    host.dispatch({ type: "settings", autoSpeak: $prefs.autoSpeak, bargeIn: $prefs.bargeIn });
    host.dispatch({ type: "start" });
  }

  // Replies, failures and waits in the chat feed the loop.
  onMount(() => {
    void v.load();
    let prev: ChatSnapshot = { sending: false, turns: [] };
    let lastWait: VoiceWaitingOn = null;
    const unsub = chatStore.subscribe((s) => {
      const next: ChatSnapshot = { sending: s.sending, turns: s.activeTurns, error: s.error };
      if (host.get().phase !== "idle") {
        const ev = replyEventOf(prev, next);
        if (ev !== null) {
          lastWait = null;
          host.dispatch(ev);
        } else if (next.sending) {
          const w = waitingOf(next.turns);
          if (w !== lastWait) {
            lastWait = w;
            host.dispatch({ type: "waiting", on: w });
          }
        }
      }
      prev = next;
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (host.get().phase !== "idle") host.dispatch({ type: "stop" });
      else if (listening) dictation.stop();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      unsub();
      document.removeEventListener("keydown", onKey);
      dictation.abort();
      if (host.get().phase !== "idle") host.dispatch({ type: "stop" });
    };
  });

  const status = $derived(
    listening ? "Listening" : transcribing ? "Transcribing" : mic.status === "error" ? "Microphone problem" : "",
  );
</script>

<span class="vc">
  <!-- A disabled button gets no pointer events: the wrapper carries the reason. -->
  <span use:tooltip={micTip}>
    <button
      type="button"
      class="vbtn"
      class:on={listening}
      aria-label={ptt ? "Dictate (hold)" : "Dictate"}
      aria-pressed={listening}
      aria-disabled={!ready.ready || modeOn || transcribing}
      disabled={!ready.ready || modeOn}
      data-testid="mic-button"
      onclick={onMicClick}
      onpointerdown={(e) => { if (ptt && e.button === 0) begin(); }}
      onpointerup={end}
      onpointercancel={end}
      onpointerleave={end}
      onkeydown={onMicKeydown}
      onkeyup={onMicKeyup}
    >
      <Icon name="mic" size="sm" />
      {#if listening}<span class="lbl">Listening</span>{:else if transcribing}<span class="lbl">Transcribing…</span>{/if}
    </button>
  </span>
  <span use:tooltip={modeOn ? "Stop voice mode" : "Voice mode: talk with the agent hands-free"}>
    <button
      type="button"
      class="vbtn"
      class:on={modeOn}
      aria-label={modeOn ? "Stop voice mode" : "Start voice mode"}
      aria-pressed={modeOn}
      data-testid="voice-mode-button"
      onclick={toggleMode}
    >
      <Icon name="voice" size="sm" />
    </button>
  </span>
  <span class="sr" role="status" aria-live="polite">{status}</span>
</span>

<style>
  .vc { display: inline-flex; align-items: center; gap: 2px; }
  .vbtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 32px;
    height: 32px;
    padding: 0 6px;
    border: 0;
    border-radius: var(--cortex-r-ctl);
    background: none;
    color: var(--cortex-text-2);
    font: 500 var(--cortex-t-xs) var(--cortex-font-ui);
    cursor: pointer;
  }
  .vbtn:hover:not(:disabled) { background: var(--cortex-surface-2); color: var(--cortex-text); }
  .vbtn:focus-visible { outline: 2px solid var(--cortex-focus); outline-offset: 2px; }
  .vbtn:disabled { color: var(--cortex-text-3); cursor: not-allowed; }
  .vbtn.on { background: var(--cortex-accent-tint); color: var(--cortex-accent); }
  .lbl { white-space: nowrap; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
