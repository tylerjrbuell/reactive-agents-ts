<script lang="ts">
  // A streaming chat turn whose agent asked a question LIVE (no durable runs): the question
  // and its reply controls inline in the turn. The run stays open; the answer goes to the
  // shared interaction route and the same turn carries on with it. Same look as the approval
  // card (the amber "Waiting on you" rail). Dismiss hides this card only: the question stays
  // pending (run header, Runs "Waiting on you").
  import Button from "$lib/components/kit/Button.svelte";
  import Status from "$lib/components/kit/Status.svelte";
  import InteractionReply from "$lib/components/InteractionReply.svelte";
  import { answerLiveInteraction, type LiveInteraction } from "$lib/chat-live-interaction.js";
  import { pendingInteractions } from "$lib/stores/interaction-watcher.js";

  interface Props {
    question: LiveInteraction;
  }
  const { question }: Props = $props();

  let busy = $state(false);
  let error = $state<string | undefined>(undefined);
  let answered = $state(false);
  let dismissed = $state(false);

  async function send(value: unknown) {
    busy = true;
    error = undefined;
    const out = await answerLiveInteraction(question, value);
    if (out.ok) {
      // Answered: clear it everywhere (Runs strip, run header) and drop this card.
      pendingInteractions.update((list) => list.filter((p) => !(p.runId === question.runId && p.interactionId === question.interactionId)));
      answered = true;
      return;
    }
    busy = false;
    error = out.error;
  }
</script>

{#if !answered && !dismissed}
  <div class="card rail rail-attention" data-testid="chat-live-interaction" data-run-id={question.runId}>
    <p class="h"><Status tone="attention" label="The agent asks you" /></p>
    <p class="prompt">{question.prompt}</p>
    {#if error}<p class="err" role="alert">{error}</p>{/if}
    {#if busy}
      <p class="busy" aria-live="polite"><Status tone="running" label="Sending your answer…" /></p>
    {:else}
      <InteractionReply kind={question.kind} schema={question.schema} onSend={(v) => void send(v)} onInvalid={(m) => (error = m)} />
      <div class="acts">
        <Button size="sm" variant="ghost" onclick={() => (dismissed = true)}>Dismiss</Button>
        <span class="note">The run is paused here until you answer.</span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .card { display: grid; gap: 8px; padding-left: 20px; max-width: var(--cortex-measure); font-size: var(--cortex-t-sm); }
  .h, .prompt, .busy, .err { margin: 0; }
  .prompt { font-size: var(--cortex-t-md); line-height: var(--cortex-lh-read); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--cortex-text); }
  .err { color: var(--cortex-bad); overflow-wrap: anywhere; }
  .acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .note { font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
