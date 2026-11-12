<script lang="ts">
  /**
   * Answering the agent's question by voice, inside the voice-mode bar: the question is
   * read aloud, the next thing said is matched to it, what was heard is shown (and read
   * back) before it is sent, and the person can confirm, say it again, or type a
   * correction. Nothing is sent without "send it" / a button, except free text when Send
   * when I stop talking is on. Approvals never come through here (they need a click).
   * Flow and rules: `lib/voice/voice-question.ts`, `voice-answer.ts`.
   */
  import { voice } from "$lib/stores/voice.js";
  import Button from "$lib/components/kit/Button.svelte";

  const v = voice();
  const q = v.questionState;

  const asking = $derived($q.phase === "speaking" || $q.phase === "listening" || $q.phase === "sending");
  const pending = $derived($q.phase === "idle" ? null : $q.pending);
  const notice = $derived($q.phase === "sending" ? null : $q.notice);

  let draft = $state("");
  // The read-back fills the field so a wrong word is a small edit.
  $effect(() => {
    draft = pending?.heard ?? "";
  });

  const status = $derived(
    $q.phase === "speaking"
      ? "Reading the question…"
      : $q.phase === "listening"
        ? pending === null
          ? "Listening for your answer. Say it, or type below."
          : "Say send it to confirm, or say it again."
        : $q.phase === "sending"
          ? "Sending your answer…"
          : "",
  );

  function send() {
    const text = draft.trim();
    if (text !== "") v.dispatchQuestion({ type: "submit-text", text });
    else v.dispatchQuestion({ type: "confirm" });
  }
</script>

{#if asking || notice}
  <div class="vq" data-testid="voice-question">
    {#if asking}
      <span class="status" role="status" aria-live="polite">{status}</span>
      {#if pending}
        <span class="heard" data-testid="voice-question-heard">Heard <q>{pending.heard}</q>{#if pending.display !== pending.heard}, as <strong>{pending.display}</strong>{/if}</span>
      {/if}
      <form class="edit" onsubmit={(e) => { e.preventDefault(); send(); }}>
        <input type="text" class="cx-control input" bind:value={draft} placeholder="Or type your answer" aria-label="Your answer" disabled={$q.phase === "sending"} />
        <Button type="submit" size="sm" variant="primary" disabled={$q.phase === "sending" || (draft.trim() === "" && pending === null)} data-testid="voice-question-send">Send answer</Button>
        <Button size="sm" variant="ghost" disabled={$q.phase === "sending"} onclick={() => v.dispatchQuestion({ type: "retry" })}>Say it again</Button>
      </form>
    {/if}
    {#if notice}<span class="note" data-testid="voice-question-notice">{notice}</span>{/if}
  </div>
{/if}

<style>
  .vq { flex-basis: 100%; display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; padding-top: 6px; border-top: 1px solid var(--cortex-line); }
  .status { color: var(--cortex-text); font-size: var(--cortex-t-xs); }
  .heard { color: var(--cortex-text-2); overflow-wrap: anywhere; }
  .heard strong { color: var(--cortex-text); font-weight: 600; }
  .note { flex-basis: 100%; color: var(--cortex-text-3); overflow-wrap: anywhere; }
  .edit { display: flex; flex: 1; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 14rem; }
  .input { flex: 1; min-width: 10rem; height: 28px; }
</style>
