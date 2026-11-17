<script lang="ts">
  /**
   * Continue for an interrupted chat turn (stopped or paused by you, loop guard, budget,
   * timeout, error). When the latest assistant turn is a run that failed or was stopped and
   * the session's durable store holds a resumable run, the stop is shown under the thread
   * with a note field, a step grant and Continue. Continue calls the
   * framework's `resumeRun` through the server; the reply lands in the thread as the next
   * exchange (`chatStore.refreshActive`). A streamed turn carries no run stamp, so the
   * stored run is looked up after each turn ends. Rules: `lib/loop-stop-resume.ts`.
   */
  import { chatStore } from "$lib/stores/chat-store.js";
  import { toast } from "$lib/stores/toast-store.js";
  import ContinueStopped from "$lib/components/ContinueStopped.svelte";
  import {
    continueChatRun,
    continueTarget,
    fetchChatResumable,
    loopStopHint,
    type ContinueBody,
    type ResumableRunWire,
  } from "$lib/loop-stop-resume.js";

  interface Props {
    sessionId: string;
  }
  const { sessionId }: Props = $props();

  const turns = $derived($chatStore.activeSessionId === sessionId ? $chatStore.activeTurns : []);
  const sending = $derived($chatStore.sending);
  /** A signature of the thread's tail, so the lookup reruns when a turn ends, not on every token. */
  const tail = $derived(`${turns.length}:${turns.at(-1)?.id ?? ""}:${turns.at(-1)?.runFailed ? "f" : "-"}`);

  let resumable = $state<ResumableRunWire[]>([]);
  /** The stored-run lookup for the current tail has answered (the hint waits for it). */
  let lookedUp = $state(false);
  let busyRun = $state<string | undefined>(undefined);
  let error = $state<string | undefined>(undefined);

  $effect(() => {
    void tail;
    void sending;
    const id = sessionId;
    const last = turns.at(-1);
    // Only a settled failed assistant turn can be continued: skip the request otherwise.
    lookedUp = false;
    if (sending || last?.role !== "assistant" || last.runFailed === undefined) {
      resumable = [];
      return;
    }
    let live = true;
    void fetchChatResumable(id).then((runs) => {
      if (!live) return;
      resumable = runs;
      lookedUp = true;
    });
    return () => {
      live = false;
    };
  });

  const target = $derived(continueTarget(turns, sending, resumable));
  const hint = $derived(loopStopHint(turns, sending, target, lookedUp));

  async function onContinue(runId: string, body: ContinueBody): Promise<void> {
    busyRun = runId;
    error = undefined;
    const out = await continueChatRun(sessionId, runId, body);
    busyRun = undefined;
    if (!out.ok) {
      error = out.error;
      return;
    }
    resumable = [];
    if (!out.success && out.resumable) toast.info("The run stopped again", "You can continue it once more.");
    await chatStore.refreshActive();
  }
</script>

{#if target}
  <div class="card rail rail-attention" data-testid="chat-continue" data-run-id={target.runId}>
    <ContinueStopped kind={target.kind} stop={target.stop} busy={busyRun === target.runId} {error} onContinue={(b) => void onContinue(target.runId, b)} />
  </div>
{:else if hint}
  <p class="hint" data-testid="chat-continue-hint">{hint}</p>
{/if}

<style>
  .card { padding-left: 20px; }
  .hint { margin: 0; max-width: var(--cortex-measure); font-size: var(--cortex-t-xs); color: var(--cortex-text-3); }
</style>
